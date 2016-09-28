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

import { startSession, SpecDescribe, TestSetup, User, StorageComponent,
	writeObjBytes }
	from '../test-utils';
import { finalizeTransaction as api }
	from '../../../../../lib-common/service-api/3nstorage/owner';
import { beforeAllAsync, itAsync }
	from '../../../../libs-for-tests/async-jasmine';
import { RequestOpts, doBodylessRequest }
	from '../../../../libs-for-tests/xhr-utils';
import { Obj, startTransaction }	from '../../../../libs-for-tests/3nstorage';
import { expectNonAcceptanceOfBadSessionId,
	expectNonAcceptanceOfNonEmptyBody }
	from '../../../../shared-checks/requests';
import { bytes as randomBytes } from '../../../../../lib-common/random-node';
import { resolve as resolveUrl } from 'url';

export let specs: SpecDescribe = {
	description: 'Request to complete (finalize) non-root object transaction'
};

let obj: Obj = {
	objId: 'aaaa',
	version: 1,
	header: randomBytes(100),
	segs: randomBytes(573)
};

specs.definition = (setup: () => TestSetup) => (() => {
	
	let reqOpts: RequestOpts
	let storageServer: StorageComponent;
	let user: User;
	let transactionId: string;

	beforeAllAsync(async () => {
		storageServer = setup().storageServer;
		user = setup().user;
		await storageServer.restartAndClearStorageFor(user.id);
		let sessionId = await startSession(user);
		transactionId = await startTransaction(user.storageOwnerUrl, sessionId, obj, true);
		await writeObjBytes(user.storageOwnerUrl, sessionId, transactionId, obj.objId, obj);
		reqOpts = {
			url: resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId, transactionId)),
			method: 'POST',
			sessionId: sessionId
		};
	});
	
	itAsync('completes object transaction', async () => {
		expect(await storageServer.objExists(user.id, obj.objId)).toBeFalsy('initially, there is no object');
		expect(await storageServer.transactionExists(user.id, obj.objId)).toBeTruthy('initially, there is a started transaction');
		
		// normal reply
		let rep = await doBodylessRequest<void>(reqOpts);
		expect(rep.status).toBe(api.SC.ok, 'status for normal transaction completion');
		expect(await storageServer.transactionExists(user.id, obj.objId)).toBeFalsy('transaction should not be present, as it has been completed');
		expect(await storageServer.objExists(user.id, obj.objId, 1, obj)).toBeTruthy('object should be present after successful write');
		
		// XXX split unknown object
		// unknown object is treated like unknown transaction
		// let rep = await doBodylessRequest<void>(reqOpts);
		// expect(rep.status).toBe(api.SC.missing, 'status for unknown object');
		
		// XXX split unknown transaction
		// duplicate request will be effectively for unknown transaction
		rep = await doBodylessRequest<void>(reqOpts);
		expect(rep.status).toBe(api.SC.missing, 'status for unknown transaction');

		// XXX split out fuzzing requests
		
		await expectNonAcceptanceOfNonEmptyBody(reqOpts);
		
		await expectNonAcceptanceOfBadSessionId(reqOpts);
		
	});

});