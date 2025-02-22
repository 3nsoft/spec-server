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
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

export type Envelope = web3n.ipc.Envelope;
export type EventEnvelope<T> = web3n.ipc.EventEnvelope<T>;
export type EventEndEnvelope = web3n.ipc.EventEndEnvelope;
export type EventException = web3n.ipc.EventException;
export type RequestEnvelope<T> = web3n.ipc.RequestEnvelope<T>;
export type ReplyEnvelope<T> = web3n.ipc.ReplyEnvelope<T>;

export namespace events {

	export namespace subscribe {

		export const REQ_NAME = 'subscribe';

	}
	Object.freeze(subscribe);

	export namespace unsubscribe {

		export const REQ_NAME = 'unsubscribe';

	}
	Object.freeze(unsubscribe);

}
Object.freeze(events);

Object.freeze(exports);