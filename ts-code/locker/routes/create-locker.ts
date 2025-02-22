/*
 Copyright (C) 2024 3NSoft Inc.
 
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
import { createLocker as api } from '../../lib-common/service-api/locker';

export type LockerCreator = (token: string|undefined) => Promise<api.Reply>;

export function createLocker(
	createLocker: LockerCreator
): RequestHandler {
	
	if ('function' !== typeof createLocker) {
		throw new TypeError(
			"Given argument 'createLocker' must be function, but is not."
		);
	}

	return async (req, res, next) => {

		const { token } = req.body as api.Request;

		try{
			const lockerInfo = await createLocker(token);
			res.status(api.SC.ok).json(lockerInfo);
		} catch (err) {
			next(err);
		}

	};
	
}
Object.freeze(exports);