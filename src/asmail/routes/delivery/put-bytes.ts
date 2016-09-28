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
import { SC as recipSC, ISaveBytes, BlobSaveOpts }
	from '../../resources/recipients';
import { msgObjSegs as api, ERR_SC, BlobQueryOpts }
	from '../../../lib-common/service-api/asmail/delivery';
import * as confUtil from '../../../lib-server/conf-util';
import { Request } from './start-session';

let CONTENT_TYPE = 'application/octet-stream';

function replyOnError(res: Response, total: number, append: boolean,
		offset: number): boolean {
	try {
		if (total !== null) {
			if (isNaN(total) || (total === 0)) {
				throw "Bad total parameter";
			}
		}
		if (offset !== null) {
			if (isNaN(offset) || (offset < 0)) {
				throw "Bad chunk offset parameter";
			}
		}
		if (append) {
			if (offset !== null) {
				throw "When appending file, offset parameter is illegal.";
			}
			if ((total !== null) && (total > 0)) {
				throw "Appending must be used only for blob of unknown size.";
			}
		} else {
			if (offset === null) {
				throw "Offset parameter is missing.";
			}
			if ((total === null) && (total < 0)) {
				throw "Total size must be known in non-appending mode.";
			}
		}
		return false;
	} catch (errMsg) {
		res.status(ERR_SC.malformed).send(errMsg);
		return true;
	}
}

function getContentLen(req: Request, res: Response,
		maxChunkSize: number): number {
	let contentLength = parseInt(req.headers['content-length'], 10);
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
}

export function saveMsgObjBytes(saveBytesFunc: ISaveBytes,
		chunkLimit: string|number): RequestHandler {
	if ('function' !== typeof saveBytesFunc) { throw new TypeError(
			"Given argument 'saveBytesFunc' must be function, but is not."); }
	let maxChunkSize = confUtil.stringToNumOfBytes(chunkLimit);

	return async function(req: Request, res: Response, next: NextFunction) {
		
		if (!req.is(CONTENT_TYPE)) {
			res.status(ERR_SC.wrongContentType).send(
				"Content-Type must be "+CONTENT_TYPE+" for this call.");
			return;
		}
	
		let session = req.session;
		let recipient = session.params.recipient;
		let msgId = session.params.msgId;
		
		if (!msgId) {
			res.status(ERR_SC.earlyReq).send(
				"Metadata has not been sent, yet.");
			return;
		}
		
		let objId: string = req.params.objId;
		
		let qOpts: BlobQueryOpts = req.query;
		
		let total = ('string' === typeof qOpts.total) ?
			parseInt(<any> qOpts.total) : null;
		let append = ((<any> qOpts.append) === 'true');
		let offset = ('string' === typeof qOpts.ofs) ?
			parseInt(<any> qOpts.ofs) : null;
		// get and check Content-Length
		let chunkLen = getContentLen(req, res, maxChunkSize);
		if ('number' !== typeof chunkLen) { return; }
		
		if (replyOnError(res, total, append, offset)) { return; }
		
		let opts: BlobSaveOpts = {
				msgId: msgId,
				objId: objId,
				appendMode: append,
				chunkLen: chunkLen,
				isFirstReq: (total !== null)
		};
		if (opts.isFirstReq && (total > 0)) {
			opts.totalSize = total;
		}
		if (!opts.appendMode) {
			opts.offset = offset;
		}
		
		let extraSpaceUsed = (opts.appendMode || opts.isFirstReq);
		if (extraSpaceUsed && (opts.chunkLen >
				session.params.maxMsgLength-session.params.currentMsgLength)) {
			res.status(ERR_SC.contentTooLong).send(
				"This request goes over the message limit.");
			return;
		}
		
		if (extraSpaceUsed) {
			session.params.currentMsgLength += opts.chunkLen;
		}
		
		try{
			await saveBytesFunc(recipient, req, opts);
			res.status(api.SC.ok).end();
		} catch (err) {
			if (extraSpaceUsed) {
				session.params.currentMsgLength -= opts.chunkLen;
			}
			if ("string" !== typeof err) {
				next(err);
			} else if (err === recipSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).send(
					"Recipient disappeared from the system.");
				session.close();
			} else if (err === recipSC.OBJ_EXIST) {
				res.status(api.SC.objAlreadyExists).send(
					"Object "+opts.objId+" already exists.");
			} else if (err === recipSC.MSG_UNKNOWN) {
				res.status(ERR_SC.server).send(
					"Message disappeared from the system.");
				session.close();
			} else if (err === recipSC.OBJ_UNKNOWN) {
				res.status(api.SC.unknownObj).send(
					"Object "+opts.objId+" is unknown.");
			} else if (err === recipSC.WRITE_OVERFLOW) {
				res.status(ERR_SC.malformed).send(
					"Attempt to write outside of set limits.");
			} else {
				next(new Error("Unhandled storage error code: "+err));
			}
		}
	};
}

Object.freeze(exports);