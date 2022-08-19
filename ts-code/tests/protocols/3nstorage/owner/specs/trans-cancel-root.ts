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
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { startSession, SpecDescribe, TestSetup, User, StorageComponent } from '../test-utils';
import { cancelRootTransaction as api, currentRootObj as rootApi } from '../../../../../lib-common/service-api/3nstorage/owner';
import { beforeAllAsync, itAsync } from '../../../../libs-for-tests/async-jasmine';
import { RequestOpts, doBodylessRequest, doBinaryRequest } from '../../../../libs-for-tests/xhr-utils';
import { Obj }	from '../../../../libs-for-tests/3nstorage';
import { expectNonAcceptanceOfBadSessionId, expectNonAcceptanceOfNonEmptyBody } from '../../../../shared-checks/requests';
import { bytesSync as randomBytes } from '../../../../../lib-common/random-node';
import { resolve as resolveUrl } from 'url';

export const specs: SpecDescribe = {
	description: 'Request to cancel root object transaction'
};

const obj: Obj = {
	objId: (null as any),
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
		const sessionId = await startSession(user);
		const fstReqOpts: RequestOpts = {
			url: resolveUrl(user.storageOwnerUrl, rootApi.firstPutReqUrlEnd({
				ver: 1, header: obj.header.length
			})),
			method: 'PUT',
			sessionId
		};
		const fstRep = await doBinaryRequest<rootApi.ReplyToPut>(
			fstReqOpts, obj.header);
		transactionId = fstRep.data.transactionId!;
		reqOpts = {
			url: resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(transactionId)),
			method: 'POST',
			sessionId
		};
	});
	
	itAsync('cancels root object transaction', async () => {
		expect(await storageServer.currentRootObjExists(user.id)).toBeFalsy('initially, there is no root object');
		expect(await storageServer.rootTransactionExists(user.id)).toBeTruthy('initially, there is a started transaction');
		
		const rep = await doBodylessRequest<void>(reqOpts);
		expect(rep.status).toBe(api.SC.ok, 'status for normal transaction cancelation');
		expect(await storageServer.rootTransactionExists(user.id)).toBeFalsy('transaction should not exist, as it has been cancelled.')
		expect(await storageServer.currentRootObjExists(user.id, 1, obj)).toBeFalsy('object is not created, cause transaction has been cancelled');

		// XXX split out fuzzing requests
		
		await expectNonAcceptanceOfNonEmptyBody(reqOpts);
		
		await expectNonAcceptanceOfBadSessionId(reqOpts);
	
	});

	// XXX add cancelation with unknown transaction id (repeat request)
	
});