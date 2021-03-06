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
import { addUser as api, ERR_SC } from '../../lib-common/admin-api/signup';
import { IAdd, SC as userSC, validateUserMidParams, validateUserStorageParams } from '../resources/users';
import { checkAndTransformAddress } from '../../lib-common/canonical-address';

export function addUser(addUserFunc: IAdd): RequestHandler {

	return async function(req, res, next) {

		const {
			mailerId, storage, userId, signupToken
		} = req.body as api.Request;

		if (('string' !== typeof userId)
		|| !checkAndTransformAddress(userId)) {
			res.status(ERR_SC.malformed).send('Given user id is malformed.');
			return;
		}
		if (!validateUserMidParams(mailerId)) {
			res.status(ERR_SC.malformed).send(
				'MailerId parameters are malformed.');
			return;
		}
		if (!validateUserStorageParams(storage)) {
			res.status(ERR_SC.malformed).send(
				'Storage parameters are malformed.');
			return;
		}
		if ((signupToken !== undefined) && (typeof signupToken !== 'string')) {
			res.status(ERR_SC.malformed).send('signupToken is invalid.');
			return;
		}

		try {
			await addUserFunc(userId, mailerId, storage.kdParams, signupToken);
			res.status(api.SC.ok).end();
		} catch (err) {
			if (err === userSC.USER_ALREADY_EXIST) {
				res.status(api.SC.userAlreadyExists).end();
			} else if (err === userSC.CREATION_UNAUTHORIZED) {
				res.status(api.SC.unauthorized).end();
			} else {
				next(err);
			}
		}

	};
}

Object.freeze(exports);