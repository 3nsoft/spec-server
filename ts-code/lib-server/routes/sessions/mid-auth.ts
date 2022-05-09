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
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { RequestHandler } from 'express';
import { Request } from './start';
import { SignedLoad, isLikeSignedMailerIdAssertion, isLikeSignedKeyCert } from '../../../lib-common/jwkeys';
import { authSession as api, ERR_SC } from '../../../lib-common/service-api/mailer-id/login';

/**
 * This function returns a promise, which resolves to true for
 * authorization passing, and to false for failed authorization.
 * Autherization failure may be due to either, invalid MailerId credentials, or
 * due to other service's restriction(s) on users.
 */
export type MidAuthorizer = (
	rpDomain: string, sessionId: string, userId: string,
	mailerIdAssertion: SignedLoad, userCert: SignedLoad, provCert: SignedLoad
) => Promise<boolean>;

/**
 * @param relyingPartyDomain is a domain of service, for which this assertion
 * check is done. Usually, it is this site's domain, which we set explicitly.
 * @param midAuthorizingFunc
 * This creates an authorize-sender route handler.
 */
export function midLogin(
	relyingPartyDomain: string, midAuthorizingFunc: MidAuthorizer
): RequestHandler {
	if ('function' !== typeof midAuthorizingFunc) { throw new TypeError(
			"Given argument 'midAuthorizingFunc' must be function, but is not."); }

	return async (req: Request, res, next) => {
		
		if (req.session.isAuthorized) {
			res.status(ERR_SC.duplicate).send(
				"This protocol request has already been served.");
			return;
		}
		
		const rb: api.Request = req.body;
		const sessionId = req.session.id;
		
		if (!isLikeSignedMailerIdAssertion(rb.assertion) ||
				!isLikeSignedKeyCert(rb.userCert) ||
				!isLikeSignedKeyCert(rb.provCert)) {
			res.sendStatus(ERR_SC.malformed);
			req.session.close();
			return;
		}
		
		try {
			const certsVerified = await midAuthorizingFunc(relyingPartyDomain,
				sessionId, req.session.params.userId,
				rb.assertion, rb.userCert, rb.provCert);
			if (certsVerified) {
				req.session.isAuthorized = true;
				res.status(api.SC.ok).end();
			} else {
				req.session.close();
				res.status(api.SC.authFailed).send(
					"Server is not accepting provided credentials.");
			}
		} catch (err) {
			next(err);
		}
		
	};
}
Object.freeze(exports);