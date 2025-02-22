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


export namespace createLocker {

	export const URL_END = 'create';

	export const method = 'PUT';

	export interface Request {
		token?: string;
	}
	
	export interface Reply {
		userId: string;
		storageUri: string;
		storageMBs: number;
		willBeRemovedAt: number;
	}

	export const SC = {
		ok: 200,
		invalidToken: 403
	};
	Object.freeze(SC);

};
Object.freeze(createLocker);

