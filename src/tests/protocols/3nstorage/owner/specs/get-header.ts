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
import { objHeader as api, HTTP_HEADER }
	from '../../../../../lib-common/service-api/3nstorage/owner';
import { beforeAllAsync, itAsync, fitAsync }
	from '../../../../libs-for-tests/async-jasmine';
import { RequestOpts, doBodylessRequest }
	from '../../../../libs-for-tests/xhr-utils';
import { Obj, saveObj }	from '../../../../libs-for-tests/3nstorage';
import { expectNonAcceptanceOfBadSessionId }
	from '../../../../shared-checks/requests';
import { bytes as randomBytes } from '../../../../../lib-common/random-node';
import { resolve as resolveUrl } from 'url';
import { copy } from '../../../../libs-for-tests/json-copy';
import { bytesEqual } from '../../../../libs-for-tests/bytes-equal';

export let specs: SpecDescribe[] = [];

let description = 'Request to get non-root object\'s header';

let reqOpts: RequestOpts
let storageServer: StorageComponent;
let user: User;
let sessionId: string;

let obj: Obj = {
	objId: 'aaaa',
	version: 3,
	header: randomBytes(100),
	segs: randomBytes(2456)
};

async function setupCommonObjVersion(setup: () => TestSetup): Promise<void> {
	storageServer = setup().storageServer;
	user = setup().user;
	await storageServer.restartAndClearStorageFor(user.id);
	sessionId = await startSession(user);
	await saveObj(user.storageOwnerUrl, sessionId,
		obj.objId, obj, true);
	reqOpts = {
		url: resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId)),
		method: 'GET',
		sessionId,
		responseType: 'arraybuffer',
		responseHeaders: [ HTTP_HEADER.objSegmentsLength, HTTP_HEADER.objVersion ]
	};
}

let fuzzingSpec: SpecDescribe = { description };
specs.push(fuzzingSpec);
fuzzingSpec.definition = (setup: () => TestSetup) => (() => {

	beforeAllAsync(() => setupCommonObjVersion(setup));

	itAsync('will not work outside of a valid session', async () => {
		let opts = copy(reqOpts);
		await expectNonAcceptanceOfBadSessionId(opts);
	});

	itAsync('fails when object does not exist', async () => {
		let unknownObj = 'unknown-obj';
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(unknownObj));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(api.SC.missing);
	});

	itAsync('fails when unknown version specified', async () => {
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, 1000));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(api.SC.missing);
	});

});

let specReadOfCommonObjectVersion: SpecDescribe = {
	description: `${description}, non-diff recorded version,`
};
specs.push(specReadOfCommonObjectVersion);
specReadOfCommonObjectVersion.definition = (setup: () => TestSetup) => (() => {

	beforeAllAsync(() => setupCommonObjVersion(setup));

	itAsync('returns current version, when version is not specified', async () => {
		expect(await storageServer.objExists(user.id, obj.objId, obj.version, obj)).toBe(true, 'object must be in serve\'s store');
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(api.SC.okGet);
		expect(parseInt(rep.headers!.get(HTTP_HEADER.objVersion)!)).toBe(obj.version, 'object version must be given in the reply header');
		expect(parseInt(rep.headers!.get(HTTP_HEADER.objSegmentsLength)!)).toBe(obj.segs.length, 'object segments size must be given in the reply header');
		expect(bytesEqual(rep.data, obj.header)).toBe(true, 'reply should have proper header bytes');
	});

	itAsync('returns specified version', async () => {
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, obj.version));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(api.SC.okGet);
		expect(rep.headers!.get(HTTP_HEADER.objVersion)).toBeFalsy('object version should not be present in the reply header');
		expect(parseInt(rep.headers!.get(HTTP_HEADER.objSegmentsLength)!)).toBe(obj.segs.length, 'object segments size must be given in the reply header');
		expect(bytesEqual(rep.data, obj.header)).toBe(true, 'reply should have proper header bytes');
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

let specReadOfDiffObjectVersion: SpecDescribe = {
	description: `${description}, diff recorded version,`
};
specs.push(specReadOfDiffObjectVersion);
specReadOfDiffObjectVersion.definition = (setup: () => TestSetup) => (() => {

	beforeAllAsync(async () => {
		await setupCommonObjVersion(setup);
		await saveObj(user.storageOwnerUrl, sessionId, diffVer.objId, diffVer, false);
	});

	itAsync('returns current version, when version is not specified', async () => {
		expect(await storageServer.objExists(user.id, diffVer.objId, diffVer.version, diffVer)).toBe(true, 'object must be in serve\'s store');
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(diffVer.objId));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(api.SC.okGet);
		expect(parseInt(rep.headers!.get(HTTP_HEADER.objVersion)!)).toBe(diffVer.version, 'object version must be given in the reply header');
		expect(parseInt(rep.headers!.get(HTTP_HEADER.objSegmentsLength)!)).toBe(diffVer.diff!.segsSize, 'object segments size must be given in the reply header');
		expect(bytesEqual(rep.data, diffVer.header)).toBe(true, 'reply should have proper header bytes');
	});

	itAsync('returns specified version', async () => {
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(diffVer.objId, diffVer.version));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(api.SC.okGet);
		expect(rep.headers!.get(HTTP_HEADER.objVersion)).toBeFalsy('object version should not be present in the reply header');
		expect(parseInt(rep.headers!.get(HTTP_HEADER.objSegmentsLength)!)).toBe(diffVer.diff!.segsSize, 'object segments size must be given in the reply header');
		expect(bytesEqual(rep.data, diffVer.header)).toBe(true, 'reply should have proper header bytes');
	});

});

Object.freeze(exports);