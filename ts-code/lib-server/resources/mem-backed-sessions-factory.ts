/*
 Copyright (C) 2015 - 2017, 2021 3NSoft Inc.
 
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

/**
 * This module constructs memory-backed sessions factories.
 */

import { Factory, Session, BaseSessionFactory, wrapFactory } from './sessions';
import { bytes as randomBytes } from '../../lib-common/random-node';
import { base64urlSafe } from '../../lib-common/buffer-utils';
import { compareVectors } from 'ecma-nacl';

const ID_BYTES_LEN = 30;
const ID_STR_CHUNK_LEN = 15;


export class InMemorySessions<T> extends BaseSessionFactory<T> {

	private sessions = new Map<string, [Uint8Array, Session<T>]>();
	private timeoutCodeIntervalId: NodeJS.Timer|undefined = undefined;
	private timeoutMillis: number;

	private checkSessionsForTimeout = () => {
		const now = Date.now();
		for (const [, s] of this.sessions.values()) {
			if ((now - s.lastAccessedAt) >= this.timeoutMillis) { s.close(); }
		}
	};

	private makeDefaultSessionParams: (sessionId: string) => T;

	protected constructor(timeoutSecs: number,
			makeSessionParams: (sessionId: string) => T) {
		super();
		if ((typeof timeoutSecs !== 'number') || (timeoutSecs <= 0)) {
			throw new Error("Given timeout must be a number greater than zero."); }
		this.timeoutMillis = timeoutSecs*1000;
		if (typeof makeSessionParams !== 'function') { throw new TypeError(
			`Given argument 'makeSessionParams' is not a function.`) }
		this.makeDefaultSessionParams = makeSessionParams;
	}

	async generate(): Promise<Session<T>> {
		let newSessionId: string;
		do {
			newSessionId = base64urlSafe.pack(await randomBytes(ID_BYTES_LEN));
		} while (this.sessions.has(strChunk(newSessionId)));
		const params = this.makeDefaultSessionParams(newSessionId);
		const session = this.makeSession(newSessionId, params);
		return session;
	}

	protected async add(s: Session<T>): Promise<void> {
		const { key, idBytes } = idToChunks(s.id);
		this.sessions.set(key, [idBytes, s]);
		if (this.sessions.size === 1) {
			this.timeoutCodeIntervalId = setInterval(
				this.checkSessionsForTimeout, this.timeoutMillis/2);
		}
	}

	protected async remove(s: Session<T>): Promise<void> {
		if (this.sessions.delete(strChunk(s.id))) {
			if (this.sessions.size === 0) {
				clearInterval(this.timeoutCodeIntervalId!);
				this.timeoutCodeIntervalId = undefined;
			}
		}
	}

	protected async get(sId: string): Promise<Session<T>|undefined> {
		const idAndSession = this.sessions.get(strChunk(sId));
		return ((idAndSession && sameIdBytes(sId, idAndSession[0])) ?
			idAndSession[1] : undefined);
	}

	/**
	 * This returns factory, that works properly in a single process application,
	 * clearing up sessions that past given timeout.
	 * @param timeout is a session timeout in seconds
	 * @param makeDefaultSessionParams is a function that creates session
	 * parameters object in some initial/default state
	 */
	static factory<T>(timeout: number, makeDefaultSessionParams: () => T):
			Factory<T> {
		const factory = new InMemorySessions(timeout, makeDefaultSessionParams);
		Object.seal(factory);
		return Object.freeze(wrapFactory(factory));
	}

}
Object.freeze(InMemorySessions.prototype);
Object.freeze(InMemorySessions);


function sameIdBytes(idStr: string, idBytes: Uint8Array): boolean {
	try {
		const bytes = base64urlSafe.open(idStr);
		return compareVectors(bytes, idBytes);
	} catch (err) {
		return false;
	}
}

function idToChunks(sessionId: string): { key: string; idBytes: Uint8Array; } {
	const idBytes = base64urlSafe.open(sessionId);
	const key = sessionId.substring(0, ID_STR_CHUNK_LEN);
	return { key, idBytes };
}

function strChunk(sessionId: string): string {
	return sessionId.substring(0, ID_STR_CHUNK_LEN);
}


Object.freeze(exports);