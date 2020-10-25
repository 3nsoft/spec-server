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

/**
 * This module is constructs users factories for MailerId app.
 */

import { readFile, FileException } from '../../lib-common/async-fs-node';
import { box } from 'ecma-nacl';
import { JsonKey, keyFromJson } from '../../lib-common/jwkeys';
import { GetUserPKeyAndKeyGenParams, UserPKeyAndKeyGenParams } from '../../lib-server/routes/pub-key-login/start-exchange';
import { UserMidParams } from '../../lib-common/admin-api/signup';
import { join } from 'path';
import { userDataInRootFolder } from '../../lib-server/resources/server-data-folders';

export interface Factory {
	getUserParamsAndKey: GetUserPKeyAndKeyGenParams;
}

async function getUser(
	rootFolder: string, userId: string
): Promise<UserMidParams|undefined> {
	try {
		const userFolder = userDataInRootFolder(rootFolder, userId);
		const midParamsPath = join(userFolder, 'info', 'mid-params');
		const str = await readFile(midParamsPath, { encoding: 'utf8' });
		return JSON.parse(str) as UserMidParams;
	} catch (exc) {
		if ((exc as FileException).notFound) {
			return;
		}
		throw exc;
	}
}

const MID_KEY_USE = 'login-pub-key';

function extractPKeyBytes(pkey: JsonKey): Uint8Array {
	return keyFromJson(pkey, MID_KEY_USE,
		box.JWK_ALG_NAME, box.KEY_LENGTH).k;
}

export function makeFactory(rootFolder: string): Factory {
	
	const factory: Factory = {

		getUserParamsAndKey: async (userId, kid) => {
			const userInfo = await getUser(rootFolder, userId);
			if (!userInfo) { return; }
			let params: UserPKeyAndKeyGenParams;
			if (typeof kid === 'string') {
				const pkey = userInfo.otherPKeys.find((pkey) => {
					return (pkey.kid === kid);
				});
				if (!pkey) { return; }
				params = {
					pkey: extractPKeyBytes(pkey),
				};
			} else {
				params = {
					pkey: extractPKeyBytes(userInfo.defaultPKey.pkey),
					params: userInfo.defaultPKey.kdParams
				};
			}
			return params;
		}

	};
	Object.freeze(factory);
	
	return factory;
}

Object.freeze(exports);