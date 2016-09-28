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
 * Inbox files are laid out on disk in the following way:
 * (a) store is just a folder with stuff inside;
 * (b) main store folder contains following folders:
 * (b.1) messages - is a folder for message folders,
 * (b.2) delivery - is a folder for messages, that are in a process of
 *                  being delivered; complete messages are moved to
 *                  'messages' folder.
 * (b.3) params - is a place for information files about this mail box;
 * (c) message folder's name is message's id
 * (d) message folder contains file 'meta' with plain-text JSON-form metadata
 *     for this particular message.
 * (e) message folder contains folder 'objects' with all object files, that
 *     are part of this particular message.
 */

import * as fs from '../../lib-common/async-fs-node';
import { createReadStream } from 'fs';
import { Writable, Readable } from 'stream';
import { isLikeSignedKeyCert } from '../../lib-common/jwkeys';
import * as random from '../../lib-common/random-node';
import * as deliveryApi from '../../lib-common/service-api/asmail/delivery';
import * as configApi from '../../lib-common/service-api/asmail/config';
import * as retrievalApi from '../../lib-common/service-api/asmail/retrieval';
import { UserFiles, SC as ufSC, addressToFName }
	from '../../lib-server/resources/user-files';

interface AnonSenderPolicy extends configApi.p.anonSenderPolicy.Policy {}
export interface AuthSenderPolicy extends configApi.p.authSenderPolicy.Policy {}
interface Whitelist extends configApi.p.authSenderWhitelist.List {} 
interface Blacklist extends configApi.p.authSenderBlacklist.List {} 
interface AuthSenderInvites extends configApi.p.authSenderInvites.List {}
interface AnonSenderInvites extends configApi.p.anonSenderInvites.List {}

export const SC = {
	OBJ_EXIST: 'obj-already-exist',
	USER_UNKNOWN: ufSC.USER_UNKNOWN,
	MSG_UNKNOWN: 'msg-unknown',
	OBJ_UNKNOWN: 'obj-unknown',
	WRITE_OVERFLOW: ufSC.WRITE_OVERFLOW
};
Object.freeze(SC);

const XSP_HEADER_FILE_NAME_END = '.hxsp';
const XSP_SEGS_FILE_NAME_END = '.sxsp';

const MSG_ID_LEN = 32;

interface MsgObjSizes {
	[objId: string]: {
		segments: number;
		header: number;
	};
}

export interface ObjReader {
	len: number;
	stream: Readable;
	// pipeTo: (sink: Writable) => Promise<void>;
}

/**
 * @param delivPath
 * @param msgsFolder is an additional folder, checked against id-collision
 * @return a promise, resolvable to generated msg id, when folder for a message
 * is created in the delivery folder.
 */
async function genMsgIdAndMakeFolder(delivPath: string, msgsFolder: string):
		Promise<string> {
	let msgId = random.stringOfB64UrlSafeChars(MSG_ID_LEN);
	// make msg folder among deliveries
	try {
		await fs.mkdir(delivPath+'/'+msgId);
	} catch (exc) {
		if ((<fs.FileException> exc).alreadyExists) {
			return genMsgIdAndMakeFolder(delivPath, msgsFolder);
		} else { throw exc; }
	}
	// ensure that msgId does not belong to any existing message
	try {
		await fs.stat(msgsFolder+'/'+msgId);
		await fs.rmdir(delivPath+'/'+msgId);
		return genMsgIdAndMakeFolder(delivPath, msgsFolder);
	} catch (exc) {}
	return msgId;
}

export class Inbox extends UserFiles {
	
	constructor(userId: string, path: string,
			writeBufferSize: string|number, readBufferSize: string|number) {
		super(userId, path, writeBufferSize, readBufferSize);
		Object.freeze(this);
	}
	
	static async make(rootFolder: string, userId: string,
			writeBufferSize: string|number, readBufferSize: string|number):
			Promise<Inbox> {
		let path = rootFolder+'/'+addressToFName(userId)+'/mail';
		let inbox = new Inbox(userId, path, writeBufferSize, readBufferSize);
		await inbox.ensureUserExistsOnDisk();
		return inbox;
	}
	
	/**
	 * @return a promise, resolvable to number bytes used by this inbox.
	 */
	async usedSpace(): Promise<number> {
		// XXX need to use space-tracker service!
		//		For now we return zero.
		return 0;
	}

	/**
	 * @return a promise, resolvable to free space in bytes.
	 */
	async freeSpace(): Promise<number> {
		// XXX need to use space-tracker service!
		let usedSpace = await this.usedSpace();
		let quota = await this.getSpaceQuota();
		return Math.max(0, quota - usedSpace);
	}

	/**
	 * @param msgMeta is json object with message's meta info directly from sender.
	 * @param authSender is an address of sender, if such was authenticated.
	 * @return a promise, resolvable to message id, when a folder for new
	 * message has been created.
	 */
	async recordMsgMeta(msgMeta: deliveryApi.msgMeta.Request,
			authSender: string): Promise<string> {
		let delivPath = this.path+'/delivery'
		let msgId = await genMsgIdAndMakeFolder(delivPath, this.path+'/messages');
		let meta: retrievalApi.msgMetadata.Reply = {
			extMeta: msgMeta,
			deliveryStart: Date.now(),
			authSender: authSender
		};
		await fs.writeFile(delivPath+'/'+msgId+'/meta.json',
			JSON.stringify(meta), { encoding: 'utf8', flag: 'wx' });
		return msgId;
	}

	/**
	 * @param msgId
	 * @param incompleteMsg flag, true for incomplete (in-delivery) messages,
	 * and false (or undefined) for complete messages.
	 * @return a promise, resolvable to message metadata from disk, when it has
	 * been found on the disk.
	 * Rejected promise may pass a string error code from SC.
	 */
	async getMsgMeta(msgId: string, incompleteMsg?: boolean):
			Promise<retrievalApi.msgMetadata.Reply> {
		let msgFolder = this.path+(incompleteMsg ? '/delivery' : '/messages');
		try {
			let str = await fs.readFile(msgFolder+'/'+msgId+'/meta.json',
				{ encoding: 'utf8', flag: 'r' });
			return JSON.parse(str);
		} catch (err) {
			if ((<fs.FileException> err).notFound) {
				throw SC.MSG_UNKNOWN;
			}
			throw err;
		}
	}

	/**
	 * @param msgId
	 * @param objId
	 * @return a promise, resolvable to undefined, when given pair of message
	 * and object ids is correct, otherwise, rejected with a string error status,
	 * found in SC of this object.
	 */
	async checkIds(msgId: string, objId: string): Promise<void> {
		let msgMeta = await this.getMsgMeta(msgId, true);
		if (msgMeta.extMeta.objIds.indexOf(objId) < 0) {
			throw SC.OBJ_UNKNOWN;
		}
	}

	/**
	 * @param msgId
	 * @param objId
	 * @param fileHeader
	 * @param allocateFile
	 * @param totalSize
	 * @param offset
	 * @param chunkLen
	 * @param chunk
	 * @return a promise, resolvable when all bytes are written to the file.
	 * Rejected promise may pass a string error code from SC.
	 */
	async saveObjChunk(msgId: string, objId: string, fileHeader: boolean,
			allocateFile: boolean, totalSize: number, offset: number,
			chunkLen: number, chunk: Readable): Promise<void> {
		let filePath = this.path+'/delivery/'+msgId+'/'+objId+
			(fileHeader ? XSP_HEADER_FILE_NAME_END : XSP_SEGS_FILE_NAME_END);
		await this.checkIds(msgId, objId);
		if (allocateFile) {
			if (typeof totalSize !== 'number') { throw new TypeError(
				'totalSize is not a number'); }
			if ((offset + chunkLen) > totalSize) {
				throw SC.WRITE_OVERFLOW;
			}
			await fs.createEmptyFile(filePath, totalSize).catch(
				(exc: fs.FileException) => {
					if (exc.alreadyExists) { throw SC.OBJ_EXIST; }
					else { throw exc; }
				});
		} else {
			let fileSize = await fs.getFileSize(filePath).catch(
				(exc: fs.FileException) => {
					if (exc.notFound) { throw SC.OBJ_UNKNOWN; }
					else { throw exc; }
				});
			if ((offset + chunkLen) > fileSize) {
				throw SC.WRITE_OVERFLOW;
			}
		}
		try {
			await fs.streamToExistingFile(filePath, offset,
				chunkLen, chunk, this.fileWritingBufferSize);
		} catch (err) {
			if (!allocateFile) { throw err; }
			try {
				await fs.unlink(filePath);
			} catch (exc) {} finally { throw err; }
		}
	}

	/**
	 * @param msgId
	 * @param objId
	 * @param fileHeader
	 * @param allocateFile
	 * @param bytes
	 * @param bytesLen
	 * @return a promise, resolvable when all bytes are written to the file.
	 * Rejected promise may pass a string error code from SC.
	 */
	async appendObj(msgId: string, objId: string, fileHeader: boolean,
			allocateFile: boolean, bytes: Readable, bytesLen: number):
			Promise<void> {
		if (typeof bytesLen !== 'number') { throw new TypeError(
			'bytesLen is not a number'); }
		let filePath = this.path+'/delivery/'+msgId+'/'+objId+
			(fileHeader ? XSP_HEADER_FILE_NAME_END : XSP_SEGS_FILE_NAME_END);
		await this.checkIds(msgId, objId);
		let initFileSize: number;
		if (allocateFile) {
			await fs.createEmptyFile(filePath, 0)
			initFileSize = 0;
		} else {
			initFileSize = await fs.getFileSize(filePath);
		}
		try{
			await fs.streamToExistingFile(filePath, initFileSize,
				bytesLen, bytes, this.fileWritingBufferSize)
		} catch (err) {
			try{
				if (allocateFile) {
					fs.unlink(filePath);
				} else {
					fs.truncate(filePath, initFileSize);
				}
			} catch (exc) {} finally { throw err; }
		}
	}
	
	/**
	 * @param msgId
	 * @param objIds
	 * @return a promise for sizes of all objects that are present on the disk,
	 * out of given ones.
	 */
	private async getMsgObjSizes(msgId: string, objIds: string[]):
			Promise<MsgObjSizes> {
		let sizes: MsgObjSizes = {};
		if (objIds.length === 0) { return sizes; }
		let pathStart = this.path+'/delivery/'+msgId+'/';
		for (let objId of objIds) {
			try {
				sizes[objId] = {
					header: await fs.getFileSize(
						pathStart+objId+XSP_HEADER_FILE_NAME_END),
					segments: await fs.getFileSize(
						pathStart+objId+XSP_SEGS_FILE_NAME_END)
				}
			} catch (err) {}
		}
		return sizes;
	}

	/**
	 * @param msgId
	 * @return a promise, resolvable, when a message has been moved from
	 * delivery to messages storing folder.
	 * Rejected promise may pass string error code from SC.
	 */
	async completeMsgDelivery(msgId: string): Promise<void> {
		let msgMeta = await this.getMsgMeta(msgId, true);
		msgMeta.deliveryCompletion = Date.now();
		msgMeta.objSizes = await this.getMsgObjSizes(
			msgId, msgMeta.extMeta.objIds);
		await fs.writeFile(this.path+'/delivery/'+msgId+'/meta.json',
			JSON.stringify(msgMeta), { encoding: 'utf8', flag: 'r+' });
		let srcFolder = this.path+'/delivery/'+msgId;
		let dstFolder = this.path+'/messages/'+msgId;
		await fs.rename(srcFolder, dstFolder);
	}

	/**
	 * @return a promise, resolvable to a list of available message ids.
	 */
	getMsgIds(): Promise<retrievalApi.listMsgs.Reply> {
		return fs.readdir(this.path+'/messages');
	}

	/**
	 * This method removes message folder from the disk.
	 * @param msgId is an id of a message, that needs to be removed.
	 * @return promise, resolvable when a message folder is removed from
	 * the disk.
	 * Rejected promise may pass string error code from SC.
	 */
	async rmMsg(msgId: string): Promise<void> {
		try {
			let msgPath = this.path+'/messages/'+msgId
			let rmPath = msgPath+'~remove';
			await fs.rename(msgPath, rmPath);
			await fs.rmDirWithContent(rmPath);
		} catch (exc) {
			if ((<fs.FileException> exc).notFound) {
				throw SC.MSG_UNKNOWN;
			}
			throw exc;
		}
	}

	/**
	 * @param msgId
	 * @param objId
	 * @param fileHeader
	 * @param offset
	 * @param maxLen
	 * @return a promise, resolvable to bytes reader.
	 */
	async getObj(msgId: string, objId: string, fileHeader: boolean,
			offset: number, maxLen?: number): Promise<ObjReader> {
		let filePath = this.path+'/messages/'+msgId+'/'+objId+
			(fileHeader ? XSP_HEADER_FILE_NAME_END : XSP_SEGS_FILE_NAME_END);
		try {
			let objSize = await fs.getFileSize(filePath);
			if (objSize <= offset) { return; }
			if ('number' !== typeof maxLen) {
				maxLen = objSize - offset;
			} else if ((offset+maxLen) >= objSize) {
				maxLen = objSize - offset;
			}
			if (maxLen <= 0) { return; }
			let reader: ObjReader = {
				len: maxLen,
				stream: createReadStream(filePath, {
					flags: 'r',
					encoding: null,
					start: offset,
					end: offset+maxLen-1
				})
			}
			Object.freeze(reader);
			return reader;
		} catch (exc) {
			if ((<fs.FileException> exc).notFound) {
				throw SC.OBJ_UNKNOWN;
			}
			throw exc;
		}
	}
	
	/**
	 * @param inbox
	 * @param initKeyCerts
	 * @param setDefault when it is true, sets default values -- null --
	 * in place of an object with certs.
	 * @return a promise, resolvable to true, when certs are set, or
	 * resolvable to false, when given certs do not pass sanitization. 
	 */
	static async setPubKey(inbox: Inbox,
			initKeyCerts: deliveryApi.initPubKey.Reply,
			setDefault: boolean): Promise<boolean> {
		if (setDefault) {
			initKeyCerts = null;
		} else {
			let isOK = 
				('object' === typeof initKeyCerts) && !!initKeyCerts &&
				isLikeSignedKeyCert(initKeyCerts.pkeyCert) &&
				isLikeSignedKeyCert(initKeyCerts.userCert) &&
				isLikeSignedKeyCert(initKeyCerts.provCert);
			if (!isOK) { return false; }
		}
		await inbox.setParam('pubkey', initKeyCerts);
		return true;
	}

	/**
	 * @return a promise, either resolvable to object with certificates,
	 * or resolvable to null (default), if key certs were not set by the user.
	 */
	static getPubKey(inbox: Inbox): Promise<deliveryApi.initPubKey.Reply> {
		return inbox.getParam<deliveryApi.initPubKey.Reply>('pubkey');
	}
	
	static getAnonSenderPolicy(inbox: Inbox): Promise<AnonSenderPolicy> {
		return inbox.getParam<AnonSenderPolicy>('anonymous/policy');
	}
	static async setAnonSenderPolicy(inbox: Inbox, policy: AnonSenderPolicy,
			setDefault: boolean): Promise<boolean> {
		if (setDefault) {
			policy = {
				accept: true,
				acceptWithInvitesOnly: true,
				defaultMsgSize: 1024*1024
			};
		} else {
			let isOK =
				('object' === typeof policy) && !!policy &&
				('boolean' === typeof policy.accept) &&
				('boolean' === typeof policy.acceptWithInvitesOnly) &&
				('number' === typeof policy.defaultMsgSize) &&
				(policy.defaultMsgSize > 500);
			if (!isOK) { false; }
		}
		await inbox.setParam('anonymous/policy', policy);
		return true;
	}
	getAnonSenderPolicy(): Promise<AnonSenderPolicy> {
		return Inbox.getAnonSenderPolicy(this);
	}
	
	static getAnonSenderInvites(inbox: Inbox): Promise<AnonSenderInvites> {
		return inbox.getParam<AnonSenderInvites>('anonymous/invites');
	}
	static async setAnonSenderInvites(inbox: Inbox, invites: AnonSenderInvites,
			setDefault: boolean): Promise<boolean> {
		if (setDefault) {
			invites = {};
		} else {
			let isOK = ('object' === typeof invites) && !!invites;
			if (!isOK) { return false; }
			let msgMaxSize: number;
			for (var invite in invites) {
				msgMaxSize = invites[invite];
				isOK = ('number' === typeof msgMaxSize) && (msgMaxSize > 500);
				if (!isOK) { return false; }
			}
		}
		await inbox.setParam('anonymous/invites', invites);
		return true;
	}
	getAnonSenderInvites(): Promise<AnonSenderInvites> {
		return Inbox.getAnonSenderInvites(this);
	}
	
	static getAuthSenderPolicy(inbox: Inbox): Promise<AuthSenderPolicy> {
		return inbox.getParam<AuthSenderPolicy>('authenticated/policy');
	}
	static async setAuthSenderPolicy(inbox: Inbox, policy: AuthSenderPolicy,
			setDefault: boolean): Promise<boolean> {
		if (setDefault) {
			policy = {
				acceptWithInvitesOnly: false,
				acceptFromWhiteListOnly: false,
				applyBlackList: true,
				defaultMsgSize: 100*1024*1024,
			};
		} else {
			let isOK =
				('object' === typeof policy) && !!policy &&
				('boolean' === typeof policy.applyBlackList) &&
				('boolean' === typeof policy.acceptFromWhiteListOnly) &&
				('boolean' === typeof policy.acceptWithInvitesOnly) &&
				('number' === typeof policy.defaultMsgSize) &&
				(policy.defaultMsgSize > 500);
			if (!isOK) { return false; }
		}
		await inbox.setParam('authenticated/policy', policy);
		return true;
	}
	getAuthSenderPolicy(): Promise<AuthSenderPolicy> {
		return Inbox.getAuthSenderPolicy(this);
	}
	
	static getAuthSenderBlacklist(inbox: Inbox): Promise<Blacklist> {
		return inbox.getParam<Blacklist>('authenticated/blacklist');
	}
	static async setAuthSenderBlacklist(inbox: Inbox, list: Blacklist,
			setDefault: boolean): Promise<boolean> {
		if (setDefault) {
			list = {};
		} else {
			let isOK = ('object' === typeof list) && !!list;
			if (!isOK) { return false; }
		}
		await inbox.setParam('authenticated/blacklist', list);
		return true;
	}
	getAuthSenderBlacklist(): Promise<Blacklist> {
		return Inbox.getAuthSenderBlacklist(this);
	}
	
	static getAuthSenderWhitelist(inbox: Inbox): Promise<Whitelist> {
		return inbox.getParam<Whitelist>('authenticated/whitelist');
	}
	static async setAuthSenderWhitelist(inbox: Inbox, list: Whitelist,
			setDefault: boolean): Promise<boolean> {
		if (setDefault) {
			list = {};
		} else {
			let isOK = ('object' === typeof list) && !!list;
			if (!isOK) { return false; }
			let msgMaxSize: number;
			for (var addr in list) {
				msgMaxSize = list[addr];
				isOK = ('number' === typeof msgMaxSize) && (msgMaxSize > 500);
				if (!isOK) { return false; }
			}
		}
		await inbox.setParam('authenticated/whitelist', list);
		return true;
	}
	getAuthSenderWhitelist(): Promise<Whitelist> {
		return Inbox.getAuthSenderWhitelist(this);
	}
	
	static getAuthSenderInvites(inbox: Inbox): Promise<AuthSenderInvites> {
		return inbox.getParam<AuthSenderInvites>('authenticated/invites');
	}
	static async setAuthSenderInvites(inbox: Inbox, invites: AuthSenderInvites,
			setDefault: boolean): Promise<boolean> {
		if (setDefault) {
			invites = {};
		} else {
			let isOK = ('object' === typeof invites) && !!invites;
			if (!isOK) { return false; }
			let msgMaxSize: number;
			for (var invite in invites) {
				msgMaxSize = invites[invite];
				isOK = ('number' === typeof msgMaxSize) && (msgMaxSize > 500);
				if (!isOK) { return false; }
			}
		}
		await inbox.setParam('authenticated/invites', invites);
		return true;
	}
	getAuthSenderInvites(): Promise<AuthSenderInvites> {
		return Inbox.getAuthSenderInvites(this);
	}

}
Object.freeze(Inbox.prototype);
Object.freeze(Inbox);

Object.freeze(exports);