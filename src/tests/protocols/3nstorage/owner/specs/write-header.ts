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
import { objHeader as api, ERR_SC }
	from '../../../../../lib-common/service-api/3nstorage/owner';
import { beforeAllAsync, beforeEachAsync, itAsync }
	from '../../../../libs-for-tests/async-jasmine';
import { RequestOpts, doBinaryRequest }
	from '../../../../libs-for-tests/xhr-utils';
import { Obj, cancelTransaction, saveObj, startTransaction }
	from '../../../../libs-for-tests/3nstorage';
import { expectNonAcceptanceOfBadSessionId,
	expectNonAcceptanceOfBadType, expectNonAcceptanceOfLongBody }
	from '../../../../shared-checks/requests';
import { bytes as randomBytes } from '../../../../../lib-common/random-node';
import { resolve as resolveUrl } from 'url';
import { copy } from '../../../../libs-for-tests/json-copy';

export let specs: SpecDescribe[] = [];

let description = 'Request to save non-root object\'s header';

let obj: Obj = {
	objId: 'aaaa',
	version: 1,
	header: randomBytes(100),
	segs: randomBytes(573)
};

let reqOpts: RequestOpts;
let storageServer: StorageComponent;
let user: User;
let sessionId: string;
let transactionId: string;

async function setupWithNonDiffTransaction(
		setup: () => TestSetup): Promise<void> {
	storageServer = setup().storageServer;
	user = setup().user;
	await storageServer.restartAndClearStorageFor(user.id);
	sessionId = await startSession(user);
	transactionId = await startTransaction(user.storageOwnerUrl,
		sessionId, obj, true);
	reqOpts = {
		url: resolveUrl(user.storageOwnerUrl, api.putReqUrlEnd(
			obj.objId, transactionId)),
		method: 'PUT',
		sessionId
	};
}

let fuzzingSpec: SpecDescribe = { description };
specs.push(fuzzingSpec);
fuzzingSpec.definition = (setup: () => TestSetup) => (() => {
	
	beforeEachAsync(() => setupWithNonDiffTransaction(setup));

	itAsync('fails for unknown object', async () => {
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.putReqUrlEnd(
			'unknown-obj', transactionId));
		let rep = await doBinaryRequest<void>(opts, obj.header);
		expect(rep.status).toBe(api.SC.missing, 'status for unknown object');
	});

	itAsync('fails for incorrect transaction', async () => {
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.putReqUrlEnd(
			obj.objId, 'unknown-transaction'));
		let rep = await doBinaryRequest<void>(opts, obj.header);
		expect(rep.status).toBe(api.SC.missing, 'status for unknown transaction');
	});

	// XXX must transaction with error be closed by server?

	itAsync('will not accept different body size', async () => {
		let rep = await doBinaryRequest<void>(reqOpts, obj.header.subarray(1));
		expect(rep.status).toBe(ERR_SC.malformed, 'status for unexpected length');
		rep = await doBinaryRequest<void>(reqOpts,
			randomBytes(obj.header.length+1));
		expect(rep.status).toBe(ERR_SC.malformed, 'status for unexpected length');
		rep = await doBinaryRequest<void>(reqOpts, new Uint8Array(0));
		expect(rep.status).toBe(ERR_SC.malformed, 'status for writing empty byte array');
	});

	itAsync('will not accept bad type', async () => {
		await expectNonAcceptanceOfBadType(reqOpts, 'application/octet-stream', obj.header);
	});

	itAsync('will not work outside of a valid session', async () => {
		await expectNonAcceptanceOfBadSessionId(reqOpts);
	});

});

let specsForNonDiffTransaction: SpecDescribe = { 
	description: `${description}, in non-diff transaction,`
};
specs.push(specsForNonDiffTransaction);
specsForNonDiffTransaction.definition = (setup: () => TestSetup) => (() => {
	
	beforeAllAsync(() => setupWithNonDiffTransaction(setup));

	itAsync('writes first version of an object\'s header', async () => {
		let rep = await doBinaryRequest<void>(reqOpts, obj.header);
		expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of header bytes');
	});
		
});

let diffVer: Obj = {
	objId: obj.objId,
	version: obj.version + 1,
	header: randomBytes(111),
	segs: randomBytes(50),
	diff: {
		baseVersion: obj.version,
		segsSize: 200,
		sections: [
			[ 0, 25, 100 ],
			[ 1, 0, 50 ],
			[ 0, 125, 50 ] ]
	}
};

async function setupWithDiffTransaction(
		setup: () => TestSetup): Promise<void> {
	storageServer = setup().storageServer;
	user = setup().user;
	await storageServer.restartAndClearStorageFor(user.id);
	sessionId = await startSession(user);
	await saveObj(user.storageOwnerUrl, sessionId, obj.objId, obj, true);
	transactionId = await startTransaction(user.storageOwnerUrl,
		sessionId, diffVer, false);
	reqOpts = {
		url: resolveUrl(user.storageOwnerUrl, api.putReqUrlEnd(
			diffVer.objId, transactionId)),
		method: 'PUT',
		sessionId
	};
}

let specsForDiffTransaction: SpecDescribe = { 
	description: `${description}, in diff transaction,`
};
specs.push(specsForDiffTransaction);
specsForDiffTransaction.definition = (setup: () => TestSetup) => (() => {
	
	beforeAllAsync(() => setupWithDiffTransaction(setup));

	itAsync('writes object header of a new version', async () => {
		let rep = await doBinaryRequest<void>(reqOpts, diffVer.header);
		expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of header bytes');
	});

});

Object.freeze(exports);