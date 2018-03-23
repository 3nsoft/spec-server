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
	from '../libs-for-tests/async-jasmine';
import { MailerIdComponent }
	from '../libs-for-tests/server-components/mailerid';
import { getMidRoot } from '../libs-for-tests/mailerid';
import { doJsonRequest, RequestOpts, doBodylessRequest, doBinaryRequest }
	from '../libs-for-tests/xhr-utils';
import { certify as certApi }
	from '../../lib-common/service-api/mailer-id/provisioning';
import * as pklApi from '../../lib-common/service-api/pub-key-login';
import { isLikeSignedKeyCert } from '../../lib-common/jwkeys';
import { expectNonAcceptanceOfBadJsonRequest,
	expectNonAcceptanceOfBadSessionId, UNAUTHORIZED_STATUS,
	expectNonAcceptanceOfBadType, expectNonAcceptanceOfLongBody }
	from '../shared-checks/requests';
import { utf8, base64 } from '../../lib-common/buffer-utils';
import { secret_box as sbox } from 'ecma-nacl';
import { decryptSessionParamsForCurve25519, startPKLSession, doPubKeyLogin,
	User } from '../libs-for-tests/pkl';
import { user as midUser, relyingParty }
	from '../../lib-common/mid-sigs-NaCl-Ed';
import { bytes as randomBytes } from '../../lib-common/random-node';
import { toCanonicalAddress } from '../../lib-common/canonical-address';
import { deepEqual } from '../libs-for-tests/json-equal';
import { JsonKey } from '../../lib-common/jwkeys';
import { bytesEqual } from '../libs-for-tests/bytes-equal';

describe('MailerId', () => {
	
	let midServer: MailerIdComponent;
	const midServiceDomain = 'mailerid.service.domain';
	const signupDomains = [ 'company.inc', 'personal.net' ];
	let user1: User;
	let user2: User;
	
	beforeAllAsync(async () => {
		midServer = new MailerIdComponent(signupDomains, midServiceDomain);
		await midServer.start();
		user1 = await midServer.addUser(`Bob Johnson @${signupDomains[0]}`);
		user2 = await midServer.addUser(`William Young @${signupDomains[1]}`);
	});
	
	afterAllAsync(async () => {
		await midServer.stop();
		midServer = (undefined as any);
	});
	
	itAsync('provides root certificates', async () => {
		
		let reqOpts: RequestOpts= {
			url: midServer.midUrl,
			method: 'GET',
			responseType: 'json'
		};
		let rep = await doBodylessRequest<any>(reqOpts);
		expect(rep.status).toBe(200, 'status code for OK reply');
		expect(Array.isArray(rep.data["previous-certs"])).toBe(true);
		expect(isLikeSignedKeyCert(rep.data["current-cert"])).toBe(true);
		expect(typeof rep.data["provisioning"]).toBe('string');
		
	});
	
	describe('provisioning stage', () => {
		
		let provUrl: string;
		
		beforeAllAsync(async () => {
			provUrl = await midServer.getProvUrl();
		});
		
		// TODO refactor Public Key Login into shared-checks spec, similarly to
		//		MailerId login, so as to reuse it where PKL is used.
		
		async function testFirstReqFor(useDefaultKey: boolean): Promise<void> {
			
			let reqOpts: RequestOpts= {
				url: provUrl + pklApi.start.URL_END,
				method: 'POST',
				responseType: 'json'
			};
			
			// request with known user id
			let req: pklApi.start.Request = (useDefaultKey ?
				{ userId: user1.id } :
				{ userId: user1.id, kid: user1.loginLabeledSKey.kid });
			let rep = await doJsonRequest<pklApi.start.Reply>(reqOpts, req);
			expect(rep.status).toBe(pklApi.start.SC.ok, 'status code for OK reply');
			expect(typeof rep.data).toBe('object');
			expect(typeof rep.data.sessionId).toBe('string');
			expect(() => {
				// note that this user uses NaCl's box (Curve25519)
				decryptSessionParamsForCurve25519(rep.data, user1.loginDefaultSKey);
			}).not.toThrow();
			
			// duplicating request, with session id now in a header
			reqOpts.sessionId = rep.data.sessionId;
			rep = await doJsonRequest<pklApi.start.Reply>(reqOpts, req);
			expect(rep.status).toBe(pklApi.ERR_SC.duplicate, 'reaction to duplicate request');
			delete reqOpts.sessionId;
			
			// when user id is unknown
			req = { userId: 'unknown user @some.domain' };
			rep = await doJsonRequest<pklApi.start.Reply>(reqOpts, req);
			expect(rep.status).toBe(pklApi.start.SC.unknownUser, 'status code for an unknown user id');
			req = { userId: 'unknown user @'+signupDomains[0] };
			rep = await doJsonRequest<pklApi.start.Reply>(reqOpts, req);
			expect(rep.status).toBe(pklApi.start.SC.unknownUser, 'status code for an unknown user id');
			
			// requests with bad user ids and with bad json's
			let badIds = [ '', ' ', '\t', '\n',	// equivalent to empty string
				5, null, undefined, {} ];	// non-strings
			let badJSONs: any[] = [ 'bar', 5, null, undefined, [ 'blah' ],
				{ a: 1 } ];
			for (let id of badIds) {
				req = { userId: <string> id };
				badJSONs.push(req);
			}
			const REQ_SIZE_LIMIT = 1024;
			await expectNonAcceptanceOfBadJsonRequest(reqOpts,
				REQ_SIZE_LIMIT, badJSONs);
			
		}

		itAsync('starts with Public Key Login, using default key',
			() => testFirstReqFor(true));
		
		itAsync('starts with Public Key Login, using non-default (labeled) key',
			() => testFirstReqFor(false));
		
		async function testSecondReqFor(useDefaultKey: boolean): Promise<void> {
			
			let exchangeParams = await startPKLSession(
				provUrl, user1, useDefaultKey);
			
			let reqOpts: RequestOpts= {
				url: provUrl + pklApi.complete.URL_END,
				method: 'POST',
				sessionId: exchangeParams.sessionId,
				responseType: 'arraybuffer'
			};
			
			let rep = await doBinaryRequest<Uint8Array>(
				reqOpts, exchangeParams.crypto.encResponse);
			expect(rep.status).toBe(pklApi.complete.SC.ok, 'status code for successful login completion');
			expect(rep.data.length).toBe(sbox.POLY_LENGTH);
			expect(bytesEqual(rep.data,
				exchangeParams.crypto.serverVerificationBytes))
			.toBe(true, 'returned bytes must be a missing poly part from the challenge, to verify to client, that server knows user\'s public key');
			
			// repeating request is not ok
			rep = await doBinaryRequest<Uint8Array>(
				reqOpts, exchangeParams.crypto.encResponse);
			expect(rep.status).toBe(pklApi.ERR_SC.duplicate, 'reaction to duplicate request');
			
			// send incorrect challenge response
			for (let i=0; i < exchangeParams.crypto.encResponse.length; i+=1) {
				let exchange2 = await startPKLSession(provUrl, user2, useDefaultKey);
				let badReply = exchange2.crypto.encResponse;
				badReply[i] ^= 1;
				reqOpts.sessionId = exchange2.sessionId;
				let rep = await doBinaryRequest<Uint8Array>(reqOpts, badReply);
				expect(rep.status).toBe(pklApi.complete.SC.authFailed);
			}
			let exchange2 = await startPKLSession(provUrl, user2, useDefaultKey);
			let badReply = exchange2.crypto.encResponse.subarray(5);
			reqOpts.sessionId = exchange2.sessionId;
			rep = await doBinaryRequest<Uint8Array>(reqOpts, badReply);
			expect(rep.status).toBe(pklApi.complete.SC.authFailed);
			
			// bad session id
			await expectNonAcceptanceOfBadSessionId(reqOpts);
			
			// too long
			const REQ_SIZE_LIMIT = 1024;
			exchange2 = await startPKLSession(provUrl, user2, useDefaultKey);
			reqOpts.sessionId = exchange2.sessionId;
			await expectNonAcceptanceOfLongBody(reqOpts,
				'application/octet-stream', REQ_SIZE_LIMIT);
			
			// wrong type
			await expectNonAcceptanceOfBadType(reqOpts, 
				'application/octet-stream', exchange2.crypto.encResponse);
			
		}

		itAsync('second request completes Public Key Login, using default key',
			() => testSecondReqFor(true));

		itAsync('second request completes Public Key Login, with non-default key',
			() => testSecondReqFor(true));
		
		itAsync('certifies user\'s MailerId public key', async () => {
			
			let midSigningPair = midUser.generateSigningKeyPair(randomBytes);
			let reqData: certApi.Request = {
				pkey: midSigningPair.pkey,
				duration: 12*60*60
			};
			
			let sessParams = await doPubKeyLogin(provUrl, user1);
			
			let reqOpts: RequestOpts= {
				url: provUrl + certApi.URL_END,
				method: 'POST',
				sessionId: sessParams.sessionId,
				responseType: 'arraybuffer'
			};
			
			let encrBody = sessParams.sessEncr.packJSON(reqData);
			let rep = await doBinaryRequest<Uint8Array>(reqOpts, encrBody);
			expect(rep.status).toBe(certApi.SC.ok, 'status code for OK reply');
			let repData: certApi.Reply = sessParams.sessEncr.openJSON(rep.data);
			let pkeyAndAddress = relyingParty.verifyChainAndGetUserKey({
					root: await getMidRoot(midServer.midUrl),
					prov: repData.provCert,
					user: repData.userCert
				},
				midServer.midServiceDomain,
				Date.now()/1000);
			expect(pkeyAndAddress.address).toBe(toCanonicalAddress(user1.id), 'certificate must be issued for session\'s user canonical address.');
			let pkeyFromCert: JsonKey = {
				alg: pkeyAndAddress.pkey.alg,
				kid: pkeyAndAddress.pkey.kid,
				use: pkeyAndAddress.pkey.use,
				k: base64.pack(pkeyAndAddress.pkey.k)
			};
			expect(deepEqual(pkeyFromCert, midSigningPair.pkey)).toBe(true, 'public key should be exactly the same as given one.');
			
			// session is closed at this request
			rep = await doBinaryRequest<Uint8Array>(
				reqOpts, sessParams.sessEncr.packJSON(reqData));
			expect(rep.status).toBe(UNAUTHORIZED_STATUS, 'session should be closed.');
			
			// messed up cipher body
			sessParams = await doPubKeyLogin(provUrl, user1);
			reqOpts.sessionId = sessParams.sessionId;
			encrBody[20] ^= 1;
			rep = await doBinaryRequest<Uint8Array>(reqOpts, encrBody);
			expect(rep.status).toBe(certApi.SC.cryptoVerifFail);
			
			// empty body
			sessParams = await doPubKeyLogin(provUrl, user1);
			reqOpts.sessionId = sessParams.sessionId;
			rep = await doBinaryRequest<Uint8Array>(reqOpts, new Uint8Array(0));
			expect(rep.status).toBe(certApi.SC.cryptoVerifFail);
			
			// set session for fuzzing below
			sessParams = await doPubKeyLogin(provUrl, user1);
			reqOpts.sessionId = sessParams.sessionId;
			
			// too long
			const REQ_SIZE_LIMIT = 16*1024;
			await expectNonAcceptanceOfLongBody(reqOpts,
				'application/octet-stream', REQ_SIZE_LIMIT);
			
			// wrong type
			encrBody = sessParams.sessEncr.packJSON(reqData);
			await expectNonAcceptanceOfBadType(reqOpts, 
				'application/octet-stream', encrBody);
			
		});
		
	});
	
});