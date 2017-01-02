/*
 Copyright (C) 2015 - 2016 3NSoft Inc.
 
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

import { Factory, Session, IdGenerator, SessionsContainer, makeSessionFactory }
	from './sessions';
import * as random from '../../lib-common/random-node';

/**
 * @param timeout is a session timeout in seconds
 * @return Factory which works properly in a single process application,
 * clearing up sessions that past given timeout.
 */
export function makeSingleProcFactory(timeout: number): Factory {
	if (('number' !== typeof timeout) || (timeout <= 0)) {
		throw new Error("Given timeout must be a number greater than zero."); }
	let sessions = new Map<string, Session<any>>();
	let idGenerator: IdGenerator = async () => {
		let newSessionId: string;
		do {
			newSessionId = random.stringOfB64Chars(40);
		} while (sessions.has(newSessionId));
		return newSessionId;
	}
	let sessionCount = 0;
	let timeoutMillis = timeout*1000;
	let timeoutCodeIntervalId: number|undefined = undefined;
	let checkSessionsForTimeout = () => {
		let now = Date.now();
		for (let s of sessions.values()) {
			if ((now - s.lastAccessedAt) >= timeoutMillis) { s.close(); }
		}
	}
	let checkPeriod = timeoutMillis/2;
	let container: SessionsContainer = {
			add: async (s: Session<any>) => {
				sessions.set(s.id, s);
				sessionCount += 1;
				if (sessionCount === 1) {
					timeoutCodeIntervalId = <any> setInterval(
							checkSessionsForTimeout, checkPeriod);
				}
			},
			remove: async (s: Session<any>) => {
				if (sessions.delete(s.id)) {
					sessionCount -= 1;
					if (sessionCount === 0) {
						clearInterval(timeoutCodeIntervalId!);
						timeoutCodeIntervalId = undefined;
					}
				}
			},
			get: async (sId: string) => {
				return sessions.get(sId);
			}
	};
	return makeSessionFactory(idGenerator, container);
}

Object.freeze(exports);