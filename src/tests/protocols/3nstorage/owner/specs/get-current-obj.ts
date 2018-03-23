/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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
import { HTTP_HEADER, ERR_SC, currentObj as api }
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

export const specs: SpecDescribe[] = [];

const description = 'Request to get current non-root object';

const obj: Obj = {
	objId: 'aaaa',
	version: 1,
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
	await saveObj(user.storageOwnerUrl, sessionId, obj.objId, 1, obj);
	reqOpts = {
		url: resolveUrl(
			user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, { header: true })),
		method: 'GET',
		sessionId,
		responseType: 'arraybuffer',
		responseHeaders: [
			HTTP_HEADER.objSegmentsLength, HTTP_HEADER.objVersion,
			HTTP_HEADER.objHeaderLength ]
	};
}

function checkReplyExpectation(rep: Reply<Uint8Array>, obj: Obj,
		headerPresent: boolean, expectedSegsBytes: Uint8Array): void {
	// status
	expect(rep.status).toBe(api.SC.okGet, 'status for returned bytes');

	// version header
	expect(parseInt(rep.headers!.get(HTTP_HEADER.objVersion)!)).toBe(obj.version, 'object version must be given in the reply header');

	// object's header length http header
	const headerLen = obj.header.length;
	if (headerPresent) {
		expect(parseInt(rep.headers!.get(HTTP_HEADER.objHeaderLength)!)).toBe(headerLen, 'object header size must be given in the reply header');
	}

	// segments length header
	const segsLen = (obj.diff ? obj.diff.segsSize : obj.segs.length);
	expect(parseInt(rep.headers!.get(HTTP_HEADER.objSegmentsLength)!)).toBe(segsLen, 'object segments size must be given in the reply header');

	// check body
	if (headerPresent) {
		expect(bytesEqual(rep.data.subarray(0, headerLen), obj.header)).toBe(true, 'reply should have header bytes at the front');
		expect(bytesEqual(rep.data.subarray(headerLen), expectedSegsBytes)).toBe(true, 'reply should have proper segments bytes, following header bytes');
	} else {
		expect(bytesEqual(rep.data, expectedSegsBytes)).toBe(true, 'reply should have proper segments bytes');
	}
}

const readSimpleObjVersion: SpecDescribe = { description };
specs.push(readSimpleObjVersion);
readSimpleObjVersion.definition = (setup: () => TestSetup) => (() => {
	
	beforeAllAsync(() => setStage(setup));

	itAsync('will not work outside of a valid session', async () => {
		const opts = copy(reqOpts);
		await expectNonAcceptanceOfBadSessionId(opts);
	});

	itAsync('fails when object does not exist', async () => {
		const unknownObj = 'unknown-obj';
		const opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(unknownObj, { ofs: 0 }));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(api.SC.unknownObj);
	});

	itAsync('will not accept bad parameters', async () => {
		const opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, { ofs: -34 }));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(ERR_SC.malformed);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, { limit: -34 }));
		rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(ERR_SC.malformed);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, { ofs: 10, limit: 0 }));
		rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(ERR_SC.malformed);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, { header: true, ofs: 10 }));
		rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(ERR_SC.malformed);
	});

	itAsync('returns header and all segments', async () => {
		expect(await storageServer.currentObjExists(user.id, obj.objId, obj.version, obj)).toBe(true, 'object must be in serve\'s store');
		const opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, { header: true }));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj, true, obj.segs);
	});

	itAsync('returns header without segments', async () => {
		expect(await storageServer.currentObjExists(user.id, obj.objId, obj.version, obj)).toBe(true, 'object must be in serve\'s store');
		const opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, { header: true, limit: 0 }));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj, true, new Uint8Array(0));
	});

	itAsync('returns all segments without header', async () => {
		expect(await storageServer.currentObjExists(user.id, obj.objId, obj.version, obj)).toBe(true, 'object must be in serve\'s store');
		const opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj, false, obj.segs);
	});

	itAsync('returns chunk, when offset and limit are given', async () => {
		const opts = copy(reqOpts);
		// with non-overflowing limit
		for (let offset=0; offset<=obj.segs.length; offset+=512) {
			const chunkLen = Math.min(512, obj.segs.length - offset);
			opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, { ofs: offset, limit: chunkLen }));
			const rep = await doBodylessRequest<Uint8Array>(opts);
			checkReplyExpectation(rep, obj, false, obj.segs.subarray(offset, offset+chunkLen));
		}
		// with overflowing limit
		const offset = obj.segs.length - 100;
		const requestedLen = 300
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, { ofs: offset, limit: requestedLen }));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj, false, obj.segs.subarray(offset));
	});

	itAsync('reads segments from start, when offset is not given', async () => {
		const opts = copy(reqOpts);
		// with non-overflowing length
		const chunkLen = 512;
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, { limit: chunkLen }));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj, false, obj.segs.subarray(0, chunkLen));
		// with overflowing length
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, { limit: obj.segs.length+300 }));
		rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj, false, obj.segs);
	});

	itAsync('reads segments to the end, when limit is not given', async () => {
		const opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, { ofs: 1234 }));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj, false, obj.segs.subarray(1234));
	});

	itAsync('no-bytes read', async () => {
		const opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, { ofs: obj.segs.length, limit: 500 }));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj, false, new Uint8Array(0));
	});

});

const diffVer: Obj = {
	objId: obj.objId,
	version: obj.version + 1,
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
	const combined = new Buffer(diffObj.diff.segsSize);
	let offset = 0;
	for (const s of diffObj.diff.sections) {
		const src = ((s[0] === 0) ? baseSegs : diffObj.segs);
		const chunk = src.subarray(s[1], s[1]+s[2]);
		if (chunk.length !== s[2]) { throw new Error(
			'Given DiffInfo incorrectly references chunks of segments'); }
		combined.set(chunk, offset);
		offset += s[2];
	}
	if (offset !== diffObj.diff.segsSize) { throw new Error(
		'Given DiffInfo states incorrect segments length'); }
	return combined;
}

const accessDiffedObjVersion: SpecDescribe = {
	description: `${description}, access to version, saved as a diff, is the same, as to version saved as a whole`
};
specs.push(accessDiffedObjVersion);
accessDiffedObjVersion.definition = (setup: () => TestSetup) => (() => {

	beforeAllAsync(async () => {
		await setStage(setup);
		await saveObj(user.storageOwnerUrl, sessionId, diffVer.objId, diffVer.version, diffVer);
		reqOpts = {
			url: resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(diffVer.objId, { header: true })),
			method: 'GET',
			sessionId,
			responseType: 'arraybuffer',
			responseHeaders: [
				HTTP_HEADER.objSegmentsLength, HTTP_HEADER.objVersion,
				HTTP_HEADER.objHeaderLength ]
		};
	});

	itAsync('returns header and all segments', async () => {
		expect(await storageServer.currentObjExists(user.id, diffVer.objId, diffVer.version, diffVer)).toBe(true, `object must be in serve's store`);
		const opts = copy(reqOpts);
		const combinedBytes = combineDiffSegs(obj.segs, diffVer);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(diffVer.objId, { header: true }));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, diffVer, true, combinedBytes);
	});

	itAsync('returns header without segments', async () => {
		expect(await storageServer.currentObjExists(user.id, diffVer.objId, diffVer.version, diffVer)).toBe(true, `object must be in serve's store`);
		const opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(diffVer.objId, { header: true, limit: 0 }));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, diffVer, true, new Uint8Array(0));
	});

	itAsync('returns all segments without header', async () => {
		expect(await storageServer.currentObjExists(user.id, diffVer.objId, diffVer.version, diffVer)).toBe(true, `object must be in serve's store`);
		const opts = copy(reqOpts);
		const combinedBytes = combineDiffSegs(obj.segs, diffVer);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(diffVer.objId));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, diffVer, false, combinedBytes);
	});

	itAsync('returns chunk, when offset and limit are given', async () => {
		const opts = copy(reqOpts);
		const combinedBytes = combineDiffSegs(obj.segs, diffVer);
		// with non-overflowing length
		for (let offset=0; offset<=diffVer.diff!.segsSize; offset+=512) {
			const chunkLen = Math.min(512, diffVer.diff!.segsSize - offset);
			opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(diffVer.objId, { ofs: offset, limit: chunkLen }));
			const rep = await doBodylessRequest<Uint8Array>(opts);
			checkReplyExpectation(rep, diffVer, false, combinedBytes.subarray(offset, offset+chunkLen));
		}
		// with overflowing length
		const offset = combinedBytes.length - 100;
		const requestedLen = 300
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(diffVer.objId, { ofs: offset, limit: requestedLen }));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, diffVer, false, combinedBytes.subarray(offset));
	});

});

Object.freeze(exports);