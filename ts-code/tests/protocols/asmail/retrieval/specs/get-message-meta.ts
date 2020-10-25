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
import { SpecDescribe, TestSetup, User, msg, ASMailComponent, startSession,
	sendMsg }
	from '../test-utils';
import { resolve as resolveUrl } from 'url';
import { msgMetadata as api }
	from '../../../../../lib-common/service-api/asmail/retrieval';
import { RequestOpts, doBodylessRequest }
	from '../../../../libs-for-tests/xhr-utils';
import { expectNonAcceptanceOfBadSessionId }
	from '../../../../shared-checks/requests';
import { copy } from '../../../../libs-for-tests/json-copy';

export const specs: SpecDescribe = {
	description: `Request to get message meta`
};

specs.definition = (setup: () => TestSetup) => (() => {
	
	let asmailServer: ASMailComponent;
	let retrievalUrl: string;
	let deliveryUrl: string;
	let user1: User;
	let reqOpts: RequestOpts

	beforeEachAsync(async () => {
		asmailServer = setup().asmailServer;
		retrievalUrl = await asmailServer.getRetrievalUrl();
		deliveryUrl = await asmailServer.getDeliveryUrl();
		user1 = setup().user1;
		const sessionId = await startSession(user1, retrievalUrl);
		reqOpts = {
			url: resolveUrl(retrievalUrl, api.genUrlEnd('some-msg')),
			method: 'GET',
			responseType: 'json',
			sessionId
		};
	});
		
	itAsync('returns message metadata', async () => {
		const msgId = await sendMsg(deliveryUrl, user1.id, msg);
		
		const opts = copy(reqOpts);
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId));
		
		const rep = await doBodylessRequest<api.Reply>(opts);
		expect(rep.status).toBe(api.SC.ok, 'status for successfully found message');
		expect(rep.data.authSender).toBeFalsy();
		expect(typeof rep.data.deliveryStart).toBe('number');
		expect(typeof rep.data.deliveryCompletion).toBe('number');
		expect(rep.data.deliveryStart).not.toBeGreaterThan(
			rep.data.deliveryCompletion!);
	});

	itAsync(`returns an error when message is unknown`, async () => {
		const opts = copy(reqOpts);
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(
			'unknown-message'));
		const rep = await doBodylessRequest<api.Reply>(opts);
		expect(rep.status).toBe(api.SC.unknownMsg, 'status for unknown message');
	});

	itAsync(`requires open session`, async () => {
		const opts = copy(reqOpts);
		await expectNonAcceptanceOfBadSessionId(opts);
	});

});