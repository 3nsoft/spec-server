/*
 Copyright (C) 2016 3NSoft Inc.
 
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

import { afterAllAsync, beforeAllAsync, itAsync }
	from '../../libs-for-tests/async-jasmine';
import { StorageComponent }
	from '../../libs-for-tests/server-components/3nstorage';
import { User, doMailerIdLogin } from '../../libs-for-tests/mailerid';
import { midLoginSpecs } from '../../shared-checks/check-mid-login';
import { resolve as resolveUrl } from 'url';
import * as api from '../../../lib-common/service-api/3nstorage/owner';
import { RequestOpts, doBodylessRequest, doJsonRequest }
	from '../../libs-for-tests/xhr-utils';
import { expectNonAcceptanceOfBadSessionId, expectNonAcceptanceOfNonEmptyBody,
	expectNonAcceptanceOfBadJsonRequest }
	from '../../shared-checks/requests';
import { startSession } from './owner/test-utils';
import { resolve } from 'path';
import { addSpecsFrom } from '../../libs-for-tests/spec-assembly';
import { deepEqual }  from '../../libs-for-tests/json-equal';

const SPECS_FOLDER = resolve(__dirname, './owner/specs');

describe('3NStorage owner service', () => {
	
	let storageServer: StorageComponent;
	const midServiceDomain = 'localhost';
	const signupDomains = [ 'company.inc', 'personal.net' ];
	let user: User;
	
	beforeAllAsync(async () => {
		storageServer = new StorageComponent(signupDomains, midServiceDomain);
		await storageServer.start();
		user = await storageServer.addUser(
			`Bob Johnson @${signupDomains[0]}`);
		await storageServer.stop(false);
	});
	
	afterAllAsync(async () => {
		if (storageServer.isRunning()) {
			await storageServer.stop();
		} else {
			await storageServer.clean();
		}
		storageServer = (undefined as any);
	});
	
	describe('session', () => {

		beforeAllAsync(async () => {
			await storageServer.restart();
		});

		describe('MailerId login', midLoginSpecs(
			() => resolveUrl(user.storageOwnerUrl, api.midLogin.MID_URL_PART),
			() => user ));
		
		itAsync('closing', async () => {
			const sessionId = await startSession(user);
			
			const reqOpts: RequestOpts = {
				url: resolveUrl(user.storageOwnerUrl, api.closeSession.URL_END),
				method: 'POST',
				sessionId
			};
			
			// normal closing of a session
			let rep = await doBodylessRequest<void>(reqOpts);
			expect(rep.status).toBe(200, 'status for successful closing of session');
			
			// repeated call should see invalid session respose
			rep = await doBodylessRequest<void>(reqOpts);
			expect(rep.status).toBe(api.ERR_SC.needAuth);
			
			reqOpts.sessionId = await doMailerIdLogin(
				resolveUrl(user.storageOwnerUrl, api.midLogin.MID_URL_PART),
				user);
			
			await expectNonAcceptanceOfNonEmptyBody(reqOpts);
			
			await expectNonAcceptanceOfBadSessionId(reqOpts);
			
		});
	
		itAsync('dictates parameters to client side', async () => {
			const ownerUrl = user.storageOwnerUrl;
			const sessionId = await startSession(user);
			
			const reqOpts: RequestOpts = {
				url: resolveUrl(ownerUrl, api.sessionParams.URL_END),
				method: 'GET',
				responseType: 'json',
				sessionId
			};
			
			const rep = await doBodylessRequest<api.sessionParams.Reply>(reqOpts);
			expect(rep.status).toBe(200, 'for successful getting of session parameters');
			expect(typeof rep.data.maxChunkSize).toBe('number');
			expect(rep.data.maxChunkSize).not.toBeLessThan(64*1024);
			
			await expectNonAcceptanceOfBadSessionId(reqOpts);
			
		});

	});

	function checkParamRoutes(paramUrlPart: string, goodValues: any[],
			badValues: any[], maxBodyLen: number): () => void {
		return () => {
			
			let sessionId: string;
			
			beforeAllAsync(async () => {
				sessionId = await startSession(user); 
			});
			
			itAsync('is readable', async () => {
				
				const reqOpts: RequestOpts = {
					url: resolveUrl(user.storageOwnerUrl, paramUrlPart),
					method: 'GET',
					responseType: 'json',
					sessionId
				};
				
				const rep = await doBodylessRequest<any>(reqOpts);
				expect(rep.status).toBe(api.PARAM_SC.ok, 'status for reading parameter');
		
				await expectNonAcceptanceOfBadSessionId(reqOpts);
				
			});
			
			async function getParam(): Promise<any> {
				const reqOpts: RequestOpts = {
					url: resolveUrl(user.storageOwnerUrl, paramUrlPart),
					method: 'GET',
					responseType: 'json',
					sessionId
				};
				const rep = await doBodylessRequest<any>(reqOpts);
				expect(rep.status).toBe(api.PARAM_SC.ok);
				return rep.data;
			}
			
			itAsync('is writable', async () => {
				
				const initValue = await getParam();
				
				const reqOpts: RequestOpts = {
					url: resolveUrl(user.storageOwnerUrl, paramUrlPart),
					method: 'PUT',
					sessionId
				};
				
				for (const paramVal of goodValues) {
					
					const rep = await doJsonRequest<void>(reqOpts, paramVal);
					expect(rep.status).toBe(api.PARAM_SC.ok, 'status for successful parameter value update');
					
					const paramOnServer = await getParam();
					expect(deepEqual(paramVal, paramOnServer)).toBe(true, 'parameter value on the server should be set to new value');
					
				}
				
				await expectNonAcceptanceOfBadJsonRequest(
					reqOpts, maxBodyLen, badValues);
				
				await expectNonAcceptanceOfBadSessionId(reqOpts);
				
			});
			
		}
	}
	
	describe(`user's key derivation parameters`, checkParamRoutes(
		api.keyDerivParams.URL_END,
		[],
		[ 1, undefined, 'string', [ 1, 2 ], [] ],
		1024));
	
	addSpecsFrom(SPECS_FOLDER, () => ({ user, storageServer }));
	
});