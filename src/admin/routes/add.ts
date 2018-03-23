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

import { RequestHandler, Request, Response, NextFunction } from 'express';
import { box } from 'ecma-nacl';
import { addUser as api, ERR_SC } from '../../lib-common/admin-api/signup';
import { ICheckId, IAdd, SC as userSC, validateUserMidParams,
	validateUserStorageParams } from '../resources/users';
import { isLikeJsonKey } from '../../lib-common/jwkeys';

/**
 * @return route handler that reserves new user ids.
 */
export function addUser(idCheckFunc: ICheckId, addUserFunc: IAdd):
		RequestHandler {
	if ('function' !== typeof idCheckFunc) { throw new TypeError(
			"Given argument 'idCheckFunc' must be function, but is not."); }
	if ('function' !== typeof addUserFunc) { throw new TypeError(
			"Given argument 'addUserFunc' must be function, but is not."); }
	
	return async function(req: Request, res: Response, next: NextFunction) {
		
		const userParams: api.Request = req.body;
		
		if (('string' !== typeof userParams.userId) ||
				!idCheckFunc(userParams.userId)) {
			res.status(ERR_SC.malformed).send('Given user id is malformed.');
			return;
		}
		if (!validateUserMidParams(userParams.mailerId)) {
			res.status(ERR_SC.malformed).send(
				'MailerId parameters are malformed.');
			return;
		}
		if (!validateUserStorageParams(userParams.storage)) {
			res.status(ERR_SC.malformed).send(
				'Storage parameters are malformed.');
			return;
		}
		
		try {
			await addUserFunc(userParams.userId,
				userParams.mailerId, userParams.storage.params);
			res.status(api.SC.ok).end();
		} catch (err) {
			if (err === userSC.USER_ALREADY_EXIST) {
				res.status(api.SC.userAlreadyExists).end();
			} else {
				next(err);
			}
		}
		
	};
}

Object.freeze(exports);