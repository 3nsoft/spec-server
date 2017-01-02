/*
 Copyright (C) 2016 3NSoft Inc.
 
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

import { Component } from './component';
import { addUserIn } from './mailerid';
import { User } from '../pkl';
import { resolve as resolveUrl } from 'url';
import { get3NStorageServiceUrl } from '../3nstorage';
import * as fs from '../../../lib-common/async-fs-node';
import { addressToFName } from '../../../lib-server/resources/user-files';
import { Obj } from '../3nstorage';
import { bytesEqual } from '../bytes-equal';
import { deepEqual } from '../json-equal';
import { ObjStatusInfo } from '../../../3nstorage/resources/store';
import { parseObjFile } from '../../../3nstorage/resources/obj-file';

async function rmFolderContent(folder: string): Promise<void> {
	await fs.rmDirWithContent(folder);
	await fs.mkdir(folder);
}

export class StorageComponent extends Component {
	
	constructor(signupDomains: string[], public midServiceDomain: string) {
		super({
			rootFolder: (null as any),
			domain: midServiceDomain,
			signup: {
				domains: signupDomains
			},
			enabledServices: {
				mailerId: true,
				storage: true
			},
			mailerId: {
				certs: (null as any)
			}
		});
		Object.seal(this);
	}
	
	async addUser(userId: string, configureDNS = true): Promise<User> {
		if (configureDNS) { this.dns.configureFor(userId); }
		let user = await addUserIn(this.url, userId);
		user.midUrl = this.midUrl;
		user.storageOwnerUrl = await this.getStorageOwnerUrl();
		return user;
	}
	
	get midUrl(): string {
		return resolveUrl(this.url, 'mailerid/');
	}
	
	get storageUrl(): string {
		return resolveUrl(this.url, '3nstorage/');
	}
	
	async getStorageOwnerUrl(): Promise<string> {
		let storageOwnerUrl = await get3NStorageServiceUrl(
			this.storageUrl, 'owner');
		if (!storageOwnerUrl.endsWith('/')) { storageOwnerUrl += '/'; }
		return storageOwnerUrl;
	}
	
	private storeFolder(userId: string): string {
		return `${this.conf.rootFolder}/users/${addressToFName(userId)}/store`;
	}
	
	private async checkTransactionPresence(transFolder: string,
			transactionId: string|undefined): Promise<boolean> {
		let transFile = 'transaction';
		try {
			let lst = await fs.readdir(transFolder);
			expect(lst).toContain(transFile);
		} catch (exc) {
			if ((<fs.FileException> exc).notFound) { return false; }
			else { throw exc; }
		}
		if (transactionId) {
			let trans = JSON.parse(await fs.readFile(
				transFolder+'/'+transFile, { encoding: 'utf8' }));
			return (trans.transactionId === transactionId);
		}
		return true;
	}
	
	rootTransactionExists(userId: string, transactionId?: string):
			Promise<boolean> {
		return this.checkTransactionPresence(
			this.storeFolder(userId)+'/root/transaction', transactionId);
	}
	
	transactionExists(userId: string, objId: string, transactionId?: string):
			Promise<boolean> {
		return this.checkTransactionPresence(
			this.storeFolder(userId)+'/transactions/'+objId, transactionId);
	}
	
	private async checkObjPresence(objFolder: string, ver: number|undefined,
			obj: Obj|undefined): Promise<boolean> {
		let status: ObjStatusInfo;
		try {
			status = JSON.parse(await fs.readFile(
				objFolder+'/status', { encoding: 'utf8' }));
		} catch (exc) {
			if ((<fs.FileException> exc).notFound) { return false; }
			else { throw exc; }
		}
		if (status.state !== 'current') { return false; }
		let currVer = status.currentVersion;
		if ((ver !== undefined) && (currVer !== ver)) { return false; }
		if (obj) {
			let fd = await fs.open(`${objFolder}/${currVer}.`, 'r')
			.catch((exc: fs.FileException) => {
				if (exc.notFound) { return undefined; }
				throw exc;
			});
			if (fd === undefined) { return false; }
			try {
				let { headerOffset, segsOffset, diff } = await parseObjFile(fd);
				let bytes = new Buffer(segsOffset - headerOffset);
				await fs.read(fd, headerOffset, bytes);
				if (!bytesEqual(bytes, obj.header)) { return false; }
				let fileStat = await fs.fstat(fd);
				bytes = new Buffer(fileStat.size - segsOffset);
				await fs.read(fd, segsOffset, bytes);
				if (!bytesEqual(bytes, obj.segs)) { return false; }
				if ((diff && !obj.diff) || (!diff && obj.diff)) { return false; }
				if (diff && !deepEqual(diff, obj.diff)) { return false; }
			} finally {
				await fs.close(fd);
			}
		}
		return true;
	}
	
	rootObjExists(userId: string, ver?: number, obj?: Obj):
			Promise<boolean> {
		return this.checkObjPresence(
			this.storeFolder(userId)+'/root', ver, obj);
	}
	
	objExists(userId: string, objId: string, ver?: number, obj?: Obj):
			Promise<boolean> {
		return this.checkObjPresence(
			this.storeFolder(userId)+'/objects/'+objId, ver, obj);
	}

	async clearStorage(userId: string): Promise<void> {
		let storeFolder = this.storeFolder(userId);
		await rmFolderContent(`${storeFolder}/transactions`);
		await rmFolderContent(`${storeFolder}/objects`);
		await rmFolderContent(`${storeFolder}/root`);
	}

	async restartAndClearStorageFor(userId: string): Promise<void> {
		await this.clearStorage(userId);
		await this.restart();
	}
	
}
Object.freeze(StorageComponent.prototype);
Object.freeze(StorageComponent);

Object.freeze(exports);