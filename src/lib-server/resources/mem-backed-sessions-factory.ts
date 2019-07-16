/*
 Copyright (C) 2015 - 2017 3NSoft Inc.
 
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

/**
 * This module constructs memory-backed sessions factories.
 */

import { Factory, Session, BaseSessionFactory, wrapFactory }
	from './sessions';
import * as random from '../../lib-common/random-node';

export class InMemorySessions<T> extends BaseSessionFactory<T> {

	protected sessions = new Map<string, Session<T>>();
	private timeoutCodeIntervalId: NodeJS.Timer|undefined = undefined;
	private timeoutMillis: number;

	private checkSessionsForTimeout = () => {
		const now = Date.now();
		for (const s of this.sessions.values()) {
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
			newSessionId = await random.stringOfB64Chars(40);
		} while (this.sessions.has(newSessionId));
		const params = this.makeDefaultSessionParams(newSessionId);
		const session = this.makeSession(newSessionId, params);
		return session;
	}

	protected async add(s: Session<T>): Promise<void> {
		this.sessions.set(s.id, s);
		if (this.sessions.size === 1) {
			this.timeoutCodeIntervalId = setInterval(
				this.checkSessionsForTimeout, this.timeoutMillis/2);
		}
	}

	protected async remove(s: Session<T>): Promise<void> {
		if (this.sessions.delete(s.id)) {
			if (this.sessions.size === 0) {
				clearInterval(this.timeoutCodeIntervalId!);
				this.timeoutCodeIntervalId = undefined;
			}
		}
	}

	protected async get(sId: string): Promise<Session<T>|undefined> {
		return this.sessions.get(sId);
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

Object.freeze(exports);