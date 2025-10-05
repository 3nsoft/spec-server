/*
 Copyright (C) 2016, 2025 3NSoft Inc.
 
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

import { afterAllAsync, beforeAllAsync, itAsync } from '../../libs-for-tests/async-jasmine';
import { ASMailComponent } from '../../libs-for-tests/server-components/asmail';
import { User } from '../../libs-for-tests/mailerid';
import { RequestOpts, doBodylessRequest } from '../../libs-for-tests/xhr-utils';
import { expectNonAcceptanceOfBadSessionId, expectNonAcceptanceOfNonEmptyBody } from '../../shared-checks/requests';
import { midLoginSpecs } from '../../shared-checks/check-mid-login';
import { resolve as resolveUrl } from 'url';
import * as api from '../../../lib-common/service-api/asmail/retrieval';
import { bytesSync as randomBytes } from '../../../lib-common/random-node';
import { Msg } from '../../libs-for-tests/asmail';
import { addSpecsFrom } from '../../libs-for-tests/spec-assembly';
import { join as joinPaths } from 'path';
import { startSession } from './retrieval/test-utils';

const SPECS_FOLDER = joinPaths(__dirname, './retrieval/specs');

describe('ASMail retrieval service', () => {
	
	let asmailServer: ASMailComponent;
	const midServiceDomain = 'localhost';
	const signupDomains = [ 'company.inc', 'personal.net' ];
	let user1: User;
	let user2: User;
	let retrievalUrl: string;
	let deliveryUrl: string;
	
	const msg: Msg = {
		cryptoMeta: {
			pid: 'ephemeral pair id'
		},
		msgObjs: [ {
			objId: 'aaaa',
			header: randomBytes(100),
			segs: randomBytes(573)
		}, {
			objId: 'bbbb',
			header: randomBytes(100),
			segs: randomBytes(2*1024 + 7)
		} ]
	};
	
	beforeAllAsync(async () => {
		asmailServer = new ASMailComponent(signupDomains, midServiceDomain);
		await asmailServer.start();
		retrievalUrl = await asmailServer.getRetrievalUrl();
		if (!retrievalUrl.endsWith('/')) { retrievalUrl += '/'; }
		deliveryUrl = await asmailServer.getDeliveryUrl();
		if (!deliveryUrl.endsWith('/')) { deliveryUrl += '/'; }
		user1 = await asmailServer.addUser(
			`Bob Johnson @${signupDomains[0]}`
		);
		user2 = await asmailServer.addUser(
			`William Young @${signupDomains[1]}`
		);
	});
	
	afterAllAsync(async () => {
		await asmailServer.stop();
		asmailServer = (undefined as any);
	});
	
	describe('session', () => {

		describe('MailerId login', midLoginSpecs(
			() => resolveUrl(retrievalUrl, api.midLogin.MID_URL_PART),
			() => user1
		));
		
		itAsync('closing session', async () => {
			const sessionId = await startSession(user1, retrievalUrl);
			
			const reqOpts: RequestOpts = {
				url: resolveUrl(retrievalUrl, api.closeSession.URL_END),
				method: 'POST',
				sessionId
			};
			
			// normal closing of a session
			let rep = await doBodylessRequest<void>(reqOpts);
			expect(rep.status).withContext('status for successful closing of session').toBe(200);
			
			// repeated call should see invalid session response
			rep = await doBodylessRequest<void>(reqOpts);
			expect(rep.status).toBe(api.ERR_SC.needAuth);
			
			reqOpts.sessionId = await startSession(user1, retrievalUrl);
			
			await expectNonAcceptanceOfNonEmptyBody(reqOpts);
			
			await expectNonAcceptanceOfBadSessionId(reqOpts);
			
		});

	});
	
	addSpecsFrom(SPECS_FOLDER, () => ({ asmailServer, user1, user2 }));
	
});