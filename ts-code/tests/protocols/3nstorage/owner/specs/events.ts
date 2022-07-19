/*
 Copyright (C) 2017 3NSoft Inc.
 
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

import { beforeEachAsync, itAsync } from '../../../../libs-for-tests/async-jasmine';
import { SpecDescribe, TestSetup, User, startSession, StorageComponent } from '../test-utils';
import { openSocket } from '../../../../libs-for-tests/ws-utils';
import { sleep } from '../../../../../lib-common/processes';
import { makeSubscriber } from '../../../../../lib-common/ipc/ws-ipc';
import { wsEventChannel as api, ERR_SC, events } from '../../../../../lib-common/service-api/3nstorage/owner';
import { Obj, saveObj, removeObj }	from '../../../../libs-for-tests/3nstorage';
import { bytesSync as randomBytes } from '../../../../../lib-common/random-node';
import { Observable } from 'rxjs';

export const specs: SpecDescribe = {
	description: `is an event emitter`
};

const obj: Obj = {
	objId: 'aaaa',
	version: 1,
	header: randomBytes(100),
	segs: randomBytes(573)
};

specs.definition = (setup: () => TestSetup) => (() => {
	
	let storageServer: StorageComponent;
	let wsUrl: string;
	let user: User;
	let sessionId: string;

	beforeEachAsync(async () => {
		storageServer = setup().storageServer;
		user = setup().user;
		wsUrl = `wss${user.storageOwnerUrl.substring(5)}${api.URL_END}`;
		sessionId = await startSession(user);
	});
	
	itAsync(`requires session to open web socket`, async () => {

		const rep = await openSocket(wsUrl, 'invalid session id');
		expect(rep.status).toBe(ERR_SC.needAuth, 'status for missing authorized session');
		
	});
	
	itAsync(`emits event on completion of object has new version (1st version is an object creation event)`, async () => {

		const rep = await openSocket(wsUrl, sessionId);
		expect(rep.status).toBe(api.SC.ok);
		
		const eventSrc = makeSubscriber(rep.data, undefined);

		const eventPromise = (Observable.create(
			obs => eventSrc.subscribe<events.objChanged.Event>(
				events.objChanged.EVENT_NAME, obs
			))
		)
		.take(2)
		.toArray()
		.toPromise();
		
		// give some time for subscription to occur
		await sleep(10);
		
		// create first version of an object
		await saveObj(user.storageOwnerUrl, sessionId, true, obj.objId, 1, obj);
		
		// create second version
		await saveObj(user.storageOwnerUrl, sessionId, false, obj.objId, 2, obj);

		(await eventPromise).forEach((event, index) => {
			expect(typeof event).toBe('object');
			expect(event.objId).toBe(obj.objId, `object change event should identify the object`);
			expect(event.newVer).toBe(index+1, `event provides new object version`);
		});

	});

	itAsync(`emits event on object removal, i.e. when current version is removed, even if there may be archived versions present`, async () => {

		const rep = await openSocket(wsUrl, sessionId);
		expect(rep.status).toBe(api.SC.ok);
		
		const eventSrc = makeSubscriber(rep.data, undefined);

		const eventPromise = (Observable.create(
			obs => eventSrc.subscribe<events.objChanged.Event>(
				events.objRemoved.EVENT_NAME, obs
			))
		)
		.take(1)
		.toPromise();
		
		// give some time for subscription to occur
		await sleep(10);

		const objId ='bbbb';
		
		// create an object
		await saveObj(user.storageOwnerUrl, sessionId, true, objId, 1, obj);
		
		// create second version
		await removeObj(user.storageOwnerUrl, sessionId, objId);

		const event = await eventPromise;
		expect(typeof event).toBe('object');
		expect(event.objId).toBe(objId, `object removal event should identify the object`);

	});

});