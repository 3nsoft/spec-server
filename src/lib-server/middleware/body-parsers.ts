/*
 Copyright (C) 2015 - 2016 3NSoft Inc.
 
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

import * as express from 'express';
import { stringToNumOfBytes } from '../conf-util';
import { makeErr } from './error-handler';
import { defer } from '../../lib-common/processes';
import { BytesFIFOBuffer } from '../../lib-common/byte-streaming/common';
import { EMPTY_BUFFER } from '../../lib-common/buffer-utils';

const HTTP_HEADER = {
	contentType: 'Content-Type',
	contentLength: 'Content-Length'
}

const TYPES = {
	plain: 'text/plain',
	json: 'application/json',
	bin: 'application/octet-stream'
}

const noop = {
	onData: (chunk: Buffer) => {},
	onEnd: () => {}
};

export function attachByteDrainToRequest(req: express.Request): void {
	req.on('data', noop.onData);
	req.on('end', noop.onEnd);
}

/**
 * Use this for empty-body POST and PUT routes, as it does sanitization, and
 * prevents hanging requests, because nothing drains data.
 * @return a middleware function that ensures empty body in requests.
 */
export function emptyBody(): express.RequestHandler {
	return (req: express.Request, res: express.Response,
			next: express.NextFunction) => {
		attachByteDrainToRequest(req);
		
		// get and check Content-Length
		const contentLength = parseInt(req.get(HTTP_HEADER.contentLength)!, 10);
		if (isNaN(contentLength)) {
			return next(makeErr(411,
				"Content-Length header is required with proper number."));
		}
		if (contentLength !== 0) {
			return next(makeErr(413, "Request body is too long."));
		}
		
		next();
	}	
}
/**
 * @param req
 * @param expectedLen is an expected non-zero length of a binary body.
 * If body has different length, this function throws.
 * @return a promise, resolvable to request's body bytes, parsed from a request
 * object.
 */
export async function parseBinaryBodyWithExpectedSize(req: express.Request,
		expectedLen: number): Promise<Uint8Array> {
	try {
		if (expectedLen < 1) { throw new Error(`Given illegal length value ${expectedLen}`); }

		// check type
		if (!req.is(TYPES.bin)) {
			throw makeErr(415, `Content-Type must be ${TYPES.bin} for this call.`);
		}

		// check length declared in header
		const contentLength = parseInt(req.get(HTTP_HEADER.contentLength)!, 10);
		if (isNaN(contentLength)) {
			throw makeErr(411,
				"Content-Length header is required with proper number.");
		}
		if (contentLength !== expectedLen) {
			throw makeErr(400, "Unexpected number of bytes.");
		}

	} catch (err) {
		attachByteDrainToRequest(req);
		throw err;
	}

	const deffered = defer<Uint8Array>();
	const bytes = new BytesFIFOBuffer();

	// collect body bytes
	let erred = false;
	req.on('data', (chunk: Buffer) => {
		if (erred) { return; }
		if ((bytes.length + chunk.length) <= expectedLen) {
			bytes.push(chunk);
		} else {
			erred = true;
			deffered.reject(makeErr(400, "Request body is longer than expected."));
		}
	});
	req.on('end', () => {
		if (erred) { return; }
		if (bytes.length === expectedLen) {
			deffered.resolve(bytes.getBytes(undefined)!);
		} else {
			deffered.reject(makeErr(400,
				"Request body is shorter than expected."));
		}
	});

	return deffered.promise;
}

function byteCollector(maxSize: string|number, contentType: string,
		parser?: express.RequestHandler): express.RequestHandler {
	const maxSizeNum = stringToNumOfBytes(maxSize);
	if ('string' !== typeof contentType) { throw new Error(
			"Given 'contentType' argument must be a string."); }
	return (req: express.Request, res: express.Response,
			next: express.NextFunction) => {
		// check Content-Type
		if (!req.is(contentType)) {
			attachByteDrainToRequest(req);
			return next(makeErr(415, "Content-Type must be "+
				contentType+" for this call."));
		}

		// get and check Content-Length
		const contentLength = parseInt(req.get(HTTP_HEADER.contentLength)!, 10);
		if (isNaN(contentLength)) {
			attachByteDrainToRequest(req);
			return next(makeErr(411,
				"Content-Length header is required with proper number."));
		}
		
		// enforce agreed limit on request size
		if (contentLength > maxSizeNum) {
			attachByteDrainToRequest(req);
			return next(makeErr(413, "Request body is too long."));
		}

		// XXX we may use fifo here, postponing byte copying till moment, when
		//		everything is downloaded

		// set body to be buffer for all expected incoming bytes
		req.body = (contentLength > 0) ?
			new Buffer(contentLength) : EMPTY_BUFFER;

		// collect incoming bytes into body array
		let bytesRead = 0;
		let erred = false;
		req.on('data', (chunk: Buffer) => {
			if (erred) { return; }
			if ((bytesRead + chunk.length) <= contentLength) {
				chunk.copy(req.body, bytesRead);
				bytesRead += chunk.length;
			} else {
				erred = true;
				req.body = null;
				next(makeErr(413, "Request body is too long."));
			}
		});
		req.on('end', () => {
			if (erred) { return; }
			if (parser) {
				parser(req, res, next);
			} else {
				next();
			}
		});
	};
}

/**
 * @param maxSize is a maximum allowed body length, given as number of bytes,
 * or string parameter for kb/mb's.
 * @return middleware function, that places all request bytes into Buffer,
 * placed into usual body field of request object. 
 */
export function binary(maxSize: string|number): express.RequestHandler {
	return byteCollector(maxSize, TYPES.bin);
}

/**
 * @param maxSize is a maximum allowed body length, given as number of bytes,
 * or string parameter for kb/mb's.
 * @param allowNonObject is a boolean flag, which, when true, turns of a check
 * that forces body to be an object.
 * @return middleware function, that parses all request bytes as JSON, placing
 * result into usual body field of request object.
 */
export function json(maxSize: string|number, allowNonObject?: boolean):
		express.RequestHandler {
	return byteCollector(maxSize, TYPES.json,
		(req: express.Request, res: express.Response,
				next: express.NextFunction) => {
			try {
				const bodyAsStr = req.body.toString('utf8');
				req.body = JSON.parse(bodyAsStr);
			} catch (err) {
				return next(makeErr(400,
					"Request body cannot be interpreted as JSON."));
			}
			if (!allowNonObject &&
					(!req.body || (typeof req.body !== 'object'))) {
				return next(makeErr(400, "Request body is not a JSON object."));
			}
			next();
		});
}

/**
 * @param maxSize is a maximum allowed body length, given as number of bytes, or
 * string parameter for kb/mb's.
 * @return middleware function, that parses all request bytes as utf8 text,
 * placing result into usual body field of request object.
 */
export function textPlain(maxSize: string|number): express.RequestHandler {
	return byteCollector(maxSize, TYPES.plain,
		(req: express.Request, res: express.Response,
				next: express.NextFunction) => {
			try {
				req.body = req.body.toString('utf8');
			} catch (err) {
				return next(makeErr(400,
					"Request body cannot be interpreted as plain utf8 text."));
			}
			next();
		});
}

Object.freeze(exports);