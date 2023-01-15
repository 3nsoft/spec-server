/*
 Copyright (C) 2016, 2020, 2023 3NSoft Inc.
 
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

import { Request, ErrorRequestHandler } from 'express';
import * as http from 'http';
import { ErrorWithCause, errWithCause as makeErrWithCause } from '../../lib-common/exceptions/error';

export interface HttpError extends ErrorWithCause {
	status: number;
}

/**
 * This creates an error object that should be given to next(), instead of
 * throwing it.
 * @param code is http status code to be attached to produced error object.
 * @param msg goes into error message.
 * @param cause
 */
export function makeErr(code: number, msg: string, cause?: any): HttpError {
  const err = makeErrWithCause(cause, msg) as HttpError;
  err.status = code;
  return err;
}

export type ErrLogger = (err: any, req: Request) => void;

export function makeErrHandler(log?: ErrLogger): ErrorRequestHandler {
	// Note that when we don't have next, tons of errors show up.
	// I guess, express checks how many arguments js function takes, and
	// gives args respectively. Thus, since express is doing this introspection
	// (magic?), we have to leave next argument, even though we ain't using it.
	return async function (err: HttpError, req, res, next) {
		let resStatus: number;
		let resBody: string;
		if (err && (typeof err.status === 'number')) {
			resStatus = err.status;
			if (resStatus === 500) {
				resBody = http.STATUS_CODES[500]!;
			} else if (err.message) {
				resBody = err.message;
			} else {
				resBody = http.STATUS_CODES[err.status]!;
			}
		} else {
			resStatus = 500;
			resBody = http.STATUS_CODES[500]!;
		}
		res.status(resStatus).send(resBody);
		if (log) {
			log(err, req);
		}
	};
}

export function makeErrLoggerToConsole(srvName: string): ErrLogger {
	return (err, req) => {
		if (typeof err.status !== 'number') {
			console.error(`\n --- Error occured in ${srvName}, when handling ${req.method} request to ${req.originalUrl}`);
			console.error(err);
		}
	};
}


Object.freeze(exports);