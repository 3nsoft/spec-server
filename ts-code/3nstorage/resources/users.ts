/*
 Copyright (C) 2015 - 2017, 2020 3NSoft Inc.
 
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
 * This module produces users object, which managers users, and manages
 * storage. The whole storage reliance set is located behind user's factory,
 * which is created by this module.
 */

import { Readable as ReadableStream } from 'stream';
import { Store, SC, ObjReader, StorageEventsSink } from './store';
import { PutObjFirstQueryOpts, PutObjSecondQueryOpts, DiffInfo } from '../../lib-common/service-api/3nstorage/owner';
import { userDataInRootFolder } from '../../lib-server/resources/server-data-folders';

export { SC, ObjReader, MismatchedObjVerException } from './store';

export type UserExists = (userId: string) => Promise<boolean>;

export type GetCurrentObj = (
	userId: string, objId: string|null,
	header: boolean, segsOffset: number, segsLimit: number|undefined
) => Promise<{ version: number; reader: ObjReader; }>;

export type SaveNewObjVersion = (
	userId: string, objId: string|null,
	fstReq: PutObjFirstQueryOpts|undefined, diff: DiffInfo|undefined,
	sndReq: PutObjSecondQueryOpts|undefined,
	bytesLen: number, bytes: ReadableStream
) => Promise<string|undefined>;

export type GetArchivedObjVersion = (
	userId: string, objId: string|null, version: number,
	header: boolean, segsOffset: number, segsLimit: number|undefined
) => Promise<ObjReader>;

export type CancelTransaction = (
	userId: string, objId: string, transactionId?: string
) => Promise<void>;

export type ArchiveObjCurrentVersion = (
	userId: string, objId: string, version: number
) => Promise<void>;

export type ListObjArchive = (
	userId: string, objId: string
) => Promise<number[]>;

export type DeleteCurrentObjVersion = (
	userId: string, objId: string, version?: number
) => Promise<void>;

export type DeleteArchivedObjVersion = (
	userId: string, objId: string|null, version: number
) => Promise<void>;


type GetParam<T> = (userId: string) => Promise<T>;
type SetParam<T> = (userId: string, param: T) => Promise<boolean>;

export type GetSpaceQuota = GetParam<number>;
export type GetKeyDerivParams = GetParam<any>;
export type SetKeyDerivParams = SetParam<any>;

export type EventsSink = StorageEventsSink;

/**
 * This is an external interface, behind which all storage machinery is hidding.
 */
export interface Factory {
	exists: UserExists;
	getKeyDerivParams: GetKeyDerivParams;
	setKeyDerivParams: SetKeyDerivParams;
	getSpaceQuota: GetSpaceQuota;
	cancelTransaction: CancelTransaction;
	getCurrentObj: GetCurrentObj;
	saveNewObjVersion: SaveNewObjVersion;
	saveNewRootVersion: SaveNewObjVersion;
	getCurrentRootObj: GetCurrentObj;
	listObjArchive: ListObjArchive;
	archiveObjVersion: ArchiveObjCurrentVersion;
	getArchivedRootVersion: GetArchivedObjVersion;
	getArchivedObjVersion: GetArchivedObjVersion;
	deleteCurrentObjVersion: DeleteCurrentObjVersion;
	deleteArchivedObjVersion: DeleteArchivedObjVersion;
	setStorageEventsSink(sink: EventsSink): void;
}

export function makeFactory(
	rootFolder: string,
	writeBufferSize?: string|number, readBufferSize?: string|number
): Factory {
	
	const stores = new Map<string, Store>();

	let storageEventsSink: StorageEventsSink|undefined = undefined;
	
	async function getStore(userId: string): Promise<Store> {
		if (!storageEventsSink) { throw new Error(
			`Storage events sink is not set`); }
		const store = stores.get(userId);
		if (store) {
			try {
				await store.ensureUserExistsOnDisk();
				return store;
			} catch (err) {
				stores.delete(userId);
				throw err;
			}
		} else {
			const userFolder = userDataInRootFolder(rootFolder, userId);
			const store = await Store.make(
				userFolder, userId, storageEventsSink,
				writeBufferSize, readBufferSize
			);
			stores.set(userId, store);
			return store;
		}
	}
	
	function makeParamGetter<T>(staticGetter: (store: Store) => Promise<T>):
			(userId: string) => Promise<T> {
		return async (userId: string) => {
			const store = await getStore(userId);
			return staticGetter(store);
		};		
	}
	
	function makeParamSetter<T>(staticSetter:
			(store: Store, param: T, setDefault: boolean) => Promise<boolean>):
			(userId: string, param: T, setDefault?: boolean) => Promise<boolean> {
		return async (userId: string, param: T, setDefault?: boolean) => {
			const store = await getStore(userId);
			return staticSetter(store, param, !!setDefault);
		};		
	}

	function makeCurrentObjGetter(isRoot?: boolean): GetCurrentObj {
		return async (userId: string, objId: string|null, header: boolean,
				segsOffset: number, segsLimit: number|undefined) => {
			if ((isRoot && objId) || (!isRoot && !objId)) {
				throw new Error("Mixed object types' functions.");
			}
			const store = await getStore(userId);
			return store.getCurrentObj(objId, header, segsOffset, segsLimit);
		}
	}

	function makeArchivedObjGetter(isRoot?: boolean): GetArchivedObjVersion {
		return async (userId: string, objId: string|null, version: number,
				header: boolean, segsOffset: number,
				segsLimit: number|undefined) => {
			if ((isRoot && objId) || (!isRoot && !objId)) {
				throw new Error("Mixed object types' functions.");
			}
			const store = await getStore(userId);
			return store.getArchivedObjVersion(objId, version, header, segsOffset, segsLimit);
		}
	}
	
	function makeObjSaver(isRoot: boolean): SaveNewObjVersion {
		return async (userId: string, objId: string|null,
				fstReq: PutObjFirstQueryOpts|undefined, diff: DiffInfo|undefined,
				sndReq: PutObjSecondQueryOpts|undefined, bytesLen: number,
				bytes: ReadableStream): Promise<string|undefined> => {
			if ((isRoot && objId) || (!isRoot && !objId)) {
				throw new Error("Mixed object types' functions.");
			}
			const store = await getStore(userId);
			if (fstReq) {
				return store.startSavingObjNewVersion(objId, diff,
					bytes, bytesLen, fstReq);
			} else if (sndReq) {
				return store.continueSavingObjNewVersion(objId,
					bytes, bytesLen, sndReq);
			} else {
				throw new Error(`Missing both request options`);
			}
		};
	}
	
	function makeTransactionCanceller(): CancelTransaction {
		return async (userId: string, objId: string, transactionId?: string) => {
			const store = await getStore(userId);
			await store.cancelTransaction(objId, transactionId);
		};
	}
	
	const factory: Factory = {
		
		exists: async (userId) => {
			try {
				const store = await getStore(userId);
				return true;
			} catch (err) {
				if (err !== SC.USER_UNKNOWN) { throw err; }
				return false;
			}
		},
		
		getSpaceQuota: makeParamGetter(Store.getSpaceQuota),
		getKeyDerivParams: makeParamGetter(Store.getKeyDerivParams),
		setKeyDerivParams: makeParamSetter(Store.setKeyDerivParams),
		
		getCurrentRootObj: makeCurrentObjGetter(true),
		getCurrentObj: makeCurrentObjGetter(false),

		getArchivedRootVersion: makeArchivedObjGetter(true),
		getArchivedObjVersion: makeArchivedObjGetter(false),

		saveNewRootVersion: makeObjSaver(true),
		saveNewObjVersion: makeObjSaver(false),

		cancelTransaction: makeTransactionCanceller(),
		
		deleteCurrentObjVersion: async (userId, objId, version) => {
			const store = await getStore(userId);
			await store.deleteCurrentObjVer(objId, version);
		},

		archiveObjVersion: async (userId, objId, version) => {
			const store = await getStore(userId);
			await store.archiveCurrentObjVersion(objId, version);
		},

		listObjArchive: async (userId, objId) => {
			const store = await getStore(userId);
			return store.listObjArchive(objId);
		},

		deleteArchivedObjVersion: async (userId, objId, version) => {
			const store = await getStore(userId);
			await store.deleteArchivedObjVer(objId, version);
		},

		setStorageEventsSink(sink: EventsSink): void {
			if (storageEventsSink) { throw new Error(
				`Storage events sink is already set`); }
			storageEventsSink = sink;
		}
		
	};
	Object.freeze(factory);
	return factory;
}

Object.freeze(exports);