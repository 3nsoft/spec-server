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
 * Inbox files are laid out on disk in the following way:
 * (a) store is just a folder with stuff inside;
 * (b) main store folder contains following folders:
 * (b.1) messages - is a folder for message folders,
 * (b.2) delivery - is a folder for messages, that are in a process of
 *                  being delivered; complete messages are moved to
 *                  'messages' folder.
 * (b.3) params - is a place for information files about this mail box;
 * (c) message folder's name is message's id. Each message folder contains:
 * (c.1) meta - is a file with plain-text JSON-form metadata for a message.
 * (c.2) objects - is a folder with all object files, that are part of the
 *                 message.
 */

import * as fs from '../../lib-common/async-fs-node';
import { createReadStream } from 'fs';
import { Writable, Readable } from 'stream';
import { isLikeSignedKeyCert } from '../../lib-common/jwkeys';
import * as random from '../../lib-common/random-node';
import * as deliveryApi from '../../lib-common/service-api/asmail/delivery';
import * as configApi from '../../lib-common/service-api/asmail/config';
import * as retrievalApi from '../../lib-common/service-api/asmail/retrieval';
import { UserFiles, SC as ufSC, addressToFName, ObjReader, pipeBytes }
	from '../../lib-server/resources/user-files';
import { parseObjFile, createObjFile } from '../../lib-common/obj-file';
import { SingleProc } from '../../lib-common/processes';
import { TimeWindowCache } from '../../lib-common/time-window-cache';

export { ObjPipe, ObjReader } from '../../lib-server/resources/user-files';

type AnonSenderPolicy = configApi.p.anonSenderPolicy.Policy;
export type AuthSenderPolicy = configApi.p.authSenderPolicy.Policy;
type Whitelist = configApi.p.authSenderWhitelist.List;
type Blacklist = configApi.p.authSenderBlacklist.List;
type AuthSenderInvites = configApi.p.authSenderInvites.List;
type AnonSenderInvites = configApi.p.anonSenderInvites.List;

type MsgMeta = retrievalApi.MsgMeta;
type ObjStatus = retrievalApi.ObjStatus;
export type MsgEvents = retrievalApi.msgMainObjRecieved.Event |
	retrievalApi.msgRecievedCompletely.Event;

export type MailEventsSink = (userId: string,
	channel: string, event: MsgEvents) => void;

export const SC = {
	OBJ_EXIST: 'obj-already-exist',
	USER_UNKNOWN: ufSC.USER_UNKNOWN,
	MSG_UNKNOWN: 'msg-unknown',
	OBJ_UNKNOWN: 'obj-unknown',
	WRONG_OBJ_STATE: 'wrong-obj-state',
	WRITE_OVERFLOW: ufSC.WRITE_OVERFLOW
};
Object.freeze(SC);

const META_FILE = 'meta.json';

const MSG_ID_LEN = 32;

/**
 * This returns a promise, resolvable to generated msg id, when folder for a
 * message is created in the delivery folder.
 * @param delivPath
 * @param msgsFolder is an additional folder, checked against id-collision
 */
async function genMsgIdAndMakeFolder(delivPath: string, msgsFolder: string):
		Promise<string> {
	const msgId = random.stringOfB64UrlSafeChars(MSG_ID_LEN);
	// make msg folder among deliveries
	try {
		await fs.mkdir(`${delivPath}/${msgId}`);
	} catch (exc) {
		if ((<fs.FileException> exc).alreadyExists) {
			return genMsgIdAndMakeFolder(delivPath, msgsFolder);
		} else { throw exc; }
	}
	// ensure that msgId does not belong to any existing message
	try {
		await fs.stat(`${msgsFolder}/${msgId}`);
		await fs.rmdir(`${delivPath}/${msgId}`);
		return genMsgIdAndMakeFolder(delivPath, msgsFolder);
	} catch (exc) {}
	return msgId;
}

export class Inbox extends UserFiles {

	private cachedMetas = new TimeWindowCache<string, MsgMeta>(5*60*1000);
	private metaSavingProc = new SingleProc<void>();
	private mailEventsSink: MailEventsSink;
	
	constructor(userId: string, path: string, mailEventsSink: MailEventsSink,
			writeBufferSize?: string|number, readBufferSize?: string|number) {
		super(userId, path, writeBufferSize, readBufferSize);
		this.mailEventsSink = mailEventsSink;
		Object.freeze(this);
	}
	
	static async make(rootFolder: string, userId: string,
			mailEventsSink: MailEventsSink, writeBufferSize?: string|number,
			readBufferSize?: string|number): Promise<Inbox> {
		const path = `${rootFolder}/${addressToFName(userId)}/mail`;
		const inbox = new Inbox(userId, path, mailEventsSink,
			writeBufferSize, readBufferSize);
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
		const usedSpace = await this.usedSpace();
		const quota = await this.getSpaceQuota();
		return Math.max(0, quota - usedSpace);
	}

	/**
	 * This returns a promise, resolvable to message id, when a folder for new
	 * message has been created.
	 * @param extMeta is json object with message's meta info directly from
	 * sender.
	 * @param authSender is an address of sender, if such was authenticated.
	 * @param invite is an invitation token, if any were used.
	 */
	async recordMsgMeta(extMeta: deliveryApi.msgMeta.Request,
			authSender: string|undefined, invite: string|undefined,
			maxMsgLength: number): Promise<string> {
		const msgId = await genMsgIdAndMakeFolder(
			`${this.path}/delivery`, `${this.path}/messages`);
		const meta: MsgMeta = {
			extMeta, authSender, invite, maxMsgLength,
			recipient: this.userId,
			deliveryStart: Date.now(),
			objs: {}
		};
		this.setMeta(msgId, meta, true);
		return msgId;
	}

	/**
	 * This returns a promise, resolvable to message metadata from disk, when it
	 * as been found on the disk.
	 * Rejected promise may pass a string error code from SC.
	 * @param msgId
	 * @param completeMsg flag, true for complete messages, and false for
	 * incomplete (in-delivery) messages.
	 */
	async getMsgMeta(msgId: string, completeMsg): Promise<MsgMeta> {
		return this.getMeta(msgId, completeMsg);
	}

	private async getMeta(msgId: string, completeMsg = false): Promise<MsgMeta> {
		const meta = this.cachedMetas.get(msgId);
		if (meta) {
			if ((meta.deliveryCompletion && !completeMsg) ||
					(!meta.deliveryCompletion && completeMsg)) {
				throw SC.MSG_UNKNOWN; }
			return meta;
		}

		try {
			const file = `${this.path}/${completeMsg ? 'messages' : 'delivery'}/${msgId}/${META_FILE}`;
			const str = await fs.readFile(file, { encoding: 'utf8', flag: 'r' });
			const meta = JSON.parse(str) as MsgMeta;
			this.cachedMetas.set(msgId, meta);
			return meta;
		} catch (err) {
			if ((<fs.FileException> err).notFound) {
				throw SC.MSG_UNKNOWN;
			}
			throw err;
		}
	}

	/**
	 * This sets meta for a given message.
	 * @param msgId 
	 * @param meta 
	 * @param isNew Indicates with true, if this meta should be added as new,
	 * else, false, default value, treats meta as existing one, and only updates
	 * respective file.
	 */
	private async setMeta(msgId: string, meta: MsgMeta, isNew = false):
			Promise<void> {
		if (isNew && this.cachedMetas.get(msgId)) { throw new Error(
			`Meta is already created for message ${msgId}`); }
		this.cachedMetas.set(msgId, meta);
		await this.metaSavingProc.startOrChain(() => fs.writeFile(
			`${this.path}/delivery/${msgId}/${META_FILE}`,
			JSON.stringify(meta),
			{ encoding: 'utf8', flag: (isNew ? 'wx' : 'r+') }));
	}

	async startSavingObj(msgId: string, objId: string, bytes: Readable,
			bytesLen: number, opts: deliveryApi.PutObjFirstQueryOpts):
			Promise<void> {
		// check meta
		const meta = await this.getMeta(msgId);
		if (meta.objs[objId]) { throw SC.WRONG_OBJ_STATE; }
		if (meta.extMeta.objIds.indexOf(objId) < 0) { throw SC.OBJ_UNKNOWN; }

		// create file
		const file = `${this.path}/delivery/${msgId}/${objId}`;
		const { headerOffset } = await createObjFile(
			file, opts.header, (opts.segs ? opts.segs : 0))
		.catch((exc: fs.FileException) => {
			if (exc.alreadyExists) { throw SC.OBJ_EXIST; }
			else { throw exc; }
		});

		// write to file (remove it in case of an error)
		await fs.streamToExistingFile(file, headerOffset, bytesLen, bytes,
			this.fileWritingBufferSize)
		.catch(async (err) => {
			await fs.unlink(file).catch(() => {})
			throw err;
		});

		// set obj status in meta
		meta.objs[objId] = {
			size: {
				header: opts.header,
				segments: opts.segs
			}
		};
		const isComplete = ((typeof opts.segs === 'number') ?
			(bytesLen === (opts.header + opts.segs)) : false);
		if (isComplete) {
			meta.objs[objId].completed = true;
		}
		await this.setMeta(msgId, meta);
	}

	async continueSavingObj(msgId: string, objId: string, bytes: Readable,
			bytesLen: number, opts: deliveryApi.PutObjSecondQueryOpts):
			Promise<void> {
		// check obj status
		const meta = await this.getMeta(msgId);
		const objStatus = meta.objs[objId];
		if (!objStatus) {
			if (meta.extMeta.objIds.indexOf(objId) < 0) { throw SC.OBJ_UNKNOWN; }
			else { throw SC.WRONG_OBJ_STATE; }
		}
		if ((!opts.last && !objStatus.size.segments && !opts.append) ||
				(objStatus.size.segments && opts.append)) {
			throw SC.WRONG_OBJ_STATE; }

		// parse existing obj file
		const file = `${this.path}/delivery/${msgId}/${objId}`;
		const { segsOffset, fileSize } = await parseObjFile(file)
		.catch((exc: fs.FileException) => {
			if (exc.notFound) { throw SC.OBJ_UNKNOWN; }
			else { throw exc; }
		});

		// write to object file only when there are bytes to write
		if (bytesLen > 0) {

			// find offset and check boundaries
			let offset: number;
			if (opts.append) {
				offset = fileSize;
			} else {
				offset = segsOffset + opts.ofs!;
				if ((offset + bytesLen) > fileSize) {
					throw SC.WRITE_OVERFLOW;
				}

			}

			// write to file (truncate appended bytes in case of error)
			await fs.streamToExistingFile(file, offset, bytesLen, bytes,
				this.fileWritingBufferSize)
			.catch(async (err) => {
				if (opts.append) {
					await fs.truncate(file, fileSize);
				}
				throw err;
			});
		}

		// update meta, if this is the last request
		if (opts.last) {
			if (opts.append) {
				objStatus.size.segments = fileSize + bytesLen - segsOffset;
			}
			objStatus.completed = true;
			await this.setMeta(msgId, meta);
		}
	}
	
	/**
	 * This returns a promise, resolvable, when a message has been moved from
	 * delivery to messages storing folder.
	 * Rejected promise may pass string error code from SC.
	 * @param msgId
	 */
	async completeMsgDelivery(msgId: string): Promise<void> {
		// indicate completion in meta
		const meta = await this.getMeta(msgId);
		meta.deliveryCompletion = Date.now();
		await this.setMeta(msgId, meta);

		// move message folder to a place with completed messages
		const srcFolder = `${this.path}/delivery/${msgId}`;
		const dstFolder = `${this.path}/messages/${msgId}`;
		await fs.rename(srcFolder, dstFolder);
		
		// raise event about completion of receiving a message
		this.mailEventsSink(this.userId,
			retrievalApi.msgRecievedCompletely.EVENT_NAME,
			{ msgId });
	}

	/**
	 * @return a promise, resolvable to a list of available message ids.
	 */
	getMsgIds(): Promise<retrievalApi.listMsgs.Reply> {
		return fs.readdir(`${this.path}/messages`);
	}

	/**
	 * This method returns parameters of an incomplete message, identified
	 * by a given id.
	 * @param msgId
	 */
	async getIncompleteMsgParams(msgId: string):
			Promise<{ maxMsgLength: number; currentMsgLength: number; }> {
		const msgMeta = await this.getMeta(msgId);
		const msgFolder = `${this.path}/delivery/${msgId}`;
		const currentMsgLength = await fs.getFolderContentSize(msgFolder);
		const maxMsgLength = msgMeta.maxMsgLength;
		return { maxMsgLength, currentMsgLength };
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
			const msgPath = `${this.path}/messages/${msgId}`;
			const rmPath = `${msgPath}~remove`;
			await fs.rename(msgPath, rmPath);
			await fs.rmDirWithContent(rmPath);
		} catch (exc) {
			if ((exc as fs.FileException).notFound) {
				throw SC.MSG_UNKNOWN;
			}
			throw exc;
		}
	}

	/**
	 * This method returns promise that resolves to obj reader.
	 * @param msgId
	 * @param objId
	 * @param header is a boolean flag that says if header bytes should be
	 * present
	 * @param segsOffset indicates offset from which segment bytes should be
	 * read. If header is present this offset must be zero.
	 * @param segsLimit
	 */
	async getObj(msgId: string, objId: string, header: boolean,
			offsetIntoSegs: number, segsLimit: number|undefined):
			Promise<ObjReader> {
		if (header && (offsetIntoSegs !== 0)) { throw new Error(
			`When header is read, segments offset must be zero`); }
		const filePath = `${this.path}/messages/${msgId}/${objId}`;
		
		// parse first part of an object file
		const { headerOffset, segsOffset, fileSize } =
			await parseObjFile(filePath).catch((exc: fs.FileException) => {
				if (exc.notFound) { throw SC.OBJ_UNKNOWN; }
				throw exc;
			});

		// find total segments length
		const segsLen = fileSize - segsOffset;

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
		let start: number;
		if (header) {
			const headerLen = segsOffset - headerOffset;
			reader = {
				len: (segBytesToRead + headerLen),
				segsLen,
				headerLen,
				pipe: undefined
			};
			start = headerOffset;
		} else {
			reader = {
				len: segBytesToRead,
				segsLen,
				pipe: undefined
			};
			start = segsOffset + offsetIntoSegs;
		}

		// attach pipe function, if needed
		if (reader.len > 0) {
			reader.pipe = (outStream => pipeBytes(
					createReadStream(filePath, {
						flags: 'r',
						start,
						end: start+reader.len-1
					}),
					outStream));
		}

		Object.freeze(reader);
		return reader;
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
			initKeyCerts = (null as any);
		} else {
			const isOK = 
				(typeof initKeyCerts === 'object') && !!initKeyCerts &&
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
				acceptWithInvitesOnly: false,
				defaultMsgSize: 1024*1024
			};
		} else {
			const isOK =
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
			const isOK = ('object' === typeof invites) && !!invites;
			if (!isOK) { return false; }
			for (var invite in invites) {
				const msgMaxSize = invites[invite];
				const isOK = ('number' === typeof msgMaxSize) && (msgMaxSize > 500);
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
			const isOK =
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
			const isOK = ('object' === typeof list) && !!list;
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
			const isOK = ('object' === typeof list) && !!list;
			if (!isOK) { return false; }
			for (var addr in list) {
				const msgMaxSize = list[addr];
				const isOK = ('number' === typeof msgMaxSize) && (msgMaxSize > 500);
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
			const isOK = ('object' === typeof invites) && !!invites;
			if (!isOK) { return false; }
			for (var invite in invites) {
				const msgMaxSize = invites[invite];
				const isOK = ('number' === typeof msgMaxSize) && (msgMaxSize > 500);
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