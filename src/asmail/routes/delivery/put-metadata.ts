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
import { SC as recipSC, SetMsgStorage } from '../../resources/recipients';
import { msgMeta as api, ERR_SC, ErrorReply }
	from '../../../lib-common/service-api/asmail/delivery';
import * as confUtil from '../../../lib-server/conf-util';
import { Request } from '../../resources/delivery-sessions';

function findProblemWithObjIds(ids: string[]): ErrorReply|undefined {
	if (!Array.isArray(ids)) {
		return {
			error: "Object ids are missing."
		};
	}
	const objIdsInLowerCase = new Set<string>();
	for (let i=0; i<ids.length; i+=1) {
		const objId = ids[i].toLowerCase();
		if (objIdsInLowerCase.has(objId)) {
			return {
				error: "Duplication of object ids."
			};
		}
		objIdsInLowerCase.add(objId);
	}
	return;
}

export function saveMetadata(setMsgStorageFunc: SetMsgStorage,
		maxChunk: string|number): RequestHandler {
	if ('function' !== typeof setMsgStorageFunc) { throw new TypeError(
			"Given argument 'setMsgStorageFunc' must "+
			"be function, but is not."); }
	const maxChunkSize = confUtil.stringToNumOfBytes(maxChunk);

	return async function(req: Request, res: Response, next: NextFunction) {
		const session = req.session;
		const msgMeta: api.Request = req.body;
		const recipient = session.params.recipient;
		const objIds = msgMeta.objIds;
		
		if (session.params.msgId) {
			res.status(ERR_SC.duplicateReq).json( <ErrorReply> {
				error: "This protocol request has already been served."
			});
			return;
		}
		
		if (findProblemWithObjIds(objIds)) {
			res.status(ERR_SC.malformed).json(findProblemWithObjIds(objIds));
			return;
		}
		
		try {
			const msgId = await setMsgStorageFunc(recipient, msgMeta,
				session.params.sender, session.params.invite,
				session.params.maxMsgLength);
			session.params.msgId = msgId;
			res.status(api.SC.ok).json( <api.Reply> {
				msgId,
				maxChunkSize
			});
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if (err === recipSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).send(
					"Recipient disappeared from the system.");
				session.close();
			}
		}
		
	};
}
Object.freeze(exports);