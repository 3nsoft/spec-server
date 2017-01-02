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
import { SC as recipSC, IGetBytes, BlobGetOpts }
	from '../../resources/recipients';
import { BlobQueryOpts, ERR_SC, msgObjSegs as api }
	from '../../../lib-common/service-api/asmail/retrieval';
import { Request } from '../../../lib-server/routes/sessions/start';

let EMPTY_BUFFER = new Buffer(0);

export function getMsgObjBytes(getMsgObjFunc: IGetBytes): RequestHandler {
	if ('function' !== typeof getMsgObjFunc) { throw new TypeError(
			"Given argument 'getMsgObjFunc' must be function, but is not."); }

	return async function(req: Request, res: Response, next: NextFunction) {
		
		let userId = req.session.params.userId;
		let msgId: string = req.params.msgId;
		let objId: string = req.params.objId;
		
		let query: BlobQueryOpts = req.query;
		let maxLen: number|undefined = parseInt(<any> query.len);
		let bytesOffset = parseInt(<any> query.ofs);
		
		if (isNaN(bytesOffset)) {
			bytesOffset = 0;
		}
		if (isNaN(maxLen)) {
			maxLen = undefined;
		}
		if ((bytesOffset < 0) || ((maxLen !== undefined) && (maxLen < 1))) {
			res.status(ERR_SC.malformed).send("Bad numeric parameters");
			return;
		}
		
		let opts: BlobGetOpts = {
				msgId: msgId,
				objId: objId,
				offset: bytesOffset
		};
		if (maxLen) {
			opts.maxLen = maxLen;
		}
		
		try{
			let objReader = await getMsgObjFunc(userId, opts);
			if (objReader) {
				res.status(api.SC.ok);
				res.set({
					'Content-Type': 'application/octet-stream',
					'Content-Length': ''+objReader.len
				});
				objReader.stream.pipe(res, { end: true });
			} else {
				res.status(api.SC.ok).send(EMPTY_BUFFER);
			}
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if (err === recipSC.OBJ_UNKNOWN) {
				res.status(api.SC.unknownMsgOrObj).send(
					"Object "+opts.objId+" is unknown.");
			} else if (err === recipSC.MSG_UNKNOWN) {
				res.status(api.SC.unknownMsgOrObj).send(
					"Message "+msgId+" is unknown.");
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