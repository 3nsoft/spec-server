/*
 Copyright (C) 2016 3NSoft Inc.
 
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

import { RequestOpts, doBodylessRequest, doBinaryRequest, doJsonRequest }
	from '../libs-for-tests/xhr-utils';
import { resolve as resolveUrl } from 'url';
import * as api from '../../lib-common/service-api/3nstorage/owner';

export async function get3NStorageServiceUrl(storageUrl: string,
		service: 'owner'|'shared'): Promise<string> {
	let reqOpts: RequestOpts= {
		url: storageUrl,
		method: 'GET',
		responseType: 'json'
	};
	let rep = await doBodylessRequest<any>(reqOpts);
	expect(rep.status).toBe(200);
	let serviceUrl: string = rep.data[service];
	expect(typeof serviceUrl).toBe('string');
	return resolveUrl(storageUrl, serviceUrl);
}

export interface BaseObj {
	objId: string,
	header: Uint8Array,
	segs: Uint8Array,
}

export interface Obj extends BaseObj {
	version: number,
	diff?: api.DiffInfo
}

export async function startTransaction(ownerUrl: string, sessionId: string,
		obj: Obj, isNew: boolean, appendingTrans = false): Promise<string> {
	let url = resolveUrl(ownerUrl, ((obj.objId === null) ?
		api.startRootTransaction.URL_END :
		api.startTransaction.getReqUrlEnd(obj.objId)));
	let reqOpts: RequestOpts = {
		url,
		method: 'POST',
		responseType: 'json',
		sessionId
	};
	let transParams: api.startTransaction.Request = {
		version: obj.version,
		sizes: {
			header: obj.header.length,
			segments: (appendingTrans ? -1 : obj.segs.length)
		}
	};
	if (isNew) {
		transParams.isNewObj = true;
	}
	if (obj.diff) {
		if (appendingTrans) { throw new Error('Diff transaction cannot be appending'); }
		transParams.diff = obj.diff;
	}
	let rep = await doJsonRequest<api.startTransaction.Reply>(
		reqOpts, transParams);
	expect(rep.status).toBe((obj.objId === null) ?
		api.startRootTransaction.SC.ok :
		api.startTransaction.SC.ok);
	return rep.data.transactionId;
}

export async function cancelTransaction(ownerUrl: string, sessionId: string,
		objId: string, transactionId: string): Promise<void> {
	let url = resolveUrl(ownerUrl, ((objId === null) ?
		api.cancelRootTransaction.getReqUrlEnd(transactionId) :
		api.cancelTransaction.getReqUrlEnd(objId, transactionId)));
	let reqOpts: RequestOpts = {
		url,
		method: 'POST',
		sessionId
	};
	let rep = await doBodylessRequest<void>(reqOpts);
	expect(rep.status).toBe((objId === null) ?
		api.cancelRootTransaction.SC.ok :
		api.cancelTransaction.SC.ok);
}

export async function getSessionParams(ownerUrl: string, sessionId: string):
		Promise<api.sessionParams.Reply> {
	let reqOpts: RequestOpts = {
		url: resolveUrl(ownerUrl, api.sessionParams.URL_END),
		method: 'GET',
		responseType: 'json',
		sessionId
	};
	let rep = await doBodylessRequest<api.sessionParams.Reply>(reqOpts);
	expect(rep.status).toBe(200);
	return rep.data;
}

/**
 * @param sessionId
 * @param transactionId
 * @param objId is object's id. Null stands for root object.
 * @param obj
 */
export async function writeObjBytes(ownerUrl: string, sessionId: string,
		transactionId: string, objId: string|null, obj: Obj): Promise<void> {
		let reqOpts: RequestOpts = {
			url: resolveUrl(ownerUrl, ((objId === null) ?
				api.rootHeader.putReqUrlEnd(transactionId) :
				api.objHeader.putReqUrlEnd(objId, transactionId))),
			method: 'PUT',
			sessionId
		};
		
		let rep = await doBinaryRequest<void>(reqOpts, obj.header);
		expect(rep.status).toBe((objId === null) ?
			api.rootHeader.SC.okPut : api.objHeader.SC.okPut);
	
		let params = {
			trans: transactionId,
			ofs: 0
		};
		reqOpts = {
			url: resolveUrl(ownerUrl, ((objId === null) ?
				api.rootSegs.putReqUrlEnd(params) :
				api.objSegs.putReqUrlEnd(objId, params))),
			method: 'PUT',
			sessionId
		};

		rep = await doBinaryRequest<void>(reqOpts, obj.segs);
		expect(rep.status).toBe((objId === null) ?
			api.rootSegs.SC.okPut : api.objSegs.SC.okPut);
}

/**
 * @param user
 * @param objId is object's id. Null stands for root object.
 * @param obj
 * @param isNewObj
 * @return a promise, resolvable object is writen.
 */
export async function saveObj(ownerUrl: string,
		sessionId: string, objId: string|null, obj: Obj, isNewObj: boolean): Promise<void> {
	let sessParam = await getSessionParams(ownerUrl, sessionId);
	let transactionId = await startTransaction(ownerUrl, sessionId,
		obj, isNewObj);
	await writeObjBytes(ownerUrl, sessionId, transactionId, objId, obj);
	let reqOpts: RequestOpts = {
		url: resolveUrl(ownerUrl, ((objId === null) ?
			api.finalizeRootTransaction.getReqUrlEnd(transactionId) :
			api.finalizeTransaction.getReqUrlEnd(objId, transactionId))),
		method: 'POST',
		sessionId: sessionId
	};
	let rep = await doBodylessRequest<void>(reqOpts);
	expect(rep.status).toBe((objId === null) ?
		api.finalizeRootTransaction.SC.ok :
		api.finalizeTransaction.SC.ok);
}

Object.freeze(exports);