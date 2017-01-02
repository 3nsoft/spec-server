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
 * This module is recipient boxes factory.
 */

import * as fs from '../../lib-common/async-fs-node';
import { Stream, Readable } from 'stream';
import { Inbox, ObjReader, AuthSenderPolicy, SC } from './inbox';
import * as deliveryApi from '../../lib-common/service-api/asmail/delivery';
import * as configApi from '../../lib-common/service-api/asmail/config';
import * as retrievalApi from '../../lib-common/service-api/asmail/retrieval';

export { SC } from './inbox';

interface AddressToSizeMap {
	[address: string]: number;
}

/**
 * @param lst is a map from addresses to numeric values
 * @param address
 * @return numeric value found in the list, or undefined,
 * if neither address, nor its domain can be matched in the list.
 */
function findMatchIn(lst: AddressToSizeMap, address: string): number|undefined {
	// check address as a whole
	let v = lst[address];
	if ('undefined' !== typeof v) { return v; }
	// check address' own domain
	let ind = address.indexOf('@');
	if (ind < 0) { return; }
	address = address.substring(ind+1);
	if (address.length === 0) { return; }
	v = lst['@'+address];
	if ('undefined' !== typeof v) { return v; }
	// check parent domains
	while (true) {
		let ind = address.indexOf('.');
		if (ind < 0) { return; }
		address = address.substring(ind+1);
		if (address.length === 0) { return; }
		v = lst['@*.'+address];
		if ('undefined' !== typeof v) { return v; }
	}
}
	
/**
 * @param inbox
 * @param msgSize is a number of message bytes
 * @returns a promise, resolvable to
 * (1) least number between given number of bytes, and free space of
 *     a given inbox;
 * (2) -1 (less than zero), if there is no free space in the inbox.
 */
async function adaptToFreeSpaceLeft(inbox: Inbox, msgSize: number):
		Promise<number> {
	let bytesFree = await inbox.freeSpace();
	return ((bytesFree > 0) ? Math.min(bytesFree, msgSize) : -1);
}

/**
 * @param inbox
 * @param invitation is a string invitation token, or null.
 * @returns a promise, resolvable to
 * (1) zero (0), if leaving mail is forbidden,
 * (2) greater than zero maximum message length, and
 * (3) -1 (less than zero), if mail cannot be accepted due to full
 *     mail box.
 */
async function allowedMsgSizeForAnonSender(
		inbox: Inbox, invitation: string): Promise<number> {
	let policy = await inbox.getAnonSenderPolicy();
	if (!policy.accept) { return 0; }
	if (!invitation) {
		if (policy.acceptWithInvitesOnly) { return 0; }
		return await adaptToFreeSpaceLeft(inbox, policy.defaultMsgSize);
	} else {
		let invites = await inbox.getAnonSenderInvites();
		let sizeForInvite = invites[invitation];
		if (typeof sizeForInvite === 'number') { return 0; }
		return adaptToFreeSpaceLeft(inbox, sizeForInvite);
	}
}

/**
 * @param inbox
 * @param sender is sender string address
 * @param invitation is a string invitation token, or null.
 * @returns a promise, resolvable to
 * (1) zero (0), if leaving mail is forbidden,
 * (2) greater than zero maximum message length, and
 * (3) -1 (less than zero), if mail cannot be accepted due to full mail
 *     box.
 */
async function allowedMsgSizeForAuthSender(inbox: Inbox, sender: string,
		invitation: string): Promise<number> {
	let results = await Promise.all<any>([
		inbox.getAuthSenderPolicy(),
		inbox.getAuthSenderWhitelist()])
	let policy: AuthSenderPolicy = results[0];
	let sizeFromWL = findMatchIn(<AddressToSizeMap> results[1], sender);
	// check whitelist for specific size
	if (typeof sizeFromWL === 'number') {
		return adaptToFreeSpaceLeft(inbox, sizeFromWL);
	} else if (typeof sizeFromWL !== 'undefined') {
		return adaptToFreeSpaceLeft(inbox, policy.defaultMsgSize);
	}
	// exit if only whitelist contacts are allowed
	if (policy.acceptFromWhiteListOnly) { return 0; }
	// if needed, apply blacklist
	if (policy.applyBlackList) {
		let bList = await inbox.getAuthSenderBlacklist();
		if (typeof findMatchIn(bList, sender) === 'undefined') {
			return adaptToFreeSpaceLeft(inbox, policy.defaultMsgSize);
		} else {
			return 0;
		}
	}
	return adaptToFreeSpaceLeft(inbox, policy.defaultMsgSize);
}

interface IGetParam<T> {
	(userId: string): Promise<T>;
}
interface ISetParam<T> {
	(userId: string, param: T): Promise<boolean>;
}

/**
 * This checks existence of a given user, returning a promise, resolvable
 * either to true, when given user id is known, or to false, when it is not.
 */
export interface IExists {
	(userId: string): Promise<boolean>;
}
/**
 * This tells what is an allowable maximum message size for a given recipient,
 * for a given sender and/or under a given invitation token.
 * Function returns a promise, resolvable to
 * (1) zero (0), if leaving mail is forbidden,
 * (2) greater than zero maximum message length, and
 * (3) -1 (less than zero), if mail cannot be accepted due to full mail
 *     box.
 */
export interface IAllowedMaxMsgSize {
	(recipient: string, sender: string|undefined, invitation: string|undefined):
		Promise<number>;
}
/**
 * This allocates storage for a message returning a promise, resolvable to
 * (1) message id, when a folder for new message has been created,
 * (2) undefined, if recipient is unknown.
 */
export interface ISetMsgStorage {
	(recipient: string, msgMeta: deliveryApi.msgMeta.Request,
		authSender: string|undefined): Promise<string>;
}
/**
 * This saves given object's bytes, returning a promise, resolvable when saving
 * is OK, otherwise, promise rejected with string error code from SC.
 */
export interface ISaveBytes {
	(recipient: string, bytes: Stream,
		opts: BlobSaveOpts): Promise<void>;
}
/**
 * This finalizes delivery of a message, returning a promise.
 * Rejected promise may have a string error code from SC.
 */
export interface IFinalizeDelivery {
	(recipient: string, msgId: string): Promise<void>;
}
/**
 * This returns a promise, resolvable to array with ids of available messages.
 * Rejected promise may have a string error code from SC.
 */
export interface IGetMsgIds {
	(userId: string): Promise<retrievalApi.listMsgs.Reply>;
}
/**
 * This returns a promise, resolvable to message meta.
 * Rejected promise may have a string error code from SC.
 */
export interface IGetMsgMeta {
	(userId: string, msgId: string): Promise<retrievalApi.msgMetadata.Reply>;
}
/**
 * This deletes a message returning a promise, resolvable when message is
 * removed.
 * Rejected promise may have a string error code from SC.
 */
export interface IDeleteMsg {
	(userId: string, msgId: string): Promise<void>;
}
export interface ObjReader extends ObjReader {}
/**
 * This returns a promise, resolvable to readable stream of bytes.
 * Rejected promise may be passing string error code from SC.
 */
export interface IGetBytes {
	(userId: string, opts: BlobGetOpts): Promise<ObjReader>;
}
export interface IGetPubKey extends IGetParam<configApi.p.initPubKey.Certs> {}
export interface ISetPubKey extends ISetParam<configApi.p.initPubKey.Certs> {}
export interface IGetAnonSenderInvites
	extends IGetParam<configApi.p.anonSenderInvites.List> {}
export interface ISetAnonSenderInvites
	extends ISetParam<configApi.p.anonSenderInvites.List> {}
export interface Factory {
	exists: IExists;
	allowedMaxMsgSize: IAllowedMaxMsgSize;
	setMsgStorage: ISetMsgStorage;
	saveObjSegments: ISaveBytes;
	saveObjHeader: ISaveBytes;
	finalizeDelivery: IFinalizeDelivery;
	getMsgIds: IGetMsgIds;
	getMsgMeta: IGetMsgMeta;
	deleteMsg: IDeleteMsg;
	getObjHeader: IGetBytes;
	getObjSegments: IGetBytes;
	getPubKey: IGetPubKey;
	setPubKey: ISetPubKey;
	getAnonSenderInvites: IGetAnonSenderInvites;
	setAnonSenderInvites: ISetAnonSenderInvites;
}

export interface BlobSaveOpts {
	msgId: string;
	objId: string;
	appendMode: boolean;
	isFirstReq: boolean;
	totalSize?: number;
	chunkLen: number;
	offset?: number;
}

export interface BlobGetOpts {
	msgId: string;
	objId: string;
	offset: number;
	maxLen?: number;
}

export function makeFactory(rootFolder: string,
		writeBufferSize?: string|number, readBufferSize?: string|number):
		Factory {
	
	let boxes = new Map<string, Inbox>();
	
	async function getInbox(userId: string): Promise<Inbox> {
		let inbox = boxes.get(userId);
		if (inbox) {
			try {
				await inbox.ensureUserExistsOnDisk();
				return inbox;
			} catch (err) {
				boxes.delete(userId);
				throw err;
			}
		} else {
			inbox = await Inbox.make(rootFolder, userId,
				writeBufferSize, readBufferSize)
			boxes.set(userId, inbox);
			return inbox;
		}
	}
	
	function makeParamGetter<T>(staticGetter: (inbox: Inbox) => Promise<T>):
			(userId: string) => Promise<T> {
		return async (userId: string) => {
			let inbox = await getInbox(userId);
			return staticGetter(inbox);
		};	
	}
	
	function makeParamSetter<T>(staticSetter:
			(inbox: Inbox, param: T, setDefault: boolean) => Promise<boolean>):
			(userId: string, param: T, setDefault?: boolean) => Promise<boolean> {
		return async (userId: string, param: T, setDefault?: boolean) => {
			let inbox = await getInbox(userId);
			return staticSetter(inbox, param, !!setDefault);
		};		
	}
	
	function makeBlobSaver(fileHeader: boolean): ISaveBytes {
		return async (recipient: string, bytes: Readable, opts: BlobSaveOpts) => {
			let inbox = await getInbox(recipient);
			if (opts.appendMode) {
				return inbox.appendObj(opts.msgId, opts.objId,
					fileHeader, opts.isFirstReq, bytes, opts.chunkLen);
			} else {
				if (typeof opts.offset !== 'number') { throw new Error(`Expectation failed: options argument for non-appending mode is missing an offset.`); }
				return inbox.saveObjChunk(opts.msgId, opts.objId,
					fileHeader, opts.isFirstReq, opts.totalSize,
					opts.offset, opts.chunkLen, bytes);
			}
		};
	}
	
	function makeBlobGetter(fileHeader: boolean): IGetBytes {
		return async (userId: string, opts: BlobGetOpts) => {
			let inbox = await getInbox(userId);
			return inbox.getObj(opts.msgId, opts.objId, fileHeader,
				opts.offset, opts.maxLen);
		};
	}
	
	let recipients: Factory = {

		exists: async (userId: string) => {
			try {
				await getInbox(userId);
				return true;
			} catch (err) {
				if (err !==  SC.USER_UNKNOWN) { throw err; }
				return false;
			}
		},
	
		getPubKey: makeParamGetter(Inbox.getPubKey),
		setPubKey: makeParamSetter(Inbox.setPubKey),
		
		getAnonSenderInvites: makeParamGetter(
			Inbox.getAnonSenderInvites),
		setAnonSenderInvites: makeParamSetter(
			Inbox.setAnonSenderInvites),

	
		allowedMaxMsgSize: async (recipient: string,
				sender: string, invitation: string) => {
			let inbox = await getInbox(recipient);
			// XXX move these two functions into inbox
			if (sender) {
				return allowedMsgSizeForAuthSender(inbox, sender, invitation);
			} else {
				return allowedMsgSizeForAnonSender(inbox, invitation);
			}
		},
	
		setMsgStorage: async (recipient: string,
				msgMeta: deliveryApi.msgMeta.Request, authSender: string) => {
			let inbox = await getInbox(recipient);
			return inbox.recordMsgMeta(msgMeta, authSender);
		},
		
		saveObjSegments: makeBlobSaver(false),
		saveObjHeader: makeBlobSaver(true),
	
		finalizeDelivery: async (recipient: string, msgId: string) => {
			let inbox = await getInbox(recipient);
			return inbox.completeMsgDelivery(msgId);
		},
	
		getMsgIds: async (userId: string) => {
			let inbox = await getInbox(userId);
			return inbox.getMsgIds();
		},
	
		getMsgMeta: async (userId: string, msgId: string) => {
			let inbox = await getInbox(userId);
			return inbox.getMsgMeta(msgId);
		},
	
		deleteMsg: async (userId: string, msgId: string) => {
			let inbox = await getInbox(userId);
			return inbox.rmMsg(msgId);
		},
		
		getObjSegments: makeBlobGetter(false),
		getObjHeader: makeBlobGetter(true)
		
	};
	Object.freeze(recipients);
	
	return recipients;
}

Object.freeze(exports);