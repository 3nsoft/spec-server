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
import { IGetSegs, BlobGetOpts, SC as storeSC } from '../../resources/users';
import { GetSegsQueryOpts, ERR_SC, HTTP_HEADER, BIN_TYPE, objSegs as api }
	from '../../../lib-common/service-api/3nstorage/owner';
import { Request } from '../../../lib-server/routes/sessions/start';
import { errWithCause } from '../../../lib-common/exceptions/error';

let EMPTY_BUFFER = new Buffer(0);

function extractNumParams(req: Request): BlobGetOpts|undefined {
	let query: GetSegsQueryOpts = req.query;

	let offsetStr: string = <any> query.ofs;
	let offset = (offsetStr ? parseInt(offsetStr) : 0);
	if (isNaN(offset) || (offset < 0)) { return; }

	let maxLenStr: string = <any> query.len;
	let maxLen = (maxLenStr ? parseInt(maxLenStr) : null);
	if (maxLen !== null) {
		if (isNaN(maxLen) || (maxLen < 1)) { return; }
	}

	return { maxLen, offset };
}

export function getObjSegments(root: boolean, getObjSegsFunc: IGetSegs):
		RequestHandler {
	if ('function' !== typeof getObjSegsFunc) { throw new TypeError(
			"Given argument 'getObjSegsFunc' must be function, but is not."); }

	return async function(req: Request, res: Response, next: NextFunction) {
		
		let userId = req.session.params.userId;
		let objId: string = (root ? null : req.params.objId);
		
		let version = parseInt(req.query.ver);
		if (isNaN(version)) {
			res.status(ERR_SC.malformed).send("Bad version");
			return;
		}
		
		let opts = extractNumParams(req);
		if (!opts) {
			res.status(ERR_SC.malformed).send("Bad numeric parameters");
			return;
		}
		
		try {
			let objReader = await getObjSegsFunc(userId, objId, version, opts);
			res.status(api.SC.okGet);
			res.set(HTTP_HEADER.contentType, BIN_TYPE);
			res.set(HTTP_HEADER.contentLength, `${objReader.len}`);
			res.set(HTTP_HEADER.objSegmentsLength, `${objReader.segsLen}`);
			if (objReader.len > 0) {
				try {
					await objReader.pipe!(res);
				} catch (err) {
					console.error(errWithCause(err, 'Wasn\'t able to complete sending segments due to error in piping'));
				} finally {
					res.end();
				}
			} else {
				res.send(EMPTY_BUFFER);
			}
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if (err === storeSC.OBJ_UNKNOWN) {
				res.status(api.SC.missing).send(objId ?
					"Object "+objId+" is unknown." :
					"Root object is not set.");
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