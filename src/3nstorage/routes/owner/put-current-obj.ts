/*
 Copyright (C) 2017 3NSoft Inc.
 
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

import { RequestHandler, Response, NextFunction } from 'express';
import { SaveNewObjVersion, BlobSaveOpts, SC as saveSC,
	MismatchedObjVerException }
	from '../../resources/users';
import { currentObj as api, ERR_SC, HTTP_HEADER, BIN_TYPE, PutObjFirstQueryOpts,
	PutObjSecondQueryOpts, DiffInfo, sanitizedDiff, ErrorReply }
	from '../../../lib-common/service-api/3nstorage/owner';
import { stringToNumOfBytes } from '../../../lib-server/conf-util';
import { Request } from '../../resources/sessions';
import { attachByteDrainToRequest }
	from '../../../lib-server/middleware/body-parsers';
import { Readable as ReadableStream } from 'stream';
import { BytesFIFOBuffer } from '../../../lib-common/byte-streaming/common';
import { defer, Deferred } from '../../../lib-common/processes';
import { utf8 } from '../../../lib-common/buffer-utils';

export function saveCurrentObj(root: boolean, saveObjFunc: SaveNewObjVersion,
		chunkLimit: string|number): RequestHandler {
	if ('function' !== typeof saveObjFunc) { throw new TypeError(
		"Given argument 'saveObjFunc' must be function, but is not."); }
	const maxChunkSize = stringToNumOfBytes(chunkLimit);

	return async function(req: Request, res: Response, next: NextFunction) {
		
		if (!req.is(BIN_TYPE)) {
			attachByteDrainToRequest(req);
			res.status(ERR_SC.wrongContentType).json( <ErrorReply> {
				error: `Content-Type must be ${BIN_TYPE} for this call.` });
			return;
		}
	
		const userId = req.session.params.userId;
		const objId: string = (root ? null : req.params.objId);
		
		// get and check Content-Length, implicitly sending replies for bad length
		let len = getContentLenOrSendError(req, res, maxChunkSize);
		if (len === undefined) {
			attachByteDrainToRequest(req);
			return;
		}
		
		// extract and check query parameters
		const opts = extractQueryOptions(req);
		if (!opts) { return replyToMalformed(req, "Bad query parameters", res); }

		let diff: DiffInfo|undefined;

		if (opts.fstReq) {

			// cross-check given lengths
			const diffAndHeader = opts.fstReq.header +
				(opts.fstReq.diff ? opts.fstReq.diff : 0);
			if (diffAndHeader > len) { return replyToMalformed(req,
				"Bad query parameters", res); }
			if (opts.fstReq.segs && ((opts.fstReq.segs + diffAndHeader) < len)) {
				return replyToMalformed(req, "Bad query parameters", res);
			}

			// read diff, if it is expected
			if (opts.fstReq.diff) {
				let diffBytes = await readChunkFrom(req, opts.fstReq.diff).catch(
					(err) => {});
				if (diffBytes) {
					len -= opts.fstReq.diff;
				} else {
					return replyToMalformed(req, "Cannot read diff bytes", res);
				}
				try {
					const diffFromReq = JSON.parse(utf8.open(diffBytes));
					diff = sanitizedDiff(diffFromReq, opts.fstReq.ver);
					if (!diff) { return replyToMalformed(req, "Malformed diff info", res); }
				} catch (err) {
					 return replyToMalformed(req, "Malformed diff info", res);
				}
			}

		} else if (opts.sndReq) {

			if ((len === 0) && !opts.sndReq.last) { return replyToMalformed(req, "No segment bytes", res); }

		}

		try {
			const transactionId = await saveObjFunc(userId, objId,
				opts.fstReq, diff, opts.sndReq, len, req);
			const reply: api.ReplyToPut = (transactionId ? { transactionId } : {});
			res.status(api.SC.okPut).json(reply);
		} catch (err) {
			if ("string" !== typeof err) {
				if ((err as MismatchedObjVerException).type === 'mismatched-obj-ver') {
					const rep: api.MismatchedObjVerReply = {
						error: "Current object version doesn't match assumed one.",
						current_version: (err as MismatchedObjVerException).current_version
					};
					res.set(HTTP_HEADER.objVersion, `${(err as MismatchedObjVerException).current_version}`);
					res.status(api.SC.mismatchedObjVer).json(rep);
				} else {
					next(err);
				}
			} else if (err === saveSC.OBJ_UNKNOWN) {
				res.status(api.SC.unknownObj).json( <ErrorReply> {
					error: `Unknown object ${objId}.` });
			} else if (err === saveSC.TRANSACTION_UNKNOWN) {
				res.status(api.SC.unknownTransaction).json( <ErrorReply> {
					error: "Unknown transaction." });
			} else if (err === saveSC.OBJ_EXIST) {
				res.status(api.SC.objAlreadyExists).json( <ErrorReply> {
					error: "Object already exists." });
			} else if (err === saveSC.CONCURRENT_TRANSACTION) {
				res.status(api.SC.concurrentTransaction).json( <ErrorReply> {
					error: `Object ${objId} is currently under a transaction.` });
			} else if (err === saveSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).json( <ErrorReply> {
					error: "Recipient disappeared from the system." });
				req.session.close();
			} else if (err === saveSC.WRITE_OVERFLOW) {
				res.status(ERR_SC.malformed).json( <ErrorReply> {
					error: "Attempt to write outside of set limits." });
			} else if (err === saveSC.NOT_ENOUGH_SPACE) {
				res.status(ERR_SC.noSpace).json( <ErrorReply> {
					error: "Reached storage limits." });
			} else if (err === saveSC.INCOMPATIBLE_TRANSACTION) {
				res.status(ERR_SC.malformed).json( <ErrorReply> {
					error: `This request is incompatible with current transaction on object ${objId}.` });
			} else {
				next(new Error(`Unhandled storage error code: ${err}`));
			}
		}
	};
}

function extractQueryOptions(req: Request): undefined |
		{ fstReq?: PutObjFirstQueryOpts; sndReq?: PutObjSecondQueryOpts; } {
	if ((req.query as PutObjSecondQueryOpts).trans) {
		// this is the second (not first) request
		// query fields are string or undefined, yet, type info helps the show
		const query: PutObjSecondQueryOpts = req.query;

		const trans = query.trans;

		const append = ((query.append as any) === 'true');

		const last = ((query.last as any) === 'true');

		const ofs = (query.ofs ? parseInt(query.ofs as any) : undefined);
		if (ofs === undefined) {
			if (!append && !last) { return; }
		} else {
			if (append || isNaN(ofs) || (ofs < 0)) { return; }
		}

		return { sndReq: { append, last, ofs, trans } };

	} else {
		// this is the first request
		// query fields are string or undefined, yet, type info helps the show
		const query: PutObjFirstQueryOpts = req.query;

		const ver = parseInt(query.ver as any);
		if (isNaN(ver) || (ver < 1)) { return; }

		const diff = (query.diff ? parseInt(query.diff as any) : undefined);
		if (diff !== undefined) {
			if (isNaN(diff) || (diff < 2) || (diff > 1024)) { return; }
		}

		const header = parseInt(query.header as any);
		if (isNaN(header) || (header < 1)) { return; }

		const append = ((query.append as any) === 'true');

		const segs = (query.segs ? parseInt(query.segs as any) : undefined);
		if (segs === undefined) {
			if (!append) { return; }
		} else {
			if (isNaN(segs) || (segs < 0) || append) { return; }
		}

		return { fstReq: { diff, header, segs, append, ver } };
		
	}
}

function getContentLenOrSendError(req: Request, res: Response,
		maxChunkSize: number): number|undefined {
	const contentLength = parseInt(req.get(HTTP_HEADER.contentLength)!);
	if (isNaN(contentLength)) {
		res.status(ERR_SC.contentLenMissing).json( <ErrorReply> {
			error: "Content-Length header is required with proper number." });
	} else if (contentLength > maxChunkSize) {
		res.status(ERR_SC.contentTooLong).json( <ErrorReply> {
			error: "Request body is too long." });
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
function readChunkFrom(stream: ReadableStream, bytesToRead: number):
		Promise<Uint8Array> {
	if (bytesToRead < 1) { throw new Error(
		`Illegal number of bytes to read from stream: ${bytesToRead}`); }
	
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

	const onError = (err) => {
		if (!deferred) { return; }
		complete(undefined, err);
	};

	stream.on('data', onData);
	stream.on('error', onError);
	stream.on('end', onEnd);

	return deferred.promise;
}

function replyToMalformed(req: Request, msg: string, res: Response): void {
	attachByteDrainToRequest(req);
	res.status(ERR_SC.malformed).json( <ErrorReply> { error: msg });
}

Object.freeze(exports);