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

import { BytesFIFOBuffer, ByteSink, ByteSource, wrapByteSinkImplementation,
	wrapByteSourceImplementation } from './common';
import { bind } from '../binding';

interface Deferred {
	resolve(result?: any): void;
	reject(cause: any): void;
}

export class SinkBackedByteSource implements ByteSource, ByteSink {
	
	private totalSize: number = null;
	private isTotalSizeSet = false;
	private collectedBytes = 0;
	private isComplete = false;
	private buf = new BytesFIFOBuffer();
	private deferredRead: {
		deferred: Deferred;
		len: number;
	} = null;
	private swalledErr: any = null;
	
	getSource(): ByteSource {
		return wrapByteSourceImplementation(this);
	}
	
	getSink(): ByteSink {
		return wrapByteSinkImplementation(this);
	}
	
	async getSize(): Promise<number> {
		return this.totalSize;
	}
	
	async setSize(size: number): Promise<void> {
		if (this.isTotalSizeSet) {
			throw new Error("Total size has already been set");
		} else if ((size !== null) && (size < this.collectedBytes)) {
			throw new Error("Given size is less than number of "+
				"already collected bytes.");
		}
		this.isTotalSizeSet = true;
		if ('number' === typeof size) {
			this.totalSize = size;
		}
	}
	
	read(len: number): Promise<Uint8Array> {
		if (this.deferredRead) {
			throw new Error("There is already pending read");
		}
		return new Promise<Uint8Array>((resolve, reject) => {
			if (this.swalledErr) {
				reject(this.swalledErr);
				return;
			}
			if (this.isComplete) {
				resolve(this.buf.getBytes(len, true));
				return;
			}
			if (typeof len === 'number') {
				let bufferedBytes = this.buf.getBytes(len);
				if (bufferedBytes) {
					resolve(bufferedBytes);
					return;
				}
			}
			this.deferredRead = {
				len,
				deferred: { resolve, reject }
			};
		})
	}
	
	private completeOnErr(err: any): void {
		if (this.deferredRead) {
			this.deferredRead.deferred.reject(err);
			this.deferredRead = null; 
		} else {
			this.swalledErr = err;
		}
	}
	
	async write(bytes: Uint8Array, err?: any): Promise<void> {
		if (this.isComplete) {
			if (bytes === null) {
				return;
			} else {
				throw new Error("Complete sink cannot except any more bytes.");
			}
		}
		let boundsErr: Error = null;
		if (bytes === null) {
			if (err) {
				this.completeOnErr(err);
				return;
			}
			this.isComplete = true;
			if (this.totalSize === null) {
				this.totalSize = this.collectedBytes;
			} else if (this.totalSize < this.collectedBytes) {
				boundsErr = new Error("Stopping bytes at "+this.collectedBytes+
					", which is sooner than declared total size "+
					this.totalSize+".");
			}
		} else {
			if (bytes.length === 0) { return; }
			if (this.totalSize !== null) {
				let maxBytesExpectation = this.totalSize - this.collectedBytes;
				if (bytes.length >= maxBytesExpectation) {
					this.isComplete = true;
					if (bytes.length > maxBytesExpectation) {
						boundsErr = new Error("More bytes given than sink was "+
							"set to accept; swallowing only part of bytes.");
						if (maxBytesExpectation === 0) { throw boundsErr; }
						bytes = bytes.subarray(0, maxBytesExpectation);
					}
				}
			}
			this.buf.push(bytes);
			this.collectedBytes += bytes.length;
		}
		if (!this.deferredRead) { return; }
		if (this.isComplete) {
			this.deferredRead.deferred.resolve(
				this.buf.getBytes(this.deferredRead.len, true));
			this.deferredRead = null;
		} else {
			let bufferedBytes = this.buf.getBytes(this.deferredRead.len);
			if (bufferedBytes) {
				this.deferredRead.deferred.resolve(bufferedBytes);
				this.deferredRead = null;
			}
		}
		if (boundsErr) { throw boundsErr; }
	}
	
}

/**
 * @param src
 * @param sink
 * @param closeSink is an optional parameter, which true (default) value closes
 * sink, when piping is done, while false value keeps sink open.
 * @param bufSize is an optional parameter for buffer, used for byte transfer.
 * Default value is 64K.
 * @return a promise, resolvable when all bytes are moved from given source to
 * given sink.
 */
export async function pipe(src: ByteSource, sink: ByteSink,
		closeSink = true, bufSize = 64*1024): Promise<void> {
	let buf = await src.read(bufSize);
	while (buf) {
		await sink.write(buf);
		buf = await src.read(bufSize);
	}
	if (closeSink) {
		await sink.write(null);
	}
}

Object.freeze(exports);