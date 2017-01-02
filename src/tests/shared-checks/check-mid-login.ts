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

import { itAsync } from '../libs-for-tests/async-jasmine';
import { authSession, startSession, ERR_SC }
	from '../../lib-common/service-api/mailer-id/login';
import { doJsonRequest, RequestOpts } from '../libs-for-tests/xhr-utils';
import { startMidSession, provisionMidSigner, User }
	from '../libs-for-tests/mailerid';
import { expectNonAcceptanceOfBadJsonRequest,
	expectNonAcceptanceOfBadSessionId } from '../shared-checks/requests';
import { utf8 } from '../../lib-common/buffer-utils';
import * as mid from '../../lib-common/mid-sigs-NaCl-Ed';
import { bytes as randomBytes } from '../../lib-common/random-node';
import { parse as parseUrl, resolve as resolveUrl } from 'url';

export function midLoginSpecs(
		loginUrl: () => string,
		user: () => User): () => void {
	return () => {
		
		itAsync('first request starts session', async () => {
			
			let reqOpts: RequestOpts= {
				url: resolveUrl(loginUrl(), startSession.URL_END),
				method: 'POST',
				responseType: 'json'
			};
			
			// request with known user id
			let req: startSession.Request = { userId: user().id };
			let rep = await doJsonRequest<startSession.Reply>(reqOpts, req);
			expect(rep.status).toBe(startSession.SC.ok, 'status for ok reply');
			expect(typeof rep.data).toBe('object');
			expect(typeof rep.data.sessionId).toBe('string', 'session id be in reply');
			
			// duplicating request, with session id now in a header
			reqOpts.sessionId = rep.data.sessionId;
			rep = await doJsonRequest<startSession.Reply>(reqOpts, req);
			expect(rep.status).toBe(ERR_SC.duplicate, 'reaction to duplicate request');
			delete reqOpts.sessionId;
			
			// when user id is unknown
			req = { userId: 'unknown user @some.domain' };
			rep = await doJsonRequest<startSession.Reply>(reqOpts, req);
			expect(rep.status).toBe(startSession.SC.unknownUser, 'status code for an unknown user id');
			
			// requests with bad json's
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
			
		});
		
		itAsync('second request authenticates session', async () => {
			
			let url = loginUrl();
			let sessionId = await startMidSession(url, user().id);
			let uInfo = user();
			
			let midSigner = await provisionMidSigner(uInfo.midUrl, uInfo);
			
			let reqOpts: RequestOpts= {
				url: resolveUrl(loginUrl(), authSession.URL_END),
				method: 'POST',
				responseType: 'json',
				sessionId
			};
			
			let serviceDomain = parseUrl(uInfo.midUrl).hostname;
			if (!serviceDomain) { throw new Error(
				`Cannot get hostname from ${uInfo.midUrl}`); }
			let req: authSession.Request = {
				assertion: midSigner.generateAssertionFor(
					serviceDomain, sessionId),
				provCert: midSigner.providerCert,
				userCert: midSigner.userCert
			};
			
			let rep = await doJsonRequest<void>(reqOpts, req);
			expect(rep.status).toBe(authSession.SC.ok, 'status for ok reply');
			
			// repeating request is not ok
			rep = await doJsonRequest<void>(reqOpts, req);
			expect(rep.status).toBe(ERR_SC.duplicate, 'reaction to duplicate request');
			
			// wrong assertion is from a different session
			sessionId = await startMidSession(url, user().id);
			reqOpts.sessionId = sessionId;
			rep = await doJsonRequest<void>(reqOpts, req);
			expect(rep.status).toBe(authSession.SC.authFailed, 'status for autherization failure');
			
			// wrong domain in assertion
			sessionId = await startMidSession(url, user().id);
			reqOpts.sessionId = sessionId;
			req.assertion = midSigner.generateAssertionFor(
				'other.domain', sessionId);
			rep = await doJsonRequest<void>(reqOpts, req);
			expect(rep.status).toBe(authSession.SC.authFailed, 'status for autherization failure');
			
			// fake certs
			let fakeRoot = mid.idProvider.generateRootKey(
				uInfo.midUrl, 365*12*60*60, randomBytes);
			let fakeProvider = mid.idProvider.generateProviderKey(
				uInfo.midUrl, 30*12*60*60, fakeRoot.skey, randomBytes);
			let fakeIdCertifier = mid.idProvider.makeIdProviderCertifier(
				uInfo.midUrl, 24*60*60, fakeProvider.skey);
			let fakeUserKeys = mid.user.generateSigningKeyPair(randomBytes);
			let fakeUserCert = fakeIdCertifier.certify(
				fakeUserKeys.pkey, user().id);
			midSigner = mid.user.makeMailerIdSigner(
				fakeUserKeys.skey, fakeUserCert, fakeProvider.cert);
			sessionId = await startMidSession(url, user().id);
			reqOpts.sessionId = sessionId;
			req.assertion = midSigner.generateAssertionFor(
				serviceDomain, sessionId);
			req.userCert = fakeUserCert;	// keep unrelated provCert
			rep = await doJsonRequest<void>(reqOpts, req);
			expect(rep.status).toBe(authSession.SC.authFailed, 'status for autherization failure');
			sessionId = await startMidSession(url, user().id);
			reqOpts.sessionId = sessionId;
			req.assertion = midSigner.generateAssertionFor(
				serviceDomain, sessionId);
			req.provCert = fakeProvider.cert;
			req.userCert = fakeUserCert;
			rep = await doJsonRequest<void>(reqOpts, req);
			expect(rep.status).toBe(authSession.SC.authFailed, 'status for autherization failure');
			
			// bad json
			const REQ_SIZE_LIMIT = 4*1024;
			sessionId = await startMidSession(url, user().id);
			reqOpts.sessionId = sessionId;
			let badJSONs: any[] = [ 1, null, undefined, 'string' ];
			await expectNonAcceptanceOfBadJsonRequest(reqOpts, REQ_SIZE_LIMIT,
				badJSONs);
			
			// bad session id
			await expectNonAcceptanceOfBadSessionId(reqOpts);
			
		});
		
	};
}

Object.freeze(exports);