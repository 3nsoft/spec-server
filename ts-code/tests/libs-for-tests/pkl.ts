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

import * as pklApi from '../../lib-common/service-api/pub-key-login';
import { base64 } from '../../lib-common/buffer-utils';
import { box, secret_box as sbox, nonce as nonceMod, arrays }
	from 'ecma-nacl';
import { makeSessionEncryptor, SessionEncryptor }
	from '../../lib-common/session-encryptor';
import { doJsonRequest, RequestOpts, doBinaryRequest }
	from './xhr-utils';
import { parse as parseUrl, resolve as resolveUrl } from 'url';
import { bytesEqual } from './bytes-equal';

export interface User {
	id: string;
	loginDefaultSKey: Uint8Array;
	loginLabeledSKey: {
		kid: string;
		k: Uint8Array;
	};
	midUrl: string;
	storageOwnerUrl: string;
}

export interface ExchangeCrypto {
	sessEncr: SessionEncryptor;
	serverVerificationBytes: Uint8Array;
	encResponse: Uint8Array;
}

export function decryptSessionParamsForCurve25519(r: pklApi.start.Reply,
		loginSKey: Uint8Array): ExchangeCrypto {
	let serverPKey = base64.open(r.serverPubKey);
	expect(serverPKey.length).toBe(box.KEY_LENGTH);
	let sharedKey = box.calc_dhshared_key(serverPKey, loginSKey);
	let encChallenge = base64.open(r.sessionKey);
	expect(encChallenge.length).toBe(
		sbox.NONCE_LENGTH + sbox.KEY_LENGTH);
	let nonce = encChallenge.subarray(0, sbox.NONCE_LENGTH);
	let zeros = new Uint8Array(sbox.KEY_LENGTH);
	let stream = sbox.pack(zeros, nonce, sharedKey).subarray(sbox.POLY_LENGTH);
	let sessionKey = new Uint8Array(
		encChallenge.subarray(sbox.NONCE_LENGTH));
	for (var i=0; i < sbox.KEY_LENGTH; i+=1) {
		sessionKey[i] ^= stream[i];
	}
	let serverVerificationBytes =
		sbox.pack(sessionKey, nonce, sharedKey)
		.subarray(0, sbox.POLY_LENGTH);
	nonceMod.advanceOddly(nonce);
	let sessEncr = makeSessionEncryptor(sessionKey, nonce);
	let encResponse = sessEncr.pack(sessionKey);
	arrays.wipe(sessionKey);
	return { sessEncr, serverVerificationBytes, encResponse };
}

export interface ExchangeParams {
	crypto: ExchangeCrypto;
	sessionId: string;
}

export async function startPKLSession(loginUrl: string, user: User,
		useDefaultKey: boolean): Promise<ExchangeParams> {
	let reqOpts: RequestOpts= {
		url: resolveUrl(loginUrl, pklApi.start.URL_END),
		method: 'POST',
		responseType: 'json'
	};
	let req: pklApi.start.Request = (useDefaultKey ?
		{ userId: user.id } :
		{ userId: user.id, kid: user.loginLabeledSKey.kid });
	let rep = await doJsonRequest<pklApi.start.Reply>(reqOpts, req);
	expect(rep.status).toBe(pklApi.start.SC.ok);
	let skey = (useDefaultKey ? user.loginDefaultSKey : user.loginLabeledSKey.k)
	return {
		sessionId: rep.data.sessionId,
		crypto: decryptSessionParamsForCurve25519(rep.data, skey)
	};
}

export interface SessionParams {
	sessEncr: SessionEncryptor;
	sessionId: string;
}

async function validatePKLSession(loginUrl: string,
		exchangeParams: ExchangeParams): Promise<SessionParams> {
	let reqOpts: RequestOpts= {
		url: resolveUrl(loginUrl, pklApi.complete.URL_END),
		method: 'POST',
		sessionId: exchangeParams.sessionId,
		responseType: 'arraybuffer'
	};
	let rep = await doBinaryRequest<Uint8Array>(
		reqOpts, exchangeParams.crypto.encResponse);
	expect(rep.status).toBe(pklApi.complete.SC.ok);
	expect(rep.data.length).toBe(sbox.POLY_LENGTH);
	expect(bytesEqual(rep.data, exchangeParams.crypto.serverVerificationBytes))
	.toBe(true);
	return {
		sessionId: exchangeParams.sessionId,
		sessEncr: exchangeParams.crypto.sessEncr
	};
}

export async function doPubKeyLogin(loginUrl: string, user: User):
		Promise<SessionParams> {
	let exchangeParams = await startPKLSession(loginUrl, user, false);
	return validatePKLSession(loginUrl, exchangeParams);
}

Object.freeze(exports);