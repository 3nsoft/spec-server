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

import * as fs from '../../lib-common/async-fs-node';
import { FileException, Code as excCode }
	from '../../lib-common/exceptions/file';
import { stringToNumOfBytes } from '../conf-util';
import { toCanonicalAddress } from '../../lib-common/canonical-address';
import { base64urlSafe, utf8 } from '../../lib-common/buffer-utils';

const DEFAULT_FILE_WRITE_BUFFER_SIZE = 4*1024;
const DEFAULT_FILE_READ_BUFFER_SIZE = 64*1024;

export const SC = {
	USER_UNKNOWN: 'user-unknown',
	WRITE_OVERFLOW: 'write-overflow'
};
Object.freeze(SC);

async function readJsonFile<T>(path): Promise<T> {
	let buf = await fs.readFile(path);
	return <T> JSON.parse(buf.toString('utf8'));
}

export function addressToFName(address: string): string {
	return base64urlSafe.pack(utf8.pack(toCanonicalAddress(address)));
}

export abstract class UserFiles {
	
	userId: string;
	path: string;
	fileWritingBufferSize: number;
	fileReadingBufferSize: number;
	
	constructor(userId: string, path: string,
			writeBufferSize: string|number, readBufferSize: string|number) {
		this.userId = userId;
		this.path = path;
		this.fileWritingBufferSize = (writeBufferSize ?
			stringToNumOfBytes(writeBufferSize) :
			DEFAULT_FILE_WRITE_BUFFER_SIZE);
		this.fileReadingBufferSize = (readBufferSize ?
			stringToNumOfBytes(readBufferSize) :
			DEFAULT_FILE_READ_BUFFER_SIZE);
	}
	
	async ensureUserExistsOnDisk(): Promise<void> {
		try {
			let stats = await fs.stat(this.path);
			if (!stats.isDirectory()) { throw new Error(
				"Path for users' folder is not a folder: "+this.path); }
		} catch (err) {
			if ((<FileException> err).code === excCode.notFound) {
				throw SC.USER_UNKNOWN;
			}
			throw err;
		}
	}
	
	getSpaceQuota(): Promise<number> {
		return readJsonFile<number>(this.path+'/../info/quota');
	}
	
	getParam<T>(paramFileName: string): Promise<T> {
		return readJsonFile<T>(this.path+'/params/'+paramFileName);
	}
	
	setParam<T>(paramFileName: string, param: T): Promise<void> {
		return fs.writeFile(this.path+'/params/'+paramFileName,
			JSON.stringify(param), { encoding: 'utf8', flag: 'w' })
	}
	
}

Object.freeze(exports);