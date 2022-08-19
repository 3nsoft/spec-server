/*
 Copyright (C) 2022 3NSoft Inc.
 
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

import { startSession, SpecDescribe, TestSetup, User, StorageComponent, archiveObjVer } from '../test-utils';
import { objStatus as api, ObjStatus } from '../../../../../lib-common/service-api/3nstorage/owner';
import { beforeAllAsync, itAsync } from '../../../../libs-for-tests/async-jasmine';
import { RequestOpts, doBodylessRequest } from '../../../../libs-for-tests/xhr-utils';
import { Obj, saveObj }	from '../../../../libs-for-tests/3nstorage';
import { expectNonAcceptanceOfBadSessionId } from '../../../../shared-checks/requests';
import { bytesSync as randomBytes } from '../../../../../lib-common/random-node';
import { resolve as resolveUrl } from 'url';
import { copy } from '../../../../libs-for-tests/json-copy';

export const specs: SpecDescribe = {
	description: `Request to list object's archived versions`
};

const obj: Obj = {
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
			method: 'GET',
			responseType: 'json',
			sessionId
		};
	});

	itAsync('will not work outside of a valid session', async () => {
		const opts = copy(reqOpts);
		await expectNonAcceptanceOfBadSessionId(opts);
	});

	itAsync('fails when object does not exist', async () => {
		const unknownObj = 'unknown-obj';
		const opts = copy(reqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.getReqUrlEnd(unknownObj));
		const rep = await doBodylessRequest(opts);
		expect(rep.status).toBe(api.SC.unknownObj);
	});

	itAsync(`shows obj status with versions' info`, async () => {
		await saveObj(user.storageOwnerUrl, sessionId, obj.objId, 1, obj);
		let rep = await doBodylessRequest<ObjStatus>(reqOpts);
		expect(rep.status).toBe(api.SC.ok);
		expect(rep.data.current).toBe(1);
		expect(rep.data.archived).toBeUndefined();
		await archiveObjVer(user, obj.objId, 1, sessionId);
		rep = await doBodylessRequest<ObjStatus>(reqOpts);
		expect(rep.status).toBe(api.SC.ok);
		expect(rep.data.current).toBe(1);
		expect(rep.data.archived).toContain(1);
	});

});


Object.freeze(exports);