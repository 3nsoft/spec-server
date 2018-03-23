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
 * This module is provides administrative functionality, like adding new users,
 * changing users quotas, etc.
 */

import * as fs from '../../lib-common/async-fs-node';
import { mkdirSync, writeFileSync } from 'fs';
import { base64urlSafe, utf8 } from '../../lib-common/buffer-utils';
import * as jwk from '../../lib-common/jwkeys';
import * as nacl from 'ecma-nacl';
import { UserMidParams } from '../../lib-common/admin-api/signup';
import { bind } from '../../lib-common/binding';
import { checkAndTransformAddress, toCanonicalAddress }
	from '../../lib-common/canonical-address';
import * as asmailConf from '../../lib-common/service-api/asmail/config';

export const SC = {
	USER_ALREADY_EXIST: 'user-already-exist',
};
Object.freeze(SC);

export interface UserStorageParams {
	params: any;
}

const MID_KEY_USE = 'login-pub-key';

function checkDefaultMidKeyParams(params: UserMidParams): boolean {
	const ok = ('object' === typeof params.defaultPKey) && !!params.defaultPKey &&
		jwk.isLikeJsonKey(params.defaultPKey.pkey) &&
		(typeof params.defaultPKey.params === 'object') &&
		!!params.defaultPKey.params;
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
		checkDefaultMidKeyParams(params) && Array.isArray(params.otherPKeys) &&
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
			(typeof params.params === 'object') && !!params.params);
}

/**
 * This checks if given id is well-formed for domains that 3NWeb provides, 
 * returning true, when given id is OK, and false, otherwise.
 */
export interface ICheckId {
	(newUserId: string): boolean;
}
/**
 * This returns a promise, resolvable to
 * - true, when given new id is available,
 * - false, when there is already a user with given id.
 */
export interface IUserIdAvailable {
	(newUserId: string): Promise<boolean>;
}
/**
 * This checks if given name is well-formed for domains that 3NWeb provides, 
 * returning true, when given id is OK, and false, otherwise.
 */
export interface ICheckName {
	(name: string): boolean;
}
/**
 * This returns a promise, resolvable to an array of addresses, that are
 * available for a given string. Array may be empty, when there are no
 * such addresses.
 */
export interface IAvailableAddressesForName {
	/**
	 * @param name is a name part of address, or not a domain part.
	 * @return a promise, resolvable to available addresses for a given name.
	 * If array is empty, there are no available addresses for a given name.
	 */
	(name: string): Promise<string[]>;
}
/**
 * This creates a user, returning a promise, resolvable when a new account has
 * been created for a given user id.
 */
export interface IAdd {
	/**
	 * @param userId is user's address. Notice that this is not a canonical form,
	 * but user-likable variant.
	 * @param midParams MailerId parameters to save
	 * @param storeParams storage parameters to save
	 * @return a promise, resolvable, when user is added, and all parameters are
	 * saved.
	 */
	(userId: string, midParams: UserMidParams, storeParams: any):
		Promise<void>;
}
/**
 * This sets user's MailerId parameters.
 */
export interface ISetMidParams {
	/**
	 * @param canonicalAddress is user's canonical address
	 * @param midParams is MailerId parameters object to save
	 * @return a promise, resolvable, when saving of new parameters is done.
	 */
	(canonicalAddress: string, midParams: UserMidParams): Promise<void>;
}

export interface Factory {
	isIdOK: ICheckId;
	isIdAvailable: IUserIdAvailable;
	isNameOK: ICheckName;
	getAvailableAddresses: IAvailableAddressesForName;
	add: IAdd;
	setMidParams: ISetMidParams;
}

/**
 * @param rootFolder
 * @param canonicalAddress
 * @return folder path, corresponding to a given user id.
 */
function makeUserFolderPath(rootFolder: string,
		canonicalAddress: string): string {
	return rootFolder+"/"+base64urlSafe.pack(utf8.pack(canonicalAddress));
}

/**
 * @param userFolder
 * @return a promise, resolvable when mail folder's structure is created in
 * a given user folder.
 */
async function createMailFolder(userFolder: string): Promise<void> {
	const mailFolder = userFolder+'/mail';
	await fs.mkdir(mailFolder)
	await Promise.all([
		fs.mkdir(mailFolder+'/messages'),
		fs.mkdir(mailFolder+'/delivery'),
		fs.mkdir(mailFolder+'/params') ]);
}

/**
 * @param userFolder
 * @return a promise, resolvable when store folder's structure is created in
 * a given user folder.
 */
async function createStoreFolder(userFolder: string): Promise<void> {
	const storeFolder = userFolder+'/store';
	await fs.mkdir(storeFolder);
	await Promise.all([
		fs.mkdir(storeFolder+'/objects'),
		fs.mkdir(storeFolder+'/transactions'),
		fs.mkdir(storeFolder+'/root'),
		fs.mkdir(storeFolder+'/params') ]);
}

/**
 * @param rootFolder
 * @param userId
 * @return promise, resolvable to path of a newly created user folder, with
 * file structure initialized for both mail and storage.
 */
async function createUserFolder(rootFolder: string, userId: string):
		Promise<string> {
	const canonicalAddress = toCanonicalAddress(userId);
	const userFolder = makeUserFolderPath(rootFolder, canonicalAddress);
	try{
		await fs.mkdir(userFolder);
	} catch (err) {
		if ((<fs.FileException> err).alreadyExists) {
			throw SC.USER_ALREADY_EXIST;
		}
		throw err;
	}
	try {
		await Promise.all([
			createMailFolder(userFolder),
			createStoreFolder(userFolder),
			fs.mkdir(userFolder+'/info') ]);
		
		await fs.writeFile(userFolder+'/info/userid',
				userId, { encoding: 'utf8', flag: 'w' });
		return userFolder;
	} catch (e) {
		await fs.rmDirWithContent(userFolder).catch((err) => {});
		throw e;
	}
}

/**
 * This synchronously checks, if given user folder exists, creating it, if it
 * does not.
 * @param usersFolder
 */
function ensureUsersPresent(usersFolder: string): void {
	if (!fs.existsFolderSync(usersFolder)) {
		mkdirSync(usersFolder);
	}
}

function writeJsonSync(path: string, json: any): void {
	writeFileSync(path, JSON.stringify(json),
		{ encoding: 'utf8', flag: 'w', mode: parseInt('660', 8) });
}

function setGeneralDefaults(defaultsFolder: string): void {
	mkdirSync(defaultsFolder+'/info');
	const inf = defaultsFolder+'/info/';
	writeJsonSync(inf+'quota', 100*1024*1024*1024);
}

function setStoreDefaults(defaultsFolder: string): void {
	mkdirSync(defaultsFolder+'/store');
	let sp = defaultsFolder+'/store/params';
	mkdirSync(sp);
	sp += '/';
	writeJsonSync(sp+'key-deriv', null);
}

function setMailDefaults(defaultsFolder: string): void {
	mkdirSync(defaultsFolder+'/mail');
	let mp = defaultsFolder+'/mail/params';
	mkdirSync(mp);
	mp += '/';
	writeJsonSync(mp+'pubkey', null);
	mkdirSync(mp+'anonymous');
	const anonPolicy: asmailConf.p.anonSenderPolicy.Policy = {
		accept: true,
		acceptWithInvitesOnly: false,
		defaultMsgSize: 1024*1024
	};
	writeJsonSync(mp+'anonymous/policy', anonPolicy);
	writeJsonSync(mp+'anonymous/invites', {});
	mkdirSync(mp+'authenticated');
	const authPolicy: asmailConf.p.authSenderPolicy.Policy = {
		acceptWithInvitesOnly: false,
		acceptFromWhiteListOnly: false,
		applyBlackList: true,
		defaultMsgSize: 1024*1024
	}
	writeJsonSync(mp+'authenticated/policy', authPolicy);
	writeJsonSync(mp+'authenticated/whitelist', {});
	writeJsonSync(mp+'authenticated/blacklist', {});
	writeJsonSync(mp+'authenticated/invites', {});
}

/**
 * This synchronously checks, if given defaults folder exists.
 * If folder does not exist, it is created and populated with default values.
 * @param defaultsFolder
 */
function ensureDefaultsPresent(defaultsFolder: string): void {
	if (!fs.existsFolderSync(defaultsFolder)) {
		mkdirSync(defaultsFolder);
		setGeneralDefaults(defaultsFolder);
		setMailDefaults(defaultsFolder);
		setStoreDefaults(defaultsFolder);
	}
}

class Users {
	
	private users: string;
	private defaults: string;
	private domains: string[];
	
	constructor(domains: string[], rootFolder: string) {
		if (!fs.existsFolderSync(rootFolder)) { throw new Error(
			`Given root folder does not exist: ${rootFolder}`); }
		this.users = rootFolder+'/users';
		ensureUsersPresent(this.users);
		this.defaults = rootFolder+'/defaults';
		ensureDefaultsPresent(this.defaults);
		if (domains.length === 0) { throw new Error('Bad domains given'); }
		this.domains = domains;
	}
	
	async add(userId: string, midParams: UserMidParams,
			storeKeyDerivParams: any): Promise<void> {
		const canonicalAddress = toCanonicalAddress(userId);
		const userFolder = await createUserFolder(this.users, userId);
		try {
			await fs.copyTree(this.defaults, userFolder);
			await this.setMidParams(canonicalAddress, midParams);
			await this.setStoreParams(canonicalAddress, storeKeyDerivParams);
		} catch (e) {
			await fs.rmDirWithContent(userFolder).catch((err) => {});
			throw e;
		}
	}
	
	setMidParams(canonicalAddress: string, midParams: UserMidParams): 
			Promise<void> {
		if (!validateUserMidParams(midParams)) { throw new Error(
			'Invalid MailerId parameters are given'); }
		return fs.writeFile(
			makeUserFolderPath(this.users, canonicalAddress)+'/info/mid-params',
			JSON.stringify(midParams), { encoding: 'utf8', flag: 'w' });
	}
	
	setStoreParams(canonicalAddress: string, keyDerivParams: any): Promise<void> {
		if (!keyDerivParams) { throw new Error(
			'Store key derivation parameters are not given'); }
		return fs.writeFile(
			makeUserFolderPath(this.users, canonicalAddress)+'/store/params/key-deriv',
			JSON.stringify(keyDerivParams), { encoding: 'utf8', flag: 'w' });
	}
	
	isIdOK(userId: string): boolean {
		if (!checkAndTransformAddress(userId)) { return false; }
		const indOfAt = userId.lastIndexOf('@');
		if (!this.isNameOK(userId.substring(0, indOfAt))) { return false; }
		const domainPart = userId.substring(indOfAt+1).toLowerCase();
		for (var i=0; i < this.domains.length; i+=1) {
			if (domainPart === this.domains[i]) { return true; }
		}
		return false;
	}
	
	async isIdAvailable(id: string): Promise<boolean> {
		if (!this.isIdOK(id)) { throw new Error(
			`Given illegal user id: ${id}`); }
		id = toCanonicalAddress(id);
		const path = makeUserFolderPath(this.users, id);
		try{
			await fs.readdir(path);
			return false;
		} catch (err) {
			if ((<fs.FileException> err).notFound) { return true; }
			throw err;
		}
	}
	
	isNameOK(name: string): boolean {
		return ((name.indexOf('@') < 0) &&
				// (name.trim() === name) &&
				(name.length >= 6) &&
				!!checkAndTransformAddress(name+'@domain'));
	}
	
	async getAvailableAddresses(name: string): Promise<string[]> {
		if (!this.isNameOK(name)) { throw new Error(
			`Given illegal name: ${name}`); }
		const availableIds: string[] = [];
		const promises: Promise<void>[] = [];
		for (const domain of this.domains) {
			const userId = `${name}@${domain}`;
			const promise = this.isIdAvailable(userId)
			.then((userIdAvailable) => {
				if (userIdAvailable) { availableIds.push(userId); }
			});
			promises.push(promise);
		}
		await Promise.all(promises)
		return availableIds;
	}
	
	wrap(): Factory {
		const wrap: Factory = {
			isIdOK: bind(this, this.isIdOK),
			isIdAvailable: bind(this, this.isIdAvailable),
			isNameOK: bind(this, this.isNameOK),
			getAvailableAddresses: bind(this, this.getAvailableAddresses),
			add: bind(this, this.add),
			setMidParams: bind(this, this.setMidParams)
		};
		Object.freeze(wrap);
		return wrap;
	}
	
}

export function makeFactory(domains: string[], rootFolder: string): Factory {
	return (new Users(domains, rootFolder)).wrap();
}

Object.freeze(exports);