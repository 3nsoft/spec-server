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
import { ISaveHeader, IGetHeaderSizeInTransaction, SC as saveSC }
	from '../../resources/users';
import { objHeader as api, ERR_SC, PutSegsQueryOpts }
	from '../../../lib-common/service-api/3nstorage/owner';
import { Request } from '../../../lib-server/routes/sessions/start';
import { parseBinaryBodyWithExpectedSize }
	from '../../../lib-server/middleware/body-parsers';

export function saveObjHeader(root: boolean,
		getHeaderSizeFunc: IGetHeaderSizeInTransaction,
		saveHeaderFunc: ISaveHeader): RequestHandler {
	if ('function' !== typeof getHeaderSizeFunc) { throw new TypeError(
			"Given argument 'getHeaderSizeFunc' must be function, but is not."); }
	if ('function' !== typeof saveHeaderFunc) { throw new TypeError(
			"Given argument 'saveHeaderFunc' must be function, but is not."); }

	return async function(req: Request, res: Response, next: NextFunction) {
		
		let session = req.session;
		let userId = session.params.userId;
		
		let objId: string = (root ? null : req.params.objId);
		
		let transactionId = (<PutSegsQueryOpts> req.query).trans;
		if (typeof transactionId !== 'string') {
			res.status(ERR_SC.malformed).send("Missing transaction id");
			return;
		}

		try {
			let expectedHeaderLen = await getHeaderSizeFunc(
				userId, objId, transactionId);

			let header = await parseBinaryBodyWithExpectedSize(
				req, expectedHeaderLen);

			await saveHeaderFunc(userId, objId, transactionId, header);
			res.status(api.SC.okPut).end();
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if ((err === saveSC.TRANSACTION_UNKNOWN) ||
					(err === saveSC.OBJ_UNKNOWN)) {
				res.status(api.SC.missing).send(
					"Unknown object or transaction.");
			} else if (err === saveSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).send(
					"Recipient disappeared from the system.");
				session.close();
			} else if (err === saveSC.WRITE_OVERFLOW) {
				res.status(ERR_SC.malformed).send(
					"Attempt to write outside of set limits.");
			} else if (err === saveSC.NOT_ENOUGH_SPACE) {
				res.status(ERR_SC.noSpace).send(
					"Reached storage limits.");
			} else {
				next(new Error("Unhandled storage error code: "+err));
			}
		}
	};
}

Object.freeze(exports);