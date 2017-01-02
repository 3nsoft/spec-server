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
 * (d.2) N.hsxp - is a file with an N'th version object's header;
 * (d.3) N.sxsp - is a file with an N'th version object's segments;
 *                this file is present only if this N'th version is not
 *                expressed with a diff, relative to another version;
 * (d.4) N.diff - is a json file that describes diff, which will recreate N'th
 *                version;
 *                this file is present only when N'th version is expressed with
 *                a diff, relative to some other version;
 * (e) transactions folder (for root and non-root) contains:
 * (e.1) transaction - is a json file with current transaction's info;
 *                     this file is present only for duration of a transaction,
 *                     and also acts as a transaction lock;
 * (e.2) new.hxsp - is a transaction file for new header;
 * (e.3) new.sxsp - is a transaction file for new segments, when a new version
 *                  is sent as is, and not as a diff, relative to some other
 *                  version;
 * (e.4) new.diff - is a transaction json file with diff, that represents a new
 *                  version, relative to some other version;
 */

import * as fs from '../../lib-common/async-fs-node';
import { Readable as ReadableStream } from 'stream';
import { createReadStream } from 'fs'
import { TransactionParams }
	from '../../lib-common/service-api/3nstorage/owner';
import { stringOfB64UrlSafeChars } from '../../lib-common/random-node';
import { UserFiles, SC as ufSC, addressToFName }
	from '../../lib-server/resources/user-files';
import { toBuffer } from '../../lib-common/buffer-utils';
import { DiffInfo } from '../../lib-common/service-api/3nstorage/owner';
import { parseObjFile, structureObjFile } from './obj-file';
import { defer } from '../../lib-common/processes';

export { DiffInfo } from '../../lib-common/service-api/3nstorage/owner';

export const SC = {
	USER_UNKNOWN: ufSC.USER_UNKNOWN,
	OBJ_EXIST: 'obj-already-exist',
	OBJ_UNKNOWN: 'obj-unknown',
	WRONG_OBJ_STATE: 'wrong-obj-state',
	WRITE_OVERFLOW: ufSC.WRITE_OVERFLOW,
	CONCURRENT_TRANSACTION: "concurrent-transactions",
	TRANSACTION_UNKNOWN: "transactions-unknown",
	INCOMPATIBLE_TRANSACTION: "incompatible-transaction",
	NOT_ENOUGH_SPACE: "not-enough-space"
};
Object.freeze(SC);

export interface ObjStatusInfo {
	state: 'new' | 'current' | 'archived';
	currentVersion?: number;
	archivedVersions?: number[];
}

const STATUS_FILE = 'status';

export interface TransactionInfo extends TransactionParams {
	transactionType: 'write' | 'remove' | 'archive';
	transactionId: string;
	headerOffset: number;
	segsOffset: number;
}

export interface SegsPipe {
	(outStream: NodeJS.WritableStream): Promise<void>;
}

export interface ObjReader {
	
	/**
	 * This indicates number of bytes, expected to come out of pipe.
	 */
	len: number;
	
	/**
	 * This is a pipe function that reads bytes directly from file.
	 */
	pipe?: SegsPipe;
	
	/**
	 * This is a total segments' length of this object version.
	 */
	segsLen: number;
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
		let usedSpace = await this.diskUsed(store.path);
		let quota = await store.getSpaceQuota();
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

let spaceTracker = new SpaceTracker();

const SINGLE_BYTE_BUF = new Buffer(1);
SINGLE_BYTE_BUF[0] = 0;

function getFstAndLastSections(sections: number[][], offset: number,
		len: number): { fstInd: number; fstSec: number[];
			lastInd: number; lastSec: number[]; } {
	let fstInd: number = (undefined as any);
	let fstSec = new Array(3);
	let sectionEnd = 0;
	for (let i=0; i < sections.length; i+=1) {
		let s = sections[i];
		sectionEnd += s[2];
		if (offset < sectionEnd) {
			fstInd = i;
			fstSec[0] = s[0];
			let secLen = sectionEnd - offset;
			let secPos = s[1] + (s[2] - secLen);
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
	for (let i=fstInd+1; i < sections.length; i+=1) {
		let s = sections[i];
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

async function pipeBytes(src: NodeJS.ReadableStream,
		sink: NodeJS.WritableStream): Promise<void> {
	let deferred = defer<void>();
	src.pipe(sink, { end: false });
	src.on('error', (err) => {
		deferred.reject(err);
		src.unpipe(sink);
	});
	src.on('end', () => {
		src.unpipe(sink);
		deferred.resolve();
	});
	return deferred.promise;
}

export class Store extends UserFiles {
	
	constructor(userId: string, path: string,
			writeBufferSize?: string|number, readBufferSize?: string|number) {
		super(userId, path, writeBufferSize, readBufferSize);
		Object.freeze(this);
	}
	
	static async make(rootFolder: string, userId: string,
			writeBufferSize?: string|number, readBufferSize?: string|number):
			Promise<Store> {
		let path = rootFolder+'/'+addressToFName(userId)+'/store';
		let store = new Store(userId, path, writeBufferSize, readBufferSize);
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
	 * @param objId
	 * @return a promise, resolvable to object's status info.
	 */
	private async getObjStatus(objId: string): Promise<ObjStatusInfo> {
		let filePath = `${this.objFolder(objId)}/${STATUS_FILE}`;
		try {
			let str = await fs.readFile(filePath, { encoding: 'utf8', flag: 'r' });
			let status: ObjStatusInfo = JSON.parse(str);
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
	private setObjStatus(objId: string, status: ObjStatusInfo): Promise<void> {
		let filePath = `${this.objFolder(objId)}/${STATUS_FILE}`;
		return fs.writeFile(filePath, JSON.stringify(status),
			{ encoding: 'utf8', flag: 'w' });
	}
	
	private async makeNewObj(objId: string): Promise<void> {
		if (objId === null) {
			await this.getObjStatus(objId).then(
				() => { throw SC.OBJ_EXIST; },
				(err) => { if (err !== SC.OBJ_UNKNOWN) { throw err; } })
		} else {
			// creation of folder ensures that id is unique
			let objFolder = this.objFolder(objId);
			await fs.mkdir(objFolder).catch((err: fs.FileException) => {
				if (err.alreadyExists) { throw SC.OBJ_EXIST; }
				else { throw err; }
			});
			// check that no id exists, that is equal up to letter case 
			let allObjIds = await this.listAllObjs();
			let lowerCaseObjId = objId.toLowerCase();
			for (let id of allObjIds) {
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
	
	private transactionFolder(objId: string): string {
		return (objId ?
			`${this.path}/transactions/${objId}` :
			`${this.path}/root/transaction`);
	}
	
	private saveTransactionParams(objId: string,
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
	private async getTransactionParams(objId: string, transactionId?: string):
			Promise<TransactionInfo> {
		try {
			let buf = await fs.readFile(
				`${this.transactionFolder(objId)}/transaction`);
			let trans = <TransactionInfo> JSON.parse(buf.toString('utf8'));
			if (transactionId && (trans.transactionId !== transactionId)) {
				throw SC.TRANSACTION_UNKNOWN;
			}
			return trans;
		} catch (err) {
			if ((<fs.FileException> err).notFound) {
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
	private async makeTransactionFolder(objId: string): Promise<void> {
		try {
			await fs.mkdir(this.transactionFolder(objId));
		} catch (err) {
			if ((<fs.FileException> err).alreadyExists) {
				throw SC.CONCURRENT_TRANSACTION;
			}
			throw err;
		}
	}
	
	async startTransaction(objId: string, reqTrans: TransactionParams):
			Promise<string> {
		let trans = <TransactionInfo> reqTrans;
		trans.transactionId = stringOfB64UrlSafeChars(10);
		trans.transactionType = 'write';
		await this.makeTransactionFolder(objId);
		try {
			if (trans.isNewObj) {
				await this.makeNewObj(objId);
			} else {
				// get current version, and check new one against it
				let status = await this.getObjStatus(objId);
				if ((status.state !== 'current') ||
						(status.currentVersion >= trans.version)) {
					throw SC.WRONG_OBJ_STATE;
				}
			}
			let { fileSize, headerOffset, segsOffset, writeToDisk } =
				structureObjFile(`${this.transactionFolder(objId)}/new`,
					trans.sizes.header, trans.sizes.segments, trans.diff);
			await spaceTracker.change(this, fileSize);
			await writeToDisk();
			trans.headerOffset = headerOffset;
			trans.segsOffset = segsOffset;
			await this.saveTransactionParams(objId, trans);
		} catch (err) {
			await this.cancelTransaction(objId).catch(() => {});
			throw err;
		}
		return trans.transactionId;
	}
	
	private async applyTransactionFiles(transFolder: string,
			objFolder: string, trans: TransactionInfo, objId: string):
			Promise<void> {
		// move new file from transaction folder to obj's one
		fs.rename(`${transFolder}/new`, `${objFolder}/${trans.version}.`);
		// update object status
		let status = await this.getObjStatus(objId);
		if (status.state === 'current') {
			// if needed, remove previous version, right after exposing a new one
			let verToDel = (status.archivedVersions &&
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
	
	async cancelTransaction(objId: string): Promise<void> {
		let trans = await this.getTransactionParams(objId).catch(
			async (exc: string) => {
				if (exc === SC.TRANSACTION_UNKNOWN) { return null; }
				else { throw exc; }
			});
		if (trans && trans.isNewObj) {
			if (objId === null) {
				await fs.unlink(`${this.objFolder(null)}/${STATUS_FILE}`)
				.catch(() => {});
			} else {
				let objFolder = this.objFolder(objId);
				await fs.rmDirWithContent(objFolder).catch(() => {});
			}
		}
		let transFolder = this.transactionFolder(objId);
		await fs.rmDirWithContent(transFolder).catch(() => {});
	}
	
	async completeTransaction(objId: string, transactionId: string):
			Promise<void> {
		let trans = await this.getTransactionParams(objId, transactionId);
		let transFolder = this.transactionFolder(objId);
		let objFolder = this.objFolder(objId);
		await this.applyTransactionFiles(transFolder, objFolder, trans, objId);
		await fs.rmDirWithContent(transFolder).catch(() => {});
	}

	async getObjHeaderSizeInTransaction(objId: string, transactionId: string):
			Promise<number> {
		let trans = await this.getTransactionParams(objId, transactionId);
		return trans.sizes.header;
	}

	async saveObjHeader(objId: string, transactionId: string,
			header: Uint8Array): Promise<void> {
		let trans = await this.getTransactionParams(objId, transactionId);
		if (trans.sizes.header !== header.length) {
			throw new Error(`Given header with size ${header.length} instead of expected length ${trans.sizes.header}`);
		}
		let file = `${this.transactionFolder(objId)}/new`;
		let fd = await fs.open(file, 'r+');
		try {
			await fs.write(fd, trans.headerOffset, toBuffer(header));
		} finally {
			await fs.close(fd);
		}
	}

	/**
	 * @param objId
	 * @param version is a parameter that either specifies version, or, with
	 * null value, asks for current object version
	 * @return a promise, resolvable to an object with following fields:
	 * (1) header, with object's header bytes, (2) segsLen, with segments length,
	 * (3) version, with object's version. 
	 */
	async getObjHeader(objId: string, version: number|null): Promise<{
			header: Uint8Array; version?: number; segsLen: number; }> {
		let objFolder = this.objFolder(objId);
		if (version === null) {
			let status = await this.getObjStatus(objId);
			if (status.state !== 'current') { throw SC.WRONG_OBJ_STATE; }
			if (typeof status.currentVersion !== 'number') { throw new Error(`Illegal state of object status file for ${objId}: state is current, while current version is missing.`); }
			version = status.currentVersion;
		}
		let file = `${objFolder}/${version}.`;
		let fd = await fs.open(file, 'r').catch((exc: fs.FileException) => {
			if (exc.notFound) { throw SC.OBJ_UNKNOWN; }
			throw exc;
		});
		try {
			let { headerOffset, segsOffset, diff } = await parseObjFile(fd);
			let header = new Buffer(segsOffset - headerOffset);
			await fs.read(fd, headerOffset, header);
			let segsLen: number;
			if (diff) {
				segsLen = diff.segsSize;
			} else {
				let segsStat = await fs.fstat(fd);
				segsLen = segsStat.size - segsOffset;
			}
			return { header, version, segsLen };
		} finally {
			await fs.close(fd);
		}
	}
	
	async appendObjSegs(objId: string, transactionId: string,
			bytes: ReadableStream, bytesLen: number): Promise<void> {
		let trans = await this.getTransactionParams(objId, transactionId);
		if (trans.sizes.segments >= 0) { throw SC.INCOMPATIBLE_TRANSACTION; }
		let file = `${this.transactionFolder(objId)}/new`;
		let initFileSize = await fs.getFileSize(file);
		await spaceTracker.change(this, bytesLen);
		try {
			await fs.streamToExistingFile(file, initFileSize,
				bytesLen, bytes, this.fileWritingBufferSize);
		} catch (err) {
			await fs.truncate(file, initFileSize).catch(() => {});
			throw err;
		}
	}
	
	async saveObjSegChunk(objId: string, transactionId: string,
			offset: number, chunkLen: number, chunk: ReadableStream):
			Promise<void> {
		let trans = await this.getTransactionParams(objId, transactionId);
		if (trans.sizes.segments < 0) {
			throw SC.INCOMPATIBLE_TRANSACTION;
		} else if ((offset + chunkLen) > trans.sizes.segments) {
			throw SC.WRITE_OVERFLOW;
		}
		let file = `${this.transactionFolder(objId)}/new`;
		await fs.streamToExistingFile(file, offset + trans.segsOffset,
				chunkLen, chunk, this.fileWritingBufferSize);
	}
	
	private makeSegsPipe(objId: string, file: string, offset: number,
			len: number, diff: DiffInfo|undefined, segsOffset: number):
			SegsPipe|null {
		if (len < 1) { return null; }
		if (!diff) {
			let stream = createReadStream(file, {
				flags: 'r',
				start: offset+segsOffset,
				end: offset+segsOffset+len-1
			});
			return async (outStream: NodeJS.WritableStream) => {
				await pipeBytes(stream, outStream);
			};
		}
		let { fstInd, fstSec, lastInd, lastSec } =
			getFstAndLastSections(diff.sections, offset, len);
		if (!fstSec) { return null; }
		return (outStream: NodeJS.WritableStream): Promise<void> => {
			let pipeSection = async (secInd: number): Promise<void> => {
				let s = ((secInd === fstInd) ? fstSec :
						((secInd === lastInd) ? lastSec : diff.sections[secInd]));
				if (s[0] === 1) {
					let stream = createReadStream(file, {
						flags: 'r',
						start: s[1]+segsOffset,
						end: s[1]+segsOffset+s[2]-1
					});
					await pipeBytes(stream, outStream);
				} else {
					let base = await this.getObjSegs(
						objId, diff.baseVersion, s[1], s[2]);
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
	 * @param version is a specific object version
	 * @param offset is a read start point.
	 * @param maxLen is a maximum number of bytes to read. Null indicates that
	 * all bytes can be read.
	 * @return
	 */
	async getObjSegs(objId: string, version: number, offset: number,
			maxLen: number|null): Promise<ObjReader> {
		let objFolder = this.objFolder(objId);
		let file = `${objFolder}/${version}.`;
		let fd = await fs.open(file, 'r').catch((exc: fs.FileException) => {
			if (exc.notFound) { throw SC.OBJ_UNKNOWN; }
			throw exc;
		});
		try {
			// read object file
			let { headerOffset, segsOffset, diff } = await parseObjFile(fd);
			let segsLen: number;
			if (diff) {
				segsLen = diff.segsSize;
			} else {
				let segsStat = await fs.fstat(fd);
				segsLen = segsStat.size - segsOffset;
			}
			// contain boundary parameters
			if (segsLen < offset) {
				offset = segsLen;
			}
			let len: number;
			if (maxLen === null) {
				len = segsLen - offset;
			} else if ((offset+maxLen) >= segsLen) {
				len = segsLen - offset;
			} else {
				len = maxLen;
			}
			// construct reader
			let pipe = this.makeSegsPipe(
				objId, file, offset, len, diff, segsOffset);
			let reader: ObjReader = { len, segsLen };
			if (pipe) {
				reader.pipe = pipe;
			}
			Object.freeze(reader);
			return reader;
		} finally {
			await fs.close(fd);
		}
	}

	/**
	 * @param objId is a string object id for non-root objects, and null for
	 * root object.
	 * @param version identifies exact version of files for removal.
	 * @return a promise, resolvable when version files are removed.
	 */
	private async rmObjFiles(objId: string, version: number): Promise<void> {
		let objFolder = this.objFolder(objId);
		let objFiles = await fs.readdir(objFolder)
		.catch((exc: fs.FileException) => {
			if (exc.notFound) { throw SC.OBJ_UNKNOWN; }
			else { throw exc; }
		});
		let verPart = `${version}.`;
		objFiles = objFiles.filter(fName => fName.startsWith(verPart));
		if (objFiles.length === 0) { throw SC.OBJ_UNKNOWN; }
		for (let fName of objFiles) {
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
		let status = await this.getObjStatus(objId);
		let arch = status.archivedVersions;
		// XXX need to put removal transaction, closing it in a finally clause

		if (archVersion === null) {
			if (objId === null) { throw new Error(
				'Root object is not removable.'); }
			if (status.state !== 'current') { throw SC.OBJ_UNKNOWN; }
			if (!Array.isArray(arch) || (arch.length === 0)) {
				await fs.rmDirWithContent(this.objFolder(objId)).catch(() => {});
			} else {
				let currVer = status.currentVersion;
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
			let indInArch = arch.indexOf(archVersion);
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
	}

	// XXX need both, archiving and removal transactions for atomic locking
	//		should these be like empty lock files instead of saving folders,
	//		with code distiguishing between the two, while concurrent transaction
	//		only need fs.stat for a given name, or a fail of creating lock
	//		file/folder.

	async archiveCurrentObjVersion(objId: string, version: number):
			Promise<void> {
		// XXX need to put archiving transaction, closing it in a finally clause

		let status = await this.getObjStatus(objId);
		if (status.state !== 'current') { throw SC.WRONG_OBJ_STATE; }
		if (typeof status.currentVersion !== 'number') { throw new Error(`Illegal state of object status file for ${objId}: state is current, while current version is missing.`); }
		let arch = status.archivedVersions;
		if (Array.isArray(arch)) {
			arch.push(status.currentVersion);
		} else {
			status.archivedVersions = [ status.currentVersion ];
		}
		await this.setObjStatus(objId, status);
	}

	async listObjArchive(objId: string): Promise<number[]> {
		let status = await this.getObjStatus(objId);
		let arch = status.archivedVersions;
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
		} else if ('object' !== typeof params) {
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