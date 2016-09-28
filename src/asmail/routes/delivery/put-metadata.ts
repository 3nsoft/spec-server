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
import { SC as recipSC, ISetMsgStorage } from '../../resources/recipients';
import { msgMeta as api, ERR_SC, ErrorReply }
	from '../../../lib-common/service-api/asmail/delivery';
import * as confUtil from '../../../lib-server/conf-util';
import { Request } from './start-session';

function findProblemWithObjIds(ids: string[]): ErrorReply {
	if (!Array.isArray(ids)) {
		return {
			error: "Object ids are missing."
		};
	}
	let objIdsInLowerCase = new Set<string>();
	let objId;
	for (var i=0; i < ids.length; i+=1) {
		objId = ids[i].toLowerCase();
		if (objIdsInLowerCase.has(objId)) {
			return {
				error: "Duplication of object ids."
			};
		}
		objIdsInLowerCase.add(objId);
	}
}

export function saveMetadata(setMsgStorageFunc: ISetMsgStorage,
		maxChunk: string|number): RequestHandler {
	if ('function' !== typeof setMsgStorageFunc) { throw new TypeError(
			"Given argument 'setMsgStorageFunc' must "+
			"be function, but is not."); }
	let maxChunkSize = confUtil.stringToNumOfBytes(maxChunk);

	return async function(req: Request, res: Response, next: NextFunction) {
		let session = req.session;
		let msgMeta: api.Request = req.body;
		let recipient = session.params.recipient;
		let sender = session.params.sender;
		let objIds = msgMeta.objIds;
		
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
			let msgId = await setMsgStorageFunc(recipient, msgMeta, sender);
			session.params.msgId = msgId;
			res.status(api.SC.ok).json( <api.Reply> {
				msgId: msgId,
				maxChunkSize: maxChunkSize
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