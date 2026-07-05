/*
 Copyright (C) 2015 - 2016, 2025 - 2026 3NSoft Inc.
 
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
import { SC as recipSC, MsgDelivery } from '../../resources/recipients';
import { msgMeta as api, ERR_SC } from '../../../lib-common/service-api/asmail/delivery';
import * as confUtil from '../../../lib-server/conf-util';
import { Request } from '../../resources/delivery-sessions';
import { base64urlSafe } from '../../../lib-common/buffer-utils';
import { replyWithErr } from '../../resources/utils';

function findProblemWithObjIds(ids: string[]): string|undefined {
	if (!Array.isArray(ids)) {
		return "Object ids are missing.";
	}
	const checkedIds = new Set<string>();
	for (const objId of ids) {
		if (checkedIds.has(objId)) {
			return "Duplication of object ids.";
		}
		if (!base64urlSafe.allCharsFromAlphabet(objId!)) {
			return "Object id is invalid.";
		}
		checkedIds.add(objId);
	}
	return;
}

export function saveMetadata(
	setMsgStorageFunc: MsgDelivery['setMsgStorage'], maxChunk: string|number
): RequestHandler {

	const maxChunkSize = confUtil.stringToNumOfBytes(maxChunk);

	return async (req: Request, res, next) => {
		const session = req.session;
		if (session.params.msgId) {
			return replyWithErr(ERR_SC.duplicateReq, "This protocol request has already been served.", res);
		}

		const recipient = session.params.recipient;
		const msgMeta: api.Request = req.body;

		const objIds = msgMeta.objIds;
		const errWithWithObjIds = findProblemWithObjIds(objIds);
		if (errWithWithObjIds) {
			return replyWithErr(ERR_SC.malformed, errWithWithObjIds, res);
		}

		try {
			const msgId = await setMsgStorageFunc(
				recipient, msgMeta, session.params.sender, session.params.invite, session.params.maxMsgLength
			);
			session.params.msgId = msgId;
			res.status(api.SC.ok).json({
				msgId,
				maxChunkSize
			} as api.Reply);
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if (err === recipSC.USER_UNKNOWN) {
				replyWithErr(ERR_SC.server, "Recipient disappeared from the system.", res);
				session.close();
			}
		}

	};
}

Object.freeze(exports);