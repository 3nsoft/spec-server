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
import { ISaveSegs, BlobSaveOpts, SC as saveSC } from '../../resources/users';
import { objSegs as api, ERR_SC, HTTP_HEADER, BIN_TYPE, PutSegsQueryOpts }
	from '../../../lib-common/service-api/3nstorage/owner';
import { stringToNumOfBytes } from '../../../lib-server/conf-util';
import { Request } from '../../../lib-server/routes/sessions/start';
import { attachByteDrainToRequest }
	from '../../../lib-server/middleware/body-parsers';

function replyOnError(res: Response, transactionId: string,
		append: boolean, offset: number|undefined): boolean {
	try {
		if ('string' !== typeof transactionId) {
			throw "Missing transaction id";
		}
		if (offset !== undefined) {
			if (isNaN(offset) || (offset < 0)) {
				throw "Bad chunk offset parameter";
			}
		}
		if (append) {
			if (offset !== undefined) {
				throw "When appending file, offset parameter is illegal.";
			}
		} else {
			if (offset === undefined) {
				throw "Offset parameter is missing.";
			}
		}
		return false;
	} catch (errMsg) {
		res.status(ERR_SC.malformed).send(errMsg);
		return true;
	}
}

function getContentLen(req: Request, res: Response,
		maxChunkSize: number): number|undefined {
	let contentLength = parseInt(req.get(HTTP_HEADER.contentLength), 10);
	if (isNaN(contentLength)) {
		res.status(ERR_SC.contentLenMissing).send(
			"Content-Length header is required with proper number.");
	} else if (contentLength === 0) {
		res.status(ERR_SC.malformed).send("No bytes given.");
	} else if (contentLength > maxChunkSize) {
		res.status(ERR_SC.contentTooLong).send("Request body is too long.");
	} else {
		return contentLength;
	}
	return;
}

export function saveObjSegments(root: boolean, saveBytesFunc: ISaveSegs,
		chunkLimit: string|number): RequestHandler {
	if ('function' !== typeof saveBytesFunc) { throw new TypeError(
			"Given argument 'saveBytesFunc' must be function, but is not."); }
	let maxChunkSize = stringToNumOfBytes(chunkLimit);

	return async function(req: Request, res: Response, next: NextFunction) {
		
		if (!req.is(BIN_TYPE)) {
			res.status(ERR_SC.wrongContentType).send(
				"Content-Type must be "+BIN_TYPE+" for this call.");
			return;
		}
	
		let session = req.session;
		let userId = session.params.userId;
		
		let objId: string = (root ? null : req.params.objId);
		
		let qOpts: PutSegsQueryOpts = req.query;
		
		let transactionId = qOpts.trans;
		let append = ((<any> qOpts.append) === 'true');
		let offset = (typeof qOpts.ofs === 'string') ?
			parseInt(<any> qOpts.ofs) : undefined;
		// get and check Content-Length, implicitly sending replies for bad length
		let chunkLen = getContentLen(req, res, maxChunkSize);
		if (chunkLen === undefined) {
			attachByteDrainToRequest(req);
			return;
		}
		
		// check parameters and send error replies
		if (replyOnError(res, transactionId, append, offset)) {
			attachByteDrainToRequest(req);
			return;
		}
		
		let opts: BlobSaveOpts = {
				objId,
				appendMode: append,
				transactionId,
				chunkLen
		};
		if (!opts.appendMode) {
			opts.offset = offset;
		}
		
		try {
			await saveBytesFunc(userId, req, opts);
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