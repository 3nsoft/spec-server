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

import { beforeEachAsync, itAsync } from '../../../../libs-for-tests/async-jasmine';
import { SpecDescribe, TestSetup, User, msg, ASMailComponent, startSessionAndSendMsgObjs } from '../test-utils';
import { doBodylessRequest, RequestOpts } from '../../../../libs-for-tests/xhr-utils';
import { resolve as resolveUrl } from 'url';
import { completion as api } from '../../../../../lib-common/service-api/asmail/delivery';
import { expectNonAcceptanceOfBadSessionId, expectNonAcceptanceOfNonEmptyBody, UNAUTHORIZED_STATUS } from '../../../../shared-checks/requests';
import { DeliveryInfo } from '../../../../libs-for-tests/asmail';

export const specs: SpecDescribe = {
	description: `Request to complete message delivery`
};

specs.definition = (setup: () => TestSetup) => (() => {

	let user2: User;
	let deliveryUrl: string;
	let asmailServer: ASMailComponent;
	let sessInfo: DeliveryInfo;
	let reqOpts: RequestOpts;

	beforeEachAsync(async () => {
		user2 = setup().user2;
		asmailServer = setup().asmailServer;
		deliveryUrl = await asmailServer.getDeliveryUrl();
		sessInfo = await startSessionAndSendMsgObjs(deliveryUrl, user2.id, msg);
		reqOpts = {
			url: resolveUrl(deliveryUrl, api.URL_END),
			method: 'POST',
			sessionId: sessInfo.sessionId
		};
	});
	
	itAsync(`marks message as completely delivered`, async () => {
		expect(await asmailServer.msgExists(user2.id, sessInfo.msgId, false)).toBeTruthy('message is known to be in delivery');

		let rep = await doBodylessRequest<void>(reqOpts);
		expect(rep.status).toBe(api.SC.ok, 'normal end of message delivering session');
		expect(await asmailServer.msgExists(user2.id, sessInfo.msgId, true, msg)).toBeTruthy('message must now be delivered');
		
		// duplicate should not work, as session is already closed
		rep = await doBodylessRequest<void>(reqOpts);
		expect(rep.status).toBe(UNAUTHORIZED_STATUS);
	});
	
	itAsync('adequately responds to fuzzing', async () => {
		await expectNonAcceptanceOfNonEmptyBody(reqOpts);
		await expectNonAcceptanceOfBadSessionId(reqOpts);
	});

});

Object.freeze(exports);