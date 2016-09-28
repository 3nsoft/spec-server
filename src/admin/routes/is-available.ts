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
import { isAvailable as api, ERR_SC } from '../../lib-common/admin-api/signup';
import { ICheckId, IUserIdAvailable } from '../resources/users';

/**
 * @return route handler that checks availability of user id.
 */
export function isUserIdAvailable(idCheckFunc: ICheckId,
		isIdAvailableFunc: IUserIdAvailable): RequestHandler {
	if ('function' !== typeof idCheckFunc) { throw new TypeError(
			"Given argument 'idCheckFunc' must be function, but is not."); }
	if ('function' !== typeof isIdAvailableFunc) { throw new TypeError(
			"Given argument 'isIdAvailableFunc' must be function, but is not."); }
	
	return async function (req: Request, res: Response, next: NextFunction) {
		
		let newId = (<api.Request> req.body).userId;
		
		if (!idCheckFunc(newId)) {
			res.status(ERR_SC.malformed).send('Given user id is malformed.');
			return;
		}
		
		try{
			let isAvailable = await isIdAvailableFunc(newId);
			if (isAvailable) {
				res.status(api.SC.ok).end();
			} else {
				res.status(api.SC.userAlreadyExists).end();
			}
		} catch (err) {
			next(err);
		}
		
	};
}

Object.freeze(exports);