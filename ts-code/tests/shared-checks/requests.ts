/*
 Copyright (C) 2016, 2019, 2025 3NSoft Inc.
 
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

import { doJsonRequest, RequestOpts, request } from '../libs-for-tests/xhr-utils';
import { randomBytes } from 'crypto';
import { utf8 } from '../../lib-common/buffer-utils';
import { copy } from '../libs-for-tests/json-copy';
import { ConnectException } from '../../lib-common/exceptions/http';

const LONG_BODY_STATUS = 413;
const MALFORMED_BODY_STATUS = 400;
const WRONG_CONTENT_TYPE_STATUS = 415;
export const UNAUTHORIZED_STATUS = 401;

/**
 * This function should test json-expecting routes.
 * @param opts
 * @param maxBodyLen
 * @param badJSONs
 * @return a promise, resolvable when all checks are done.
 */
export async function expectNonAcceptanceOfBadJsonRequest(
	opts: RequestOpts, maxBodyLen: number, badJSONs: any[]
): Promise<void> {
	
	// bad json
	for (const badReq of badJSONs) {
		const rep = await doJsonRequest<void>(opts, badReq);
		expect(rep.status).withContext(`status code for malformed request: ${JSON.stringify(badReq)}`).toBe(MALFORMED_BODY_STATUS);
	}
	
	// bad non-json bodies
	const badBodies = [ Buffer.alloc(0), randomBytes(Math.floor(maxBodyLen/2)) ];
	for (const bytes of badBodies) {
		const req = request<void>('application/json', opts);
		req.xhr.send(bytes);
		const rep = await req.promise;
		expect(rep.status).withContext('status code for malformed request').toBe(MALFORMED_BODY_STATUS);
	}
	
	// wrong content type
	await expectNonAcceptanceOfBadType(opts, 'application/json',
		utf8.pack(JSON.stringify({})));
	
	// request that is too long (>maxBodyLen)
	await expectNonAcceptanceOfLongBody(opts, 'application/json', maxBodyLen);
	
}

export declare type BodyType =
	'application/octet-stream' | 'text/plain' | 'application/json';

const bodyTypes = [ 'application/octet-stream',
	'text/plain', 'application/json', undefined ];

export async function expectNonAcceptanceOfBadType(
	opts: RequestOpts, correctType: BodyType, body: Uint8Array
): Promise<void> {
	for (const bt of bodyTypes) {
		if (correctType === bt) { continue; }
		const req = request<void>(bt, opts);
		req.xhr.send(body);
		const rep = await req.promise;
		expect(rep.status).withContext('status code for wrong content type request').toBe(WRONG_CONTENT_TYPE_STATUS);
	}
}

export async function expectNonAcceptanceOfLongBody(
	opts: RequestOpts, bodyType: BodyType, maxBodyLen: number
): Promise<void> {
	const badReq = randomBytes(maxBodyLen+1);
	const req = request<void>(bodyType, opts);
	req.xhr.send(badReq);
	try {
		const rep = await req.promise;
		expect(rep.status).withContext('status code for long request').toBe(LONG_BODY_STATUS);
	} catch (exc) {
		const cantConnect = (exc as ConnectException).runtimeException &&
		((exc as ConnectException).type === 'http-connect');
		expect(cantConnect).withContext(`server can close connection on a long reply, resulting in a can't connect error on a client side`).toBe(true);
	}
}

export async function expectNonAcceptanceOfNonEmptyBody(
	opts: RequestOpts
): Promise<void> {
	const badReq = randomBytes(1);
	const req = request<void>(undefined, opts);
	req.xhr.send(badReq);
	const rep = await req.promise;
	expect(rep.status).withContext('status code for long request').toBe(LONG_BODY_STATUS);
}

/**
 * @param opts
 * @param hasBody is a flag, telling if body should be sent with the request.
 * Default value is false, for no body in request.
 */
export async function expectNonAcceptanceOfBadSessionId(
	opts: RequestOpts, hasBody = false
): Promise<void> {
	opts = copy(opts);
	
	// missing session id
	delete opts.sessionId;
	let req = request<void>(undefined, opts);
	if (hasBody) { req.xhr.send(randomBytes(5)); }
	else { req.xhr.send(); }
	let rep = await req.promise;
	expect(rep.status).withContext('status code when required session id is missing').toBe(UNAUTHORIZED_STATUS);
	
	// invalid session id
	opts.sessionId = 'bogus session id';
	req = request<void>(undefined, opts);
	if (hasBody) { req.xhr.send(randomBytes(5)); }
	else { req.xhr.send(); }
	rep = await req.promise;
	expect(rep.status).withContext('status code for an invalid session id').toBe(UNAUTHORIZED_STATUS);
}

Object.freeze(exports);