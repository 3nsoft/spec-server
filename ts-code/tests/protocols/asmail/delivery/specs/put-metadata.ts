/*
 Copyright (C) 2016 - 2017, 2025 3NSoft Inc.
 
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
import { SpecDescribe, ASMailComponent, TestSetup, User, msg } from '../test-utils';
import { doJsonRequest, RequestOpts } from '../../../../libs-for-tests/xhr-utils';
import { resolve as resolveUrl } from 'url';
import { msgMeta as api, ERR_SC } from '../../../../../lib-common/service-api/asmail/delivery';
import { expectNonAcceptanceOfBadSessionId, expectNonAcceptanceOfBadJsonRequest } from '../../../../shared-checks/requests';
import { startMsgDeliverySession } from '../../../../libs-for-tests/asmail';

export const specs: SpecDescribe = {
	description: `Request to put message's metadata`
};

specs.definition = (setup: () => TestSetup) => (() => {

	let user2: User;
	let reqOpts: RequestOpts;
	let asmailServer: ASMailComponent;

	beforeEachAsync(async () => {
		user2 = setup().user2;
		asmailServer = setup().asmailServer;
		const deliveryUrl = await asmailServer.getDeliveryUrl();
		const sessInfo = await startMsgDeliverySession(
			deliveryUrl, { recipient: user2.id });
		reqOpts = {
			url: resolveUrl(deliveryUrl, api.URL_END),
			method: 'PUT',
			responseType: 'json',
			sessionId: sessInfo.sessionId
		};
	});
	
	itAsync('starts actual message delivery, returning message id', async () => {
		
		const req: api.Request = {
			pid: msg.cryptoMeta.pid,
			objIds: [ msg.msgObjs[0].objId, msg.msgObjs[1].objId ]
		};
		
		const rep = await doJsonRequest<api.Reply>(reqOpts, req);
		expect(rep.status).withContext('status for normal meta acceptance and issue of a corresponding message id').toBe(api.SC.ok);
		expect(typeof rep.data.msgId).toBe('string');
		const msgId = rep.data.msgId;
		expect(msgId.length).toBeGreaterThan(0);
		expect(typeof rep.data.maxChunkSize).toBe('number');
		expect(rep.data.maxChunkSize).not.toBeLessThan(64*1024);
		expect(await asmailServer.msgExists(user2.id, msgId, false)).withContext('message is known to be in delivery').toBeTruthy();
		
	});
	
	itAsync('is not allowing message with object ids that are either same, or have chars not from base64 url-safe alphabet', async () => {

		// request with object ids, exact to letter case
		const req: api.Request = {
			pid: msg.cryptoMeta.pid,
			objIds: [ msg.msgObjs[0].objId, msg.msgObjs[0].objId.toLowerCase() ]
		};

		let rep = await doJsonRequest<api.Reply>(reqOpts, req);
		expect(rep.status).withContext('same object ids are not allowed').toBe(ERR_SC.malformed);
		
		req.objIds = [ msg.msgObjs[0].objId, msg.msgObjs[0].objId+'+as' ];
		rep = await doJsonRequest<api.Reply>(reqOpts, req);
		expect(rep.status).withContext('object ids, equal to letter case, are not allowed').toBe(ERR_SC.malformed);
		
	});

	itAsync('adequately responds to fuzzing', async () => {

		// bad JSON's
		const REQ_SIZE_LIMIT = 16*1024;
		const badJSONs: any[] = [ null, undefined, 1, 'string',
			// XXX add meta checks to screen out these
			// [1,2], [], { a:1, b:2 }
			];
		await expectNonAcceptanceOfBadJsonRequest(reqOpts, REQ_SIZE_LIMIT,
			badJSONs);
		
		await expectNonAcceptanceOfBadSessionId(reqOpts, true);
		
	});

});

Object.freeze(exports);