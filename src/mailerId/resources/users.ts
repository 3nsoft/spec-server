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

/**
 * This module is constructs users factories for MailerId app.
 */

import { readFile, FileException } from '../../lib-common/async-fs-node';
import { base64urlSafe, utf8 } from '../../lib-common/buffer-utils';
import { box } from 'ecma-nacl';
import { JsonKey, keyFromJson } from '../../lib-common/jwkeys';
import { IGetUserPKeyAndKeyGenParams, UserPKeyAndKeyGenParams } from 
	'../../lib-server/routes/pub-key-login/start-exchange';
import { UserMidParams } from '../../lib-common/admin-api/signup';

export interface Factory {
	getUserParamsAndKey: IGetUserPKeyAndKeyGenParams;
}

async function getUser(rootFolder: string, userId: string):
		Promise<UserMidParams|undefined> {
	try {
		let path = `${ rootFolder }/${ base64urlSafe.pack(utf8.pack(userId)) }/info/mid-params`;
		let str = await readFile(path, { encoding: 'utf8' });
		return JSON.parse(str) as UserMidParams;
	} catch (exc) {
		if ((<FileException> exc).notFound) {
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
	
	let factory: Factory = {
		getUserParamsAndKey: async (userId: string, kid: string|undefined):
				Promise<UserPKeyAndKeyGenParams|undefined> => {
			let userInfo = await getUser(rootFolder, userId);
			if (!userInfo) { return; }
			let params: UserPKeyAndKeyGenParams;
			if (typeof kid === 'string') {
				let pkey = userInfo.otherPKeys.find((pkey) => {
					return (pkey.kid === kid);
				});
				if (!pkey) { return; }
				params = {
					pkey: extractPKeyBytes(pkey),
				};
			} else {
				params = {
					pkey: extractPKeyBytes(userInfo.defaultPKey.pkey),
					params: userInfo.defaultPKey.params
				};
			}
			return params;
		}
	};
	Object.freeze(factory);
	
	return factory;
}

Object.freeze(exports);