/*
 Copyright (C) 2015 - 2017, 2019 - 2020, 2025 - 2026 3NSoft Inc.
 
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
import { SC as recipSC, MsgDelivery, BIN_TYPE } from '../../resources/recipients';
import { msgObj as api, ERR_SC, HTTP_HEADER, PutObjFirstQueryOpts, PutObjSecondQueryOpts } from '../../../lib-common/service-api/asmail/delivery';
import * as confUtil from '../../../lib-server/conf-util';
import { Request } from '../../resources/delivery-sessions';
import { getObjIdFromParams, replyWithErr } from '../../resources/utils';

export function saveMsgObj(saveObjFunc: MsgDelivery['saveObj'], chunkLimit: string|number): RequestHandler {

	const maxChunkSize = confUtil.stringToNumOfBytes(chunkLimit);

	return async (req: Request, res, next) => {

		if (!req.is(BIN_TYPE)) {
			return replyWithErr(ERR_SC.wrongContentType, `Content-Type must be ${BIN_TYPE} for this call.`, res, req);
		}

		const session = req.session;
		const recipient = session.params.recipient;
		const msgId = session.params.msgId;

		if (!msgId) {
			return replyWithErr(ERR_SC.earlyReq, "Metadata has not been sent, yet.", res, req);
		}

		const { objId, objIdParseErr } = getObjIdFromParams(req);
		if (objIdParseErr) {
			return replyWithErr(ERR_SC.malformed, objIdParseErr, res);
		}

		// get and check Content-Length, implicitly sending replies for bad length
		let len = getContentLenOrSendError(req, res, maxChunkSize);
		if (len === undefined) {
			return;
		}

		// extract and check query parameters
		const opts = extractQueryOptions(req);
		if (!opts) {
			return replyWithErr(ERR_SC.malformed, "Bad query parameters", res, req);
		}

		if (opts.fstReq) {
			// check options versus chunk length
			if (opts.fstReq.header > len) {
				return replyWithErr(ERR_SC.malformed, "Bad query parameters", res, req);
			}
		} else if (opts.sndReq) {
			// check options versus chunk length
			if ((len === 0) && !opts.sndReq.last) {
				return replyWithErr(ERR_SC.malformed, "No segment bytes", res, req);
			}
		} else {
			return next(new Error(`This place should not be reachable`));
		}

		// ensure that it is ok space-wise to save additional bytes
		const allowedSpace = (session.params.maxMsgLength - session.params.currentMsgLength);
		if (len <= allowedSpace) {
			session.params.currentMsgLength += len;
		} else {
			return replyWithErr(ERR_SC.contentTooLong, "This request goes over the message limit.", res, req);
		}

		try {
			await saveObjFunc(recipient, msgId, objId, opts.fstReq, opts.sndReq, len, req);
			res.status(api.SC.ok).send();
		} catch (err) {
			session.params.currentMsgLength -= len;
			if ("string" !== typeof err) {
				next(err);
			} else if (err === recipSC.USER_UNKNOWN) {
				replyWithErr(ERR_SC.server, "Recipient disappeared from the system.", res);
				session.close();
			} else if (err === recipSC.OBJ_EXIST) {
				replyWithErr(api.SC.objAlreadyExists, `Object ${objId} already exists.`, res);
			} else if (err === recipSC.MSG_UNKNOWN) {
				replyWithErr(ERR_SC.server, "Message disappeared from the system.", res);
				session.close();
			} else if (err === recipSC.OBJ_UNKNOWN) {
				replyWithErr(api.SC.unknownObj, `Object ${objId} is unknown.`, res);
			} else if (err === recipSC.WRONG_OBJ_STATE) {
				replyWithErr(ERR_SC.malformed, `Object ${objId} is not in a different state.`, res);
			} else if (err === recipSC.OBJ_FILE_INCOMPLETE) {
				replyWithErr(ERR_SC.objIncomplete, `Object ${objId} is not complete.`, res);
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

function getContentLenOrSendError(req: Request, res: Response, maxChunkSize: number): number|undefined {
	const contentLength = parseInt(req.get(HTTP_HEADER.contentLength)!);
	if (isNaN(contentLength)) {
		replyWithErr(ERR_SC.contentLenMissing, "Content-Length header is required with proper number.", res, req);
	} else if (contentLength > maxChunkSize) {
		replyWithErr(ERR_SC.contentTooLong, "Request body is too long.", res, req);
	} else {
		return contentLength;
	}
	return;
}

Object.freeze(exports);