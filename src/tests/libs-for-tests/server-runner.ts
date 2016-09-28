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
 this program. If not, see <http://www.gnu.org/licenses/>. */

import * as https from "https";
import * as express from 'express';
import { startService, stopService } from '../../lib-server/async-server';
import { sslOpts } from '../../mock/tls-options';

// allow client test calls to trust above self-signed cert
(<any> https.globalAgent).options.ca = sslOpts.cert;

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping';

export abstract class ServerRunner {
	
	protected state: ServerState = 'stopped';
	protected server: https.Server = null;
	
	constructor(
		protected servicePort: number) {}
	
	abstract prepToRun(): Promise<express.Express>;
	
	abstract clean(): Promise<void>;
	
	isRunning(): boolean {
		return (this.state === 'running');
	}

	async start(): Promise<void> {
		if (this.state !== 'stopped') { throw new Error(
			`Home server is already in ${this.state} state.`); }
		this.state = 'starting';
		let app = await this.prepToRun();
		this.server = https.createServer(sslOpts, app);
		await startService(this.server, this.servicePort);
		this.state = 'running';
	}
	
	async stop(doCleanup = true): Promise<void> {
		if (this.state !== 'running') { throw new Error(
			`Home server is in ${this.state} state instead of running state`); }
		this.state = 'stopping';
		await stopService(this.server);
		this.server = null;
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