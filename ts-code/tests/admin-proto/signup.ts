/*
 Copyright (C) 2016, 2020 - 2021 3NSoft Inc.
 
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

import { afterEachAsync, beforeEachAsync, itAsync } from '../libs-for-tests/async-jasmine';
import { AdminComponent } from '../libs-for-tests/server-components/admin';
import { doJsonRequest, RequestOpts } from '../libs-for-tests/xhr-utils';
import * as signupApi from '../../lib-common/admin-api/signup';
import { expectNonAcceptanceOfBadJsonRequest } from '../shared-checks/requests';
import { use } from '../../lib-common/jwkeys';
import { box } from 'ecma-nacl';

describe('Admin', () => {

	describe('signup subsystem', () => {

		let admin: AdminComponent;
		const signupDomains = [ 'first.org', 'second.org' ];

		beforeEachAsync(async () => {
			admin = new AdminComponent(signupDomains);
			await admin.start();
		});

		afterEachAsync(async () => {
			await admin.stop();
			admin = (undefined as any);
		});

		itAsync('tells available addresses for a given name', async () => {

			const REQ_SIZE_LIMIT = 1024;

			const name = 'Bob Marley ';

			const reqOpts: RequestOpts= {
				url: admin.signupUrl + signupApi.availableAddressesForName.URL_END,
				method: 'POST',
				responseType: 'json'
			};

			// request with ok name
			let req: signupApi.availableAddressesForName.Request = { name };
			const rep = await doJsonRequest<string[]>(reqOpts, req);
			expect(rep.status).toBe(signupApi.availableAddressesForName.SC.ok, 'status code for OK reply');
			expect(Array.isArray(rep.data)).toBe(true, 'OK reply is an array');
			expect(rep.data.length).toBe(signupDomains.length, 'with no users, all domains should used as options for available addresses');
			for (const domain of signupDomains) {
				expect(rep.data).toContain(name+'@'+domain);
			}

			// requests with bad names and with bad json's
			const badNames = [ name+'@something',	// char '@' not allowed in name
				5, null, undefined, {} ];	// non-strings
			const badJSONs: any[] = [ name, 5, null, undefined, [ name ],
				{ a: 1 } ];
			for (const badName of badNames) {
				req = { name: <string> badName };
				badJSONs.push(req);
			}
			await expectNonAcceptanceOfBadJsonRequest(reqOpts,
				REQ_SIZE_LIMIT, badJSONs);

		});

		itAsync('tells available domains', async () => {

			const REQ_SIZE_LIMIT = 1024;

			const reqOpts: RequestOpts= {
				url: admin.signupUrl + signupApi.availableDomains.URL_END,
				method: 'POST',
				responseType: 'json'
			};

			const req: signupApi.availableDomains.Request = {};
			const rep = await doJsonRequest<string[]>(reqOpts, req);
			expect(rep.status).toBe(signupApi.availableDomains.SC.ok, 'status code for OK reply');
			expect(Array.isArray(rep.data)).toBe(true, 'OK reply is an array');
			expect(rep.data.length).toBe(signupDomains.length, 'with no users, all domains should used as options for available addresses');
			for (const domain of signupDomains) {
				expect(rep.data).toContain(domain);
			}

			// requests with bad json's
			const badJSONs: any[] = [ { signupToken: 4 } ];
			await expectNonAcceptanceOfBadJsonRequest(
				reqOpts, REQ_SIZE_LIMIT, badJSONs);

		});

		async function getAvailableAddressesFor(name: string): Promise<string[]> {
			const reqOpts: RequestOpts= {
				url: admin.signupUrl + signupApi.availableAddressesForName.URL_END,
				method: 'POST',
				responseType: 'json'
			};
			const req: signupApi.availableAddressesForName.Request = { name };
			const rep = await doJsonRequest<string[]>(reqOpts, req);
			expect(rep.status).toBe(signupApi.availableAddressesForName.SC.ok);
			return rep.data;
		} 

		function makeAddUserReq(
			userId: string, signupToken?: string
		): signupApi.addUser.Request {
			return {
				userId,
				storage: {
					kdParams: {}
				},
				mailerId: {
					defaultPKey: {
						pkey: {
							alg: box.JWK_ALG_NAME,
							kid: (Buffer.alloc(12)).toString('base64'),
							use: use.MID_PKLOGIN,
							k: (Buffer.alloc(box.KEY_LENGTH)).toString('base64')
						},
						kdParams: {}
					},
					otherPKeys: [ {
							alg: box.JWK_ALG_NAME,
							kid: (Buffer.alloc(12)).toString('base64'),
							use: use.MID_PKLOGIN,
							k: (Buffer.alloc(box.KEY_LENGTH)).toString('base64')
						} ]
				},
				signupToken
			};
		}

		function makeBadAddUserReq(goodId: string): any[] {
			const name = 'Bob Marley';
			const badJSONs: any[] = [ name, 5, null, undefined, [ name ],
				{ a: 1 } ];
			const badIds = [ 'bad domain str',
				'', ' ', '\t', '\n',	// these are all equivalent to empty string
				5, null, undefined, {} ];	// non-strings
			for (const id of badIds) {
				const req = makeAddUserReq(<string> id);
				badJSONs.push(req);
			}
			let req = makeAddUserReq(goodId);
			delete req.userId;
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.storage;
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.storage.kdParams;
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.mailerId;
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.mailerId.defaultPKey;
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.mailerId.defaultPKey.pkey.alg;
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.mailerId.defaultPKey.pkey.k;
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.mailerId.defaultPKey.pkey.kid;
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.mailerId.defaultPKey.pkey.use;
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.mailerId.defaultPKey.kdParams;
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.mailerId.otherPKeys;
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.mailerId.otherPKeys[0];
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.mailerId.otherPKeys[0].alg;
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.mailerId.otherPKeys[0].k;
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.mailerId.otherPKeys[0].kid;
			badJSONs.push(req);
			req = makeAddUserReq(goodId);
			delete req.mailerId.otherPKeys[0].use;
			badJSONs.push(req);
			return badJSONs;
		}

		async function addNewUser(
			userId: string, signupToken?: string
		): Promise<void> {
			const reqOpts: RequestOpts= {
				url: admin.signupUrl + signupApi.addUser.URL_END,
				method: 'POST'
			};
			const req = makeAddUserReq(userId, signupToken);
			let rep = await doJsonRequest<string[]>(reqOpts, req);
			expect(rep.status).toBe(signupApi.addUser.SC.ok, 'status when user is added');
			rep = await doJsonRequest<string[]>(reqOpts, req);
			expect(rep.status).toBe(signupApi.addUser.SC.userAlreadyExists, 'status when user already exists');
		}

		itAsync('adds new user', async () => {

			const REQ_SIZE_LIMIT = 4*1024;

			const reqOpts: RequestOpts= {
				url: admin.signupUrl + signupApi.addUser.URL_END,
				method: 'POST'
			};

			const name = 'Bob Marley ';
			let addresses = await getAvailableAddressesFor(name);
			let numOfAvailableAddresses = addresses.length;
			expect(numOfAvailableAddresses).toBe(signupDomains.length);
			
			// requests with bad json's
			const badJSONs = makeBadAddUserReq(addresses[0]);
			await expectNonAcceptanceOfBadJsonRequest(reqOpts,
				REQ_SIZE_LIMIT, badJSONs);
			
			// normal adding users
			for (const userId of addresses) {
				expect(addresses).toContain(userId);
				await addNewUser(userId);
				numOfAvailableAddresses -= 1;
				addresses = await getAvailableAddressesFor(name);
				expect(addresses.length).toBe(numOfAvailableAddresses);
				expect(addresses).not.toContain(userId);
			}

		});

		itAsync(`adds new user with token`, async () => {
			const reqOpts: RequestOpts= {
				url: admin.signupUrl + signupApi.addUser.URL_END,
				method: 'POST'
			};

			// note that new id has other domain that isn't set anywhere
			const userId = 'Pink Floyd @home.town';

			// let's try to do this without any token
			let req = makeAddUserReq(userId);
			let rep = await doJsonRequest<string[]>(reqOpts, req);
			expect(rep.status).toBe(signupApi.addUser.SC.unauthorized, 'status when no token given');

			// create token, here setup code uses spec-server specific code
			const token = await admin.createSingleUserSignupTokenFor(userId);
			req = makeAddUserReq(userId, token);
			rep = await doJsonRequest<string[]>(reqOpts, req);
			expect(rep.status).toBe(signupApi.addUser.SC.ok, 'status when user is added');

		});

	});

});
