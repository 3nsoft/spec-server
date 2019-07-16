/*
 Copyright (C) 2017 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>. */

import * as http from 'http';
import * as https from 'https';
import * as express from 'express';
import * as WebSocket from 'ws';
import { bind } from '../../lib-common/binding';
import { MapOfSets } from '../../lib-common/map-of-sets';
import { CheckSession, BaseRequest as HttpRequest, SessionParams } from '../resources/sessions';
import { parse as parseUrl } from 'url';
	
export type HttpServer = http.Server | https.Server;

const MAX_MSG_PAYLOAD = 4*1024;


class UserSocketsServer {

	/**
	 * This is a web socket server. It is undefined, when app hasn't started, or
	 * when it has already closed.
	 */
	private wss: WebSocket.Server|undefined = undefined;

	private socksByPath = new Map<string, UserSockets>();
	
	prefixPathsWith(prefix: string): void {
		if (this.wss) { throw new Error(`Already connected to an http server`); }
		if (!prefix) { return; }
		prefix = ensureSlashesOnFront(prefix);
		const socksByPath = new Map<string, UserSockets>();
		for (const socks of this.socksByPath.values()) {
			socks.path = `${prefix}${socks.path}`;
			socksByPath.set(socks.path, socks);
		}
		this.socksByPath = socksByPath;
	}

	connectTo(server: HttpServer): void {
		if (this.wss) { throw new Error(`Already connected to an http server`); }

		this.wss = new WebSocket.Server({
			server,
			clientTracking: true,
			maxPayload: MAX_MSG_PAYLOAD,
			verifyClient: bind(this, this.verifyClient)
		} as WebSocket.ServerOptions)
		.on('connection', bind(this, this.handleConnection) as any)	// bad @types
		.on('error', (err) => { console.error(err); });

	}

	disconnect(): void {
		if (!this.wss) { return; }
		this.wss.close();
		this.wss = undefined;
		for (const socks of this.socksByPath.values()) {
			socks.disconnect();
		}
		this.socksByPath.clear();
	}

	private verifyClient(info: { req: http.IncomingMessage },
			cb: (res: boolean, code?: number, msg?: string) => void): void {
		const path = parseUrl(info.req.url!).path!;
		const socks = this.socksByPath.get(path);
		if (!socks) {
			cb(false, 405, `WebSocket upgrade is not provided on ${path}`);
			return;
		}
		socks.checkSession(info.req as HttpRequest<SessionParams>)
		.then((sessionOK) => {
			cb(sessionOK);
		}, (err) => {
			console.error(err);
			cb(false, 401, "Required to start new session.");
		});
	}

	private handleConnection(client: WebSocket, req: HttpRequest<SessionParams>):
			void {
		const userId = req.session.params.userId;
		const path = parseUrl(req.url!).path!;
		const socks = this.socksByPath.get(path);
		if (!socks) {
			client.close();
			return;
		}
		socks.handleConnection(userId, client);
	}

	addUserSockets(socks: UserSockets): void {
		if (this.socksByPath.has(socks.path)) { throw new Error(
			`Sockets component is already set on path ${socks.path}`); }
		this.socksByPath.set(socks.path, socks);
	}

	addUserSocketsFrom(sockServer: UserSocketsServer, path?: string): void {
		if (path) {
			sockServer.prefixPathsWith(path);
		}
		for (const sock of sockServer.socksByPath.values()) {
			this.addUserSockets(sock);
		}
	}

}
Object.freeze(UserSocketsServer.prototype);
Object.freeze(UserSocketsServer);

function ensureSlashesOnFront(path: string): string {
	while (path.endsWith('/')) {
		path = path.substring(0, path.length - 1);
	}
	if (!path.startsWith('/')) {
		path = `/${path}`;
	}
	return path;
}

export class UserSockets {

	/**
	 * Only connections that match this path are accepted.
	 */
	public path = '';

	private clients = new MapOfSets<string, WebSocket>();
	
	private ipcs: SocketIPCs[] = [];

	constructor(
			public checkSession: CheckSession<SessionParams>) {}

	disconnect(): void {
		this.clients.clear();
	}

	handleConnection(userId: string, client: WebSocket): void {
		for (const ipc of this.ipcs) {
			ipc.attachIPC(userId, client);
		}
		let pinger = new PingSender(client);
		client.on('close', () => {
			this.clients.remove(userId, client);
			pinger.close();
		});
		client.on('pong', () => pinger.onPong());
		this.clients.add(userId, client);
	}

	addSocketIPC(ipc: SocketIPCs): void {
		if (this.ipcs.find(existingIPC =>
				(existingIPC.ipcChannel === ipc.ipcChannel))) {
			throw new Error(`IPC channel ${ipc.ipcChannel} on a web socket is already set.`);
		}
		this.ipcs.push(ipc);
	}

	get socketGetter(): (userId: string) => Set<WebSocket>|undefined {
		return (userId => this.clients.get(userId));
	}

}
Object.freeze(UserSockets.prototype);
Object.freeze(UserSockets);

class PingSender {

	private outstandingPong = 0;
	private client: WebSocket|undefined;
	private fourMinCheck: NodeJS.Timer;
	
	constructor(client: WebSocket) {
		this.client = client;
		this.fourMinCheck = setInterval(() => this.recurrentPing(), 4*60*1000);
		this.fourMinCheck.unref();
	}

	private recurrentPing() {
		if (!this.client) { return this.close(); }
		if (this.outstandingPong === 0) {
		} else if (this.outstandingPong === 1) {
			setTimeout(() => this.additionalPing(), 2*60*1000).unref();
		} else {
			this.client.close();
			return;
		}
		this.client.ping();
		this.outstandingPong += 1;
	}

	additionalPing() {
		if (!this.client) { return; }
		if (this.outstandingPong === 0) { return; }
		this.client.ping();
		this.outstandingPong += 1;
	}

	onPong() {
		this.outstandingPong = 0;
	}
	
	close() {
		if (!this.client) { return; }
		this.client = undefined;
		clearInterval(this.fourMinCheck);
	}
}
Object.freeze(PingSender.prototype);
Object.freeze(PingSender);

export interface SocketIPCs {
	ipcChannel: string|undefined;
	attachIPC(userId: string, ws: WebSocket): void;
}

export class AppWithWSs {

	private server: HttpServer|undefined = undefined;
	private closingProc: Promise<void>|undefined = undefined;
	http: express.Express;

	private socks: UserSocketsServer|undefined = undefined;
	private get sockServer(): UserSocketsServer {
		if (!this.socks) {
			this.socks = new UserSocketsServer();
		}
		return this.socks;
	}

	constructor(httpApp?: express.Express) {
		this.http =  (httpApp ? httpApp : express());
		Object.seal(this);
	}

	addWS(path: string, socks: UserSockets): void;
	addWS(socks: UserSockets): void;
	addWS(path: string|UserSockets, socks?: UserSockets): void {
		if (typeof path === 'string') {
			socks!.path = ensureSlashesOnFront(path);
		} else {
			socks = path;
		}
		this.sockServer.addUserSockets(socks!);
	}

	use(path: string, app: AppWithWSs): void;
	use(app: AppWithWSs): void;
	use(path: string|AppWithWSs, app?: AppWithWSs): void {
		if (typeof path === 'string') {
			if (!app) { throw new TypeError(`App argument is missing`); }
			this.http.use(path, app.http);
			if (app.socks) {
				this.sockServer.addUserSocketsFrom(app.socks, path);
			}
		} else {
			app = path;
			this.http.use(app.http);
			if (app.socks) {
				this.sockServer.addUserSocketsFrom(app.socks);
			}
		}
	}

	start(sslOts: https.ServerOptions|undefined,
			port: number, hostname?: string): Promise<void> {
		if (this.server) { throw new Error(`Server is already set`); }

		// setup server
		this.server = (sslOts ?
			https.createServer(sslOts, this.http) :
			http.createServer(this.http));
		if (this.socks) {
			this.socks.connectTo(this.server);
		}

		// start listening
		this.closingProc = undefined;
		return new Promise<void>((resolve, reject) => {
			const cb = (err?) => {
				if (err) { reject(err); }
				else { resolve(); }
			};
			if (hostname) {
				this.server!.listen(port, hostname, cb);
			} else {
				this.server!.listen(port, cb);
			}
		});
	}

	async stop(): Promise<void> {
		if (!this.server) { return; }
		if (!this.closingProc) {
			if (this.socks) {
				this.socks.disconnect();
			}
			this.closingProc = new Promise<void>((resolve, reject) => {
				const cb = (err) => {
					if (err) { reject(err); }
					else { resolve(); }
				};
				this.server!.close(cb);
				this.server = undefined;
			});
		}
		await this.closingProc;
	}

}
Object.freeze(AppWithWSs.prototype);
Object.freeze(AppWithWSs);

Object.freeze(exports);