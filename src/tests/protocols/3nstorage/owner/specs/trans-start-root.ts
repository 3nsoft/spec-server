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
import { startRootTransaction as api, ERR_SC }
	from '../../../../../lib-common/service-api/3nstorage/owner';
import { beforeAllAsync, beforeEachAsync, itAsync, xitAsync, fitAsync }
	from '../../../../libs-for-tests/async-jasmine';
import { RequestOpts, doJsonRequest }
	from '../../../../libs-for-tests/xhr-utils';
import { Obj, cancelTransaction, saveObj }	from '../../../../libs-for-tests/3nstorage';
import { expectNonAcceptanceOfBadSessionId,
	expectNonAcceptanceOfBadJsonRequest }
	from '../../../../shared-checks/requests';
import { bytes as randomBytes } from '../../../../../lib-common/random-node';
import { resolve as resolveUrl } from 'url';

export let specs: SpecDescribe[] = [];

let description = 'Request to start root object transaction';

let reqOpts: RequestOpts
let storageServer: StorageComponent;
let user: User;
let sessionId: string;

let obj: Obj = {
	objId: (null as any),
	version: 1,
	header: randomBytes(100),
	segs: randomBytes(573)
};

async function setStage(setup: () => TestSetup): Promise<void> {
	storageServer = setup().storageServer;
	user = setup().user;
	await storageServer.restartAndClearStorageFor(user.id);
	sessionId = await startSession(user);
	reqOpts = {
		url: resolveUrl(user.storageOwnerUrl, api.URL_END),
		method: 'POST',
		responseType: 'json',
		sessionId: await startSession(user)
	};
}

let fuzzingSpec: SpecDescribe = { description };
specs.push(fuzzingSpec);
fuzzingSpec.definition = (setup: () => TestSetup) => (() => {
	
	beforeAllAsync(() => setStage(setup));

	itAsync('will not accept invalid inputs', async () => {
		const REQ_SIZE_LIMIT = 1024;
		let badJSONs: any[] = [ 1, null, undefined, 'string', [ 1, 2 ], [],
			{}, { a: 1, b: 2 } ];
		await expectNonAcceptanceOfBadJsonRequest(
			reqOpts, REQ_SIZE_LIMIT, badJSONs);
	});

	itAsync('will not work outside of a valid session', async () => {
		await expectNonAcceptanceOfBadSessionId(reqOpts);
	});

});

let specsForNewObject: SpecDescribe = {
	description: `${description}, when object does not exist,`
};
specs.push(specsForNewObject);
specsForNewObject.definition = (setup: () => TestSetup) => (() => {
	
	let transactionId: string;

	beforeAllAsync(() => setStage(setup));

	itAsync('will not start transaction without new-object flag', async () => {
		expect(await storageServer.rootTransactionExists(user.id)).toBeFalsy('should be no transaction at the begining.');
		expect(await storageServer.rootObjExists(user.id)).toBeFalsy('object is not present at the begining.');
		let req: api.Request = {
			sizes: { header: obj.header.length, segments: obj.segs.length },
			version: obj.version
		};
		let rep = await doJsonRequest<api.Reply>(reqOpts, req);
		expect(rep.status).toBe(api.SC.unknownObj, 'status for unknown object.');
		expect (await storageServer.rootTransactionExists(user.id)).toBeFalsy('should be no transaction, as starting it should have failed.');
	});

	itAsync('will not start diff-ed transaction');

	itAsync('starts transaction', async () => {
		expect(await storageServer.rootTransactionExists(user.id)).toBeFalsy('should be no transaction at the begining.');
		expect(await storageServer.rootObjExists(user.id)).toBeFalsy('object is not present at the begining.');
		let req: api.Request = {
			sizes: { header: obj.header.length, segments: obj.segs.length },
			isNewObj: true,
			version: obj.version
		};
		let rep = await doJsonRequest<api.Reply>(reqOpts, req);
		expect(rep.status).toBe(api.SC.ok, 'normal start of a transaction');
		expect(typeof rep.data).toBe('object');
		expect(typeof rep.data.transactionId).toBe('string');
		transactionId = rep.data.transactionId;
		expect (await storageServer.rootTransactionExists(user.id, transactionId)).toBeTruthy('transaction has been created');
	});

	itAsync('will not start concurrent transaction', async () => {
		let req: api.Request = {
			sizes: { header: obj.header.length, segments: obj.segs.length },
			version: obj.version + 1
		};
		let rep = await doJsonRequest<api.Reply>(reqOpts, req);
		expect(rep.status).toBe(api.SC.concurrentTransaction, 'status for concurrent transaction');
		expect (await storageServer.rootTransactionExists(user.id, transactionId)).toBeTruthy('transaction stays untouched');
	});
		
});

let specsExistingObject: SpecDescribe = {
	description: `${description}, when object exists,`
};
specs.push(specsExistingObject);
specsExistingObject.definition = (setup: () => TestSetup) => (() => {

	beforeEachAsync(async () => {
		await setStage(setup);
		await saveObj(user.storageOwnerUrl, sessionId, null, obj, true);
	});

	itAsync('starts transaction for next version', async () => {
		expect(await storageServer.rootObjExists(user.id, obj.version)).toBeTruthy('object version already exists');
		let req: api.Request = {
			sizes: { header: obj.header.length, segments: obj.segs.length },
			version: obj.version + 1
		};
		let rep = await doJsonRequest<api.Reply>(reqOpts, req);
		expect(rep.status).toBe(api.SC.ok, 'normal start of a transaction');
		expect (await storageServer.rootTransactionExists(user.id, rep.data.transactionId)).toBeTruthy('transaction has been created');
	});

	itAsync('starts transaction for next version skipping a few', async () => {
		expect(await storageServer.rootObjExists(user.id, obj.version)).toBeTruthy('object version already exists');
		let req: api.Request = {
			sizes: { header: obj.header.length, segments: obj.segs.length },
			version: obj.version + 5
		};
		let rep = await doJsonRequest<api.Reply>(reqOpts, req);
		expect(rep.status).toBe(api.SC.ok, 'normal start of a transaction');
		expect (await storageServer.rootTransactionExists(user.id, rep.data.transactionId)).toBeTruthy('transaction has been created');
	});

	xitAsync('transaction start fails if new version is equal or smaller than current object version');

	itAsync('starts diff-ed transaction', async () => {
		let originalSegsSize = obj.segs.length;
		// this is a diff for common situation of file key reencryption.
		let req: api.Request = {
			version: obj.version + 1,
			sizes: { header: obj.header.length, segments: 0 },
			diff: {
				baseVersion: obj.version,
				sections: [ [ 0, 0, originalSegsSize ] ],
				segsSize: originalSegsSize
			}
		};
		let rep = await doJsonRequest<api.Reply>(reqOpts, req);
		expect(rep.status).toBe(api.SC.ok, 'normal start of a transaction');
		expect (await storageServer.rootTransactionExists(user.id, rep.data.transactionId)).toBeTruthy('transaction has been created');
	});

});

Object.freeze(exports);