/*
 Copyright (C) 2022, 2026 3NSoft Inc.
 
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
import { GetObjStatus, SC as storeSC } from '../../resources/users';
import { objStatus as api, ERR_SC } from '../../../lib-common/service-api/3nstorage/owner';
import { Request } from '../../resources/sessions';
import { getObjIdFromParams, replyWithErr } from '../../resources/utils';

export function getObjStatus(
	root: boolean, getObjStatusFunc: GetObjStatus
): RequestHandler {

	return async (req: Request, res, next) => {

		const userId = req.session.params.userId;
		const { objId, objIdParseErr } = getObjIdFromParams(root, req);
		if (objIdParseErr) {
			return replyWithErr(ERR_SC.malformed, objIdParseErr, res);
		}
		
		try {
			const lst = await getObjStatusFunc(userId, objId);
			res.status(api.SC.ok).json(lst);
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if (err === storeSC.OBJ_UNKNOWN) {
				replyWithErr(api.SC.unknownObj, (root ? `Root object is set.` : `Object ${objId} is unknown.`), res);
			} else if (err === storeSC.USER_UNKNOWN) {
				replyWithErr(ERR_SC.server, "Recipient disappeared from the system.", res);
				req.session.close();
			} else {
				next(new Error("Unhandled storage error code: "+err));
			}
		}
		
	};
};

Object.freeze(exports);