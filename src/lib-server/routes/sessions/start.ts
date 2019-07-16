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

import { RequestHandler, Response, NextFunction } from 'express';
import { GenerateSession, Request as SessionReq, SessionParams } from '../../resources/sessions';
import { startSession as api, ERR_SC, ErrorReply } from '../../../lib-common/service-api/mailer-id/login';
import { checkAndTransformAddress } from '../../../lib-common/canonical-address';

export type Request = SessionReq<SessionParams>;

/**
 * This function checks overall shape of a given user id, possibly
 * transforming it to some canonical form, used by the service.
 * If incoming id is ok, function returns it in a canonical form.
 * Else, if incoming id is not ok, undefined is returned.
 * @params initUserId is a an incoming string, that should be an id
 */
export type CheckAndTransformUserId = (initUserId: string) => string|undefined;

export type UserExists = (userId: string) => Promise<boolean>;

export type Redirect = (userId: string) => Promise<string>;

/**
 * This returns route handler that creates sessions for a given userId, with
 * potential redirect for a named user.
 * @param checkIdFunc
 * @param allowUserFunc
 * @param sessionGenFunc
 * @param redirectFunc (optional)
 */
export function startSession(
		userExistsFunc: UserExists,
		sessionGenFunc: GenerateSession<any>,
		redirectFunc?: Redirect): RequestHandler {
	if ('function' !== typeof userExistsFunc) { throw new TypeError(
			"Given argument 'userExistsFunc' must be function, but is not."); }
	if ('function' !== typeof sessionGenFunc) { throw new TypeError(
			"Given argument 'sessionGenFunc' must be function, but is not."); }
	if (('undefined' !== typeof redirectFunc) &&
			('function' !== typeof redirectFunc)) { throw new TypeError(
			"Given argument 'redirectFunc' must either be function, " +
			"or be undefined, but it is neither."); }
		
	async function serveRequestHere(userId: string, res: Response):
			Promise<void> {
		const userExists = await userExistsFunc(userId);
		if (userExists) {
			const session = await sessionGenFunc();
			(<SessionParams> session.params).userId = userId;
			res.status(api.SC.ok).json( <api.Reply> {
				sessionId: session.id,
			});
		} else {
			res.status(api.SC.unknownUser).json( <ErrorReply> {
				error: `User ${userId} is unknown.`
			});
		}
	}
	
	return async function(req: Request, res: Response, next: NextFunction) {
		
		const session = req.session;
		const userId = checkAndTransformAddress((req.body as api.Request).userId);
		
		if (!userId) {
			res.status(ERR_SC.malformed).json( <ErrorReply> {
				error: "User id is either malformed, or missing."
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
		
		try {
			if (redirectFunc) {
				const redirectTo = await redirectFunc(userId);
				if (redirectTo) {
					res.status(api.SC.redirect).json( <api.RedirectReply> {
						redirect: redirectTo
					});
				} else {
					await serveRequestHere(userId, res);
				}
			} else {
				await serveRequestHere(userId, res);
			}
		} catch (err) {
			next(err);
		}
	};
}
Object.freeze(exports);