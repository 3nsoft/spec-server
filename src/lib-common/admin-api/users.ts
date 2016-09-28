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

/*
 * This defines interfaces to manipulate users of Home Server from an
 * administrative interface.
 */

import * as jwk from '../../lib-common/jwkeys';

export module addUser {
	
	export let URL_END = 'user/add';
	
	export interface Request {
		userId: string;
		mailerId: {
			pkey: jwk.JsonKey;
			params: any;
		};
		storage: {
			params: any;
			quota: number;
		};
	}
	
	export let SC = {
		ok: 200,
		userAlreadyExists: 473
	};
	Object.freeze(SC);
	
}
Object.freeze(addUser);

export module updateUserMailerId {
	
	export let URL_END = 'user/update/mailerId';
	
	export interface Request {
		pkey: jwk.JsonKey;
		params: any;
	}
	
	export let SC = {
		ok: 200,
		unknownUser: 474,
	};
	Object.freeze(SC);
	
}
Object.freeze(updateUserMailerId);

export module updateUserStorage {
	
	export let URL_END = 'user/update/storage';
	
	export interface Request {
		params: any;
		quota: number;
	}
	
	export let SC = {
		ok: 200,
		unknownUser: 474,
	};
	Object.freeze(SC);
	
}
Object.freeze(updateUserMailerId);

export module removeUser {
	
	export let URL_END = 'user/remove';
	
	export interface Request {
		userId: string;
	}
	
	export let SC = {
		ok: 200,
		unknownUser: 474,
	};
	Object.freeze(SC);
	
}
Object.freeze(removeUser);



Object.freeze(exports);