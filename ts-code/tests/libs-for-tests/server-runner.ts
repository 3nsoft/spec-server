/*
 Copyright (C) 2016 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import * as https from "https";
import { sslOpts } from '../../mock/tls-options';
import { AppWithWSs } from '../../lib-server/web-sockets/app';
import { sleep } from "../../lib-common/processes";

// allow client test calls to trust above self-signed cert
https.globalAgent.options.ca = sslOpts.cert;

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping';

export abstract class ServerRunner {
	
	protected state: ServerState = 'stopped';
	protected app: AppWithWSs = (undefined as any);
	
	constructor(
		protected servicePort: number
	) {}
	
	abstract prepToRun(): Promise<AppWithWSs>;
	
	abstract clean(): Promise<void>;
	
	isRunning(): boolean {
		return (this.state === 'running');
	}

	async start(): Promise<void> {
		if (this.state !== 'stopped') { throw new Error(
			`Home server is already in ${this.state} state.`); }
		this.state = 'starting';
		this.app = await this.prepToRun();
		await this.app.start(sslOpts, this.servicePort);
		await sleep(100);
		this.state = 'running';
	}
	
	async stop(doCleanup = true): Promise<void> {
		if (this.state !== 'running') { throw new Error(
			`Home server is in ${this.state} state instead of running state`); }
		this.state = 'stopping';
		await this.app.stop();
		this.app = (undefined as any);
		if (doCleanup) {
			await this.clean();
		}
		this.state = 'stopped';
	}

	async restart(): Promise<void> {
		if (this.isRunning()) {
			await this.stop(false);
		}
		await this.start();
	}
	
	protected get url(): string {
		return `https://localhost:${this.servicePort}/`;
	}
	
}
Object.freeze(ServerRunner.prototype);
Object.freeze(ServerRunner);

Object.freeze(exports);