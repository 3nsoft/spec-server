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
import { utf8 } from '../../lib-common/buffer-utils';

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
 * @param user
 * @param objId is object's id. Null stands for root object.
 * @param ver
 * @param obj
 * @return a promise, resolvable object is writen.
 */
export async function saveObj(ownerUrl: string, sessionId: string,
		objId: string|null, ver: number, obj: Obj): Promise<void> {

	const header = obj.header.length;
	const segs = obj.segs.length;
	const diffBytes = (obj.diff ?
		utf8.pack(JSON.stringify(obj.diff)) : undefined);
	const diff = (diffBytes ? diffBytes.length : undefined);
	let opts: RequestOpts;
	if (objId) {
		opts = {
			url: resolveUrl(ownerUrl, api.currentObj.firstPutReqUrlEnd(objId,
				{ ver, diff, header, segs })),
			method: 'PUT',
			responseType: 'json',
			sessionId
		};
	} else {
		opts = {
			url: resolveUrl(ownerUrl, api.currentRootObj.firstPutReqUrlEnd(
				{ ver, diff, header, segs })),
			method: 'PUT',
			responseType: 'json',
			sessionId
		};
	}

	const bytes = [ obj.header, obj.segs ];
	if (diffBytes) {
		bytes.unshift(diffBytes);
	}
	const rep = await doBinaryRequest<api.currentObj.ReplyToPut>(opts, bytes);
	expect(rep.status).toBe((objId === null) ?
		api.currentRootObj.SC.okPut : api.currentRootObj.SC.okPut);

}

export async function removeObj(ownerUrl: string, sessionId: string,
		objId: string): Promise<void> {
	const opts: RequestOpts = {
		url: resolveUrl(ownerUrl, api.currentObj.getReqUrlEnd(objId)),
		method: 'DELETE',
		sessionId
	};
	const rep = await doBodylessRequest(opts);
	expect(rep.status).toBe(api.currentObj.SC.okDelete);
}

Object.freeze(exports);