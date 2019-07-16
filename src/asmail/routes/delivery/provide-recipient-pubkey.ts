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
import { SC as recipSC, GetPubKey } from '../../resources/recipients';
import { initPubKey as api, ERR_SC } from '../../../lib-common/service-api/asmail/delivery';
import { Request } from '../../resources/delivery-sessions';

/**
 * This creates a get-init-pub-key route handler.
 * @param pkeyProvidingFunc is a function that provides recipient's public key
 * for use in this communication. 
 */
export function getRecipientPubKey(pkeyProvidingFunc: GetPubKey):
		RequestHandler {
	if ('function' !== typeof pkeyProvidingFunc) { throw new TypeError(
			"Given argument 'pkeyProvidingFunc' must be function, but is not."); }
	
	return async function(req: Request, res: Response, next: NextFunction) {
		
		const session = req.session;
		
		try{
			const certs = await pkeyProvidingFunc(session.params.recipient);
			if (certs) {
				res.status(api.SC.ok).json(certs);
			} else {
				res.status(api.SC.pkeyNotRegistered).send('No public key registered for the recipient.');
				session.close();
			}
		} catch (err) {
			if (typeof err !== "string") {
				next(err);
			} else if (err === recipSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).send(
					"Recipient disappeared from the system.");
				session.close();
			} else {
				next(new Error("Unhandled storage error code: "+err));
			}
		}
		
	};
}
Object.freeze(exports);