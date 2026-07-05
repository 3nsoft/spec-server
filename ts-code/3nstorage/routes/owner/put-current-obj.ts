/*
 Copyright (C) 2017, 2019 - 2020, 2026 3NSoft Inc.
 
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

import { RequestHandler, Response } from 'express';
import { SaveNewObjVersion, SC as saveSC, MismatchedObjVerException } from '../../resources/users';
import { currentObj as api, ERR_SC, HTTP_HEADER, BIN_TYPE, PutObjFirstQueryOpts, PutObjSecondQueryOpts, DiffInfo, sanitizedDiff, ErrorReply } from '../../../lib-common/service-api/3nstorage/owner';
import { stringToNumOfBytes } from '../../../lib-server/conf-util';
import { Request } from '../../resources/sessions';
import { attachByteDrainToRequest } from '../../../lib-server/middleware/body-parsers';
import { Readable as ReadableStream } from 'stream';
import { BytesFIFOBuffer } from '../../../lib-common/byte-streaming/common';
import { defer, Deferred } from '../../../lib-common/processes';
import { utf8 } from '../../../lib-common/buffer-utils';
import { getObjIdFromParams, replyWithErr } from '../../resources/utils';

export function saveCurrentObj(
	root: boolean, saveObjFunc: SaveNewObjVersion, chunkLimit: string|number
): RequestHandler {
	if ('function' !== typeof saveObjFunc) { throw new TypeError(
		"Given argument 'saveObjFunc' must be function, but is not."); }
	const maxChunkSize = stringToNumOfBytes(chunkLimit);

	return async (req: Request, res, next) => {
		
		if (!req.is(BIN_TYPE)) {
			return replyWithErr(ERR_SC.wrongContentType, `Content-Type must be ${BIN_TYPE} for this call.`, res, req);
		}

		// get and check Content-Length, implicitly sending replies for bad length
		let len = getContentLenOrSendError(req, res, maxChunkSize);
		if (len === undefined) {
			return;
		}
	
		const userId = req.session.params.userId;
		const { objId, objIdParseErr } = getObjIdFromParams(root, req);
		if (objIdParseErr) {
			return replyWithErr(ERR_SC.malformed, objIdParseErr, res, req);
		}
		
		// extract and check query parameters
		const opts = extractQueryOptions(req);
		if (!opts) {
			return replyWithErr(ERR_SC.malformed, "Bad query parameters", res, req);
		}
		const { fstReq, sndReq } = opts;

		let diff: DiffInfo|undefined;

		if (fstReq) {

			// cross-check given lengths
			const diffAndHeader = fstReq.header + (fstReq.diff ? fstReq.diff : 0);
			if (diffAndHeader > len) {
				return replyWithErr(ERR_SC.malformed, "Bad query parameters", res, req);
			}

			// read diff, if it is expected
			if (fstReq.diff) {
				let diffBytes = await readChunkFrom(req, fstReq.diff).catch(noop);
				if (diffBytes) {
					len -= fstReq.diff;
				} else {
				return replyWithErr(ERR_SC.malformed, "Cannot read diff bytes", res, req);
				}
				try {
					const diffFromReq = JSON.parse(utf8.open(diffBytes));
					diff = sanitizedDiff(diffFromReq, fstReq.ver);
					if (!diff) {
						return replyWithErr(ERR_SC.malformed, "Malformed diff info", res, req);
					}
				} catch (err) {
					return replyWithErr(ERR_SC.malformed, "Malformed diff info", res, req);
				}
			}

		} else if (sndReq) {

			if ((len === 0) && !sndReq.last) {
				return replyWithErr(ERR_SC.malformed, "No segment bytes", res, req);
			}

		}

		try {
			const transactionId = await saveObjFunc(userId, objId, fstReq, diff, sndReq, len, req);
			const reply: api.ReplyToPut = (transactionId ? { transactionId } : {});
			res.status(api.SC.okPut).json(reply);
		} catch (err) {
			if ("string" !== typeof err) {
				if ((err as MismatchedObjVerException).type === 'mismatched-obj-ver') {
					const rep: api.MismatchedObjVerReply = {
						error: "Current object version doesn't match assumed one.",
						current_version: (err as MismatchedObjVerException).current_version
					};
					res.set(HTTP_HEADER.objVersion, `${rep.current_version}`);
					res.status(api.SC.mismatchedObjVer).json(rep);
				} else {
					next(err);
				}
			} else if ((err === saveSC.OBJ_UNKNOWN)
			|| (err === saveSC.OBJ_VER_UNKNOWN)) {
				replyWithErr(api.SC.unknownObj, `Unknown object ${objId}.`, res);
			} else if (err === saveSC.TRANSACTION_UNKNOWN) {
				replyWithErr(api.SC.unknownTransaction, "Unknown transaction.", res);
			} else if ((err === saveSC.OBJ_EXIST)
			|| (err === saveSC.OBJ_VER_EXIST)) {
				replyWithErr(api.SC.objAlreadyExists, "Object already exists.", res);
			} else if (err === saveSC.CONCURRENT_TRANSACTION) {
				replyWithErr(api.SC.concurrentTransaction, `Object ${objId} is currently under a transaction.`, res);
			} else if (err === saveSC.USER_UNKNOWN) {
				replyWithErr(ERR_SC.server, "Recipient disappeared from the system.", res);
				req.session.close();
			} else if (err === saveSC.NOT_ENOUGH_SPACE) {
				replyWithErr(ERR_SC.noSpace, "Reached storage limits.", res);
			} else if (err === saveSC.OBJ_FILE_INCOMPLETE) {
				replyWithErr(api.SC.objIncomplete, "Object version file is incomplete.", res);
			} else {
				next(new Error(`Unhandled storage error code: ${err}`));
			}
		}
	};
}

function extractQueryOptions(req: Request): undefined|{
	fstReq?: PutObjFirstQueryOpts; sndReq?: PutObjSecondQueryOpts;
} {
	if ((req.query as any as PutObjSecondQueryOpts).trans) {
		// this is the second (not first) request
		// query fields are string or undefined, yet, type info helps the show
		const query = req.query as any as PutObjSecondQueryOpts;

		const trans = query.trans;

		const last = ((query.last as any) === 'true');

		const ofs = parseInt(query.ofs as any);
		if (isNaN(ofs))  { return; }

		return { sndReq: { last, ofs, trans } };

	} else {
		// this is the first request
		// query fields are string or undefined, yet, type info helps the show
		const query = req.query as any as PutObjFirstQueryOpts;

		const ver = parseInt(query.ver as any);
		if (isNaN(ver) || (ver < 1)) { return; }

		const diff = (query.diff ? parseInt(query.diff as any) : undefined);
		if (diff !== undefined) {
			if (isNaN(diff) || (diff < 2) || (diff > 1024)) { return; }
		}

		const header = parseInt(query.header as any);
		if (isNaN(header) || (header < 1)) { return; }

		const last = ((query.last as any) === 'true');

		return { fstReq: { diff, header, last, ver } };
		
	}
}

function getContentLenOrSendError(
	req: Request, res: Response, maxChunkSize: number
): number|undefined {
	const contentLength = parseInt(req.get(HTTP_HEADER.contentLength)!);
	if (isNaN(contentLength)) {
		replyWithErr(ERR_SC.contentLenMissing, "Content-Length header is required with proper number.", res, req);
	} else if (contentLength > maxChunkSize) {
		replyWithErr(ERR_SC.contentTooLong, "Request body is too long.", res, req);
	} else {
		return contentLength;
	}
	return;
}

const EARLY_END_OF_STREAM_ERR_STR = `Unexpected end of stream`;

/**
 * This returns a promise of bytes, read from a given stream.
 * Given stream will be paused, when bytes are read. Beware.
 * @param stream
 * @param bytesToRead is a number of bytes to read from a stream. Error is
 * thrown, if stream ends too early.
 */
function readChunkFrom(
	stream: ReadableStream, bytesToRead: number
): Promise<Uint8Array> {
	if (bytesToRead < 1) {
		throw new Error(`Illegal number of bytes to read from stream: ${bytesToRead}`);
	}
	
	const buffer = new BytesFIFOBuffer();
	let deferred: Deferred<Uint8Array>|undefined = defer<Uint8Array>();

	const complete = (bytes?: Uint8Array, err?: any) => {
		if (!deferred) { return; }
		if (bytes) {
			deferred.resolve(bytes);
		} else {
			deferred.reject(err);
			buffer.clear();
		}
		deferred = undefined;
		stream.removeListener('data', onData);
		stream.removeListener('error', onError);
		stream.removeListener('end', onEnd);
	};
	
	const onData = (data: Buffer) => {
		if (!deferred) { return; }
		buffer.push(data);
		if (buffer.length < bytesToRead) { return; }
		stream.pause();
		complete(buffer.getBytes(bytesToRead));
		if (buffer.length === 0) { return; }
		const bytesToUnshift = buffer.getBytes(undefined)!;
		stream.unshift(Buffer.from(
			bytesToUnshift.buffer as ArrayBuffer, bytesToUnshift.byteOffset, bytesToUnshift.length));
	};

	const onEnd = () => {
		if (!deferred) { return; }
		complete(undefined, EARLY_END_OF_STREAM_ERR_STR);
	};

	const onError = (err?: any) => {
		if (!deferred) { return; }
		complete(undefined, err);
	};

	stream.on('data', onData);
	stream.on('error', onError);
	stream.on('end', onEnd);

	return deferred.promise;
}

function noop() {}

Object.freeze(exports);