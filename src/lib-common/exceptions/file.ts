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

import { RuntimeException } from './runtime';

export const ExceptionType = 'file';

export const Code = {
	notFound: 'ENOENT',
	alreadyExists: 'EEXIST',
	notDirectory: 'ENOTDIR',
	notFile: 'ENOTFILE',
	isDirectory: 'EISDIR',
	endOfFile: 'EEOF'
};
Object.freeze(Code);

export interface FileException extends RuntimeException {
	code: string;
	message?: string;
	notFound?: boolean;
	alreadyExists?: boolean;
	notDirectory?: boolean;
	notFile?: boolean;
	isDirectory?: boolean;
	endOfFile?: boolean;
}

export function makeFileException(code: string, msg?: string): FileException {
	let err: FileException = {
		runtimeException: true,
		type: ExceptionType,
		code: code
	};
	if (msg) {
		err.message = msg;
	}
	if (code === Code.alreadyExists) {
		err.alreadyExists = true;
	} else if (code === Code.notFound) {
		err.notFound = true;
	} else if (code === Code.isDirectory) {
		err.isDirectory = true;
	} else if (code === Code.notDirectory) {
		err.notDirectory = true;
	} else if (code === Code.notFile) {
		err.notFile = true;
	} else if (code === Code.endOfFile) {
		err.endOfFile = true;
	}
	return err;
}

export function makeFileExceptionFromNodes(nodeExc: NodeJS.ErrnoException):
		FileException {
	return makeFileException(nodeExc.code, `${nodeExc.code}: ${nodeExc.path}`);
}

Object.freeze(exports);