/*
 Copyright (C) 2017, 2020 3NSoft Inc.
 
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

import { RequestHandler, Response, NextFunction } from 'express';
import { GetCurrentObj, SC as storeSC } from '../../resources/users';
import { GetObjQueryOpts, ERR_SC, HTTP_HEADER, BIN_TYPE, currentObj as api } from '../../../lib-common/service-api/3nstorage/owner';
import { Request } from '../../resources/sessions';
import { errWithCause, stringifyErr } from '../../../lib-common/exceptions/error';
import { EMPTY_BUFFER } from '../../../lib-common/buffer-utils';

function extractQueryOptions(req: Request): undefined |
		{ header: boolean; limit: number|undefined; ofs: number;
			ver: number|undefined; } {
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

	let ver = (query.ver ? parseInt(query.ver as any) : undefined);
	if (ver !== undefined) {
		if (isNaN(ver!)) {
			ver = undefined;
		} else if (ver < 1) {
			return;
		}
	}

	return { header, limit, ofs, ver };
}

export function getCurrentObj(
	root: boolean, getCurrentObjFunc: GetCurrentObj
): RequestHandler {
	if ('function' !== typeof getCurrentObjFunc) { throw new TypeError(
			"Given argument 'getCurrentObjFunc' must be function, but is not."); }

	return async function(req: Request, res: Response, next: NextFunction) {
		
		const userId = req.session.params.userId;
		const objId: string = (root ? null as any : req.params.objId);
		
		const opts = extractQueryOptions(req);
		if (!opts) {
			res.status(ERR_SC.malformed).send("Bad query parameters");
			return;
		}
		
		try {
			const { version, reader } = await getCurrentObjFunc(userId, objId,
				opts.header, opts.ofs, opts.limit);
			if (opts.ver) {
				if (opts.ver !== version) {
					res.set(HTTP_HEADER.objVersion, `${version}`);
					res.status(api.SC.unknownObjVer).end();
					return;
				}
			} else {
				res.set(HTTP_HEADER.objVersion, `${version}`);
			}
			res.status(api.SC.okGet);
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
					console.error(stringifyErr(errWithCause(err, `Wasn't able to complete sending segments due to error in piping`)));
				} finally {
					res.end();
				}
			} else {
				res.send(EMPTY_BUFFER);
			}
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if ((err === storeSC.OBJ_UNKNOWN)
			|| (err === storeSC.OBJ_VER_UNKNOWN)) {
				res.status(api.SC.unknownObj).send(objId ?
					`Object ${objId} is unknown.` : `Root object is not set.`);
			} else if (err === storeSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).send(`Recipient disappeared from the system.`);
				req.session.close();
			} else {
				next(new Error(`Unhandled storage error code: ${err}`));
			}
		}
		
	};
};

Object.freeze(exports);