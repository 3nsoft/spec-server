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
import { SignedLoad } from '../../../lib-common/jwkeys';
import { authSender as api, ERR_SC } from '../../../lib-common/service-api/asmail/delivery';
import { Request } from '../../resources/delivery-sessions';

export interface IMidAuthorizer {
	(rpDomain: string, sessionId: string, userId: string,
		mailerIdAssertion: SignedLoad, userCert: SignedLoad,
		provCert: SignedLoad): Promise<boolean>;
}

/**
 * This creates an authorize-sender route handler.
 * @param relyingPartyDomain at which this service operates, as seen by client
 * @param mailerIdAuthorizingFunc is a function returning promise, which
 * resolves into boolean flag, with true value for authorization passing,
 * and false for failed authorization. 
 */
export function authorize(relyingPartyDomain: string,
		midAuthorizingFunc: IMidAuthorizer): RequestHandler {
	if ('function' !== typeof midAuthorizingFunc) { throw new TypeError(
			"Given argument 'midAuthorizingFunc' must be function, but is not."); }
	
	return async function(req: Request, res: Response, next: NextFunction) {
		
		if (req.session.isAuthorized) {
			res.status(ERR_SC.duplicateReq).send(
				"This protocol request has already been served.");
			return;
		}
		
		const rb: api.Request = req.body;
		const sender = req.session.params.sender;
		const sessionId = req.session.id;

		if (!sender) {
			// This case must be rejected, because place for authorizing
			// anonymous connection is at the session start.
			res.status(api.SC.authFailed).send(
				"Server is not accepting provided credentials.");
			req.session.close();
			return;
		}
		
		if (!rb.assertion || !rb.userCert || !rb.provCert) {
			res.status(ERR_SC.malformed).send("No credentials given.");
			req.session.close();
			return;
		}
		
		try {
			const certsVerified = await midAuthorizingFunc(relyingPartyDomain,
				sessionId, sender, rb.assertion, rb.userCert, rb.provCert);
			if (certsVerified) {
				req.session.isAuthorized = true;
				res.status(api.SC.ok).end();
			} else {
				res.status(api.SC.authFailed).send(
					"Server is not accepting provided credentials.");
				req.session.close();
			}
		} catch (err) {
			next(err);
		}
		
	};
}
Object.freeze(exports);