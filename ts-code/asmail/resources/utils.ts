/*
 Copyright (C) 2026 3NSoft Inc.
 
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

import { Response, Request } from 'express';
import { base64urlSafe } from '../../lib-common/buffer-utils';
import { attachByteDrainToRequest } from '../../lib-server/middleware/body-parsers';
import { ErrorReply } from '../../lib-common/service-api/asmail/delivery';

export function getObjIdFromParams(req: Request): {
	objId: string; objIdParseErr?: string;
} {
	const objId = req.params.objId;
	return ((!!objId && base64urlSafe.allCharsFromAlphabet(objId)) ?
		{ objId } :
		{ objId: undefined as any, objIdParseErr: "Bad object id" }
	);
}

export function replyWithErr(status: number, msg: string, res: Response, reqToDrainBytesFrom?: Request): void {
	if (reqToDrainBytesFrom) {
		attachByteDrainToRequest(reqToDrainBytesFrom);
	}
	res.status(status).json({ error: msg } as ErrorReply);
}


Object.freeze(exports);