/*
 Copyright (C) 2015 - 2017, 2019 - 2020 3NSoft Inc.
 
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

import { RequestHandler, Response } from 'express';
import { SC as recipSC, SaveObj, BIN_TYPE } from '../../resources/recipients';
import { msgObj as api, ERR_SC, HTTP_HEADER, PutObjFirstQueryOpts, PutObjSecondQueryOpts } from '../../../lib-common/service-api/asmail/delivery';
import * as confUtil from '../../../lib-server/conf-util';
import { Request } from '../../resources/delivery-sessions';
import { attachByteDrainToRequest } from '../../../lib-server/middleware/body-parsers';

export function saveMsgObj(
	saveObjFunc: SaveObj, chunkLimit: string|number
): RequestHandler {
	if ('function' !== typeof saveObjFunc) { throw new TypeError(
		"Given argument 'saveObjFunc' must be function, but is not."); }
	const maxChunkSize = confUtil.stringToNumOfBytes(chunkLimit);

	return async (req: Request, res, next) => {
		
		if (!req.is(BIN_TYPE)) {
			attachByteDrainToRequest(req);
			res.status(ERR_SC.wrongContentType).send(`Content-Type must be ${BIN_TYPE} for this call.`);
			return;
		}
	
		const session = req.session;
		const recipient = session.params.recipient;
		const msgId = session.params.msgId;

		if (!msgId) {
			res.status(ERR_SC.earlyReq).send(
				"Metadata has not been sent, yet.");
			return;
		}
	
		const objId: string = req.params.objId;
		
		// get and check Content-Length, implicitly sending replies for bad length
		let len = getContentLenOrSendError(req, res, maxChunkSize);
		if (len === undefined) {
			attachByteDrainToRequest(req);
			return;
		}
		
		// extract and check query parameters
		const opts = extractQueryOptions(req);
		if (!opts) { return replyToMalformed(req, "Bad query parameters", res); }

		if (opts.fstReq) {
			// check options versus chunk length
			if (opts.fstReq.header > len) { return replyToMalformed(req,
				"Bad query parameters", res); }
		} else if (opts.sndReq) {
			// check options versus chunk length
			if ((len === 0) && !opts.sndReq.last) { return replyToMalformed(req, "No segment bytes", res); }
		} else {
			return next(new Error(`This place should not be reachable`));
		}
		
		// ensure that it is ok space-wise to save additional bytes
		const allowedSpace =
			(session.params.maxMsgLength - session.params.currentMsgLength);
		if (len <= allowedSpace) {
			session.params.currentMsgLength += len;
		} else {
			res.status(ERR_SC.contentTooLong).send(
				"This request goes over the message limit.");
			return;
		}

		try {
			await saveObjFunc(recipient, msgId, objId,
				opts.fstReq, opts.sndReq, len, req);
			res.status(api.SC.ok).end();
		} catch (err) {
			session.params.currentMsgLength -= len;
			if ("string" !== typeof err) {
				next(err);
			} else if (err === recipSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).send(
					"Recipient disappeared from the system.");
				session.close();
			} else if (err === recipSC.OBJ_EXIST) {
				res.status(api.SC.objAlreadyExists).send(
					`Object ${objId} already exists.`);
			} else if (err === recipSC.MSG_UNKNOWN) {
				res.status(ERR_SC.server).send(
					"Message disappeared from the system.");
				session.close();
			} else if (err === recipSC.OBJ_UNKNOWN) {
				res.status(api.SC.unknownObj).send(`Object ${objId} is unknown.`);
			} else if (err === recipSC.WRONG_OBJ_STATE) {
				res.status(ERR_SC.malformed).send(`Object ${objId} is not in a different state.`);
			} else if (err === recipSC.OBJ_FILE_INCOMPLETE) {
				res.status(ERR_SC.objIncomplete).send(`Object ${objId} is not complete.`);
			} else {
				next(new Error(`Unhandled storage error code: ${err}`));
			}
		}
	};
}

function extractQueryOptions(req: Request): undefined|{
	fstReq?: PutObjFirstQueryOpts; sndReq?: PutObjSecondQueryOpts;
} {
	if ((req.query as any as PutObjFirstQueryOpts).header) {
		// this is the first request
		// query fields are string or undefined, yet, type info helps the show
		const query = req.query as any as PutObjFirstQueryOpts;

		const header = parseInt(query.header as any);
		if (isNaN(header) || (header < 1)) { return; }

		const last = ((query.last as any) === 'true');

		return { fstReq: { header, last } };
		
	} else {
		// this is the second (not first) request
		// query fields are string or undefined, yet, type info helps the show
		const query = req.query as any as PutObjSecondQueryOpts;

		const last = ((query.last as any) === 'true');

		const ofs = parseInt(query.ofs as any);
		if (isNaN(ofs) || (ofs < 0)) { return; }

		return { sndReq: { ofs, last } };

	}
}

function getContentLenOrSendError(
	req: Request, res: Response, maxChunkSize: number
): number|undefined {
	const contentLength = parseInt(req.get(HTTP_HEADER.contentLength)!);
	if (isNaN(contentLength)) {
		res.status(ERR_SC.contentLenMissing).send(
			"Content-Length header is required with proper number.");
	} else if (contentLength > maxChunkSize) {
		res.status(ERR_SC.contentTooLong).send("Request body is too long.");
	} else {
		return contentLength;
	}
	return;
}

function replyToMalformed(req: Request, msg: string, res: Response): void {
	attachByteDrainToRequest(req);
	res.status(ERR_SC.malformed).send(msg);
}

Object.freeze(exports);