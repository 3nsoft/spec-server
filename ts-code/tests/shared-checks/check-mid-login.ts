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

import { itAsync } from '../libs-for-tests/async-jasmine';
import { authSession, startSession, ERR_SC } from '../../lib-common/service-api/mailer-id/login';
import { doJsonRequest, RequestOpts } from '../libs-for-tests/xhr-utils';
import { startMidSession, provisionMidSigner, User } from '../libs-for-tests/mailerid';
import { expectNonAcceptanceOfBadJsonRequest, expectNonAcceptanceOfBadSessionId } from './requests';
import * as mid from '../../lib-common/mid-sigs-NaCl-Ed';
import { bytesSync as randomBytes } from '../../lib-common/random-node';
import { parse as parseUrl, resolve as resolveUrl } from 'url';

export function midLoginSpecs(
	loginUrl: () => string,
	user: () => User
): () => void {
	return () => {
		
		itAsync('first request starts session', async () => {
			
			const reqOpts: RequestOpts= {
				url: resolveUrl(loginUrl(), startSession.URL_END),
				method: 'POST',
				responseType: 'json'
			};
			
			// request with known user id
			let req: startSession.Request = { userId: user().id };
			let rep = await doJsonRequest<startSession.Reply>(reqOpts, req);
			expect(rep.status).withContext('status for ok reply').toBe(startSession.SC.ok);
			expect(typeof rep.data).toBe('object');
			expect(typeof rep.data.sessionId).withContext('session id be in reply').toBe('string');
			
			// duplicating request, with session id now in a header
			reqOpts.sessionId = rep.data.sessionId;
			rep = await doJsonRequest<startSession.Reply>(reqOpts, req);
			expect(rep.status).withContext('reaction to duplicate request').toBe(ERR_SC.duplicate);
			delete reqOpts.sessionId;
			
			// when user id is unknown
			req = { userId: 'unknown user @some.domain' };
			rep = await doJsonRequest<startSession.Reply>(reqOpts, req);
			expect(rep.status).withContext('status code for an unknown user id').toBe(startSession.SC.unknownUser);
			
			// requests with bad json's
			const badIds = [ '', ' ', '\t', '\n',	// equivalent to empty string
				5, null, undefined, {} ];	// non-strings
			const badJSONs: any[] = [ 'bar', 5, null, undefined, [ 'blah' ],
				{ a: 1 } ];
			for (const id of badIds) {
				req = { userId: <string> id };
				badJSONs.push(req);
			}
			const REQ_SIZE_LIMIT = 1024;
			await expectNonAcceptanceOfBadJsonRequest(reqOpts,
				REQ_SIZE_LIMIT, badJSONs);
			
		});
		
		itAsync('second request authenticates session', async () => {
			
			const url = loginUrl();
			let sessionId = await startMidSession(url, user().id);
			const uInfo = user();
			
			let midSigner = await provisionMidSigner(uInfo.midUrl, uInfo);
			
			const reqOpts: RequestOpts= {
				url: resolveUrl(loginUrl(), authSession.URL_END),
				method: 'POST',
				responseType: 'json',
				sessionId
			};
			
			const serviceDomain = parseUrl(loginUrl()).hostname;
			if (!serviceDomain) { throw new Error(
				`Cannot get hostname from ${loginUrl()}`); }
			const req: authSession.Request = {
				assertion: midSigner.generateAssertionFor(
					serviceDomain, sessionId),
				provCert: midSigner.providerCert,
				userCert: midSigner.userCert
			};
			
			let rep = await doJsonRequest<void>(reqOpts, req);
			expect(rep.status).withContext('status for ok reply').toBe(authSession.SC.ok);
			
			// repeating request is not ok
			rep = await doJsonRequest<void>(reqOpts, req);
			expect(rep.status).withContext('reaction to duplicate request').toBe(ERR_SC.duplicate);
			
			// wrong assertion is from a different session
			sessionId = await startMidSession(url, user().id);
			reqOpts.sessionId = sessionId;
			rep = await doJsonRequest<void>(reqOpts, req);
			expect(rep.status).withContext('status for autherization failure').toBe(authSession.SC.authFailed);
			
			// wrong domain in assertion
			sessionId = await startMidSession(url, user().id);
			reqOpts.sessionId = sessionId;
			req.assertion = midSigner.generateAssertionFor(
				'other.domain', sessionId);
			rep = await doJsonRequest<void>(reqOpts, req);
			expect(rep.status).withContext('status for autherization failure').toBe(authSession.SC.authFailed);
			
			// fake certs
			const fakeRoot = mid.idProvider.generateRootKey(
				uInfo.midUrl, 365*12*60*60, randomBytes);
			const fakeProvider = mid.idProvider.generateProviderKey(
				uInfo.midUrl, 30*12*60*60, fakeRoot.skey, randomBytes);
			const fakeIdCertifier = mid.idProvider.makeIdProviderCertifier(
				uInfo.midUrl, 24*60*60, fakeProvider.skey);
			const fakeUserKeys = mid.user.generateSigningKeyPair(randomBytes);
			const fakeUserCert = fakeIdCertifier.certify(
				fakeUserKeys.pkey, user().id);
			midSigner = mid.user.makeMailerIdSigner(
				fakeUserKeys.skey, fakeUserCert, fakeProvider.cert);
			sessionId = await startMidSession(url, user().id);
			reqOpts.sessionId = sessionId;
			req.assertion = midSigner.generateAssertionFor(
				serviceDomain, sessionId);
			req.userCert = fakeUserCert;	// keep unrelated provCert
			rep = await doJsonRequest<void>(reqOpts, req);
			expect(rep.status).withContext('status for autherization failure').toBe(authSession.SC.authFailed);
			sessionId = await startMidSession(url, user().id);
			reqOpts.sessionId = sessionId;
			req.assertion = midSigner.generateAssertionFor(
				serviceDomain, sessionId);
			req.provCert = fakeProvider.cert;
			req.userCert = fakeUserCert;
			rep = await doJsonRequest<void>(reqOpts, req);
			expect(rep.status).withContext('status for autherization failure').toBe(authSession.SC.authFailed);
			
			// bad json
			const REQ_SIZE_LIMIT = 4*1024;
			sessionId = await startMidSession(url, user().id);
			reqOpts.sessionId = sessionId;
			const badJSONs: any[] = [ 1, null, undefined, 'string' ];
			await expectNonAcceptanceOfBadJsonRequest(reqOpts, REQ_SIZE_LIMIT,
				badJSONs);
			
			// bad session id
			await expectNonAcceptanceOfBadSessionId(reqOpts);
			
		});
		
	};
}

Object.freeze(exports);