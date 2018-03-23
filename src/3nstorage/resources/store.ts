/*
 Copyright (C) 2015 - 2017 3NSoft Inc.
 
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

// XXX change from transaction folder to a pair of transaction info and new
//		version files, and remove dot after version, as there is no need in it.

import * as fs from '../../lib-common/async-fs-node';
import { Readable as ReadableStream } from 'stream';
import { createReadStream, ReadStream } from 'fs'
import { PutObjFirstQueryOpts, PutObjSecondQueryOpts }
	from '../../lib-common/service-api/3nstorage/owner';
import { stringOfB64UrlSafeChars } from '../../lib-common/random-node';
import { UserFiles, SC as ufSC, addressToFName, ObjPipe, ObjReader, pipeBytes }
	from '../../lib-server/resources/user-files';
import { utf8 } from '../../lib-common/buffer-utils';
import { DiffInfo, objChanged, objRemoved }
	from '../../lib-common/service-api/3nstorage/owner';
import { parseObjFile, createObjFile } from '../../lib-common/obj-file';

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
	WRITE_OVERFLOW: ufSC.WRITE_OVERFLOW,
	CONCURRENT_TRANSACTION: "concurrent-transactions",
	TRANSACTION_UNKNOWN: "transactions-unknown",
	INCOMPATIBLE_TRANSACTION: "incompatible-transaction",
	NOT_ENOUGH_SPACE: "not-enough-space"
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
	sizes: {
		header: number;
		segments: number;
	};
	diff?: DiffInfo;
}

export interface TransactionInfo extends TransactionParams {
	transactionType: 'write' | 'remove' | 'archive';
	transactionId: string;
	headerOffset: number;
	segsOffset: number;
}

interface SpaceInfo {
	free: number;
	used: number;
}

// XXX this is what space-tracker in lib-server should do
//		we may reuse UserFiles to contain worker-side space tracking functionality
// This is a memoizer for space usage with a little extra.
class SpaceTracker {
	
	private space: {
		[userId: string]: SpaceInfo;
	} = {};
	
	constructor() {
		Object.freeze(this);
	}

	private async diskUsed(path: string, runNum = 0): Promise<number> {
		
		// XXX use du, while on windows du might be in linux console!

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
			throw SC.NOT_ENOUGH_SPACE; }
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

const SINGLE_BYTE_BUF = new Buffer(1);
SINGLE_BYTE_BUF[0] = 0;

function getFstAndLastSections(sections: number[][], offset: number,
		len: number): { fstInd: number; fstSec: number[];
			lastInd: number; lastSec: number[]; } {
	let fstInd: number = (undefined as any);
	const fstSec = new Array(3);
	let sectionEnd = 0;
	for (let i=0; i<sections.length; i+=1) {
		const s = sections[i];
		sectionEnd += s[2];
		if (offset < sectionEnd) {
			fstInd = i;
			fstSec[0] = s[0];
			const secLen = sectionEnd - offset;
			const secPos = s[1] + (s[2] - secLen);
			fstSec[1] = secPos;
			fstSec[2] = secLen;
			break;
		}
	}
	if (typeof fstInd !== 'number') { return ({} as any); }
	if (fstSec[2] >= len) {
		fstSec[2] = len;
		return { fstSec, fstInd, lastSec: fstSec, lastInd: fstInd };
	}
	if ((fstInd + 1) === sections.length) {
		return { fstSec, fstInd, lastSec: fstSec, lastInd: fstInd };
	}
	let lastInd: number = (undefined as any);
	let lastSec = new Array<number>(3);
	for (let i=fstInd+1; i<sections.length; i+=1) {
		const s = sections[i];
		sectionEnd += s[2];
		if (len <= (sectionEnd - offset)) {
			lastInd = i;
			lastSec[0] = s[0];
			lastSec[1] = s[1];
			lastSec[2] = s[2] - ((sectionEnd - offset) - len);
			break;
		}
	}
	if (typeof lastInd !== 'number') {
		lastInd = sections.length - 1;
		lastSec = sections[lastInd];
	}
	return { fstInd, fstSec, lastInd, lastSec }; 
}

export class Store extends UserFiles {

	private storageEventsSink: StorageEventsSink;
	
	constructor(userId: string, path: string,
			storageEventsSink: StorageEventsSink,
			writeBufferSize?: string|number, readBufferSize?: string|number) {
		super(userId, path, writeBufferSize, readBufferSize);
		this.storageEventsSink = storageEventsSink;
		Object.freeze(this);
	}
	
	static async make(rootFolder: string, userId: string,
			storageEventsSink: StorageEventsSink,
			writeBufferSize?: string|number, readBufferSize?: string|number):
			Promise<Store> {
		const path = rootFolder+'/'+addressToFName(userId)+'/store';
		const store = new Store(userId, path, storageEventsSink,
			writeBufferSize, readBufferSize);
		await store.ensureUserExistsOnDisk();
		return store;
	}
	
	private objFolder(objId: string|null): string {
		return (objId ? this.path+'/objects/'+objId : this.path+'/root');
	}
	
	private listAllObjs(): Promise<string[]> {
		return fs.readdir(this.path+'/objects/');
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
	async startSavingObjNewVersion(objId: string|null, diff: DiffInfo|undefined,
			bytes: ReadableStream, byteLen: number, opts: PutObjFirstQueryOpts):
			Promise<string|undefined> {

		const trans = await this.startTransaction(objId, {
			isNewObj: (opts.ver === 1),
			version: opts.ver,
			diff,
			sizes: {
				header: opts.header,
				segments: ((typeof opts.segs === 'number') ? opts.segs : -1)
			}
		});

		const file = `${this.transactionFolder(objId)}/new`;
		await fs.streamToExistingFile(file, trans.headerOffset,
				byteLen, bytes, this.fileWritingBufferSize);
		
		if (opts.append || (byteLen < (opts.header + opts.segs!))) {
			return trans.transactionId;
		} else {
			await this.completeTransaction(objId, trans.transactionId);
			this.storageEventsSink(this.userId, objChanged.EVENT_NAME, {
				objId,
				newVer: opts.ver
			});
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
	async continueSavingObjNewVersion(objId: string|null, bytes: ReadableStream,
			byteLen: number, opts: PutObjSecondQueryOpts):
			Promise<string|undefined> {
		const trans = await this.getTransactionParams(objId, opts.trans);
		const file = `${this.transactionFolder(objId)}/new`;

		if (opts.append) {
			if (trans.sizes.segments >= 0) { throw SC.INCOMPATIBLE_TRANSACTION; }

			if (byteLen > 0) {
				const offset = await fs.getFileSize(file);
				await spaceTracker.change(this, byteLen);
				await fs.streamToExistingFile(
					file, offset, byteLen, bytes, this.fileWritingBufferSize)
				.catch(async (err) => {
					await fs.truncate(file, offset).catch(() => {});
					throw err;
				});
			}
		} else {
			if ((trans.sizes.segments < 0) && !opts.append) {
				throw SC.INCOMPATIBLE_TRANSACTION;
			} else if ((opts.ofs! + byteLen) > trans.sizes.segments) {
				throw SC.WRITE_OVERFLOW;
			}
			
			const offset = trans.segsOffset + opts.ofs!;
			if (byteLen > 0) {
				await fs.streamToExistingFile(file, offset, byteLen, bytes,
					this.fileWritingBufferSize);
			}
		}
		
		if (!opts.last) { return opts.trans; }

		await this.completeTransaction(objId, opts.trans);
		this.storageEventsSink(this.userId, objChanged.EVENT_NAME, {
			objId,
			newVer: trans.version
		});
	}

	/**
	 * @param objId
	 * @return a promise, resolvable to object's status info.
	 */
	private async getObjStatus(objId: string|null): Promise<ObjStatusInfo> {
		const filePath = `${this.objFolder(objId)}/${STATUS_FILE}`;
		try {
			const str = await fs.readFile(filePath, { encoding: 'utf8', flag: 'r' });
			const status: ObjStatusInfo = JSON.parse(str);
			return status;
		} catch (err) {
			if ((<fs.FileException> err).notFound) {
				throw SC.OBJ_UNKNOWN;
			}
			throw err;
		}
	}

	/**
	 * @param objId
	 * @param status is object's status info.
	 * @return a promise, resolvable when a new version is set.
	 */
	private setObjStatus(objId: string|null, status: ObjStatusInfo): Promise<void> {
		const filePath = `${this.objFolder(objId)}/${STATUS_FILE}`;
		return fs.writeFile(filePath, JSON.stringify(status),
			{ encoding: 'utf8', flag: 'w' });
	}
	
	private async makeNewObj(objId: string|null): Promise<void> {
		if (objId === null) {
			await this.getObjStatus(objId).then(
				() => { throw SC.OBJ_EXIST; },
				(err) => { if (err !== SC.OBJ_UNKNOWN) { throw err; } });
		} else {
			// creation of folder ensures that id is unique
			const objFolder = this.objFolder(objId);
			await fs.mkdir(objFolder).catch((err: fs.FileException) => {
				if (err.alreadyExists) { throw SC.OBJ_EXIST; }
				else { throw err; }
			});
			// check that no id exists, that is equal up to letter case 
			const allObjIds = await this.listAllObjs();
			const lowerCaseObjId = objId.toLowerCase();
			for (const id of allObjIds) {
				if ((id.toLowerCase() === lowerCaseObjId) && (id !== objId)) {
					fs.rmdir(objFolder);
					throw SC.OBJ_EXIST;
				}
			}
		}
		await this.setObjStatus(objId, {
			state: 'new'
		});
	}
	
	private transactionFolder(objId: string|null): string {
		return (objId ?
			`${this.path}/transactions/${objId}` :
			`${this.path}/root/transaction`);
	}
	
	private saveTransactionParams(objId: string|null,
			transaction: TransactionInfo): Promise<void> {
		return fs.writeFile(`${this.transactionFolder(objId)}/transaction`,
			JSON.stringify(transaction), { encoding: 'utf8', flag: 'w' });
	}
	
	/**
	 * @param objId
	 * @param transactionId is an optional parameter, that ensures that
	 * object transaction has given id.
	 * @return A promise, resolvable to transaction info object.
	 */
	private async getTransactionParams(objId: string|null, transactionId?: string):
			Promise<TransactionInfo> {
		try {
			const buf = await fs.readFile(
				`${this.transactionFolder(objId)}/transaction`);
			const trans = <TransactionInfo> JSON.parse(buf.toString('utf8'));
			if (transactionId && (trans.transactionId !== transactionId)) {
				throw SC.TRANSACTION_UNKNOWN;
			}
			return trans;
		} catch (err) {
			if ((<fs.FileException> err).notFound) {
				await fs.stat(this.objFolder(objId))
				.catch((exc: fs.FileException) => {
					if (exc.notFound) { throw SC.OBJ_UNKNOWN; }
					else { throw exc; }
				})
				throw SC.TRANSACTION_UNKNOWN;
			}
			throw err;
		}
	}
	
	/**
	 * @param objId
	 * @return a promise, resolvable, when transaction folder is created,
	 * or rejectable, when transaction folder already exists.
	 */
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
	
	private async startTransaction(objId: string|null,
			reqTrans: TransactionParams): Promise<TransactionInfo> {
		const trans = <TransactionInfo> reqTrans;
		trans.transactionId = stringOfB64UrlSafeChars(10);
		trans.transactionType = 'write';
		await this.makeTransactionFolder(objId);
		try {
			
			// check object status
			if (trans.isNewObj) {
				await this.makeNewObj(objId);
			} else {
				// get current version, and check new one against it
				const status = await this.getObjStatus(objId);
				if (status.state !== 'current') {
					throw SC.OBJ_UNKNOWN;
				} else if (trans.version <= status.currentVersion!) {
					throw makeMismatchedObjVerException(status.currentVersion!);
				}
			}

			// check if given size is allowed, and create object file
			const diffBytes = (trans.diff ?
				utf8.pack(JSON.stringify(trans.diff)) : undefined);
			const fileSize = (diffBytes ? 13 + diffBytes.length : 8) +
				trans.sizes.header + Math.max(trans.sizes.segments, 0);
			await spaceTracker.change(this, fileSize);
			const filePath = `${this.transactionFolder(objId)}/new`;
			const { headerOffset, segsOffset } = await createObjFile(
				filePath, trans.sizes.header, trans.sizes.segments, diffBytes);
			
			// set and save transaction parameters
			trans.headerOffset = headerOffset;
			trans.segsOffset = segsOffset;
			await this.saveTransactionParams(objId, trans);
		} catch (err) {
			await this.cancelTransaction(objId, trans.transactionId).catch(() => {});
			throw err;
		}
		return trans;
	}
	
	private async applyTransactionFiles(transFolder: string,
			objFolder: string, trans: TransactionInfo, objId: string|null):
			Promise<void> {
		// move new file from transaction folder to obj's one
		fs.rename(`${transFolder}/new`, `${objFolder}/${trans.version}.`);
		// update object status
		const status = await this.getObjStatus(objId);
		if (status.state === 'current') {
			// if needed, remove previous version, right after exposing a new one
			const verToDel = (status.archivedVersions &&
				(status.archivedVersions.indexOf(
					status.currentVersion as number) >= 0)) ?
				null : status.currentVersion;
			status.currentVersion = trans.version;
			await this.setObjStatus(objId, status);
			if (verToDel !== null) {
				if (!trans.diff || (trans.diff.baseVersion !== verToDel))
				await fs.unlink(`${objFolder}/${verToDel}.`);
			}
		} else if (status.state === 'new') {
			status.state = 'current';
			status.currentVersion = trans.version;
			await this.setObjStatus(objId, status);
		} else {
			throw new Error(`Object ${objId} has unexpected for transaction completion state: ${status.state}`);
		}
	}
	
	async cancelTransaction(objId: string|null,
			transactionId: string|undefined): Promise<void> {
		
		// XXX implement assurance that canceling without transaction id
		//		happens only after a certain timeout, i.e. as a method to
		//		remove deadlock, when time determines that there is a deadlock

		const trans = await this.getTransactionParams(objId).catch(
			async (exc: string) => {
				if (exc === SC.TRANSACTION_UNKNOWN) { return null; }
				else { throw exc; }
			});
		if (trans && trans.isNewObj) {
			if (objId === null) {
				await fs.unlink(`${this.objFolder(null)}/${STATUS_FILE}`)
				.catch(() => {});
			} else {
				const objFolder = this.objFolder(objId);
				await fs.rmDirWithContent(objFolder).catch(() => {});
			}
		}
		const transFolder = this.transactionFolder(objId);
		await fs.rmDirWithContent(transFolder).catch(() => {});
	}
	
	private async completeTransaction(objId: string|null, transactionId: string):
			Promise<void> {
		const trans = await this.getTransactionParams(objId, transactionId);
		const transFolder = this.transactionFolder(objId);
		const objFolder = this.objFolder(objId);
		await this.applyTransactionFiles(transFolder, objFolder, trans, objId);
		await fs.rmDirWithContent(transFolder).catch(() => {});
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
	async getCurrentObj(objId: string|null,
			header: boolean, segsOffset: number, segsLimit: number|undefined):
			Promise<{ reader: ObjReader; version: number; }> {
		const status = await this.getObjStatus(objId);
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
	async getArchivedObjVersion(objId: string|null, version: number,
			header: boolean, segsOffset: number, segsLimit: number|undefined):
			Promise<ObjReader> {
		const status = await this.getObjStatus(objId);
		if (!status.archivedVersions) { throw SC.OBJ_UNKNOWN; }
		if (status.archivedVersions.indexOf(version) < 0) {
			throw SC.OBJ_UNKNOWN; }
		const reader = await this.makeObjReader(
			objId, version, header, segsOffset, segsLimit);
		return reader;
	}

	private async makeObjReader(objId: string|null, version: number,
			header: boolean, offsetIntoSegs: number, segsLimit: number|undefined):
			Promise<ObjReader> {
		const objFolder = this.objFolder(objId);
		const objFile = `${objFolder}/${version}.`;

		// parse first part of an object file
		const { headerOffset, segsOffset, diff, fileSize } =
			await parseObjFile(objFile).catch((exc: fs.FileException) => {
				if (exc.notFound) { throw SC.OBJ_UNKNOWN; }
				throw exc;
			});
		
		// find total segments length
		const segsLen = (diff ? diff.segsSize : (fileSize - segsOffset));

		// contain boundary parameters offsetIntoSegs and len for segment bytes
		if (segsLen < offsetIntoSegs) {
			offsetIntoSegs = segsLen;
		}
		let segBytesToRead: number;
		if (segsLimit === undefined) {
			segBytesToRead = segsLen - offsetIntoSegs;
		} else if ((offsetIntoSegs+segsLimit) >= segsLen) {
			segBytesToRead = segsLen - offsetIntoSegs;
		} else {
			segBytesToRead = segsLimit;
		}

		// construct reader
		let reader: ObjReader;
		if (header) {
			const headerLen = segsOffset - headerOffset;
			reader = {
				len: (segBytesToRead + headerLen),
				segsLen,
				headerLen,
				pipe: this.makeObjPipe(objId, objFile, offsetIntoSegs,
					segBytesToRead, diff, headerOffset, segsOffset)
			};
		} else {
			reader = {
				len: segBytesToRead,
				segsLen,
				pipe: this.makeObjPipe(objId, objFile, offsetIntoSegs,
					segBytesToRead, diff, undefined, segsOffset)
			};
		}
		Object.freeze(reader);
		
		return reader;
	}
	
	private makeObjPipe(objId: string|null, file: string, offset: number,
			segBytesToRead: number, diff: DiffInfo|undefined,
			headerOffset: number|undefined, segsOffset: number):
			ObjPipe|undefined {
		if ((typeof headerOffset === 'number') && (offset > 0)) { throw new Error(
			`Offset into segments is ${offset} instead of being zero when header is requested.`); }
		
		// function to pipe directly from non-diff-ed version
		if (!diff) {
			if (typeof headerOffset === 'number') {
				return (outStream: NodeJS.WritableStream) => pipeBytes(
					createReadStream(file, {
						flags: 'r',
						start: headerOffset,
						end: segsOffset+segBytesToRead-1
					}),
					outStream);
			} else {
				if (segBytesToRead < 1) { return; }
				return (outStream: NodeJS.WritableStream) => pipeBytes(
					createReadStream(file, {
						flags: 'r',
						start: offset+segsOffset,
						end: offset+segsOffset+segBytesToRead-1
					}),
					outStream);
			}
		}

		// find which diff's sections should be read
		const { fstInd, fstSec, lastInd, lastSec } =
			getFstAndLastSections(diff.sections, offset, segBytesToRead);
		if (!fstSec) { return; }

		// function to pipe from diff sections
		return async (outStream: NodeJS.WritableStream): Promise<void> => {
			if (typeof headerOffset === 'number') {
				await pipeBytes(
					createReadStream(file, {
						flags: 'r',
						start: headerOffset,
						end: segsOffset-1
					}),
					outStream);
			}
			const pipeSection = async (secInd: number): Promise<void> => {
				const s = ((secInd === fstInd) ? fstSec :
						((secInd === lastInd) ? lastSec : diff.sections[secInd]));
				if (s[0] === 1) {
					await pipeBytes(
						createReadStream(file, {
							flags: 'r',
							start: s[1]+segsOffset,
							end: s[1]+segsOffset+s[2]-1
						}),
						outStream);
				} else {
					const base = await this.makeObjReader(
						objId, diff.baseVersion, false, s[1], s[2]);
					if (base.pipe) {
						await base.pipe(outStream);
					}
				}
				// continue recursively
				secInd += 1;
				if (secInd <= lastInd) {
					return pipeSection(secInd);
				}
			};
			return pipeSection(fstInd);
		};
	}

	/**
	 * @param objId is a string object id for non-root objects, and null for
	 * root object.
	 * @param version identifies exact version of files for removal.
	 * @return a promise, resolvable when version files are removed.
	 */
	private async rmObjFiles(objId: string, version: number): Promise<void> {
		const objFolder = this.objFolder(objId);
		let objFiles = await fs.readdir(objFolder)
		.catch((exc: fs.FileException) => {
			if (exc.notFound) { throw SC.OBJ_UNKNOWN; }
			else { throw exc; }
		});
		const verPart = `${version}.`;
		objFiles = objFiles.filter(fName => fName.startsWith(verPart));
		if (objFiles.length === 0) { throw SC.OBJ_UNKNOWN; }
		for (const fName of objFiles) {
			await fs.unlink(`${objFolder}/${fName}`).catch(() => {});
		}
	}

	/**
	 * @param objId is a string object id for non-root objects, and null for
	 * root object.
	 * @param archVersion is an optional parameter, identifying archived version
	 * to delete. Default null value indicates that an object should be removed.
	 * If an object has any archived versions (even if current), these will not
	 * be removed, and such object state will be labeled as archived.
	 */
	async deleteObj(objId: string, archVersion: number|null = null):
			Promise<void> {
		const status = await this.getObjStatus(objId);
		const arch = status.archivedVersions;
		// XXX need to put removal transaction, closing it in a finally clause

		if (archVersion === null) {
			if (objId === null) { throw new Error(
				'Root object is not removable.'); }
			if (status.state !== 'current') { throw SC.OBJ_UNKNOWN; }
			if (!Array.isArray(arch) || (arch.length === 0)) {
				await fs.rmDirWithContent(this.objFolder(objId)).catch(() => {});
			} else {
				const currVer = status.currentVersion;
				delete status.currentVersion;
				status.state = 'archived';
				await this.setObjStatus(objId, status);
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
			await this.setObjStatus(objId, status);
			if (status.currentVersion !== archVersion) {
				await this.rmObjFiles(objId, archVersion);
			}
		}
		this.storageEventsSink(this.userId, objRemoved.EVENT_NAME, {
			objId,
		});
	}

	// XXX need both, archiving and removal transactions for atomic locking
	//		should these be like empty lock files instead of saving folders,
	//		with code distiguishing between the two, while concurrent transaction
	//		only need fs.stat for a given name, or a fail of creating lock
	//		file/folder.

	async archiveCurrentObjVersion(objId: string, version: number):
			Promise<void> {
		// XXX need to put archiving transaction, closing it in a finally clause

		const status = await this.getObjStatus(objId);
		if (status.state !== 'current') { throw SC.OBJ_UNKNOWN; }
		if (typeof status.currentVersion !== 'number') { throw new Error(`Illegal state of object status file for ${objId}: state is current, while current version is missing.`); }
		const arch = status.archivedVersions;
		if (Array.isArray(arch)) {
			arch.push(status.currentVersion);
		} else {
			status.archivedVersions = [ status.currentVersion ];
		}
		await this.setObjStatus(objId, status);
	}

	async listObjArchive(objId: string): Promise<number[]> {
		const status = await this.getObjStatus(objId);
		const arch = status.archivedVersions;
		return (Array.isArray(arch) ? arch : []);
	}
	
	static getSpaceQuota(store: Store): Promise<number> {
		return store.getSpaceQuota();
	}
	
	static getKeyDerivParams(store: Store): Promise<any> {
		return store.getParam<any>('key-deriv');
	}
	static async setKeyDerivParams(store: Store, params: any,
			setDefault: boolean): Promise<boolean> {
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

Object.freeze(exports);