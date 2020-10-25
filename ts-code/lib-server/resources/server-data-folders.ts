/*
 Copyright (C) 2020 3NSoft Inc.
 
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

import { base64urlSafe, utf8 } from '../../lib-common/buffer-utils';
import { toCanonicalAddress } from '../../lib-common/canonical-address';
import { join } from 'path';
import { promises as fsPromises, mkdirSync } from 'fs';

export function addressToFName(address: string): string {
	return canonicalAddressToFName(toCanonicalAddress(address));
}

function canonicalAddressToFName(canonicalAddress: string): string {
	return base64urlSafe.pack(utf8.pack(canonicalAddress));
}

export interface FolderDef {
	path: string;
}

export interface RootDataTree {
	tokens: FolderDef;
	users: FolderDef;
	defaults: FolderDef;
}

export interface DefaultsDataTree {
	info: FolderDef;
	store: FolderDef & {
		params: FolderDef;
	};
	mail: FolderDef & {
		params: FolderDef & {
			anonymous: FolderDef;
			authenticated: FolderDef;
		};
	};
}

export interface UserDataTree {
	mail: FolderDef & {
		messages: FolderDef;
		delivery: FolderDef;
		params: FolderDef;
	};
	store: FolderDef & {
		objects: FolderDef;
		transactions: FolderDef;
		root: FolderDef;
		params: FolderDef;
	};
	info: FolderDef;
}

export function treeInRootFolder(rootFolder: string): RootDataTree {
	const defaults = join(rootFolder, 'defaults');
	return {
		users: { path: join(rootFolder, 'users') },
		defaults: {
			path: defaults,
		},
		tokens: { path: tokensInRootFolder(rootFolder) }
	};
}

export function tokensInRootFolder(rootFolder: string): string {
	return join(rootFolder, 'tokens');
}

export function userDataInRootFolder(root: string, userId: string): string {
	return join(root, 'users', addressToFName(userId));
}

export function treeInDefaultsFolder(defaults: string): DefaultsDataTree {
	const mail = join(defaults, 'mail');
	const mailParams = join(mail, 'params');
	const store = join(defaults, 'store');
	return {
		info: { path: join(defaults, 'info') },
		mail: {
			path: mail,
			params: {
				path: mailParams,
				anonymous: { path: join(mailParams, 'anonymous') },
				authenticated: { path: join(mailParams, 'authenticated') }
			}
		},
		store: {
			path: store,
			params: { path: join(store, 'params') }
		}
	};
}

export function treeInUserFolder(userFoder: string): UserDataTree {
	const mail = join(userFoder, 'mail');
	const store = join(userFoder, 'store');
	return {
		info: { path: join(userFoder, 'info') },
		mail: {
			path: mail,
			delivery: { path: join(mail, 'delivery') },
			messages: { path: join(mail, 'messages') },
			params: { path: join(mail, 'params') }
		},
		store: {
			path: store,
			params: { path: join(store, 'params') },
			root: { path: join(store, 'root') },
			objects: { path: join(store, 'objects') },
			transactions: { path: join(store, 'transactions') }
		}
	};
}

export async function createFolderTree(
	structure: RootDataTree|UserDataTree|DefaultsDataTree|FolderDef
): Promise<void> {
	for (const [ key, def ] of Object.entries(structure)) {
		if (key === 'path') {
			await fsPromises.mkdir(def, { recursive: true });
		} else {
			await createFolderTree(def);
		}
	}
}

export function createFolderTreeSync(
	structure: RootDataTree|UserDataTree|DefaultsDataTree|string
): void {
	for (const [ key, def ] of Object.entries(structure)) {
		if (key === 'path') {
			mkdirSync(def, { recursive: true });
		} else {
			createFolderTreeSync(def);
		}
	}
}


Object.freeze(exports);