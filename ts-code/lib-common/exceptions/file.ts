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

export const fileExceptionType = 'file';

export const Code: web3n.files.exceptionCode = {
	notFound: 'ENOENT',
	alreadyExists: 'EEXIST',
	notDirectory: 'ENOTDIR',
	notFile: 'ENOTFILE',
	notLink: 'not-link',
	isDirectory: 'EISDIR',
	notEmpty: 'ENOTEMPTY',
	endOfFile: 'EEOF',
	concurrentUpdate: 'concurrent-update'
};
Object.freeze(Code);

export type FileException = web3n.files.FileException;

export function makeFileException(code: string|undefined, path: string,
		cause?: any): FileException {
	const err: FileException = {
		runtimeException: true,
		type: fileExceptionType,
		code,
		path,
		cause
	};
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
	} else if (code === Code.notLink) {
		err.notLink = true;
	} else if (code === Code.endOfFile) {
		err.endOfFile = true;
	} else if (code === Code.notEmpty) {
		err.notEmpty = true;
	} else if (code === Code.concurrentUpdate) {
		err.concurrentUpdate = true;
	}
	return err;
}

export function maskPathInExc(pathPrefixMaskLen: number, exc: any):
		FileException {
	if (exc.runtimeException || !exc.code) { return exc; }
	if (typeof exc.path === 'string') {
		exc.path = exc.path.substring(pathPrefixMaskLen);
	}
	return exc;
}

export function ensureCorrectFS(fs: web3n.files.FS, type: web3n.files.FSType,
		writable: boolean): void {
	if (!fs) { throw new Error("No file system given."); }
	if (fs.type !== type) { throw new Error(
		`Expected ${type} file system, instead got ${fs.type} type.`); }
	if (fs.writable !== writable) { throw new Error(
		`Given file system is ${fs.writable ? '' : 'not'} writable, while it is expected to be ${writable ? '' : 'not'} writable`); }
}

Object.freeze(exports);