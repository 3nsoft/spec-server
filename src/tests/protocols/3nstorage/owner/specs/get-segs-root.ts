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

import { startSession, SpecDescribe, TestSetup, User, StorageComponent }
	from '../test-utils';
import { rootSegs as api, HTTP_HEADER, ERR_SC }
	from '../../../../../lib-common/service-api/3nstorage/owner';
import { beforeAllAsync, itAsync, xitAsync }
	from '../../../../libs-for-tests/async-jasmine';
import { RequestOpts, doBodylessRequest, Reply }
	from '../../../../libs-for-tests/xhr-utils';
import { Obj, saveObj }	from '../../../../libs-for-tests/3nstorage';
import { expectNonAcceptanceOfBadSessionId }
	from '../../../../shared-checks/requests';
import { bytes as randomBytes } from '../../../../../lib-common/random-node';
import { resolve as resolveUrl } from 'url';
import { copy } from '../../../../libs-for-tests/json-copy';
import { bytesEqual } from '../../../../libs-for-tests/bytes-equal';

export let specs: SpecDescribe[] = [];

let description = 'Request to get root object segments';

let obj: Obj = {
	objId: (null as any),
	version: 3,
	header: randomBytes(100),
	segs: randomBytes(2345)
};
	
let reqOpts: RequestOpts
let storageServer: StorageComponent;
let user: User;
let sessionId: string;

async function setStage(setup: () => TestSetup): Promise<void> {
	storageServer = setup().storageServer;
	user = setup().user;
	await storageServer.restartAndClearStorageFor(user.id);
	sessionId = await startSession(user);
	await saveObj(user.storageOwnerUrl, sessionId, obj.objId, obj, true);
	reqOpts = {
		url: resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.version)),
		method: 'GET',
		sessionId,
		responseType: 'arraybuffer',
		responseHeaders: [ HTTP_HEADER.objSegmentsLength, HTTP_HEADER.objVersion ]
	};
}

function checkReplyExpectation(rep: Reply<Uint8Array>, obj: Obj,
		expectedBytes: Uint8Array): void {
	expect(rep.status).toBe(api.SC.okGet, 'status for returned bytes');
	let segsLen = (obj.diff ? obj.diff.segsSize : obj.segs.length);
	expect(parseInt(rep.headers!.get(HTTP_HEADER.objSegmentsLength)!)).toBe(segsLen, 'object segments size must be given in the reply header');
	expect(bytesEqual(rep.data, expectedBytes)).toBe(true, 'reply should have proper segments bytes');
}

let readSimpleObjVersion: SpecDescribe = { description };
specs.push(readSimpleObjVersion);
readSimpleObjVersion.definition = (setup: () => TestSetup) => (() => {
	
	beforeAllAsync(() => setStage(setup));

	itAsync('will not work outside of a valid session', async () => {
		let opts = copy(reqOpts);
		await expectNonAcceptanceOfBadSessionId(opts);
	});

	itAsync('will not accept bad parameters', async () => {
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.version, { ofs: -34 }));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(ERR_SC.malformed);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.version, { len: -34 }));
		rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(ERR_SC.malformed);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.version, { ofs: 10, len: 0 }));
		rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(ERR_SC.malformed);
	});

	itAsync('fails when unknown version specified', async () => {
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(1000));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(api.SC.missing);
	});

	itAsync('returns all segments', async () => {
		expect(await storageServer.rootObjExists(user.id, obj.version, obj)).toBe(true, 'object must be in serve\'s store');
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.version));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj, obj.segs);
	});

	itAsync('returns chunk, when offset and length are given', async () => {
		let opts = copy(reqOpts);
		// with non-overflowing length
		for (let offset=0; offset <= obj.segs.length; offset+=512) {
			let chunkLen = Math.min(512, obj.segs.length - offset);
			opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.version, { ofs: offset, len: chunkLen }));
			let rep = await doBodylessRequest<Uint8Array>(opts);
			checkReplyExpectation(rep, obj, obj.segs.subarray(offset, offset+chunkLen));
		}
		// with overflowing length
		let offset = obj.segs.length - 100;
		let requestedLen = 300
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.version, { ofs: offset, len: requestedLen }));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj, obj.segs.subarray(offset));
	});

	itAsync('reads segments from start, when offset is not given', async () => {
		let opts = copy(reqOpts);
		// with non-overflowing length
		let chunkLen = 512;
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.version, { len: chunkLen }));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj, obj.segs.subarray(0, chunkLen));
		// with overflowing length
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.version, { len: obj.segs.length+300 }));
		rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj, obj.segs);
	});

	itAsync('reads segments to the end, when length is not given', async () => {
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.version, { ofs: 1234 }));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj, obj.segs.subarray(1234));
	});

	itAsync('no-bytes read', async () => {
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.version, { ofs: obj.segs.length, len: 500 }));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj, new Uint8Array(0));
	});

});

let diffVer: Obj = {
	objId: obj.objId,
	version: obj.version + 2,
	header: randomBytes(111),
	segs: randomBytes(1000),
	diff: {
		baseVersion: obj.version,
		segsSize: 2000,
		sections: [
			[ 0, 25, 500 ],
			[ 1, 0, 300 ],
			[ 0, 525, 500 ],
			[ 1, 300, 700 ] ]
	}
};

function combineDiffSegs(baseSegs: Uint8Array, diffObj: Obj): Uint8Array {
	if (!diffObj.diff) { throw new Error(`object has no diff`); }
	let combined = new Buffer(diffObj.diff.segsSize);
	let offset = 0;
	for (let s of diffObj.diff.sections) {
		let src = ((s[0] === 0) ? baseSegs : diffObj.segs);
		let chunk = src.subarray(s[1], s[1]+s[2]);
		if (chunk.length !== s[2]) { throw new Error(
			'Given DiffInfo incorrectly references chunks of segments'); }
		combined.set(chunk, offset);
		offset += s[2];
	}
	if (offset !== diffObj.diff.segsSize) { throw new Error(
		'Given DiffInfo states incorrect segments length'); }
	return combined;
}

let accessDiffedObjVersion: SpecDescribe = {
	description: `${description}, access to version, saved as a diff, is the same, as to version saved as a whole`
};
specs.push(accessDiffedObjVersion);
accessDiffedObjVersion.definition = (setup: () => TestSetup) => (() => {

	beforeAllAsync(async () => {
		await setStage(setup);
		await saveObj(user.storageOwnerUrl, sessionId, diffVer.objId, diffVer, false);
		reqOpts = {
			url: resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(diffVer.version)),
			method: 'GET',
			sessionId,
			responseType: 'arraybuffer',
			responseHeaders: [ HTTP_HEADER.objSegmentsLength, HTTP_HEADER.objVersion ]
		};
	});


	itAsync('returns all segments', async () => {
		expect(await storageServer.rootObjExists(user.id, diffVer.version, diffVer)).toBe(true, 'object must be in serve\'s store');
		let opts = copy(reqOpts);
		let combinedBytes = combineDiffSegs(obj.segs, diffVer);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(diffVer.version));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, diffVer, combinedBytes);
	});

	itAsync('returns chunk, when offset and length are given', async () => {
		let opts = copy(reqOpts);
		let combinedBytes = combineDiffSegs(obj.segs, diffVer);
		// with non-overflowing length
		for (let offset=0; offset <= diffVer.diff!.segsSize; offset+=512) {
			let chunkLen = Math.min(512, diffVer.diff!.segsSize - offset);
			opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(diffVer.version, { ofs: offset, len: chunkLen }));
			let rep = await doBodylessRequest<Uint8Array>(opts);
			checkReplyExpectation(rep, diffVer, combinedBytes.subarray(offset, offset+chunkLen));
		}
		// with overflowing length
		let offset = combinedBytes.length - 100;
		let requestedLen = 300
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(diffVer.version, { ofs: offset, len: requestedLen }));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, diffVer, combinedBytes.subarray(offset));
	});

});

Object.freeze(exports);