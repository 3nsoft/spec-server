/*
 Copyright (C) 2015 - 2017, 2020 3NSoft Inc.
 
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

import * as fs from '../../lib-common/async-fs-node';
import { FileException, Code as excCode } from '../../lib-common/exceptions/file';
import { stringToNumOfBytes } from '../conf-util';
import { toCanonicalAddress } from '../../lib-common/canonical-address';
import { base64urlSafe, utf8 } from '../../lib-common/buffer-utils';
import { defer } from '../../lib-common/processes';
import { join } from 'path';

const DEFAULT_FILE_WRITE_BUFFER_SIZE = 4*1024;
const DEFAULT_FILE_READ_BUFFER_SIZE = 64*1024;

export const SC = {
	USER_UNKNOWN: 'user-unknown',
};
Object.freeze(SC);

async function readJsonFile<T>(path): Promise<T> {
	const buf = await fs.readFile(path);
	return <T> JSON.parse(buf.toString('utf8'));
}

export function addressToFName(address: string): string {
	return base64urlSafe.pack(utf8.pack(toCanonicalAddress(address)));
}


export abstract class UserFiles<ParamTypes extends object> {
	
	protected readonly fileWritingBufferSize: number;
	protected readonly fileReadingBufferSize: number;

	constructor(
		public readonly userId: string,
		public readonly path: string,
		writeBufferSize?: string|number, readBufferSize?: string|number
	) {
		this.fileWritingBufferSize = (writeBufferSize ?
			stringToNumOfBytes(writeBufferSize) :
			DEFAULT_FILE_WRITE_BUFFER_SIZE
		);
		this.fileReadingBufferSize = (readBufferSize ?
			stringToNumOfBytes(readBufferSize) :
			DEFAULT_FILE_READ_BUFFER_SIZE
		);
	}

	async ensureUserExistsOnDisk(): Promise<void> {
		try {
			const stats = await fs.stat(this.path);
			if (!stats.isDirectory()) {
				throw new Error(
					`Path for users' folder is not a folder: ${this.path}`
				);
			}
		} catch (err) {
			if ((err as FileException).code === excCode.notFound) {
				throw SC.USER_UNKNOWN;
			}
			throw err;
		}
	}

	private commonInfoFolder(): string {
		return join(this.path, '..', 'info');
	}

	getSpaceQuota(): Promise<number> {
		return readJsonFile<number>(join(this.commonInfoFolder(), 'quota'));
	}

	getParam<P extends keyof ParamTypes>(
		paramFileName: P
	): Promise<ParamTypes[P]> {
		const filePath = join(this.path, 'params', paramFileName as string);
		return readJsonFile<ParamTypes[P]>(filePath);
	}

	protected setParam<P extends keyof ParamTypes>(
		paramFileName: P, param: ParamTypes[P]
	): Promise<void> {
		const filePath = join(this.path, 'params', paramFileName as string);
		return fs.writeFile(
			filePath, JSON.stringify(param), { encoding: 'utf8', flag: 'w' }
		);
	}

}
Object.freeze(UserFiles.prototype);
Object.freeze(UserFiles);


export type ObjPipe = (outStream: NodeJS.WritableStream) => Promise<void>;

export interface ObjReader {
	len: number;
	
	/**
	 * This is a pipe function that reads bytes directly from file.
	 */
	pipe?: ObjPipe;

	/**
	 * This is header length. It is present only if header is included in piped
	 * bytes.
	 */
	headerLen?: number;
	
	/**
	 * This is a total segments' length of this object version.
	 */
	segsLen: number;

}

export async function pipeBytes(src: NodeJS.ReadableStream,
		sink: NodeJS.WritableStream): Promise<void> {
	const deferred = defer<void>();
	src.pipe(sink, { end: false });
	src.on('error', (err) => {
		deferred.reject(err);
		src.unpipe(sink);
	});
	src.on('end', () => {
		src.unpipe(sink);
		deferred.resolve();
	});
	return deferred.promise;
}

Object.freeze(exports);