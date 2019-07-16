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
import { CancelTransaction, SC as storeSC } from '../../resources/users';
import { cancelTransaction as api, ERR_SC } from '../../../lib-common/service-api/3nstorage/owner';
import { Request } from '../../resources/sessions';

export function cancelTransaction(root: boolean,
		cancelTransFunc: CancelTransaction): RequestHandler {
	if ('function' !== typeof cancelTransFunc) { throw new TypeError(
			"Given argument 'cancelTransFunc' must be function, but is not."); }

	return async function(req: Request, res: Response, next: NextFunction) {
		
		const userId = req.session.params.userId;
		const objId: string = (root ? null : req.params.objId);
		const transactionId: string = req.params.transactionId;
		
		try {
			await cancelTransFunc(userId, objId,
				((transactionId === '-') ? undefined : transactionId));
			res.status(api.SC.ok).end();
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if ((err === storeSC.TRANSACTION_UNKNOWN)
			|| (err === storeSC.OBJ_UNKNOWN)
			|| (err === storeSC.OBJ_VER_UNKNOWN)) {
				res.status(api.SC.missing).send(
					"Unknown transaction or object.");
			} else if (err === storeSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).send(
					"Recipient disappeared from the system.");
				req.session.close();
			} else {
				next(new Error("Unhandled storage error code: "+err));
			}
		}
		
	};
};

Object.freeze(exports);