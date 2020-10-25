/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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

export interface ErrorWithCause extends Error {
	cause: any;
}

export function errWithCause(cause: any, message: string): ErrorWithCause {
	const err = <ErrorWithCause> new Error(message);
	err.cause = cause;
	return err;
}

export function stringifyErr(err: any): string {
	if ((err as web3n.RuntimeException).runtimeException || !err
	|| (typeof err !== 'object')) {
		return `${JSON.stringify(err, null, '  ')}
`;
	} else {
		return `Error message: ${err.message}
Error stack: ${err.stack}${
	((err as ErrorWithCause).cause ? `
Caused by:
${stringifyErr((err as ErrorWithCause).cause)}` :
	'')}
`;
	}
}

Object.freeze(exports);