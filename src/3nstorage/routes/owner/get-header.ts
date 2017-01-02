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
import { IGetHeader, BlobGetOpts, SC as storeSC } from '../../resources/users';
import { GetSegsQueryOpts, ERR_SC, HTTP_HEADER, BIN_TYPE, objSegs as api }
	from '../../../lib-common/service-api/3nstorage/owner';
import { Request } from '../../../lib-server/routes/sessions/start';

export function getObjHeader(root: boolean, getObjHeaderFunc: IGetHeader):
		RequestHandler {
	if ('function' !== typeof getObjHeaderFunc) { throw new TypeError(
			"Given argument 'getObjHeaderFunc' must be function, but is not."); }

	return async function(req: Request, res: Response, next: NextFunction) {
		
		let userId = req.session.params.userId;
		let objId: string = (root ? null : req.params.objId);
		
		let requestedVersion: number|null = parseInt(req.query.ver);
		if (isNaN(requestedVersion)) {
			requestedVersion = null;
		}
		
		try {
			let { header, segsLen, version } = await getObjHeaderFunc(
				userId, objId, requestedVersion);
			res.status(api.SC.okGet);
			res.header(HTTP_HEADER.objSegmentsLength, `${segsLen}`);
			if (requestedVersion === null) {
				res.header(HTTP_HEADER.objVersion, `${version}`);
			}
			res.send(header);
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if ((err === storeSC.OBJ_UNKNOWN) ||
					(err === storeSC.WRONG_OBJ_STATE)) {
				res.status(api.SC.missing).send(objId ?
					`Object ${objId} (or requested version) is unknown.` :
					"Root object is not set, or request version is unknown.");
			} else if (err === storeSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).send(
					"Recipient disappeared from the system.");
				req.session.close();
			} else {
				next(new Error(`Unhandled storage error code: ${err}`));
			}
		}
		
	};
};

Object.freeze(exports);