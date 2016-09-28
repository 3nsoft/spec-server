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
import { objSegs as api, ERR_SC }
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

let description = 'Request to save non-root object\'s segments';

let obj: Obj = {
	objId: 'aaaa',
	version: 1,
	header: randomBytes(100),
	segs: randomBytes(2345)
};

let reqOpts: RequestOpts;
let storageServer: StorageComponent;
let user: User;
let sessionId: string;
let transactionId: string;

async function setupWithNonDiffNonAppendingTransaction(
		setup: () => TestSetup): Promise<void> {
	storageServer = setup().storageServer;
	user = setup().user;
	await storageServer.restartAndClearStorageFor(user.id);
	sessionId = await startSession(user);
	transactionId = await startTransaction(user.storageOwnerUrl,
		sessionId, obj, true);
	reqOpts = {
		url: resolveUrl(user.storageOwnerUrl, api.putReqUrlEnd(
			obj.objId, { trans: transactionId, ofs: 0 })),
		method: 'PUT',
		sessionId
	};
}

let fuzzingSpec: SpecDescribe = { description };
specs.push(fuzzingSpec);
fuzzingSpec.definition = (setup: () => TestSetup) => (() => {
	
	beforeEachAsync(() => setupWithNonDiffNonAppendingTransaction(setup));

	itAsync('fails for unknown object', async () => {
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.putReqUrlEnd(
			'unknown-obj', { trans: transactionId, ofs: 0 }));
		let rep = await doBinaryRequest<void>(opts, obj.segs);
		expect(rep.status).toBe(api.SC.missing, 'status for unknown object');
	});

	itAsync('fails for incorrect transaction', async () => {
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.putReqUrlEnd(
			obj.objId, { trans: 'unknown-transaction', ofs: 0 }));
		let rep = await doBinaryRequest<void>(opts, obj.segs);
		expect(rep.status).toBe(api.SC.missing, 'status for unknown transaction');
	});

	// XXX must transaction with error be closed by server?

	// XXX try bad parameter combinations (offset, length, appending)

	itAsync('will not accept bad type', async () => {
		await expectNonAcceptanceOfBadType(reqOpts, 'application/octet-stream', obj.segs);
	});

	itAsync('will not work outside of a valid session', async () => {
		await expectNonAcceptanceOfBadSessionId(reqOpts);
	});

});

let specsForNonDiffTransaction: SpecDescribe = {
	description: `${description}, inside non-diff, non-appending transaction,`
};
specs.push(specsForNonDiffTransaction);
specsForNonDiffTransaction.definition = (setup: () => TestSetup) => (() => {
	
	beforeEachAsync(() => setupWithNonDiffNonAppendingTransaction(setup));

	itAsync('writes object\'s segments with one request', async () => {
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.putReqUrlEnd(
			obj.objId, { trans: transactionId, ofs: 0 }));
		let rep = await doBinaryRequest<void>(opts, obj.segs);
		expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
	});

	itAsync('writes object\'s segments in several requests', async () => {
		let opts = copy(reqOpts);
		for (let offset=0; offset < obj.segs.length; offset+=512) {
			opts.url = resolveUrl(user.storageOwnerUrl, api.putReqUrlEnd(
				obj.objId, { trans: transactionId, ofs: offset }));
			let chunk = obj.segs.subarray(offset, offset+512);
			let rep = await doBinaryRequest<void>(opts, chunk);
			expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
		}
	});
		
});

let diffVer: Obj = {
	objId: obj.objId,
	version: obj.version + 1,
	header: randomBytes(111),
	segs: randomBytes(1000),
	diff: {
		baseVersion: 1,
		segsSize: 1200,
		sections: [
			[ 0, 25, 100 ],
			[ 1, 0, 300 ],
			[ 0, 125, 100 ],
			[ 1, 300, 700 ] ]
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
			diffVer.objId, { trans: transactionId })),
		method: 'PUT',
		sessionId
	};
}

let specsForDiffTransaction: SpecDescribe = {
	description: `${description}, inside diff transaction,`
};
specs.push(specsForDiffTransaction);
specsForDiffTransaction.definition = (setup: () => TestSetup) => (() => {
	
	beforeEachAsync(() => setupWithDiffTransaction(setup));

	itAsync('writes object\'s segments with one request', async () => {
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.putReqUrlEnd(
			diffVer.objId, { trans: transactionId, ofs: 0 }));
		let rep = await doBinaryRequest<void>(opts, diffVer.segs);
		expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
	});

	itAsync('writes object\'s segments in several requests', async () => {
		let opts = copy(reqOpts);
		for (let offset=0; offset < diffVer.segs.length; offset+=512) {
			opts.url = resolveUrl(user.storageOwnerUrl, api.putReqUrlEnd(
				diffVer.objId, { trans: transactionId, ofs: offset }));
			let chunk = diffVer.segs.subarray(offset, offset+512);
			let rep = await doBinaryRequest<void>(opts, chunk);
			expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
		}
	});
		
});

// XXX add appending transaction

Object.freeze(exports);