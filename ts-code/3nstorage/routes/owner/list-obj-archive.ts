/*
 Copyright (C) 2016 3NSoft Inc.
 
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
import { ListObjArchive, SC as storeSC } from '../../resources/users';
import { archiveObj as api } from '../../../lib-common/service-api/3nstorage/owner';
import { Request } from '../../resources/sessions';

export function listObjArchive(root: boolean,
		listObjArchiveFunc: ListObjArchive): RequestHandler {
	if ('function' !== typeof listObjArchiveFunc) { throw new TypeError(
			"Given argument 'listObjArchiveFunc' must be function, but is not."); }

	return async function(req: Request, res: Response, next: NextFunction) {

		next(new Error('Not implemented, yet.'));

		// const userId = req.session.params.userId;
		// const objId: string = (root ? null : req.params.objId);
		// const version: number = (delCurrent ? null : req.params.version);
		
		// try {
		// 	await deleteObjFunc(userId, objId, version);
		// 	res.status(SC.ok).end();
		// } catch (err) {
		// 	if ("string" !== typeof err) {
		// 		next(err);
		// 	} else if (err === storeSC.CONCURRENT_TRANSACTION) {
		// 		res.status(SC.concurrentTransaction).send(
		// 			`Object ${objId} is currently under a transaction.`);
		// 	} else if (err === storeSC.OBJ_UNKNOWN) {
		// 		res.status(SC.unknownObj).send((version === null) ?
		// 			`Object ${objId} is unknown.` :
		// 			`Object ${objId} version ${version} is unknown.`);
		// 	} else if (err === storeSC.WRONG_OBJ_STATE) {
		// 		res.status(SC.incompatibleObjState).send(
		// 			`Object ${objId} is in a state, that does not allow to procede with this request.`);
		// 	} else if (err === storeSC.USER_UNKNOWN) {
		// 		res.status(api.ERR_SC.server).send(
		// 			"Recipient disappeared from the system.");
		// 		req.session.close();
		// 	} else {
		// 		next(new Error("Unhandled storage error code: "+err));
		// 	}
		// }
		
	};
};

Object.freeze(exports);