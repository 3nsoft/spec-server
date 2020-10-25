/*
 Copyright (C) 2015 - 2017 3NSoft Inc.
 
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

import { makeHTTPException, makeConnectionException, HTTPException }
	from '../../lib-common/exceptions/http';
import { BytesFIFOBuffer } from '../../lib-common/byte-streaming/common';

const xhr2 = require('xhr2');

export const SESSION_ID_HEADER = "X-Session-Id";

export interface Reply<T> {
	url: string;
	method: string;
	status: number;
	data: T;
	headers?: Headers;
}

export interface RequestOpts {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	url?: string;
	path?: string;
	responseType?: 'json' | 'arraybuffer';
	sessionId?: string;
	responseHeaders?: string[];
}

export interface Headers {
	get(name: string): string|undefined;
}

const logHttp = (process.argv.indexOf('--console-log-http') > 0);

function makeHeadersInstanceFrom(xhr: XMLHttpRequest, selectHeaders: string[]):
		Headers {
	const m = new Map<string, string>();
	for (const h of selectHeaders) {
		if (typeof h !== 'string') { continue; }
		const value = xhr.getResponseHeader(h);
		if (typeof value !== 'string') { continue; }
		m.set(h.toLowerCase(), value);
	}
	return {
		get(name: string): string|undefined {
			return m.get(name.toLowerCase());
		}
	};
}

export function request<T>(contentType: string|undefined, opts: RequestOpts):
		{ xhr: XMLHttpRequest; promise: Promise<Reply<T>>; } {
	const xhr: XMLHttpRequest = new xhr2();
	const promise = new Promise<Reply<T>>((resolve, reject) => {
		xhr.open(opts.method, opts.url!);

		// DEBUG
		if (logHttp) { console.log(` - ${opts.method} @ ${opts.url} ...\n`); }

		xhr.onload = () => {
			let data = xhr.response;

			// DEBUG
			if (logHttp) { console.log(` > ${xhr.status} reply to ${opts.method} @ ${opts.url}\n > ${(data instanceof ArrayBuffer) ? (<ArrayBuffer> data).byteLength+' bytes' : JSON.stringify(data) }\n`); }

			if ((opts.responseType === 'arraybuffer') &&
					(data instanceof ArrayBuffer)) {
				data = new Uint8Array(data);
			}
			const rep: Reply<T> = {
				url: opts.url!,
				method: opts.method,
				status: xhr.status,
				data: data
			};
			if (Array.isArray(opts.responseHeaders)) {
				rep.headers = makeHeadersInstanceFrom(xhr, opts.responseHeaders);
			}
			resolve(rep);
		};
		xhr.onerror = (ev) => {
// DEBUG
if (logHttp) { console.log(` * cannot connect to ${opts.method} @ ${opts.url} ...\n${ev}\n`); }
			reject(makeConnectionException(opts.url, opts.method, 'Cannot connect'));
		};
		if (contentType) {
			xhr.setRequestHeader('Content-Type', contentType);
		}
		if (opts.sessionId) {
			xhr.setRequestHeader(SESSION_ID_HEADER, opts.sessionId);
		}
		if (opts.responseType) {
			xhr.responseType = opts.responseType;
		}
	});
	return { xhr, promise };
}

/**
 * This assembles XMLHttpRequest with 'Content-Type: application/json' and
 * sends given json. 
 * @param opts
 * @param json
 * @return a promise, resolvable to reply object
 */
export function doJsonRequest<T>(opts: RequestOpts, json: any):
		Promise<Reply<T>> {
	const req = request<T>('application/json', opts);
	req.xhr.send(JSON.stringify(json));
	return req.promise;
}

/**
 * This assembles XMLHttpRequest with 'Content-Type: application/octet-stream'
 * and sends given bytes.
 * @param opts
 * @param bytes
 * @return a promise, resolvable to reply object
 */
export function doBinaryRequest<T>(opts: RequestOpts,
		bytes: Uint8Array|Uint8Array[]): Promise<Reply<T>> {
	const req = request<T>('application/octet-stream', opts);
	if (Array.isArray(bytes)) {
		const fifo = new BytesFIFOBuffer();
		for (const arr of bytes) {
			fifo.push(arr);
		}
		req.xhr.send(fifo.getBytes(undefined));
	} else {
		req.xhr.send(bytes);
	}
	return req.promise;
}

/**
 * This assembles XMLHttpRequest with 'Content-Type: text/plain'
 * and sends given text
 * @param opts
 * @param txt
 * @return a promise, resolvable to reply object
 */
export function doTextRequest<T>(opts: RequestOpts, txt: string):
		Promise<Reply<T>> {
	const req = request<T>('text/plain', opts);
	req.xhr.send(txt);
	return req.promise;
}

/**
 * This assembles XMLHttpRequest without 'Content-Type'.
 * @param opts
 * @return a promise, resolvable to reply object
 */
export function doBodylessRequest<T>(opts: RequestOpts): Promise<Reply<T>> {
	const req = request<T>(undefined, opts);
	req.xhr.send();
	return req.promise;
}

/**
 * @param rep
 * @param errMsg
 * @return http exception based on given reply, with an optional message
 */
export function makeException(rep: Reply<any>, errMsg?: string): HTTPException {
	return makeHTTPException(rep.url, rep.method, rep.status, errMsg);
}

export function extractIntHeader(rep: Reply<any>, headerName: string): number {
	const intHeader = parseInt(rep.headers!.get(headerName)!);
	if (isNaN(intHeader)) { throw makeException(rep,
		`Malformed response: header ${headerName} is missing or malformed`); }
	return intHeader;
}

Object.freeze(exports);