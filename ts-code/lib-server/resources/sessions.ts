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
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import * as express from 'express';
import * as http from 'http';

// Constant custom header
export const SESSION_ID_HEADER = "X-Session-Id";
const LOW_CASED_SESSION_ID_HEADER = SESSION_ID_HEADER.toLowerCase();

export interface SessionParams {
	userId: string;
}

export interface Session<T> {
	params: T;
	isAuthorized: boolean;
	id: string;
	lastAccessedAt: number;
	addCleanUp(func: { (): void; }): void;
	putIdIntoResponse(res: express.Response): void;
	close(): void;
}

export interface Request<T> extends express.Request {
	session: Session<T>;
}

export interface BaseRequest<T> extends http.IncomingMessage {
	session: Session<T>;
}

export type CheckSession<T> = (req: BaseRequest<T>) => Promise<boolean>;

export type GenerateSession<T> = () => Promise<Session<T>>;

export interface Factory<T> {
	generate: GenerateSession<T>;
	ensureAuthorizedSession(): express.RequestHandler;
	ensureOpenedSession(): express.RequestHandler;
	checkSession(): express.RequestHandler;
	ensureAuthorizedSessionForSocketStart(): CheckSession<T>;
}

export abstract class BaseSessionFactory<T> implements Factory<T> {
	
	abstract generate(): Promise<Session<T>>;

	protected abstract get(sId: string): Promise<Session<T>|undefined>;

	protected abstract add(s: Session<any>): Promise<void>;

	protected abstract remove(s: Session<T>): Promise<void>;

	protected async makeSession(id: string, params: T): Promise<Session<T>> {
		const cleanUpFuncs: ({ (): void; }|undefined)[] = [];
		const session: Session<T> = {
			params,
			isAuthorized: false,
			id: id,
			lastAccessedAt: Date.now(),
			addCleanUp: (func: { (): void; }): void => {
				if ('function' !== typeof func) { throw new Error(
						"Given argument func must be function."); } 
				cleanUpFuncs.push(func);
			},
			close: (): void => {
				this.remove(session);
				for (let i=0; i<cleanUpFuncs.length; i+=1) {
					const func = cleanUpFuncs[i];
					cleanUpFuncs[i] = undefined;
					try {
						if (typeof func === 'function') { func(); }
					} catch (err) {
						// where to log error(s)?
					}
				}
			},
			putIdIntoResponse: (res: express.Response): void => {
				const header = {};
				header[SESSION_ID_HEADER] = session.id;
				res.set(header);
			}
		};
		Object.seal(session);
		await this.add(session);
		return session;
	}

	/**
	 * This returns middleware function, that adds to request object a 'session'
	 * field with existing valid session object, or, if no session found, and
	 * it is configured so, responds with 401.
	 * @param factory to which resulting middleware is bound.
	 * @param send401WhenMissingSession is a flag, which, when true, makes
	 * middleware function to send 401 reply, when valid session object cannot
	 * be found.
	 * @param sessionMustBeAuthorized is a flag, which, when true,, makes
	 * middleware function to send 401 reply, when session needs to go through
	 * sender authorization step.
	 */
	private makeSessionMiddleware(
		send401WhenMissingSession: boolean,
		sessionMustBeAuthorized: boolean
	): express.RequestHandler {
		return async (
			req: Request<T>, res: express.Response, next: express.NextFunction
		) => {
			if ('OPTIONS' == req.method) {
				next();
				return;
			}
			
			// get session id header
			const sessionId = req.get(SESSION_ID_HEADER);
			if (typeof sessionId !== 'string') {
				if (send401WhenMissingSession) {
					res.status(401).send("Required to start new session.");
				} else {
					next();
				}
				return;
			}
			
			// get session, and attach it to request
			const session = await this.get(sessionId);
			if (session) {
				req.session = session;
				session.lastAccessedAt = Date.now();
			}

			// send error status or continue, depending on session and flags
			if (send401WhenMissingSession) {
				if (!req.session) {
					res.status(401).send("Required to start new session.");
				} else if (sessionMustBeAuthorized &&
						!req.session.isAuthorized) {
					res.status(401).send(
							"Required to complete authorization step.");
				} else {
					next();
				}
			} else {
				next();
			}
		};
	}
	
	/**
	 * This returns middleware function, that adds to request object a 'session'
	 * field with existing valid session object, or, if no session found, or if
	 * it is not yet set as authorized, responds with 401.
	 */
	ensureAuthorizedSession(): express.RequestHandler {
		return this.makeSessionMiddleware(true, true);
	}
	
	/**
	 * This returns middleware function, that adds to request object a 'session'
	 * field with existing valid session object, even if session is not yet
	 * authorized. If there is no session found, middleware responds with 401.
	 */
	ensureOpenedSession(): express.RequestHandler {
		return this.makeSessionMiddleware(true, false);
	}
	
	/**
	 * This returns middleware function, that adds to request object a 'session'
	 * field with existing valid session object, or creates a new not authorized,
	 * yet, session.
	 */
	checkSession(): express.RequestHandler {
		return this.makeSessionMiddleware(false, false);
	}

	/**
	 * This returns a function that checks for an authorized session, attaching
	 * it to request object, and resolving returned promise to true. Else, if
	 * there is no session found, or if a session is not yet set as authorized,
	 * returned promise resolves to false.
	 * This function should be used for verification of incoming web-socket
	 * connection requests.
	 */
	ensureAuthorizedSessionForSocketStart(): CheckSession<T> {
		return async (req: BaseRequest<T>): Promise<boolean> => {
			// get session id header
			const sessionId = req.headers[LOW_CASED_SESSION_ID_HEADER];
			if (typeof sessionId !== 'string') { return false; }
			
			// get session, and check it
			const session = await this.get(sessionId);
			if (!session) { return false; }
			if (!session.isAuthorized) { return false; }
			
			// attach session to request
			req.session = session;
			session.lastAccessedAt = Date.now();
			return true;
		};
	}
	
}
Object.freeze(BaseSessionFactory.prototype);
Object.freeze(BaseSessionFactory);

export function wrapFactory<T>(impl: Factory<T>): Factory<T> {
	const wrap: Factory<T> = {
		checkSession: impl.checkSession.bind(impl),
		ensureAuthorizedSession: impl.ensureAuthorizedSession.bind(impl),
		ensureOpenedSession: impl.ensureOpenedSession.bind(impl),
		ensureAuthorizedSessionForSocketStart:
			impl.ensureAuthorizedSessionForSocketStart.bind(impl),
		generate: impl.generate.bind(impl)
	};
	return wrap;
}

Object.freeze(exports);