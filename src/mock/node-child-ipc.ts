/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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


import * as cProcs from 'child_process';
import { RawDuplex, RequestServer, makeRequestServer,
	RequestingClient, makeRequestingClient, Envelope, Observer,
	SingleObserverWrap }
	from '../lib-common/ipc/generic-ipc';

export { RequestEnvelope, RequestHandler } from '../lib-common/ipc/generic-ipc';

export type IPCToChild = RequestingClient;
export type IPCToParent = RequestServer;

export function commToChild(channel: string, child: cProcs.ChildProcess):
		IPCToChild {
	const observer = new SingleObserverWrap<Envelope>();
	const nodeListener = (env: Envelope) => observer.next(env);
	const rawDuplex: RawDuplex<Envelope> = {
		subscribe(obs: Observer<Envelope>): () => void {
			observer.set(obs);
			child.on('message', nodeListener);
			child.once('disconnet', () => observer.complete());
			return () => {
				observer.detach();
				child.removeListener('message', nodeListener);
			};
		},
		postMessage(env: any): void {
			child.send(env);
		}
	};
	return makeRequestingClient(channel, rawDuplex);
}

export function commToParent(channel: string): IPCToParent {
	const observer = new SingleObserverWrap<Envelope>();
	const nodeListener = (env: Envelope) => {
		if (observer && observer.next) { observer.next(env); }
	};
	const commPoint: RawDuplex<Envelope> = {
		subscribe(obs: Observer<Envelope>): () => void {
			observer.set(obs);
			process.on('message', nodeListener);
			return () => {
				observer.detach();
				process.removeListener('message', nodeListener);
			};
		},
		postMessage(env: any): void {
			process.send!(env);
		}
	};
	return makeRequestServer(channel, commPoint);
}

Object.freeze(exports);