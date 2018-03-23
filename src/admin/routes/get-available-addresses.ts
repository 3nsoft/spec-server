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
import { availableAddressesForName as api, ERR_SC }
	from '../../lib-common/admin-api/signup';
import { ICheckName, IAvailableAddressesForName } from '../resources/users';

/**
 * @return route handler that provides available addresses for a given name.
 */
export function availableAddresses(nameCheckFunc: ICheckName,
		availableAddressesFunc: IAvailableAddressesForName):
		RequestHandler {
	if ('function' !== typeof nameCheckFunc) { throw new TypeError(
			"Given argument 'nameCheckFunc' must be function, but is not."); }
	if ('function' !== typeof availableAddressesFunc) { throw new TypeError(
			"Given argument 'availableAddressesFunc' "+
			"must be function, but is not."); }
	
	return async function (req: Request, res: Response, next: NextFunction) {
		
		const newName = (<api.Request> req.body).name;
		
		if ((typeof newName !== 'string') || !nameCheckFunc(newName)) {
			res.status(ERR_SC.malformed).send('Given name is malformed.');
			return;
		}
		
		try {
			const addresses = await availableAddressesFunc(newName);
			res.status(api.SC.ok).json(addresses);
		} catch (err) {
			next(err);
		}
		
	};
}

Object.freeze(exports);