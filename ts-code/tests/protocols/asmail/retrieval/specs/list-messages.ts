/*
 Copyright (C) 2016 - 2017б 2022 3NSoft Inc.
 
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
import { SpecDescribe, TestSetup, User, msg, startSession, sendMsg } from '../test-utils';
import { resolve as resolveUrl } from 'url';
import { listMsgs as api } from '../../../../../lib-common/service-api/asmail/retrieval';
import { RequestOpts, doBodylessRequest } from '../../../../libs-for-tests/xhr-utils';
import { expectNonAcceptanceOfBadSessionId } from '../../../../shared-checks/requests';
import { copy } from '../../../../libs-for-tests/json-copy';
import { msgSendingSteps } from '../../../../libs-for-tests/asmail';

export const specs: SpecDescribe = {
	description: `Request to list messages in inbox`
};

specs.definition = (setup: () => TestSetup) => (() => {

	let retrievalUrl: string;
	let deliveryUrl: string;
	let user1: User;
	let reqOpts: RequestOpts

	beforeEachAsync(async () => {
		retrievalUrl = await setup().asmailServer.getRetrievalUrl();
		deliveryUrl = await setup().asmailServer.getDeliveryUrl();
		user1 = setup().user1;
		const sessionId = await startSession(user1, retrievalUrl);
		reqOpts = {
			url: resolveUrl(retrievalUrl, api.URL_END),
			method: 'GET',
			responseType: 'json',
			sessionId
		};
	});

	// TODO add to this route time limits for listing

	itAsync('lists messages in inbox', async () => {
		const opts = copy(reqOpts);
		
		// some number of messages at the start of test
		let rep = await doBodylessRequest<api.Reply>(opts);
		expect(rep.status).withContext('normal status reply').toBe(api.SC.ok);
		expect(Array.isArray(rep.data)).toBe(true);
		const initNumOfMsgs = rep.data.length;
		
		// add one message, and see a change
		const msgId = await sendMsg(deliveryUrl, user1.id, msg);
		rep = await doBodylessRequest<api.Reply>(opts);
		expect(rep.status).withContext('normal status reply').toBe(api.SC.ok);
		expect(Array.isArray(rep.data)).toBe(true);
		expect(rep.data).toContain(msgId);
		expect(rep.data.length).toBe(initNumOfMsgs + 1);
		
	});

	itAsync(`requires open session`, async () => {
		const opts = copy(reqOpts);
		await expectNonAcceptanceOfBadSessionId(opts);
	});

	itAsync(`doesn't list messages that ain't completely sent`, async () => {
		const opts = copy(reqOpts);
		let lst = (await doBodylessRequest<api.Reply>(opts)).data;
		const initMsgNum = lst.length;

		// start prolonged message sending
		const longSending = msgSendingSteps(deliveryUrl, user1.id, msg);
		const { value: msgId1 } = (await longSending.next());
		lst = (await doBodylessRequest<api.Reply>(opts)).data;
		expect(lst.length).toBe(initMsgNum);
		expect(lst).not.toContain(msgId1);

		// add one message completely before listing
		const msgId2 = await sendMsg(deliveryUrl, user1.id, msg);
		lst = (await doBodylessRequest<api.Reply>(opts)).data;
		expect(lst.length).toBe(initMsgNum + 1);
		expect(lst).toContain(msgId2);

		let done: boolean;
		do {
			done = !!(await longSending.next()).done;
			if (!done) {
				expect((await doBodylessRequest<api.Reply>(opts)).data)
				.not.toContain(msgId1);
			}
		} while (!done);

		// listing message only when it is completely sent
		lst = (await doBodylessRequest<api.Reply>(opts)).data;
		expect(lst.length).toBe(initMsgNum + 2);
		expect(lst).toContain(msgId1);
	});

});