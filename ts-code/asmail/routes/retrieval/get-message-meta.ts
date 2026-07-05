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
import { SC as recipSC, MsgRetrieval } from '../../resources/recipients';
import { msgMetadata as api, ERR_SC } from '../../../lib-common/service-api/asmail/retrieval';
import { Request } from '../../resources/sessions';
import { replyWithErr } from '../../resources/utils';

export function getMsgMeta(
	getMsgMetaFunc: MsgRetrieval['getMsgMeta']
): RequestHandler {
	return async (req: Request, res, next) => {
		const userId = req.session.params.userId;
		const msgId: string = req.params.msgId;

		try {
			const meta = await getMsgMetaFunc(userId, msgId);
			res.status(api.SC.ok).json(meta);
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if (err === recipSC.MSG_UNKNOWN) {
				replyWithErr(api.SC.unknownMsg, "Message "+msgId+" is unknown.", res);
			} else if (err === recipSC.USER_UNKNOWN) {
				replyWithErr(ERR_SC.server, "Recipient disappeared from the system.", res);
				req.session.close();
			} else {
				next(new Error("Unhandled storage error code: "+err));
			}
		}

	};
}

Object.freeze(exports);