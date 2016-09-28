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
 * This module produces users object, which managers users, and manages
 * storage. The whole storage reliance set is located behind user's factory,
 * which is created by this module.
 */

import { Stream, Readable } from 'stream';
import { Store, SC, ObjReader } from './store';
import * as ownerApi from '../../lib-common/service-api/3nstorage/owner';

export { SC, ObjReader } from './store';

export interface BlobGetOpts {
	offset: number;
	maxLen: number;
}

export interface BlobSaveOpts {
	objId: string;
	appendMode: boolean;
	transactionId: string;
	chunkLen: number;
	offset?: number;
}

interface IGetParam<T> {
	(userId: string): Promise<T>;
}
interface ISetParam<T> {
	(userId: string, param: T): Promise<boolean>;
}

export interface IExists {
	(userId: string): Promise<boolean>;
}
export interface IStartTransaction {
	(userId: string, objId: string, trans: ownerApi.TransactionParams):
		Promise<string>;
}
export interface ICompleteTransaction {
	(userId: string, objId: string, transactionId: string): Promise<void>;
}
export interface ICancelTransaction {
	(userId: string, objId: string): Promise<void>;
}
export interface IGetHeader {
	(userId: string, objId: string, version: number): Promise<{
		header: Uint8Array; version?: number; segsLen: number; }>;
}
export interface IGetSegs {
	(userId: string, objId: string, version: number, opts: BlobGetOpts):
		Promise<ObjReader>;
}
export interface IGetHeaderSizeInTransaction {
	(userId: string, objId: string, transactionId: string): Promise<number>;
}
export interface ISaveHeader {
	(userId: string, objId: string, transactionId: string, header: Uint8Array):
		Promise<void>;
}
export interface ISaveSegs {
	(userId: string, bytes: Stream, opts: BlobSaveOpts): Promise<void>;
}
export interface IArchiveObjCurrentVersion {
	(userId: string, objId: string, version: number): Promise<void>;
}
export interface IListObjArchive {
	(userId: string, objId: string): Promise<number[]>;
}
export interface IDeleteObj {
	(userId: string, objId: string, version: number): Promise<void>;
}
export interface IGetSpaceQuota extends IGetParam<number> {}
export interface IGetKeyDerivParams extends IGetParam<any> {}
export interface ISetKeyDerivParams extends ISetParam<any> {}
/**
 * This is an external interface, behind which all storage machinery is hidding.
 */
export interface Factory {
	exists: IExists;
	getKeyDerivParams: IGetKeyDerivParams;
	setKeyDerivParams: ISetKeyDerivParams;
	getSpaceQuota: IGetSpaceQuota;
	startTransaction: IStartTransaction;
	finalizeTransaction: ICompleteTransaction;
	cancelTransaction: ICancelTransaction;
	getRootHeader: IGetHeader;
	getRootSegments: IGetSegs;
	getRootObjHeaderSizeInTransaction: IGetHeaderSizeInTransaction;
	saveRootHeader: ISaveHeader;
	saveRootSegments: ISaveSegs;
	getObjHeader: IGetHeader;
	getObjSegments: IGetSegs;
	getObjHeaderSizeInTransaction: IGetHeaderSizeInTransaction;
	saveObjHeader: ISaveHeader;
	saveObjSegments: ISaveSegs;
	listObjArchive: IListObjArchive;
	archiveObjVersion: IArchiveObjCurrentVersion;
	deleteObj: IDeleteObj;
}

export function makeFactory(rootFolder: string,
		writeBufferSize?: string|number, readBufferSize?: string|number):
		Factory {
	
	let stores = new Map<string, Store>();
	
	async function getStore(userId: string): Promise<Store> {
		let store = stores.get(userId);
		if (store) {
			try {
				await store.ensureUserExistsOnDisk();
				return store;
			} catch (err) {
				stores.delete(userId);
				throw err;
			}
		} else {
			let store = await Store.make(
				rootFolder, userId, writeBufferSize, readBufferSize);
			stores.set(userId, store);
			return store;
		}
	}
	
	function makeParamGetter<T>(staticGetter: (store: Store) => Promise<T>):
			(userId: string) => Promise<T> {
		return async (userId: string) => {
			let store = await getStore(userId);
			return staticGetter(store);
		};		
	}
	
	function makeParamSetter<T>(staticSetter:
			(store: Store, param: T, setDefault: boolean) => Promise<boolean>):
			(userId: string, param: T, setDefault?: boolean) => Promise<boolean> {
		return async (userId: string, param: T, setDefault?: boolean) => {
			let store = await getStore(userId);
			return staticSetter(store, param, setDefault);
		};		
	}
	
	function makeSegsSaver(isRoot: boolean): ISaveSegs {
		return async (userId: string, bytes: Readable, opts: BlobSaveOpts) => {
			let objId = opts.objId;
			if ((isRoot && objId) || (!isRoot && !objId)) {
				throw new Error("Mixed object types' functions.");
			}
			let store = await getStore(userId);
			if (opts.appendMode) {
				await store.appendObjSegs(objId, opts.transactionId,
					bytes, opts.chunkLen);
			} else {
				await store.saveObjSegChunk(objId, opts.transactionId,
					opts.offset, opts.chunkLen, bytes);
			}
		};
	}

	function makeHeaderSaver(isRoot: boolean): ISaveHeader {
		return async (userId: string, objId: string, transactionId: string, header: Uint8Array) => {
			if ((isRoot && objId) || (!isRoot && !objId)) {
				throw new Error("Mixed object types' functions.");
			}
			let store = await getStore(userId);
			await store.saveObjHeader(objId, transactionId, header);
		};
	}

	function makeHeaderSizeInTransGetter(isRoot: boolean):
			IGetHeaderSizeInTransaction {
		return async (userId: string, objId: string, transactionId: string) => {
			if ((isRoot && objId) || (!isRoot && !objId)) {
				throw new Error("Mixed object types' functions.");
			}
			let store = await getStore(userId);
			return store.getObjHeaderSizeInTransaction(objId, transactionId);
		}
	}

	function makeHeaderGetter(isRoot: boolean): IGetHeader {
		return async(userId: string, objId: string, version: number) => {
			if ((isRoot && objId) || (!isRoot && !objId)) {
				throw new Error("Mixed object types' functions.");
			}
			let store = await getStore(userId);
			return store.getObjHeader(objId, version);
		}
	}
	
	function makeSegsGetter(isRoot?: boolean): IGetSegs {
		return async (userId: string, objId: string, version: number,
				opts: BlobGetOpts) => {
			if ((isRoot && objId) || (!isRoot && !objId)) {
				throw new Error("Mixed object types' functions.");
			}
			let store = await getStore(userId);
			return store.getObjSegs(objId, version, opts.offset, opts.maxLen);
		};
	}
	
	function makeTransactionCloser(): ICompleteTransaction {
		return async (userId: string, objId: string, transactionId: string) => {
			let store = await getStore(userId);
			await store.completeTransaction(objId, transactionId);
		};
	}
	
	function makeTransactionCanceller(): ICancelTransaction {
		return async (userId: string, objId: string) => {
			let store = await getStore(userId);
			await store.cancelTransaction(objId);
		};
	}
	
	let factory: Factory = {
		
		exists: async (userId: string): Promise<boolean> => {
			try {
				let store = await getStore(userId);
				return true;
			} catch (err) {
				if (err !== SC.USER_UNKNOWN) { throw err; }
				return false;
			}
		},
		
		getSpaceQuota: makeParamGetter(Store.getSpaceQuota),
		getKeyDerivParams: makeParamGetter(Store.getKeyDerivParams),
		setKeyDerivParams: makeParamSetter(Store.setKeyDerivParams),
		
		startTransaction: async (userId: string, objId: string,
				trans: ownerApi.TransactionParams): Promise<string> => {
			let store = await getStore(userId);
			let transId = await store.startTransaction(objId, trans);
			return transId;
		},
		
		finalizeTransaction: makeTransactionCloser(),
		cancelTransaction: makeTransactionCanceller(),
		
		getRootObjHeaderSizeInTransaction: makeHeaderSizeInTransGetter(true),
		getObjHeaderSizeInTransaction: makeHeaderSizeInTransGetter(false),

		saveRootHeader: makeHeaderSaver(true),
		saveObjHeader: makeHeaderSaver(false),

		saveRootSegments: makeSegsSaver(true),
		saveObjSegments: makeSegsSaver(false),
		
		getRootHeader: makeHeaderGetter(true),
		getObjHeader: makeHeaderGetter(false),

		getRootSegments: makeSegsGetter(true),
		getObjSegments: makeSegsGetter(false),

		deleteObj: async (userId: string, objId: string, version: number):
				Promise<void> => {
			let store = await getStore(userId);
			await store.deleteObj(objId, version);
		},

		archiveObjVersion: async (userId: string, objId: string,
				version: number): Promise<void> => {
			let store = await getStore(userId);
			await store.archiveCurrentObjVersion(objId, version);
		},

		listObjArchive: async (userId: string, objId: string):
				Promise<number[]> => {
			let store = await getStore(userId);
			return store.listObjArchive(objId);
		},
		
	};
	Object.freeze(factory);
	return factory;
}

Object.freeze(exports);