/*
 Copyright (C) 2016, 2020 3NSoft Inc.
 
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
import { DeleteObj, SC as storeSC } from '../../resources/users';
import { ERR_SC, currentObj as api } from '../../../lib-common/service-api/3nstorage/owner';
import { Request } from '../../resources/sessions';

export function deleteObj(root: boolean, delCurrent: boolean,
		deleteObjFunc: DeleteObj): RequestHandler {
	if ('function' !== typeof deleteObjFunc) { throw new TypeError(
			"Given argument 'deleteObjFunc' must be function, but is not."); }

	return async (req: Request, res, next) => {
		
		const userId = req.session.params.userId;
		const objId: string = (root ? null as any : req.params.objId);
		const version: number = (delCurrent ? null as any : req.params.version);
		
		try {
			await deleteObjFunc(userId, objId, version);
			res.status(api.SC.okDelete).end();
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if (err === storeSC.CONCURRENT_TRANSACTION) {
				res.status(api.SC.concurrentTransaction).send(
					`Object ${objId} is currently under a transaction.`);
			} else if (err === storeSC.OBJ_UNKNOWN) {
				res.status(api.SC.unknownObj).send(`Object ${objId} is unknown.`);
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