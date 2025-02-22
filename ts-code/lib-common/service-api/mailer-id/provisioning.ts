/*
 Copyright (C) 2015, 2019 3NSoft Inc.
 
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
 * This defines request interfaces for MailerId certificate provisioning.
 */

import { JsonKey, SignedLoad } from '../../jwkeys';

export namespace certify {
	
	export const URL_END = 'certify';
	
	export interface Request {
		pkey: JsonKey;
		duration: number;
	}

	export interface Reply {
		userCert: SignedLoad;
		provCert: SignedLoad;
	}

	export const SC = {
		cryptoVerifFail: 403,
		malformed: 400,
		ok: 200
	};
	Object.freeze(SC);
	
}
Object.freeze(certify);

export namespace serviceRoot {

	export interface Reply {
		"current-cert": SignedLoad;
		"previous-certs": SignedLoad[];
		provisioning: string;
	}

	export const SC = {
		ok: 200
	};
	Object.freeze(SC);

}
Object.freeze(serviceRoot);

Object.freeze(exports);