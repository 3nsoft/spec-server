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

/*
 * This module is provides administrative functionality, like adding new users,
 * changing users quotas, etc.
 */

import * as fs from '../../lib-common/async-fs-node';
import { writeFileSync, readdirSync } from 'fs';
import * as jwk from '../../lib-common/jwkeys';
import * as nacl from 'ecma-nacl';
import { UserMidParams, UserStorageParams } from '../../lib-common/admin-api/signup';
import { bind } from '../../lib-common/binding';
import * as asmailConf from '../../lib-common/service-api/asmail/config';
import { join } from 'path';
import { createFolderTreeSync, treeInRootFolder, treeInDefaultsFolder, DefaultsDataTree, addressToFName, treeInUserFolder, createFolderTree } from '../../lib-server/resources/server-data-folders';
import { MultiDomainSignupCtx, SignupContext, addressesForName, canCreateUser, parseToken, areTokensSame } from '../signup-tokens';
import { errWithCause } from '../../lib-common/exceptions/error';

export const SC = {
	USER_ALREADY_EXIST: 'user-already-exist',
	CREATION_UNAUTHORIZED: 'creation-unauthorized'
};
Object.freeze(SC);

const MID_KEY_USE = 'login-pub-key';

function checkDefaultMidKeyParams(params: UserMidParams): boolean {
	const ok = ('object' === typeof params.defaultPKey) &&
		!!params.defaultPKey &&
		jwk.isLikeJsonKey(params.defaultPKey.pkey) &&
		(typeof params.defaultPKey.kdParams === 'object') &&
		!!params.defaultPKey.kdParams;
	if (!ok) { return false; }
	try {
		jwk.keyFromJson(params.defaultPKey.pkey, MID_KEY_USE,
			nacl.box.JWK_ALG_NAME, nacl.box.KEY_LENGTH);
		return true;
	} catch (err) {
		return false;
	}
}

export function validateUserMidParams(params: UserMidParams): boolean {
	const ok = ('object' === typeof params) && !!params &&
		checkDefaultMidKeyParams(params) &&
		Array.isArray(params.otherPKeys) &&
		(params.otherPKeys.length > 0);
	if (!ok) { return false; }
	for (const pkey of params.otherPKeys) {
		try {
			jwk.keyFromJson(pkey, MID_KEY_USE,
				nacl.box.JWK_ALG_NAME, nacl.box.KEY_LENGTH);
		} catch (err) {
			return false;
		}
		if (!pkey.kid) { return false; }
	}
	return true;
}

export function validateUserStorageParams(params: UserStorageParams): boolean {
	return ((typeof params === 'object') && !!params &&
			(typeof params.kdParams === 'object') && !!params.kdParams);
}

/**
 * This returns a promise, resolvable to
 * - true, when given new id is available,
 * - false, when there is already a user with given id.
 */
export type IUserIdAvailable = (
	newUserId: string, signupToken: string|undefined
) => Promise<boolean>;

/**
 * This returns a promise, resolvable to an array of addresses, that are
 * available for a given string. Array may be empty, when there are no
 * such addresses.
 * @param name is a name part of address, or not a domain part.
 * @return a promise, resolvable to available addresses for a given name.
 * If array is empty, there are no available addresses for a given name.
 */
export type IAvailableAddressesForName = (
	name: string, signupToken: string|undefined
) => Promise<string[]>;

/**
 * This creates a user, returning a promise, resolvable when a new account has
 * been created for a given user id.
 * @param userId is user's address. Notice that this is not a canonical form,
 * but user-likable variant.
 * @param midParams MailerId parameters to save
 * @param storeParams storage parameters to save
 * @return a promise, resolvable, when user is added, and all parameters are
 * saved.
 */
export type IAdd = (
	userId: string, midParams: UserMidParams, storeParams: any,
	signupToken: string|undefined
) => Promise<void>;

export interface Factory {
	getAvailableAddresses: IAvailableAddressesForName;
	add: IAdd;
}

async function writeJson(path: string, json: any): Promise<void> {
	return fs.writeFile(path, JSON.stringify(json),
		{ encoding: 'utf8', flag: 'w', mode: '660' });
}

function writeJsonSync(path: string, json: any): void {
	writeFileSync(path, JSON.stringify(json),
		{ encoding: 'utf8', flag: 'w', mode: '660' });
}

function setGeneralDefaults(defaults: DefaultsDataTree): void {
	const infoFolder = defaults.info.path;
	writeJsonSync(join(infoFolder, 'quota'), 100*1024*1024*1024);
}

function setStoreDefaults(store: DefaultsDataTree['store']): void {
	const sp = store.params.path;
	writeJsonSync(join(sp, 'key-deriv'), null);
}

function setMailDefaults(mail: DefaultsDataTree['mail']): void {
	writeJsonSync(join(mail.params.path, 'pubkey'), null);
	const anonFolder = mail.params.anonymous.path;
	const anonPolicy: asmailConf.p.anonSenderPolicy.Policy = {
		accept: true,
		acceptWithInvitesOnly: false,
		defaultMsgSize: 1024*1024
	};
	writeJsonSync(join(anonFolder, 'policy'), anonPolicy);
	writeJsonSync(join(anonFolder, 'invites'), {});
	const authFolder = mail.params.authenticated.path;
	const authPolicy: asmailConf.p.authSenderPolicy.Policy = {
		acceptWithInvitesOnly: false,
		acceptFromWhiteListOnly: false,
		applyBlackList: true,
		defaultMsgSize: 1024*1024
	}
	writeJsonSync(join(authFolder, 'policy'), authPolicy);
	writeJsonSync(join(authFolder, 'whitelist'), {});
	writeJsonSync(join(authFolder, 'blacklist'), {});
	writeJsonSync(join(authFolder, 'invites'), {});
}


class Users {

	private readonly users: string;
	private readonly defaults: string;
	private readonly tokens: string;


	constructor(
		rootFolder: string,
		private readonly noTokenFile?: string
	) {
		if (!fs.existsFolderSync(rootFolder)) { throw new Error(
			`Given root folder does not exist: ${rootFolder}`); }
		const folders = treeInRootFolder(rootFolder);
		createFolderTreeSync(folders);
		this.users = folders.users.path;
		this.defaults = folders.defaults.path;
		this.tokens = folders.tokens.path;
		this.populateDefaultsIfEmpty();
	}

	private populateDefaultsIfEmpty(): void {
		if (readdirSync(this.defaults).length > 0) { return; }
		const defaults = treeInDefaultsFolder(this.defaults);
		createFolderTreeSync(defaults);
		setGeneralDefaults(defaults);
		setMailDefaults(defaults.mail);
		setStoreDefaults(defaults.store);
	}

	private userFolderPath(userId: string): string {
		return join(this.users, addressToFName(userId));
	}

	async add(
		userId: string, midParams: UserMidParams, storeKeyDerivParams: any,
		signupToken: string|undefined
	): Promise<void> {
		if (!validateUserMidParams(midParams)) { throw new Error(
			'Invalid MailerId parameters are given'); }
		if (!storeKeyDerivParams) { throw new Error(
			'Store key derivation parameters are not given'); }
		const rmToken = await this.checkIfCreationAllowed(userId, signupToken);
		const userFolder = this.userFolderPath(userId);
		await fs.mkdir(userFolder).catch((err: fs.FileException) => {
			if (err.alreadyExists) {
				throw SC.USER_ALREADY_EXIST;
			} else {
				throw err;
			}
		});
		try {
			// make folder tree
			const tree = treeInUserFolder(userFolder);
			await createFolderTree(tree);
			// record user id
			await fs.writeFile(
				join(tree.info.path, 'userid'),
				userId, { encoding: 'utf8', flag: 'w', mode: '440' });
			// copy defaults
			await fs.copyTree(this.defaults, userFolder);
			// record mid parameters
			await writeJson(
				join(tree.info.path, 'mid-params'),
				midParams);
			// record storage params
			await writeJson(
				join(tree.store.params.path, 'key-deriv'),
				storeKeyDerivParams);
			if (rmToken) {
				await rmToken();
			}
		} catch (e) {
			await fs.rmDirWithContent(userFolder).catch(err => {});
			throw e;
		}
	}

	private async checkIfCreationAllowed(
		userId: string, signupToken: string|undefined
	): Promise<(() => Promise<void>)|undefined> {
		if (signupToken) {
			const t = parseToken(signupToken);
			if (!t) { throw SC.CREATION_UNAUTHORIZED; }
			const ctxFilePath = join(this.tokens, t.tokenFile);
			const str = await fs.readFile(ctxFilePath, { encoding: 'utf8' })
			.catch((exc: fs.FileException) => {
				throw (exc.notFound ? SC.CREATION_UNAUTHORIZED : exc);
			});
			try {
				const ctx = JSON.parse(str) as SignupContext;
				if (ctx.token && !areTokensSame(t.tokenBytes, ctx.token)) {
					throw SC.CREATION_UNAUTHORIZED;
				}
				if (canCreateUser(userId, ctx)) {
					if (ctx.type === 'single-user') {
						return () => fs.unlink(ctxFilePath).catch(noop);
					} else {
						return;
					}
				}
			} catch (err) {
				throw errWithCause(err, `Error occured in using file ${
					ctxFilePath} as a signup context.`);
			}
		} else if (this.noTokenFile) {
			try {
				const str = await fs.readFile(
					this.noTokenFile, { encoding: 'utf8' });
				const ctx = JSON.parse(str) as MultiDomainSignupCtx;
				if (canCreateUser(userId, ctx)) { return; }
			} catch (exc) {
				if (!(exc as fs.FileException).notFound) {
					throw errWithCause(exc, `Error occured in using file ${
						this.noTokenFile} as a no-token signup context.`);
				}
			}
		}
		throw SC.CREATION_UNAUTHORIZED;
	}

	async getAvailableAddresses(
		name: string, signupToken: string|undefined
	): Promise<string[]> {
		if (signupToken) {
			const t = parseToken(signupToken);
			if (!t) { return []; }
			const ctxFilePath = join(this.tokens, t.tokenFile);
			const str = await fs.readFile(ctxFilePath, { encoding: 'utf8' })
			.catch((exc: fs.FileException) => {
				if (exc.notFound) { return; }
				else { throw exc; }
			});
			if (!str) {
				return [];
			}
			try {
				const ctx = JSON.parse(str) as SignupContext;
				if (ctx.token && !areTokensSame(t.tokenBytes, ctx.token)) {
					return [];
				}
				return this.availableAddressInCtx(name, ctx);
			} catch (err) {
				throw errWithCause(err, `Error occured in using file ${
					ctxFilePath} as a signup context.`);
			}
		} else if (this.noTokenFile) {
			try {
				const str = await fs.readFile(
					this.noTokenFile, { encoding: 'utf8' });
				const ctx = JSON.parse(str) as MultiDomainSignupCtx;
				return this.availableAddressInCtx(name, ctx);
			} catch (exc) {
				if ((exc as fs.FileException).notFound) {
					return [];
				} else {
					throw errWithCause(exc, `Error occured in using file ${
						this.noTokenFile} as a no-token signup context.`);
				}
			}
		} else {
			return [];
		}
	}

	private async availableAddressInCtx(
		name: string, ctx: SignupContext
	): Promise<string[]> {
		const allIds = addressesForName(name, ctx);
		if (!allIds) {
			return [];
		}
		const availableIds: string[] = [];
		for (const userId of allIds) {
			const userExist = await this.isUserPresent(userId);
			if (!userExist) {
				availableIds.push(userId);
			}
		}
		return availableIds;
	}

	private async isUserPresent(id: string): Promise<boolean> {
		const userFolder = this.userFolderPath(id);
		try {
			const stats = await fs.stat(userFolder);
			return stats.isDirectory();
		} catch (err) {
			if ((err as fs.FileException).notFound) { return false; }
			else { throw err; }
		}
	}

	wrap(): Factory {
		const wrap: Factory = {
			getAvailableAddresses: bind(this, this.getAvailableAddresses),
			add: bind(this, this.add),
		};
		Object.freeze(wrap);
		return wrap;
	}

}

function noop() {}

export function makeFactory(
	rootFolder: string, noTokenFile: string|undefined
): Factory {
	return (new Users(rootFolder, noTokenFile)).wrap();
}

Object.freeze(exports);