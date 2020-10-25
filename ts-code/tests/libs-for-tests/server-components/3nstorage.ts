/*
 Copyright (C) 2016, 2019 - 2020 3NSoft Inc.
 
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

import { Component } from './component';
import { addUserIn } from './mailerid';
import { User } from '../pkl';
import { resolve as resolveUrl } from 'url';
import { get3NStorageServiceUrl } from '../3nstorage';
import * as fs from '../../../lib-common/async-fs-node';
import { Obj } from '../3nstorage';
import { bytesEqual } from '../bytes-equal';
import { ObjStatusInfo } from '../../../3nstorage/resources/store';
import { ObjVersionFile } from '../../../lib-common/objs-on-disk/obj-file';
import { join } from 'path';
import { joinByteArrs } from '../../../lib-common/buffer-utils';
import { userDataInRootFolder } from '../../../lib-server/resources/server-data-folders';

async function rmFolderContent(folder: string): Promise<void> {
	await fs.rmDirWithContent(folder);
	await fs.mkdir(folder);
}

export class StorageComponent extends Component {
	
	constructor(
		signupDomains: string[],
		public midServiceDomain: string
	) {
		super(
			{
				rootFolder: (null as any),
				domain: midServiceDomain,
				signup: {},
				enabledServices: {
					mailerId: true,
					storage: true
				},
				mailerId: {
					certs: (null as any)
				}
			},
			signupDomains
		);
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
		return join(userDataInRootFolder(this.conf.rootFolder, userId), 'store');
	}
	
	private async checkTransactionPresence(
		transFolder: string, transactionId: string|undefined
	): Promise<boolean> {
		const transFile = 'transaction';
		try {
			const lst = await fs.readdir(transFolder);
			expect(lst).toContain(transFile);
		} catch (exc) {
			if ((exc as fs.FileException).notFound) { return false; }
			else { throw exc; }
		}
		if (transactionId) {
			const trans = JSON.parse(await fs.readFile(
				join(transFolder, transFile), { encoding: 'utf8' }));
			return (trans.transactionId === transactionId);
		}
		return true;
	}
	
	rootTransactionExists(
		userId: string, transactionId?: string
	): Promise<boolean> {
		return this.checkTransactionPresence(
			join(this.storeFolder(userId), 'root', 'transaction'), transactionId);
	}
	
	transactionExists(
		userId: string, objId: string, transactionId?: string
	): Promise<boolean> {
		return this.checkTransactionPresence(
			join(this.storeFolder(userId),'transactions', objId), transactionId);
	}
	
	private async checkCurrentObjPresence(
		objFolder: string, ver: number|undefined, obj: Obj|undefined
	): Promise<boolean> {
		let status: ObjStatusInfo;
		try {
			status = JSON.parse(await fs.readFile(
				objFolder+'/status', { encoding: 'utf8' }));
		} catch (exc) {
			if ((<fs.FileException> exc).notFound) { return false; }
			else { throw exc; }
		}
		if (status.state !== 'current') { return false; }
		const currVer = status.currentVersion;
		if ((ver !== undefined) && (currVer !== ver)) { return false; }
		if (obj) {
			const filePath = join(objFolder, `${currVer}.`);
			const file = await ObjVersionFile.forExisting(filePath)
			.catch((exc: fs.FileException) => {
				if (exc.notFound) { return undefined; }
				throw exc;
			});
			if (!file) { return false; }
			const headerInFile = await file.readHeader();
			if (!headerInFile
			|| !bytesEqual(headerInFile, obj.header)) { return false; }
			const diff = obj.diff;
			if (file.getBaseVersion() === undefined) {
				if (diff) { return false; }
				const segsInFile = joinByteArrs(
					await file.readSegs(0, file.getTotalSegsLen()));
				if (!bytesEqual(segsInFile, obj.segs)) { return false; }
			} else {
				if (!diff) { return false; }
				if (file.getBaseVersion() !== diff.baseVersion) { return false; }
				if (file.getTotalSegsLen() !== diff.segsSize) { return false; }
				let ofs = 0;
				for (const [ isNew, dsOfs, len ] of diff.sections) {
					if (isNew === 0) {
						const sections = await file.segsLocations(ofs, len);
						for (const section of sections) {
							if (section.type !== 'base') { return false; }
						}
					} else {
						if (!bytesEqual(
							joinByteArrs(await file.readSegs(ofs, len)),
							obj.segs.subarray(dsOfs, dsOfs+len))) { return false; }
					}
					ofs += len;
				}
			}
		}
		return true;
	}
	
	currentRootObjExists(
		userId: string, ver?: number, obj?: Obj
	): Promise<boolean> {
		return this.checkCurrentObjPresence(
			join(this.storeFolder(userId), 'root'), ver, obj);
	}
	
	currentObjExists(
		userId: string, objId: string, ver?: number, obj?: Obj
	): Promise<boolean> {
		return this.checkCurrentObjPresence(
			join(this.storeFolder(userId), 'objects', objId), ver, obj);
	}

	async clearStorage(userId: string): Promise<void> {
		let storeFolder = this.storeFolder(userId);
		await rmFolderContent(join(storeFolder, 'transactions'));
		await rmFolderContent(join(storeFolder, 'objects'));
		await rmFolderContent(join(storeFolder, 'root'));
	}

	async restartAndClearStorageFor(userId: string): Promise<void> {
		await this.clearStorage(userId);
		await this.restart();
	}
	
}
Object.freeze(StorageComponent.prototype);
Object.freeze(StorageComponent);


Object.freeze(exports);