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

import { EventfulServer, makeEventfulServer, makeJsonCommPoint } from '../../lib-common/ipc/ws-ipc';
import * as WebSocket from 'ws';
import { SocketIPCs } from './app';
import { bind } from '../../lib-common/binding';

export type EventsSink<T> = (userId: string, channel: string, event: T) => void;

export class ServerEvents<T> implements SocketIPCs {

	private socketToIPC = new WeakMap<WebSocket, EventfulServer>();

	constructor(
			public ipcChannel: string|undefined,
			private eventChannels: string[],
			private getSocket: (userId: string) => Set<WebSocket>|undefined) {
		Object.seal(this);
	}

	attachIPC(userId: string, ws: WebSocket): void {
		const comm = makeJsonCommPoint(ws);
		const ipc = makeEventfulServer(this.ipcChannel, comm);
		for (const channel of this.eventChannels) {
			ipc.addEventGroup(channel, async () => {});
		}
		this.socketToIPC.set(ws, ipc);
	}

	private sendEvent(userId: string, channel: string, event: T): void {
		const sockets = this.getSocket(userId);
		if (!sockets) { return; }
		for (const ws of sockets) {
			const ipc = this.socketToIPC.get(ws);
			if (!ipc) { continue; }
			ipc.sendEvent(channel, event);
		}
	}

	get eventsSink(): EventsSink<T> {
		return bind(this, this.sendEvent);
	}

}
Object.freeze(ServerEvents.prototype);
Object.freeze(ServerEvents);

Object.freeze(exports);