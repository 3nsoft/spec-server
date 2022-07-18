/*
 Copyright (C) 2022 3NSoft Inc.
 
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
import { ArchiveObjCurrentVersion, SC as storeSC } from '../../resources/users';
import { archiveObj as api, ERR_SC } from '../../../lib-common/service-api/3nstorage/owner';
import { Request } from '../../resources/sessions';

const SC = api.SC;

export function archiveCurrentObjVersion(
	root: boolean, archiveObjVerFunc: ArchiveObjCurrentVersion
): RequestHandler {
	if ('function' !== typeof archiveObjVerFunc) { throw new TypeError(
			"Given argument 'archiveObjVerFunc' must be function, but is not."); }

	return async (req: Request, res, next) => {

		const userId = req.session.params.userId;
		const objId: string = (root ? null as any : req.params.objId);

		const version = parseInt(req.query.ver as any);
		if (isNaN(version) || (version < 1)) {
			res.status(ERR_SC.malformed).send("Bad query parameters");
			return;
		}

		
		try {
			await archiveObjVerFunc(userId, objId, version);
			res.status(SC.okPost).end();
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if (err === storeSC.OBJ_VER_UNKNOWN) {
				res.status(SC.unknownObjVer).send(
					`Object ${objId} version ${version} is not current.`);
			} else if (err === storeSC.OBJ_UNKNOWN) {
				res.status(SC.unknownObj).send(root ?
					`Root object is not set.` :
					`Object ${objId} is unknown.`);
			} else if (err === storeSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).send(
					"Recipient disappeared from the system.");
				req.session.close();
			} else {
				next(new Error("Unhandled storage error code: "+err));
			}
		}
		
	};
};

Object.freeze(exports);