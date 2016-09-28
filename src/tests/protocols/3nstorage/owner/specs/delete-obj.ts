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
import { deleteObj as api }
	from '../../../../../lib-common/service-api/3nstorage/owner';
import { beforeAllAsync, itAsync, xitAsync }
	from '../../../../libs-for-tests/async-jasmine';
import { RequestOpts, doBodylessRequest }
	from '../../../../libs-for-tests/xhr-utils';
import { Obj, saveObj }	from '../../../../libs-for-tests/3nstorage';
import { expectNonAcceptanceOfBadSessionId }
	from '../../../../shared-checks/requests';
import { bytes as randomBytes } from '../../../../../lib-common/random-node';
import { resolve as resolveUrl } from 'url';
import { copy } from '../../../../libs-for-tests/json-copy';

export let specs: SpecDescribe = {
	description: 'Request to delete object\'s current version'
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
	let sessionId: string;

	beforeAllAsync(async () => {
		storageServer = setup().storageServer;
		user = setup().user;
		await storageServer.restartAndClearStorageFor(user.id);
		sessionId = await startSession(user);
		reqOpts = {
			url: resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(obj.objId)),
			method: 'DELETE',
			sessionId
		};
	});

	itAsync('fails when object does not exist', async () => {
		let unknownObj = 'unknown-obj';
		expect(await storageServer.objExists(user.id, unknownObj)).toBeFalsy();
		let opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(unknownObj));
		let rep = await doBodylessRequest(opts);
		expect(rep.status).toBe(api.SC.missing);
	});

	itAsync('does remove it', async () => {
		await saveObj(user.storageOwnerUrl, sessionId,
			obj.objId, obj, true);
		expect(await storageServer.objExists(user.id, obj.objId)).toBeTruthy();
		let rep = await doBodylessRequest(reqOpts);
		expect(rep.status).toBe(api.SC.ok);
		expect(await storageServer.objExists(user.id, obj.objId)).toBeFalsy();
	});

	xitAsync('keeps archived versions intact');

	itAsync('will not work outside of a valid session', async () => {
		let opts = copy(reqOpts);
		await expectNonAcceptanceOfBadSessionId(opts);
	});

});

Object.freeze(exports);