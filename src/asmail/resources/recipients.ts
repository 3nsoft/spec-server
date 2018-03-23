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

/*
 * This module is recipient boxes factory.
 */

import * as fs from '../../lib-common/async-fs-node';
import { Readable } from 'stream';
import { Inbox, ObjReader, AuthSenderPolicy, SC, MailEventsSink }
	from './inbox';
import * as deliveryApi from '../../lib-common/service-api/asmail/delivery';
import * as configApi from '../../lib-common/service-api/asmail/config';
import * as retrievalApi from '../../lib-common/service-api/asmail/retrieval';

export { SC } from './inbox';

export const BIN_TYPE = 'application/octet-stream';

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
	const ind = address.indexOf('@');
	if (ind < 0) { return; }
	address = address.substring(ind+1);
	if (address.length === 0) { return; }
	v = lst['@'+address];
	if ('undefined' !== typeof v) { return v; }
	// check parent domains
	while (true) {
		const ind = address.indexOf('.');
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
	const bytesFree = await inbox.freeSpace();
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
	const policy = await inbox.getAnonSenderPolicy();
	if (!policy.accept) { return 0; }
	if (!invitation) {
		if (policy.acceptWithInvitesOnly) { return 0; }
		return await adaptToFreeSpaceLeft(inbox, policy.defaultMsgSize);
	} else {
		const invites = await inbox.getAnonSenderInvites();
		const sizeForInvite = invites[invitation];
		if (typeof sizeForInvite !== 'number') { return 0; }
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
	const results = await Promise.all<any>([
		inbox.getAuthSenderPolicy(),
		inbox.getAuthSenderWhitelist()])
	const policy: AuthSenderPolicy = results[0];
	const sizeFromWL = findMatchIn(<AddressToSizeMap> results[1], sender);
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
		const bList = await inbox.getAuthSenderBlacklist();
		if (typeof findMatchIn(bList, sender) === 'undefined') {
			return adaptToFreeSpaceLeft(inbox, policy.defaultMsgSize);
		} else {
			return 0;
		}
	}
	return adaptToFreeSpaceLeft(inbox, policy.defaultMsgSize);
}

/**
 * This checks existence of a given user, returning a promise, resolvable
 * either to true, when given user id is known, or to false, when it is not.
 */
export type UserExists = (userId: string) => Promise<boolean>;

/**
 * This tells what is an allowable maximum message size for a given recipient,
 * for a given sender and/or under a given invitation token.
 * Function returns a promise, resolvable to
 * (1) zero (0), if leaving mail is forbidden,
 * (2) greater than zero maximum message length, and
 * (3) -1 (less than zero), if mail cannot be accepted due to full mail
 *     box.
 */
export type AllowedMaxMsgSize = (recipient: string,
	sender: string|undefined, invitation: string|undefined) => Promise<number>;

/**
 * This allocates storage for a message returning a promise, resolvable to
 * (1) message id, when a folder for new message has been created,
 * (2) undefined, if recipient is unknown.
 */
export type SetMsgStorage = (recipient: string,
	msgMeta: deliveryApi.msgMeta.Request,
	authSender: string|undefined, invite: string|undefined,
	maxMsgLength: number) => Promise<string>;

/**
 * This saves object's bytes, returning a promise, resolvable when saving
 * is OK, otherwise, promise rejects with string error code from SC.
 */
export type SaveObj = (recipient: string, msgId: string, objId: string,
	fstReq: deliveryApi.PutObjFirstQueryOpts|undefined,
	sndReq: deliveryApi.PutObjSecondQueryOpts|undefined,
	bytesLen: number, bytes: Readable) => Promise<void>;

/**
 * This finalizes delivery of a message, returning a promise.
 * Rejected promise may have a string error code from SC.
 */
export type FinalizeDelivery = (recipient: string,
	msgId: string) => Promise<void>;

/**
 * This returns a promise, resolvable to array with ids of available messages.
 * Rejected promise may have a string error code from SC.
 */
export type GetMsgIds = (userId: string) =>
	Promise<retrievalApi.listMsgs.Reply>;

/**
 * This returns a promise, resolvable to message meta.
 * Rejected promise may have a string error code from SC.
 */
export type GetMsgMeta = (userId: string, msgId: string) =>
	Promise<retrievalApi.MsgMeta>;

/**
 * This deletes a message returning a promise, resolvable when message is
 * removed.
 * Rejected promise may have a string error code from SC.
 */
export type DeleteMsg = (userId: string, msgId: string) => Promise<void>;

/**
 * This returns parameter of a message that is still in delivery, identified
 * by given recipient and message id. If message is unknown, or if it has
 * already been delivered, error code is thrown.
 * Rejected promise may have a string error code from SC.
 */
export type IncompleteMsgDeliveryParams = (recipient: string, msgId: string) =>
	Promise<{ maxMsgLength: number; currentMsgLength: number; }>;

/**
 * This returns a promise, resolvable to readable stream of object bytes.
 * Rejected promise may be passing string error code from SC.
 */
export type GetObj = (userId: string, msgId: string, objId: string,
	header: boolean, segsOffset: number, segsLimit: number|undefined) =>
	Promise<ObjReader>;

type GetParam<T> = (userId: string) => Promise<T>;
type SetParam<T> = (userId: string, param: T) => Promise<boolean>;

export type GetPubKey = GetParam<configApi.p.initPubKey.Certs>;
export type SetPubKey = SetParam<configApi.p.initPubKey.Certs>;
export type GetAnonSenderInvites = GetParam<configApi.p.anonSenderInvites.List>;
export type SetAnonSenderInvites = SetParam<configApi.p.anonSenderInvites.List>;

export type EventsSink = MailEventsSink;

export interface Factory {
	exists: UserExists;
	allowedMaxMsgSize: AllowedMaxMsgSize;
	setMsgStorage: SetMsgStorage;
	saveObj: SaveObj;
	finalizeDelivery: FinalizeDelivery;
	getMsgIds: GetMsgIds;
	getMsgMeta: GetMsgMeta;
	deleteMsg: DeleteMsg;
	getObj: GetObj;
	incompleteMsgDeliveryParams: IncompleteMsgDeliveryParams;
	getPubKey: GetPubKey;
	setPubKey: SetPubKey;
	getAnonSenderInvites: GetAnonSenderInvites;
	setAnonSenderInvites: SetAnonSenderInvites;
	setMailEventsSink(sink: EventsSink): void;
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
	
	const boxes = new Map<string, Inbox>();

	let mailEventsSink: EventsSink|undefined = undefined;
	
	async function getInbox(userId: string): Promise<Inbox> {
		if (!mailEventsSink) { throw new Error(`Mail events sink is not set`); }
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
			inbox = await Inbox.make(rootFolder, userId, mailEventsSink,
				writeBufferSize, readBufferSize)
			boxes.set(userId, inbox);
			return inbox;
		}
	}
	
	function makeParamGetter<T>(staticGetter: (inbox: Inbox) => Promise<T>):
			(userId: string) => Promise<T> {
		return async (userId: string) => {
			const inbox = await getInbox(userId);
			return staticGetter(inbox);
		};	
	}
	
	function makeParamSetter<T>(staticSetter:
			(inbox: Inbox, param: T, setDefault: boolean) => Promise<boolean>):
			(userId: string, param: T, setDefault?: boolean) => Promise<boolean> {
		return async (userId: string, param: T, setDefault?: boolean) => {
			const inbox = await getInbox(userId);
			return staticSetter(inbox, param, !!setDefault);
		};		
	}
	
	const recipients: Factory = {

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
			const inbox = await getInbox(recipient);
			// XXX move these two functions into inbox
			if (sender) {
				return allowedMsgSizeForAuthSender(inbox, sender, invitation);
			} else {
				return allowedMsgSizeForAnonSender(inbox, invitation);
			}
		},
	
		setMsgStorage: async (recipient: string,
				msgMeta: deliveryApi.msgMeta.Request, authSender: string|undefined, invite: string|undefined, maxMsgLength: number) => {
			const inbox = await getInbox(recipient);
			return inbox.recordMsgMeta(msgMeta, authSender, invite, maxMsgLength);
		},
		
		saveObj: async (recipient: string, msgId: string, objId: string,
				fstReq: deliveryApi.PutObjFirstQueryOpts|undefined,
				sndReq: deliveryApi.PutObjSecondQueryOpts|undefined,
				bytesLen: number, bytes: Readable): Promise<void> => {
			const inbox = await getInbox(recipient);
			if (fstReq) {
				return inbox.startSavingObj(msgId, objId, bytes, bytesLen, fstReq);
			} else if (sndReq) {
				return inbox.continueSavingObj(msgId, objId, bytes, bytesLen, sndReq);
			} else {
				throw new Error(`Missing both request options`);
			}
		},
	
		finalizeDelivery: async (recipient: string, msgId: string) => {
			const inbox = await getInbox(recipient);
			return inbox.completeMsgDelivery(msgId);
		},
	
		getMsgIds: async (userId: string) => {
			const inbox = await getInbox(userId);
			return inbox.getMsgIds();
		},
	
		getMsgMeta: async (userId: string, msgId: string) => {
			const inbox = await getInbox(userId);
			return inbox.getMsgMeta(msgId, true);
		},
	
		deleteMsg: async (userId: string, msgId: string) => {
			const inbox = await getInbox(userId);
			return inbox.rmMsg(msgId);
		},

		incompleteMsgDeliveryParams: async (recipient: string, msgId: string) => {
			const inbox = await getInbox(recipient);
			return inbox.getIncompleteMsgParams(msgId);
		},
		
		getObj: async (userId: string, msgId: string, objId: string,
				header: boolean, segsOffset: number, segsLimit: number|undefined):
				Promise<ObjReader> => {
			const inbox = await getInbox(userId);
			return inbox.getObj(msgId, objId, header, segsOffset, segsLimit);
		},

		setMailEventsSink(sink: EventsSink): void {
			if (mailEventsSink) { throw new Error(`Mail events sink is already set`); }
			mailEventsSink = sink;
		}
		
	};
	Object.freeze(recipients);
	
	return recipients;
}

Object.freeze(exports);