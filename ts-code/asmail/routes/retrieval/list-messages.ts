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
import { SC as recipSC, GetMsgIds } from '../../resources/recipients';
import { listMsgs as api, ERR_SC } from '../../../lib-common/service-api/asmail/retrieval';
import { Request } from '../../resources/sessions';

export function listMsgIds(listMsgIdsFunc: GetMsgIds): RequestHandler {
	if ('function' !== typeof listMsgIdsFunc) { throw new TypeError(
			"Given argument 'listMsgIdsFunc' must be function, but is not."); }

	return async function(req: Request, res: Response, next: NextFunction) {
		const userId = req.session.params.userId;
		
		try {
			const msgIds = await listMsgIdsFunc(userId);
			res.status(api.SC.ok).json(msgIds);
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if (err === recipSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).send(
					"Recipient disappeared from the system.");
				req.session.close();
			} else {
				next(new Error("Unhandled storage error code: "+err));
			}
		}
		
	};
}

Object.freeze(exports);