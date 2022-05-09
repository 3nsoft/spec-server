/*
 Copyright (C) 2015 - 2017 3NSoft Inc.
 
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
import { SC as recipSC, GetObj, BIN_TYPE } from '../../resources/recipients';
import { GetObjQueryOpts, ERR_SC, msgObj as api, HTTP_HEADER } from '../../../lib-common/service-api/asmail/retrieval';
import { Request } from '../../resources/sessions';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { EMPTY_BUFFER } from '../../../lib-common/buffer-utils';

function extractQueryOptions(req: Request): undefined|{
	header: boolean; limit: number|undefined; ofs: number;
} {
	// query fields are string or undefined, yet, type info helps the show
	const query: GetObjQueryOpts = req.query;

	const header = ((query.header as any) === 'true');

	const ofs = (query.ofs ? parseInt(query.ofs as any) : 0);
	if (isNaN(ofs) ||
			(ofs < 0) ||
			(header && (ofs > 0))) { return; }

	const limit = (query.limit ? parseInt(query.limit as any) : undefined);
	if (limit !== undefined) {
		if (isNaN(limit) ||
				(limit < 0) ||
				(!header && (limit === 0))) { return; }
	}

	return { header, limit, ofs };
}

export function getMsgObj(getMsgObjFunc: GetObj): RequestHandler {
	if ('function' !== typeof getMsgObjFunc) { throw new TypeError(
			"Given argument 'getMsgObjFunc' must be function, but is not."); }

	return async (req: Request, res, next) => {
		
		const userId = req.session.params.userId;
		const msgId: string = req.params.msgId;
		const objId: string = req.params.objId;
		
		const opts = extractQueryOptions(req);
		if (!opts) {
			res.status(ERR_SC.malformed).send("Bad query parameters");
			return;
		}
		
		try{
			const reader = await getMsgObjFunc(userId, msgId, objId,
				opts.header, opts.ofs, opts.limit);
			res.status(api.SC.ok);
			res.set(HTTP_HEADER.contentType, BIN_TYPE);
			res.set(HTTP_HEADER.contentLength, `${reader.len}`);
			if (opts.header) {
				res.set(HTTP_HEADER.objHeaderLength, `${reader.headerLen}`);
			}
			res.set(HTTP_HEADER.objSegmentsLength, `${reader.segsLen}`);
			if (reader.len > 0) {
				try {
					await reader.pipe!(res);
				} catch (err) {
					console.error(errWithCause(err, `Wasn't able to complete sending segments due to error in piping`));
				} finally {
					res.end();
				}
			} else {
				res.send(EMPTY_BUFFER);
			}
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if (err === recipSC.OBJ_UNKNOWN) {
				res.status(api.SC.unknownMsgOrObj).send(
					`Object ${objId} is unknown.`);
			} else if (err === recipSC.MSG_UNKNOWN) {
				res.status(api.SC.unknownMsgOrObj).send(
					`Message ${msgId} is unknown.`);
			} else if (err === recipSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).send(
					`Recipient disappeared from the system.`);
				req.session.close();
			} else {
				next(new Error(`Unhandled storage error code: ${err}`));
			}
		}
	};
}

Object.freeze(exports);