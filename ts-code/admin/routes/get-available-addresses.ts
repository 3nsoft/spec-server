/*
 Copyright (C) 2015 - 2016, 2020 3NSoft Inc.
 
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
import { availableAddressesForName as api, ERR_SC } from '../../lib-common/admin-api/signup';
import { IAvailableAddressesForName } from '../resources/users';

export function availableAddresses(
	availableAddressesFunc: IAvailableAddressesForName
): RequestHandler {

	return async function (req, res, next) {

		const { name, signupToken } = req.body as api.Request;

		if ((typeof name !== 'string') || (name.indexOf('@') >= 0)) {
			res.status(ERR_SC.malformed).send('name is missing or invalid.');
			return;
		}
		if ((signupToken !== undefined) && (typeof signupToken !== 'string')) {
			res.status(ERR_SC.malformed).send('signupToken is invalid.');
			return;
		}

		try {
			const addresses = await availableAddressesFunc(name, signupToken);
			res.status(api.SC.ok).json(addresses);
		} catch (err) {
			next(err);
		}

	};
}

Object.freeze(exports);