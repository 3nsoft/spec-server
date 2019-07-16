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

import { InMemorySessions } from '../../lib-server/resources/mem-backed-sessions-factory';
import { Factory } from '../../lib-server/resources/sessions';
import { SessionParams } from '../../lib-server/routes/pub-key-login/start-exchange';
export { Request } from '../../lib-server/routes/pub-key-login/start-exchange';


export type SessionsFactory = Factory<SessionParams>;

function makeSessionParams(): SessionParams {
	return {
		userId: (undefined as any),
		encryptor: (undefined as any),
		serverVerificationBytes: (undefined as any),
		sessionKey: (undefined as any)
	 };
}

/**
 * This returns factory, that works properly in a single process application,
 * clearing up sessions that past given timeout.
 * @param timeout is a session timeout in seconds
 */
export function makeSessionFactory(timeout: number): SessionsFactory {
	return InMemorySessions.factory<SessionParams>(timeout, makeSessionParams);
}

Object.freeze(exports);