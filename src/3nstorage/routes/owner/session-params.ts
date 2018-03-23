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
 this program. If not, see <http://www.gnu.org/licenses/>. */

import { RequestHandler, Response, NextFunction } from 'express';
import { GetKeyDerivParams, SC as storeSC } from '../../resources/users';
import { sessionParams as api, ERR_SC }
	from '../../../lib-common/service-api/3nstorage/owner';
import { stringToNumOfBytes } from '../../../lib-server/conf-util';
import { Request } from '../../resources/sessions';

export function sessionParams(maxChunk: number|string): RequestHandler {
	const maxChunkSize = stringToNumOfBytes(maxChunk);

	return async function(req: Request, res: Response, next: NextFunction) {
		
		const userId = req.session.params.userId;
		
		try{
			const reply: api.Reply = { maxChunkSize };
			res.status(api.SC.ok).json(reply);
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
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