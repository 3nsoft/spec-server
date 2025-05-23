/*
 Copyright (C) 2016, 2020, 2025 3NSoft Inc.
 
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
import { User, doMailerIdLogin } from '../../libs-for-tests/mailerid';
import { midLoginSpecs } from '../../shared-checks/check-mid-login';
import * as api from '../../../lib-common/service-api/asmail/config';
import { doJsonRequest, RequestOpts, doBodylessRequest } from '../../libs-for-tests/xhr-utils';
import { expectNonAcceptanceOfBadJsonRequest, expectNonAcceptanceOfNonEmptyBody, expectNonAcceptanceOfBadSessionId } from '../../shared-checks/requests';
import { resolve as resolveUrl } from 'url';
import { deepEqual }  from '../../libs-for-tests/json-equal';

describe('ASMail configuration', () => {
	
	let asmailServer: ASMailComponent;
	const midServiceDomain = 'localhost';
	const signupDomains = [ 'company.inc', 'personal.net' ];
	let user1: User;
	let confUrl: string;
	
	beforeAllAsync(async () => {
		asmailServer = new ASMailComponent(signupDomains, midServiceDomain);
		await asmailServer.start();
		confUrl = await asmailServer.getConfUrl();
		if (!confUrl.endsWith('/')) { confUrl += '/'; }
		user1 = await asmailServer.addUser(`Bob Johnson @${signupDomains[0]}`);
	});
	
	afterAllAsync(async () => {
		await asmailServer.stop();
		asmailServer = (undefined as any);
	});
	
	describe('MailerId login', midLoginSpecs(
		() => resolveUrl(confUrl, api.midLogin.URL_PART),
		() => user1
	));
	
	async function startSession(user: User): Promise<string> {
		return await doMailerIdLogin(
			resolveUrl(confUrl, api.midLogin.URL_PART),
			user
		);
	}

	function checkParamRoutes(
		paramUrlPart: string, goodValues: any[], badValues: any[],
		maxBodyLen: number
	): () => void {
		return () => {
			
			let sessionId: string;
			
			beforeAllAsync(async () => {
				sessionId = await startSession(user1); 
			});
			
			itAsync('is readable', async () => {
				
				const reqOpts: RequestOpts = {
					url: resolveUrl(confUrl, paramUrlPart),
					method: 'GET',
					responseType: 'json',
					sessionId
				};
				
				const rep = await doBodylessRequest<any>(reqOpts);
				expect(rep.status).withContext('status for reading parameter').toBe(api.PARAM_SC.ok);
		
				await expectNonAcceptanceOfBadSessionId(reqOpts);
				
			});
			
			async function getParam(): Promise<any> {
				const reqOpts: RequestOpts = {
					url: resolveUrl(confUrl, paramUrlPart),
					method: 'GET',
					responseType: 'json',
					sessionId
				};
				const rep = await doBodylessRequest<any>(reqOpts);
				expect(rep.status).toBe(api.PARAM_SC.ok);
				return rep.data;
			}
			
			itAsync('is writable', async () => {
				
				const reqOpts: RequestOpts = {
					url: resolveUrl(confUrl, paramUrlPart),
					method: 'PUT',
					sessionId
				};
				
				for (const paramVal of goodValues) {
					
					const rep = await doJsonRequest<void>(reqOpts, paramVal);
					expect(rep.status).withContext('status for successful parameter value update').toBe(api.PARAM_SC.ok);
					
					const paramOnServer = await getParam();
					expect(deepEqual(paramVal, paramOnServer)).withContext('parameter value on the server should be set to new value').toBe(true);
					
				}
				
				await expectNonAcceptanceOfBadJsonRequest(
					reqOpts, maxBodyLen, badValues
				);
				
				await expectNonAcceptanceOfBadSessionId(reqOpts);
				
			});
			
		}
	}
	
	// TODO add route checking for other parameters,
	//		write stricter good/bad values that go into the check
	
	describe(`user's initial public key`, checkParamRoutes(
		api.p.initPubKey.URL_END,
		[],
		[ 1, undefined, 'string', [ 1, 2 ], [] ],
		4*1024
	));
	
	describe(`invites for anonymous senders`, checkParamRoutes(
		api.p.anonSenderInvites.URL_END,
		[ {} ],
		[ 1, null, undefined, 'string' ],
		40*1024
	));
	
	itAsync(`closing session`, async () => {
		const sessionId = await startSession(user1);
		
		const reqOpts: RequestOpts = {
			url: resolveUrl(confUrl, api.closeSession.URL_END),
			method: 'POST',
			sessionId
		};
		
		// normal closing of a session
		let rep = await doBodylessRequest<void>(reqOpts);
		expect(rep.status).withContext('status for successful closing of session').toBe(200);
		
		// repeated call should see invalid session respose
		rep = await doBodylessRequest<void>(reqOpts);
		expect(rep.status).toBe(api.ERR_SC.needAuth);
		
		reqOpts.sessionId = await startSession(user1);
		
		await expectNonAcceptanceOfNonEmptyBody(reqOpts);
		
		await expectNonAcceptanceOfBadSessionId(reqOpts);
		
	});
	
});