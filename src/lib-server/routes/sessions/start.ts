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

import { RequestHandler, Response, NextFunction } from 'express';
import { IGenerateSession, Request as SessReq } from '../../resources/sessions';
import { startSession as api, ERR_SC, ErrorReply }
	from '../../../lib-common/service-api/mailer-id/login';

export interface SessionParams {
	userId: string;
}

export type Request = SessReq<SessionParams>;

export interface ICheckAndTransformUserId {
	/**
	 * This function checks overall shape of a given user id, possibly
	 * transforming it to some canonical form, used by the service.
	 * @params initUserId is a an incoming string, that should be an id
	 * @return if incoming id is ok, same, or transformed id is returned,
	 * else, if incoming id is not ok, undefined is returned.
	 */
	(initUserId: string): string|undefined;
}

export interface IUserExists {
	(userId: string): Promise<boolean>;
}

export interface IRedirect {
	(userId: string): Promise<string>;
}

/**
 * @param checkIdFunc
 * @param allowUserFunc
 * @param sessionGenFunc
 * @param redirectFunc (optional)
 * @return route handler that creates sessions for a given userId, with
 * potential redirect for a named user.
 */
export function startSession(
		checkIdFunc: ICheckAndTransformUserId,
		userExistsFunc: IUserExists,
		sessionGenFunc: IGenerateSession<any>,
		redirectFunc?: IRedirect): RequestHandler {
	if ('function' !== typeof checkIdFunc) { throw new TypeError(
			"Given argument 'checkIdFunc' must be function, but is not."); }
	if ('function' !== typeof userExistsFunc) { throw new TypeError(
			"Given argument 'userExistsFunc' must be function, but is not."); }
	if ('function' !== typeof sessionGenFunc) { throw new TypeError(
			"Given argument 'sessionGenFunc' must be function, but is not."); }
	if (('undefined' !== typeof redirectFunc) &&
			('function' !== typeof redirectFunc)) { throw new TypeError(
			"Given argument 'redirectFunc' must either be function, " +
			"or be undefined, but it is neither."); }
	
	return async function(req: Request, res: Response, next: NextFunction) {
		
		let session = req.session;
		let userId = checkIdFunc((<api.Request> req.body).userId);
		
		if (!userId) {
			res.status(ERR_SC.malformed).json( <ErrorReply> {
				error: "User id is missing."
			});
			return;
		}
		
		// already existing session indicates repeated call, which
		// should be bounced off
		if (session) {
			res.status(ERR_SC.duplicate).json( <ErrorReply> {
				error: "This protocol request has already been served."
			});
			return;
		}
		
		async function serveRequestHere() {
			let userExists = await userExistsFunc(userId!);
			if (userExists) {
				let session = await sessionGenFunc();
				(<SessionParams> session.params).userId = userId!;
				res.status(api.SC.ok).json( <api.Reply> {
					sessionId: session.id,
				});
			} else {
				res.status(api.SC.unknownUser).json( <ErrorReply> {
					error: "User "+userId+" is unknown."
				});
			}
		}
		
		try {
			if (redirectFunc) {
				let redirectTo = await redirectFunc(userId);
				if (redirectTo) {
					res.status(api.SC.redirect).json( <api.RedirectReply> {
						redirect: redirectTo
					});
				} else {
					await serveRequestHere();
				}
			} else {
				await serveRequestHere();
			}
		} catch (err) {
			next(err);
		}
	};
}
Object.freeze(exports);