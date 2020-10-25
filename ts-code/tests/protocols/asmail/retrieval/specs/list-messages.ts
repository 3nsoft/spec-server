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
 this program. If not, see <http://www.gnu.org/licenses/>. */

import { beforeEachAsync, itAsync }
	from '../../../../libs-for-tests/async-jasmine';
import { SpecDescribe, TestSetup, User, msg, startSession, sendMsg }
	from '../test-utils';
import { resolve as resolveUrl } from 'url';
import { listMsgs as api }
	from '../../../../../lib-common/service-api/asmail/retrieval';
import { RequestOpts, doBodylessRequest }
	from '../../../../libs-for-tests/xhr-utils';
import { expectNonAcceptanceOfBadSessionId }
	from '../../../../shared-checks/requests';
import { copy } from '../../../../libs-for-tests/json-copy';

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
		
		// there are no messages
		let rep = await doBodylessRequest<api.Reply>(opts);
		expect(rep.status).toBe(api.SC.ok, 'normal status reply');
		expect(Array.isArray(rep.data)).toBe(true);
		const initNumOfMsgs = rep.data.length;
		
		// add one message, and see a change
		const msgId = await sendMsg(deliveryUrl, user1.id, msg);
		rep = await doBodylessRequest<api.Reply>(opts);
		expect(rep.status).toBe(api.SC.ok, 'normal status reply');
		expect(Array.isArray(rep.data)).toBe(true);
		expect(rep.data).toContain(msgId);
		expect(rep.data.length).toBe(initNumOfMsgs + 1);
		
	});

	itAsync(`requires open session`, async () => {
		const opts = copy(reqOpts);
		await expectNonAcceptanceOfBadSessionId(opts);
	});

});