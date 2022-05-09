/*
 Copyright (C) 2016, 2019 3NSoft Inc.
 
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

import { RequestOpts, doBodylessRequest, doBinaryRequest } from './xhr-utils';
import { resolve as resolveUrl } from 'url';
import * as api from '../../lib-common/service-api/3nstorage/owner';
import { utf8 } from '../../lib-common/buffer-utils';
import { assert } from './assert';

export async function get3NStorageServiceUrl(
	storageUrl: string, service: 'owner'|'shared'
): Promise<string> {
	let reqOpts: RequestOpts= {
		url: storageUrl,
		method: 'GET',
		responseType: 'json'
	};
	let rep = await doBodylessRequest<any>(reqOpts);
	assert(rep.status === 200);
	let serviceUrl: string = rep.data[service];
	assert(typeof serviceUrl === 'string');
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
	assert(rep.status === api.cancelTransaction.SC.ok, `Obj transaction isn't canceled: server status ${rep.status} instead of expected ${api.cancelTransaction.SC.ok}`);
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
	assert(rep.status === 200);
	return rep.data;
}

/**
 * @param user
 * @param objId is object's id. Null stands for root object.
 * @param ver
 * @param obj
 * @return a promise, resolvable object is writen.
 */
export async function saveObj(
	ownerUrl: string, sessionId: string,
	newObj: boolean, objId: string|null, ver: number, obj: Obj
): Promise<void> {

	const header = obj.header.length;
	const diffBytes = (obj.diff ?
		utf8.pack(JSON.stringify(obj.diff)) : undefined);
	const diff = (diffBytes ? diffBytes.length : undefined);
	const opts: RequestOpts = {
		method: 'PUT',
		responseType: 'json',
		sessionId
	};
	if (diffBytes) {
		const urlEnd = (objId ?
			api.currentObj.firstPutReqUrlEnd(objId, { ver, diff, header }) :
			api.currentRootObj.firstPutReqUrlEnd({ ver, diff, header }));
		opts.url = resolveUrl(ownerUrl, urlEnd);
		const rep = await doBinaryRequest<api.currentObj.ReplyToPut>(
			opts, [ diffBytes, obj.header ]);
		assert(rep.status === api.currentObj.SC.okPut, `Obj header isn't saved: server status ${rep.status} instead of expected ${api.currentObj.SC.okPut}`);
		const trans = rep.data.transactionId!;
		let ofs = 0;
		for (const [ isNew, dOfs, len ] of obj.diff!.sections) {
			const last = ((dOfs+len) === obj.segs.length);
			if (isNew === 1) {
				const urlEnd = (objId ?
					api.currentObj.secondPutReqUrlEnd(objId, { ofs, trans, last }) :
					api.currentRootObj.secondPutReqUrlEnd({ ofs, trans, last }));
				opts.url = resolveUrl(ownerUrl, urlEnd);
				const rep = await doBinaryRequest<api.currentObj.ReplyToPut>(
					opts, obj.segs.subarray(dOfs, dOfs+len));
				assert(rep.status === api.currentObj.SC.okPut, `Obj segments sections isn't saved: server status ${rep.status} instead of expected ${api.currentObj.SC.okPut}`);
			}
			ofs += len;
		}
	} else {
		const urlOpts: api.PutObjFirstQueryOpts = { ver, header, last: true };
		if (newObj) {
			urlOpts.create = true;
		}
		const urlEnd = (objId ?
			api.currentObj.firstPutReqUrlEnd(objId, urlOpts) :
			api.currentRootObj.firstPutReqUrlEnd(urlOpts));
		opts.url = resolveUrl(ownerUrl, urlEnd);
		const rep = await doBinaryRequest<api.currentObj.ReplyToPut>(
			opts, [ obj.header, obj.segs ]);
		assert(rep.status === api.currentObj.SC.okPut, `Complete obj isn't saved: server status ${rep.status} instead of expected ${api.currentObj.SC.okPut}`);
	}
}

export async function removeObj(ownerUrl: string, sessionId: string,
		objId: string): Promise<void> {
	const opts: RequestOpts = {
		url: resolveUrl(ownerUrl, api.currentObj.getReqUrlEnd(objId)),
		method: 'DELETE',
		sessionId
	};
	const rep = await doBodylessRequest(opts);
	assert(rep.status === api.currentObj.SC.okDelete, `Obj isn't removed: server status ${rep.status} instead of expected ${api.currentObj.SC.okDelete}`);
}

Object.freeze(exports);