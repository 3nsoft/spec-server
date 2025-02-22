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
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { isLikeSignedKeyCert, SignedLoad } from '../../lib-common/jwkeys';
import { doJsonRequest, RequestOpts, doBodylessRequest, doBinaryRequest }
	from './xhr-utils';
import { authSession, startSession }
	from '../../lib-common/service-api/mailer-id/login';
import { certify as certApi }
	from '../../lib-common/service-api/mailer-id/provisioning';
import { user as midUser }	from '../../lib-common/mid-sigs-NaCl-Ed';
import { doPubKeyLogin, User } from './pkl';
import { bytesSync as randomBytes } from '../../lib-common/random-node';
import { parse as parseUrl } from 'url';

export { User } from './pkl';

async function getMidData(midUrl: string): Promise<any> {
	let reqOpts: RequestOpts= {
		url: midUrl,
		method: 'GET',
		responseType: 'json'
	};
	let rep = await doBodylessRequest<any>(reqOpts);
	expect(rep.status).toBe(200);
	return rep.data;
}

/**
 * @param midUrl
 * @return a promise, resolvable to MailerId service's provisioning url.
 */
export async function getProvPath(midUrl: string): Promise<any> {
	let midData = await getMidData(midUrl);
	let prov: string = midData['provisioning']
	expect(typeof prov).toBe('string');
	// return url with provision path
	let pathStarts = midUrl.indexOf('/', midUrl.indexOf('://')+3);
	return midUrl.substring(0, pathStarts) + prov;
}

export async function getMidRoot(midUrl: string): Promise<SignedLoad> {
	let midData = await getMidData(midUrl);
	let rootCert = midData["current-cert"];
	expect(isLikeSignedKeyCert(rootCert)).toBe(true);
	return rootCert;
}

export async function startMidSession(loginUrl: string, userId: string):
		Promise<string> {
	let reqOpts: RequestOpts= {
		url: loginUrl + startSession.URL_END,
		method: 'POST',
		responseType: 'json'
	};
	let req: startSession.Request = { userId };
	let rep = await doJsonRequest<startSession.Reply>(reqOpts, req);
	expect(rep.status).toBe(startSession.SC.ok);
	return rep.data.sessionId;
}

export async function provisionMidSigner(midServiceUrl: string, user: User):
		Promise<midUser.MailerIdSigner> {
	let provUrl = await getProvPath(midServiceUrl);
	let sessParams = await doPubKeyLogin(provUrl, user);
	let reqOpts: RequestOpts= {
		url: provUrl + certApi.URL_END,
		method: 'POST',
		sessionId: sessParams.sessionId,
		responseType: 'arraybuffer'
	};
	let midSigningPair = midUser.generateSigningKeyPair(randomBytes);
	let reqData: certApi.Request = {
		pkey: midSigningPair.pkey,
		duration: 12*60*60
	};
	let encrBody = sessParams.sessEncr.packJSON(reqData);
	let rep = await doBinaryRequest<Uint8Array>(reqOpts, encrBody);
	expect(rep.status).toBe(certApi.SC.ok);
	let repData: certApi.Reply = sessParams.sessEncr.openJSON(rep.data);
	return midUser.makeMailerIdSigner(
		midSigningPair.skey, repData.userCert, repData.provCert);
}

export async function doMailerIdLogin(loginUrl: string, user: User):
		Promise<string> {
	let sessionId = await startMidSession(loginUrl, user.id);
	let midSigner = await provisionMidSigner(user.midUrl, user);
	let reqOpts: RequestOpts= {
		url: loginUrl + authSession.URL_END,
		method: 'POST',
		responseType: 'json',
		sessionId
	};
	let serviceDomain = parseUrl(loginUrl).hostname;
	if (!serviceDomain) { throw new Error(
		`Cannot parse hostname from login url ${loginUrl}`); }
	let req: authSession.Request = {
		assertion: midSigner.generateAssertionFor(
			serviceDomain, sessionId),
		provCert: midSigner.providerCert,
		userCert: midSigner.userCert
	};
	let rep = await doJsonRequest<void>(reqOpts, req);
	expect(rep.status).toBe(authSession.SC.ok);
	return sessionId;
}

Object.freeze(exports);