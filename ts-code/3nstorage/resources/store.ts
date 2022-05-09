/*
 Copyright (C) 2015 - 2017, 2019 - 2020 3NSoft Inc.
 
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
 * Everything in this module is assumed to be inside of a storage reliance set.
 * 
 * Store files are laid out on disk in the following way:
 * (a) store is just a folder with stuff inside;
 * (b) main store folder contains following folders:
 * (b.1) root - is afolder for root object;
 * (b.2) objects - is a folder for non-root object folders;
 * (b.3) transactions - is a folder with non-root object transactions;
 * (b.4) params - is a folder for information files about this storage;
 * (c) object folder's name is object's id;
 * (d) object folder contains:
 * (d.1) status - is a json file with information about an object;
 * (d.2) N. - is a file with an N'th version object's either diff or whole
 *            object file;
 * (e) transactions folder (for root and non-root) contains:
 * (e.1) transaction - is a json file with current transaction's info;
 *                     this file is present only for duration of a transaction,
 *                     and also acts as a transaction lock;
 * (e.2) new - is a new version, still in transaction, either diff or whole
 *              object file;
 */

import * as fs from '../../lib-common/async-fs-node';
import { Readable } from 'stream';
import { PutObjFirstQueryOpts, PutObjSecondQueryOpts } from '../../lib-common/service-api/3nstorage/owner';
import { stringOfB64UrlSafeChars } from '../../lib-common/random-node';
import { UserFiles, SC as ufSC, ObjReader } from '../../lib-server/resources/user-files';
import { DiffInfo, objChanged, objRemoved } from '../../lib-common/service-api/3nstorage/owner';
import { streamToObjFile, diffToLayout, chunksInOrderedStream, makeObjPipe, GetObjFile } from '../../lib-common/objs-on-disk/utils';
import { TimeWindowCache } from '../../lib-common/time-window-cache';
import { ObjVersionFile } from '../../lib-common/objs-on-disk/obj-file';
import { errWithCause } from '../../lib-common/exceptions/error';
import { join } from 'path';
import { NamedProcs } from '../../lib-common/processes';

export { DiffInfo } from '../../lib-common/service-api/3nstorage/owner';
export { ObjPipe, ObjReader } from '../../lib-server/resources/user-files';

export type MsgEvents = objChanged.Event | objRemoved.Event;

export type StorageEventsSink = (userId: string,
	channel: string, event: MsgEvents) => void;

export const SC = {
	USER_UNKNOWN: ufSC.USER_UNKNOWN,
	OBJ_EXIST: 'obj-already-exist',
	OBJ_UNKNOWN: 'obj-unknown',
	OBJ_VER_UNKNOWN: 'obj-ver-unknown',
	OBJ_VER_EXIST: 'obj-ver-already-exist',
	CONCURRENT_TRANSACTION: "concurrent-transactions",
	TRANSACTION_UNKNOWN: "transactions-unknown",
	NOT_ENOUGH_SPACE: "not-enough-space",
	OBJ_FILE_INCOMPLETE: 'obj-file-incomplete',
};
Object.freeze(SC);

export interface MismatchedObjVerException {
	type: 'mismatched-obj-ver';
	current_version: number;
}

export function makeMismatchedObjVerException(current_version: number):
		MismatchedObjVerException {
	return {
		type: 'mismatched-obj-ver',
		current_version
	};
}

export interface ObjStatusInfo {
	state: 'new' | 'current' | 'archived';
	currentVersion?: number;
	archivedVersions?: number[];
}

const STATUS_FILE = 'status';

export interface TransactionParams {
	isNewObj?: boolean;
	version: number;
	baseVersion?: number;
}

export interface TransactionInfo extends TransactionParams {
	transactionType: 'write' | 'remove' | 'archive';
	transactionId: string;
}

interface SpaceInfo {
	free: number;
	used: number;
}

// XXX move this space-tracker into user-files file. One instance for the whole
// server should do the job.
class SpaceTracker {
	
	private space: {
		[userId: string]: SpaceInfo;
	} = {};
	
	constructor() {
		Object.freeze(this);
	}

	private async diskUsed(path: string, runNum = 0): Promise<number> {
		
		// XXX use calculated value, updating it from time to time with du <folder>. while on windows du might be in linux console!

		return 0;
	}
	
	/**
	 * @param store
	 * @return a promise, resolvable to space info object.
	 */
	private async updateSpaceInfo(store: Store): Promise<SpaceInfo> {
		const usedSpace = await this.diskUsed(store.path);
		const quota = await store.getSpaceQuota();
		return {
			free: Math.max(0, quota-usedSpace),
			used: usedSpace
		};
	}
	
	async change(store: Store, delta: number): Promise<void> {
		let s = this.space[store.userId];
		if (!s) {
			s = await this.updateSpaceInfo(store);
		}
		if ((delta > 0) && ((s.free - delta) < 0)) {
			throw SC.NOT_ENOUGH_SPACE;
		}
		s.free -= delta;
		s.used += delta;
	}
	
	reset(userId: string): void {
		delete this.space[userId];
	}
	
}
Object.freeze(SpaceTracker.prototype);
Object.freeze(SpaceTracker);

const spaceTracker = new SpaceTracker();

const SINGLE_BYTE_BUF = Buffer.alloc(1);
SINGLE_BYTE_BUF[0] = 0;

export class Store extends UserFiles {

	private objVerFiles = new ObjVerFiles(30*1000);

	private statuses = new ObjStatuses(30*1000, this.path);

	private transactions = new ObjTransactions(
		30*1000, this.statuses, this.path, this.objVerFiles.uncache);
	
	constructor(userId: string, path: string,
		private storageEventsSink: StorageEventsSink,
		writeBufferSize?: string|number, readBufferSize?: string|number
	) {
		super(userId, path, writeBufferSize, readBufferSize);
		Object.freeze(this);
	}
	
	static async make(
		userFolder: string, userId: string, storageEventsSink: StorageEventsSink,
		writeBufferSize?: string|number, readBufferSize?: string|number
	): Promise<Store> {
		const path = join(userFolder, 'store');
		const store = new Store(userId, path, storageEventsSink,
			writeBufferSize, readBufferSize);
		await store.ensureUserExistsOnDisk();
		return store;
	}

	/**
	 * This method starts object saving transaction, saves bytes from a stream,
	 * and, if upload is complete in one request, closes transaction.
	 * Returned promise resolves to a transaction id, if transaction is not
	 * complete, and to undefined, otherwise.
	 * @param objId is a string object id for non-root objects, and null for
	 * root object.
	 * @param bytes is a stream of bytes that has object header, and some or all
	 * segment bytes, following header.
	 * @param byteLen is an expected length of a given byte stream.
	 * @param opts
	 */
	async startSavingObjNewVersion(
		objId: string|null, diff: DiffInfo|undefined,
		bytes: Readable, byteLen: number, opts: PutObjFirstQueryOpts
	): Promise<string|undefined> {
		if (byteLen > 0) {
			await spaceTracker.change(this, byteLen);
		}

		const params: TransactionParams = {
			isNewObj: opts.create,
			version: opts.ver,
			baseVersion: (diff ? diff.baseVersion : undefined)
		};
		const trans = await this.transactions.startNew(objId, params);

		let file: ObjVersionFile;
		try {
			const filePath = this.transactions.objFileWritingPath(objId);
			file = await this.objVerFiles.forNewFile(
				objId, trans.version, filePath);
			if (diff) {
				await file.setSegsLayout(diffToLayout(diff), false);
			}

			const chunks = chunksInOrderedStream(byteLen, opts.header, 0);
			await streamToObjFile(file, chunks, bytes, this.fileWritingBufferSize);

			if (opts.last) {
				if (!file.isFileComplete()) { throw SC.OBJ_FILE_INCOMPLETE; }
				await this.transactions.complete(objId, trans, file);
				this.storageEventsSink(this.userId, objChanged.EVENT_NAME, {
					objId,
					newVer: opts.ver
				});
			} else {
				return trans.transactionId;
			}

		} catch (err) {
			await spaceTracker.change(this, -byteLen);
			await this.transactions.cancel(objId, trans.transactionId).catch(noop);
			throw err;
		}
	}

	/**
	 * This method continues object saving transaction. If this request is the
	 * last, it closes transaction.
	 * Returned promise resolves to a transaction id, if transaction is not
	 * complete, and to undefined, if it is closed.
	 * @param objId is a string object id for non-root objects, and null for
	 * root object.
	 * @param bytes is a stream of bytes that has optional diff info, object
	 * header, and some or all segment bytes in this order.
	 * @param byteLen is an expected length of a given byte stream.
	 * @param opts
	 */
	async continueSavingObjNewVersion(
		objId: string|null, bytes: Readable, byteLen: number,
		opts: PutObjSecondQueryOpts
	): Promise<string|undefined> {
		const trans = await this.transactions.get(objId, opts.trans);

		try {
			const filePath = this.transactions.objFileWritingPath(objId);
			const file = await this.objVerFiles.forExistingFile(
				objId, trans.version, filePath);

			if (byteLen > 0) {
				await spaceTracker.change(this, byteLen);
				const chunks = chunksInOrderedStream(byteLen, undefined, opts.ofs);
				await streamToObjFile(
					file, chunks, bytes, this.fileWritingBufferSize);
			}
			
			if (opts.last) {
				if (!file.isFileComplete()) { throw SC.OBJ_FILE_INCOMPLETE; }
				await this.transactions.complete(objId, trans, file);
				this.storageEventsSink(this.userId, objChanged.EVENT_NAME, {
					objId,
					newVer: trans.version
				});
			} else {
				return opts.trans;
			}
		} catch (err) {
			await spaceTracker.change(this, -byteLen);
			await this.transactions.cancel(objId, trans.transactionId).catch(() => {});
			throw err;
		}
	}

	async cancelTransaction(
		objId: string|null, transactionId?: string
	): Promise<void> {
		await this.transactions.cancel(objId, transactionId);
	}

	/**
	 * This method promises to return object reader with a corresponding version
	 * number.
	 * @param objId is a string object id for non-root objects, and null for
	 * root object.
	 * @param header is a boolean flag, which true value indicates that header
	 * bytes should be present.
	 * @param segsOffset is a read starting point in segments. If header is
	 * present, this offset must be zero.
	 * @param segsLimit is a maximum number of segment bytes to read. Undefined
	 * indicates that all bytes can be read.
	 */
	async getCurrentObj(
		objId: string|null, header: boolean, segsOffset: number,
		segsLimit: number|undefined
	): Promise<{ reader: ObjReader; version: number; }> {
		const status = await this.statuses.get(objId);
		const version = status.currentVersion;
		if (typeof version !== 'number') { throw SC.OBJ_UNKNOWN; }
		const reader = await this.makeObjReader(
			objId, version, header, segsOffset, segsLimit);
		return { reader, version };
	}

	/**
	 * This method promises to return object reader.
	 * @param objId is a string object id for non-root objects, and null for
	 * root object.
	 * @param version is object's archived version number
	 * @param header is a boolean flag, which true value indicates that header
	 * bytes should be present.
	 * @param segsOffset is a read starting point in segments. If header is
	 * present, this offset must be zero.
	 * @param segsLimit is a maximum number of segment bytes to read. Undefined
	 * indicates that all bytes can be read.
	 */
	async getArchivedObjVersion(
		objId: string|null, version: number,
		header: boolean, segsOffset: number, segsLimit: number|undefined
	): Promise<ObjReader> {
		const status = await this.statuses.get(objId);
		if (!status.archivedVersions) { throw SC.OBJ_UNKNOWN; }
		if (status.archivedVersions.indexOf(version) < 0) {
			throw SC.OBJ_UNKNOWN; }
		const reader = await this.makeObjReader(
			objId, version, header, segsOffset, segsLimit);
		return reader;
	}

	private async makeObjReader(
		objId: string|null, version: number,
		header: boolean, segsOfs: number, segsLimit: number|undefined
	): Promise<ObjReader> {
		const file = await this.getObjFile(objId, version);

		// find total segments length
		const segsLen = file.getTotalSegsLen();

		// contain boundary parameters offsetIntoSegs and len for segment bytes
		if (segsLen < segsOfs) {
			segsOfs = segsLen;
		}
		let segBytesToRead: number;
		if (segsLimit === undefined) {
			segBytesToRead = segsLen - segsOfs;
		} else if ((segsOfs+segsLimit) >= segsLen) {
			segBytesToRead = segsLen - segsOfs;
		} else {
			segBytesToRead = segsLimit;
		}

		// construct reader
		let reader: ObjReader;
		if (header) {
			const headerLen = file.getHeaderLen()!;
			reader = {
				len: (segBytesToRead + headerLen),
				segsLen,
				headerLen,
				pipe: makeObjPipe(
					file, true, segsOfs, segBytesToRead, objId, this.getObjFile)
			};
		} else {
			reader = {
				len: segBytesToRead,
				segsLen,
				pipe: makeObjPipe(
					file, false, segsOfs, segBytesToRead, objId, this.getObjFile)
			};
		}
		Object.freeze(reader);
		
		return reader;
	}

	private getObjFile: GetObjFile = async (
		objId: string|null, version: number
	): Promise<ObjVersionFile> => {
		const filePath = this.statuses.objFileReadingPath(objId, version);
		return await this.objVerFiles.forExistingFile(
			objId, version, filePath).catch((exc: fs.FileException) => {
				if (exc.notFound) { throw SC.OBJ_UNKNOWN; }
				throw exc;
			});
	};

	/**
	 * @param objId is a string object id for non-root objects, and null for
	 * root object.
	 * @param archVersion is an optional parameter, identifying archived version
	 * to delete. Default null value indicates that an object should be removed.
	 * If an object has any archived versions (even if current), these will not
	 * be removed, and such object state will be labeled as archived.
	 */
	async deleteObj(
		objId: string, archVersion: number|null = null
	): Promise<void> {
		const status = await this.statuses.get(objId);
		const arch = status.archivedVersions;
		// XXX need to put removal transaction, closing it in a finally clause

		if (archVersion === null) {
			if (objId === null) { throw new Error(
				'Root object is not removable.'); }
			if (status.state !== 'current') { throw SC.OBJ_UNKNOWN; }
			if (!Array.isArray(arch) || (arch.length === 0)) {
				await this.statuses.deleteWithObj(objId);
			} else {
				const currVer = status.currentVersion;
				delete status.currentVersion;
				status.state = 'archived';
				await this.statuses.set(objId, status);
				if (typeof currVer !== 'number') { throw new Error(`Illegal state of object status file for ${objId}: state is current, while current version is missing.`); }
				if (arch.indexOf(currVer) < 0) {
					await this.rmObjFiles(objId, currVer);
				}
			}
		} else {
			if (!Array.isArray(arch)) { throw SC.OBJ_UNKNOWN; }
			const indInArch = arch.indexOf(archVersion);
			if (indInArch < 0) { throw SC.OBJ_UNKNOWN; }
			arch.splice(indInArch, 1);
			if (arch.length === 0) {
				delete status.archivedVersions;
			}
			await this.statuses.set(objId, status);
			if (status.currentVersion !== archVersion) {
				await this.rmObjFiles(objId, archVersion);
			}
		}
		this.storageEventsSink(this.userId, objRemoved.EVENT_NAME, {
			objId,
		});
	}

	/**
	 * @param objId is a string object id for non-root objects, and null for
	 * root object.
	 * @param version identifies exact version of files for removal.
	 * @return a promise, resolvable when version files are removed.
	 */
	private async rmObjFiles(objId: string, version: number): Promise<void> {
		const objFolder = this.statuses.objFolder(objId);
		let objFiles = await fs.readdir(objFolder)
		.catch((exc: fs.FileException) => {
			if (exc.notFound) { throw SC.OBJ_UNKNOWN; }
			else { throw exc; }
		});
		const verPart = toFName(version);
		objFiles = objFiles.filter(fName => fName.startsWith(verPart));
		if (objFiles.length === 0) { throw SC.OBJ_UNKNOWN; }
		for (const fName of objFiles) {
			await fs.unlink(join(objFolder, fName)).catch(() => {});
		}
	}

	// XXX need both, archiving and removal transactions for atomic locking
	//		should these be like empty lock files instead of saving folders,
	//		with code distiguishing between the two, while concurrent transaction
	//		only need fs.stat for a given name, or a fail of creating lock
	//		file/folder.

	async archiveCurrentObjVersion(
		objId: string, version: number
	): Promise<void> {
		// XXX need to put archiving transaction, closing it in a finally clause

		const status = await this.statuses.get(objId);
		if (status.state !== 'current') { throw SC.OBJ_UNKNOWN; }
		if (typeof status.currentVersion !== 'number') { throw new Error(`Illegal state of object status file for ${objId}: state is current, while current version is missing.`); }
		const arch = status.archivedVersions;
		if (Array.isArray(arch)) {
			arch.push(status.currentVersion);
		} else {
			status.archivedVersions = [ status.currentVersion ];
		}
		await this.statuses.set(objId, status);
	}

	async listObjArchive(objId: string): Promise<number[]> {
		const status = await this.statuses.get(objId);
		const arch = status.archivedVersions;
		return (Array.isArray(arch) ? arch : []);
	}
	
	static getSpaceQuota(store: Store): Promise<number> {
		return store.getSpaceQuota();
	}
	
	static getKeyDerivParams(store: Store): Promise<any> {
		return store.getParam<any>('key-deriv');
	}
	static async setKeyDerivParams(
		store: Store, params: any, setDefault: boolean
	): Promise<boolean> {
		if (setDefault) {
			params = {};
		} else if ((typeof params !== 'object') || Array.isArray(params)) {
			return false;
		}
		await store.setParam('key-deriv', params);
		return true;
	}
	getKeyDerivParams(): Promise<any> {
		return this.getParam<any>('key-deriv');
	}
		
}
Object.freeze(Store.prototype);
Object.freeze(Store);

class ObjVerFiles {

	private cache: TimeWindowCache<string, ObjVersionFile>;

	constructor(cachePeriodMillis: number) {
		this.cache = new TimeWindowCache(cachePeriodMillis);
		Object.freeze(this);
	}

	async forNewFile(
		objId: string|null, version: number, path: string
	): Promise<ObjVersionFile> {
		const cacheId = this.cacheIdFor(objId, version);
		const objFile = await ObjVersionFile.createNew(path)
		.catch((exc: fs.FileException) => {
			if (exc.alreadyExists) { throw  SC.OBJ_VER_EXIST; }
			throw exc;
		});
		this.cache.set(cacheId, objFile);
		return objFile;
	}

	async forExistingFile(
		objId: string|null, version: number, path?: string
	): Promise<ObjVersionFile> {
		const cacheId = this.cacheIdFor(objId, version);
		let objFile = this.cache.get(cacheId);
		if (!objFile) {
			if (!path) { throw new Error(
				`Path to file is not given, while instance of obj version file is not found in cache.`); }
			objFile = await ObjVersionFile.forExisting(path)
			.catch((exc: fs.FileException) => {
				if (exc.notFound) { throw SC.OBJ_VER_UNKNOWN; }
				throw exc;
			});
			this.cache.set(cacheId, objFile);
		}
		return objFile;
	}

	private cacheIdFor(objId: string|null, version: number): string {
		return `${objId}:${version}`;
	}

	uncache = (objId: string|null, version: number): void => {
		this.cache.delete(this.cacheIdFor(objId, version));
	};

}
Object.freeze(ObjVerFiles.prototype);
Object.freeze(ObjVerFiles);

class ObjStatuses {

	private cache: TimeWindowCache<string|null, ObjStatusInfo>;
	private saveProcs = new NamedProcs();

	constructor(
		cachePeriodMillis: number,
		public path: string
	) {
		this.cache = new TimeWindowCache(cachePeriodMillis);
		Object.freeze(this);
	}
	
	objFolder(objId: string|null): string {
		return (objId ?
			join(this.path, 'objects', objId) :
			join(this.path, 'root'));
	}

	async get(objId: string|null): Promise<ObjStatusInfo> {
		let status = this.cache.get(objId);
		if (!status) {
			status = await this.fromFile(objId);
			this.cache.set(objId, status);
		}
		return status;
	}

	private async fromFile(objId: string|null): Promise<ObjStatusInfo> {
		const filePath = join(this.objFolder(objId), STATUS_FILE);
		const str = await fs.readFile(filePath, { encoding: 'utf8', flag: 'r' }).catch((exc: fs.FileException) => {
			if (exc.notFound) { throw SC.OBJ_UNKNOWN; }
			throw exc;
		});
		try {
			return JSON.parse(str) as ObjStatusInfo;
		} catch (err) {
			throw errWithCause(err, `Can't parse content of obj status file`);
		}
	}

	async set(objId: string|null, status: ObjStatusInfo): Promise<void> {
		this.cache.set(objId, status);
		await this.saveToFile(objId, status)
	}

	private async saveToFile(
		objId: string|null, status: ObjStatusInfo
	): Promise<void> {
		const filePath = join(this.objFolder(objId), STATUS_FILE);
		const str = JSON.stringify(status);
		const procId = (objId ? objId : 'null');
		await this.saveProcs.startOrChain(procId, () => fs.writeFile(
			filePath, str, { encoding: 'utf8', flag: 'w' }));
	}

	async deleteWithObj(objId: string|null): Promise<void> {
		this.cache.delete(objId);
		if (objId === null) {
			await fs.unlink(join(this.objFolder(null), STATUS_FILE))
			.catch(() => {});
		} else {
			const objFolder = this.objFolder(objId);
			await fs.rmDirWithContent(objFolder).catch(() => {});
		}
	}

	async makeNewObj(objId: string|null): Promise<void> {
		if (objId === null) {
			await this.get(objId).then(
				() => { throw SC.OBJ_EXIST; },
				(err) => { if (err !== SC.OBJ_UNKNOWN) { throw err; } });
		} else {
			// creation of folder ensures that id is unique
			const objFolder = this.objFolder(objId);
			await fs.mkdir(objFolder).catch((err: fs.FileException) => {
				if (err.alreadyExists) { throw SC.OBJ_EXIST; }
				else { throw err; }
			});
		}
		await this.set(objId, {
			state: 'new'
		});
	}

	objFileReadingPath(objId: string|null, version: number): string {
		return join(this.objFolder(objId), toFName(version));
	}

}
Object.freeze(ObjStatuses.prototype);
Object.freeze(ObjStatuses);

class ObjTransactions {

	private cache: TimeWindowCache<string|null, TransactionInfo>;
	private saveProcs = new NamedProcs();

	constructor(
		cachePeriodMillis: number,
		private statuses: ObjStatuses,
		private path: string,
		private uncacheFile: ObjVerFiles['uncache']
	) {
		this.cache = new TimeWindowCache(cachePeriodMillis);
		Object.freeze(this);
	}

	private transactionFolder(objId: string|null): string {
		return (objId ?
			join(this.path, 'transactions', objId) :
			join(this.path, 'root', 'transaction'));
	}

	async get(
		objId: string|null, transactionId?: string
	): Promise<TransactionInfo> {
		let isInCache = true;
		let trans = this.cache.get(objId);
		if (!trans) {
			isInCache = false;
			trans = await this.fromFile(objId);
		}
		if (transactionId && (trans.transactionId !== transactionId)) {
			throw SC.TRANSACTION_UNKNOWN;
		}
		if (isInCache) {
			this.cache.set(objId, trans);
		}
		return trans;
	}

	private transactionFilePath(objId: string|null): string {
		return join(this.transactionFolder(objId), 'transaction');
	}

	private async fromFile(objId: string|null): Promise<TransactionInfo> {
		const filePath = this.transactionFilePath(objId);
		const str = await fs.readFile(filePath, { encoding: 'utf8', flag: 'r' })
		.catch(async (exc: fs.FileException) => {
			if (exc.notFound) {
				// it may be due to obj missing, in which case the following
				// throws respective error
				await this.statuses.get(objId);
				// or just missing transaction file
				throw SC.TRANSACTION_UNKNOWN;
			}
			throw exc;
		});
		try {
			return JSON.parse(str) as TransactionInfo;
		} catch (err) {
			throw errWithCause(err, `Can't parse content of obj transaction file`);
		}
	}

	async set(objId: string|null, status: TransactionInfo): Promise<void> {
		this.cache.set(objId, status);
		await this.saveToFile(objId, status)
	}

	private async saveToFile(
		objId: string|null, transaction: TransactionInfo
	): Promise<void> {
		const filePath = this.transactionFilePath(objId);
		const str = JSON.stringify(transaction);
		const procId = (objId ? objId : 'null');
		await this.saveProcs.startOrChain(procId, () => fs.writeFile(
			filePath, str, { encoding: 'utf8', flag: 'w' }));
	}

	objFileWritingPath(objId: string|null): string {
		return join(this.transactionFolder(objId), 'new');
	}

	async startNew(
		objId: string|null, reqTrans: TransactionParams
	): Promise<TransactionInfo> {
		const trans = reqTrans as TransactionInfo;
		trans.transactionId = await stringOfB64UrlSafeChars(10);
		trans.transactionType = 'write';
		await this.makeTransactionFolder(objId);
		await this.set(objId, trans);
		try {
			
			// check object status
			if (trans.isNewObj) {
				await this.statuses.makeNewObj(objId);
			} else {
				// get current version, and check new one against it
				const status = await this.statuses.get(objId);
				if (status.state !== 'current') {
					throw SC.OBJ_UNKNOWN;
				} else if (trans.version <= status.currentVersion!) {
					throw makeMismatchedObjVerException(status.currentVersion!);
				}
			}

		} catch (err) {
			await this.cancel(objId, trans.transactionId).catch(() => {});
			throw err;
		}
		return trans;
	}
	
	private async makeTransactionFolder(objId: string|null): Promise<void> {
		try {
			await fs.mkdir(this.transactionFolder(objId));
		} catch (err) {
			if ((<fs.FileException> err).alreadyExists) {
				throw SC.CONCURRENT_TRANSACTION;
			}
			throw err;
		}
	}

	async cancel(objId: string|null, transactionId?: string): Promise<void> {
		
		// XXX implement assurance that canceling without transaction id
		//		happens only after a certain timeout, i.e. as a method to
		//		remove deadlock, when time determines that there is a deadlock

		const trans = await this.get(objId).catch(
			async (exc: string) => {
				if (exc === SC.TRANSACTION_UNKNOWN) { return null; }
				else { throw exc; }
			});
		if (trans && trans.isNewObj) {
			this.statuses.deleteWithObj(objId);
		}
		this.cache.delete(objId);
		const transFolder = this.transactionFolder(objId);
		await fs.rmDirWithContent(transFolder).catch(() => {});
	}

	async complete(
		objId: string|null, trans: TransactionInfo, newVerFile: ObjVersionFile
	): Promise<void> {
		this.cache.delete(objId);
		// move new file from transaction folder to obj's one
		const newVerPath = this.statuses.objFileReadingPath(objId, trans.version);
		await newVerFile.moveFile(newVerPath);
		// update object status
		const status = await this.statuses.get(objId);
		if (status.state === 'current') {
			// if needed, remove previous version, right after exposing a new one
			const verToDel = (status.archivedVersions &&
				(status.archivedVersions.indexOf(
					status.currentVersion as number) >= 0)) ?
				undefined : status.currentVersion;
			status.currentVersion = trans.version;
			await this.statuses.set(objId, status);
			if ((verToDel !== undefined) && (trans.baseVersion !== verToDel)) {
				this.uncacheFile(objId, verToDel);
				const rmPath = this.statuses.objFileReadingPath(objId, verToDel);
				await fs.unlink(rmPath);
			}
		} else if (status.state === 'new') {
			status.state = 'current';
			status.currentVersion = trans.version;
			await this.statuses.set(objId, status);
		} else {
			throw new Error(`Object ${objId} has unexpected for transaction completion state: ${status.state}`);
		}
		await fs.rmDirWithContent(this.transactionFolder(objId)).catch(() => {});
	}

}
Object.freeze(ObjStatuses.prototype);
Object.freeze(ObjStatuses);

function toFName(version: number): string {
	return `${version}.`;
}

function noop () {}


Object.freeze(exports);