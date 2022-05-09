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

import { beforeAllAsync, itAsync } from '../../../../libs-for-tests/async-jasmine';
import { SpecDescribe, TestSetup, User } from '../test-utils';
import { doJsonRequest, RequestOpts } from '../../../../libs-for-tests/xhr-utils';
import { resolve as resolveUrl } from 'url';
import { sessionStart as api } from '../../../../../lib-common/service-api/asmail/delivery';
import { expectNonAcceptanceOfBadJsonRequest } from '../../../../shared-checks/requests';

export const specs: SpecDescribe = {
	description: 'Request to start message delivery session'
};

specs.definition = (setup: () => TestSetup) => (() => {

	let user2: User;
	let reqOpts: RequestOpts;

	beforeAllAsync(async () => {
		user2 = setup().user2;
		const deliveryUrl = await setup().asmailServer.getDeliveryUrl();
		reqOpts = {
			url: resolveUrl(deliveryUrl, api.URL_END),
			method: 'POST',
			responseType: 'json'
		};
	});

	itAsync('with ok reply returns session parameters (id, etc.)', async () => {
		
		const req: api.Request = {
			recipient: user2.id
		};
		
		const rep = await doJsonRequest<api.Reply>(reqOpts, req);
		expect(rep.status).toBe(api.SC.ok, 'successful session start status');
		expect(typeof rep.data.sessionId).toBe('string');
		expect(rep.data.sessionId.length).toBeGreaterThan(0);
		expect(typeof rep.data.maxMsgLength).toBe('number');
		expect(rep.data.maxMsgLength).toBeGreaterThan(0);
		
	});

	itAsync('returns error status when recipient is unknown', async () => {
		const req: api.Request = { recipient: 'unknown user@bank.com' };
		const rep = await doJsonRequest<api.Reply>(reqOpts, req);
		expect(rep.status).toBe(api.SC.unknownRecipient, 'status for unknown recipient');
	});

	itAsync('adequately responds to fuzzing', async () => {
		
		// bad JSON's
		const REQ_SIZE_LIMIT = 1024;
		const badJSONs: any[] = [ null, undefined, 1, 'string',
			[1,2], [], { a:1, b:2 }];
		await expectNonAcceptanceOfBadJsonRequest(reqOpts, REQ_SIZE_LIMIT,
			badJSONs);
			
	});

	
});

Object.freeze(exports);