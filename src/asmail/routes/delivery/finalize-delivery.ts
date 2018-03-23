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
import { SC as recipSC, FinalizeDelivery } from '../../resources/recipients';
import { Request } from '../../resources/delivery-sessions';
import { completion as api, ERR_SC }
	from '../../../lib-common/service-api/asmail/delivery';

export function finalizeDelivery(finDelivFunc: FinalizeDelivery):
		RequestHandler {
	if ('function' !== typeof finDelivFunc) { throw new TypeError(
			"Given argument 'finDelivFunc' must be function, but is not."); }

	return async function(req: Request, res: Response, next: NextFunction) {
		const session = req.session;
		const recipient = session.params.recipient;
		const msgId = session.params.msgId;
		
		try {
			await finDelivFunc(recipient, msgId);
			session.close();
			res.status(api.SC.ok).end();
		} catch (err) {
			if ('string' !== typeof err) {
				next(err);
			} else if (err === recipSC.USER_UNKNOWN) {
				session.close();
				res.status(ERR_SC.server).send(
					"Recipient disappeared from the system.");
			} else if (err === recipSC.MSG_UNKNOWN) {
				session.close();
				res.status(ERR_SC.server).send(
					"Message disappeared from the system.");
			} else {
				next(new Error("Unhandled storage error code: "+err));
			}
		}
		
	};
}
Object.freeze(exports);