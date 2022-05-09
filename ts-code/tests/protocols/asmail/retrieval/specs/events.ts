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
import { SpecDescribe, TestSetup, User, msg, ASMailComponent, startSession, sendMsg } from '../test-utils';
import { openSocket } from '../../../../libs-for-tests/ws-utils';
import { sleep } from '../../../../../lib-common/processes';
import { makeSubscriber } from '../../../../../lib-common/ipc/ws-ipc';
import { msgRecievedCompletely, wsEventChannel as api, ERR_SC } from '../../../../../lib-common/service-api/asmail/retrieval';
import { Observable } from 'rxjs';

export const specs: SpecDescribe = {
	description: `is an event emitter`
};

specs.definition = (setup: () => TestSetup) => (() => {
	
	let asmailServer: ASMailComponent;
	let wsUrl: string;
	let deliveryUrl: string;
	let user1: User;
	let sessionId: string;

	beforeEachAsync(async () => {
		asmailServer = setup().asmailServer;
		const retrievalUrl = await asmailServer.getRetrievalUrl();
		wsUrl = `wss${retrievalUrl.substring(5)}${api.URL_END}`;
		deliveryUrl = await asmailServer.getDeliveryUrl();
		user1 = setup().user1;
		sessionId = await startSession(user1, retrievalUrl);
	});
	
	itAsync(`requires session to open web socket`, async () => {

		let rep = await openSocket(wsUrl, 'invalid session id');
		expect(rep.status).toBe(ERR_SC.needAuth, 'status for missing authorized session');
		
	});
	
	itAsync(`emits event on completion of message reception`, async () => {

		let rep = await openSocket(wsUrl, sessionId);
		expect(rep.status).toBe(api.SC.ok);
		
		const eventSrc = makeSubscriber(rep.data, undefined);

		const eventPromise = (Observable.create(
			obs => eventSrc.subscribe<msgRecievedCompletely.Event>(
			msgRecievedCompletely.EVENT_NAME, obs)) as Observable<msgRecievedCompletely.Event>)
		.take(1)
		.toPromise();
		
		// give some time for subscription to occur
		await sleep(10);
		
		const msgId = await sendMsg(deliveryUrl, user1.id, msg);

		const event = await eventPromise;
		expect(typeof event).toBe('object');
		expect(event.msgId).toBe(msgId, `message reception completion event should give a respective message id`);

	});

});