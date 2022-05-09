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
import { doBodylessRequest, RequestOpts } from '../../../../libs-for-tests/xhr-utils';
import { resolve as resolveUrl } from 'url';
import { initPubKey as api } from '../../../../../lib-common/service-api/asmail/delivery';
import { expectNonAcceptanceOfBadSessionId, UNAUTHORIZED_STATUS } from '../../../../shared-checks/requests';
import { startMsgDeliverySession } from '../../../../libs-for-tests/asmail';
import { copy } from '../../../../libs-for-tests/json-copy';

export const specs: SpecDescribe = {
	description: `Request to get recipient's registered initial key`
};

specs.definition = (setup: () => TestSetup) => (() => {

	let deliveryUrl: string;
	let user1: User;
	let user2: User;
	let baseReqOpts: RequestOpts;

	beforeAllAsync(async () => {
		user1 = setup().user1;
		user2 = setup().user2;
		deliveryUrl = await setup().asmailServer.getDeliveryUrl();
		baseReqOpts = {
			url: resolveUrl(deliveryUrl, api.URL_END),
			method: 'GET',
			responseType: 'json'
		};
	});

	itAsync(`returns certificates, registered by recipient`, async () => {

		const sessInfo = await startMsgDeliverySession(
			deliveryUrl, { recipient: user2.id });
		const reqOpts = copy(baseReqOpts);
		reqOpts.sessionId = sessInfo.sessionId;

		const rep = await doBodylessRequest<api.Reply>(reqOpts);
		expect(rep.status).toBe(api.SC.ok, 'status for successfully getting a key');

		// TODO add check of certs, together with adding check in setting pkey
		
	});
	
	itAsync(`returns error, when recipient registered no certs`, async () => {

		// recipient doesn't have initial public key registered
		const sessInfo = await startMsgDeliverySession(
			deliveryUrl, { recipient: user1.id });
		const reqOpts = copy(baseReqOpts);
		reqOpts.sessionId = sessInfo.sessionId;

		let rep = await doBodylessRequest<api.Reply>(reqOpts);
		expect(rep.status).toBe(api.SC.pkeyNotRegistered, 'status for no key registered with server');
		
		// session is closed, when there is no key, so repeat request is denied
		rep = await doBodylessRequest<api.Reply>(reqOpts);
		expect(rep.status).toBe(UNAUTHORIZED_STATUS, 'status for closed session');
		
	});

	itAsync('adequately responds to fuzzing', async () => {
		
		await expectNonAcceptanceOfBadSessionId(baseReqOpts);
			
	});

});

Object.freeze(exports);