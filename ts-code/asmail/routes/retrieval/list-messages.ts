/*
 Copyright (C) 2015 - 2016, 2025 3NSoft Inc.
 
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
import { listMsgs as api, ERR_SC, ListMsgsOpts } from '../../../lib-common/service-api/asmail/retrieval';
import { Request } from '../../resources/sessions';

export function listMsgIds(
	listMsgIdsFunc: MsgRetrieval['getMsgIds']
): RequestHandler {
	return async (req: Request, res, next) => {
		const userId = req.session.params.userId;

		const opts = extractQueryOptions(req);
		if (!opts) {
			res.status(ERR_SC.malformed).send("Bad query parameters");
			return;
		}

		try {
			const { from, to } = opts;
			const msgIds = await listMsgIdsFunc(userId, from, to);
			res.status(api.SC.ok).json(msgIds);
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if (err === recipSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).send(
					"Recipient disappeared from the system."
				);
				req.session.close();
			} else {
				next(new Error("Unhandled storage error code: "+err));
			}
		}

	};
}

function extractQueryOptions(req: Request): ListMsgsOpts|undefined {
	const query: ListMsgsOpts = req.query;

	const from = (query.from ? parseInt(query.from as any) : undefined);
	if ((from !== undefined) && (isNaN(from) || (from <= 0))) {
		return;
	}
	const to = (query.to ? parseInt(query.to as any) : undefined);
	if ((to !== undefined) && (isNaN(to) || (to <= 0))) {
		return;
	}

	return { from, to };
}

Object.freeze(exports);