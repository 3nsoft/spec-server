/*
 Copyright (C) 2015 - 2016, 2019 3NSoft Inc.
 
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


export type ByteSource = web3n.ByteSource;

type Transferable = web3n.implementation.Transferable;

export function wrapByteSourceImplementation(src: ByteSource): ByteSource {
	const wrap: ByteSource = {
		read: src.read.bind(src),
		getSize: src.getSize.bind(src)
	};
	if (src.seek) {
		wrap.seek = src.seek.bind(src);
		wrap.getPosition = src.getPosition!.bind(src);
	}
	(wrap as any as Transferable).$_transferrable_type_id_$ = 'ByteSource';
	return wrap;
}

export type ByteSink = web3n.ByteSink; 

export function wrapByteSinkImplementation(sink: ByteSink): ByteSink {
	const wrap: ByteSink = {
		setSize: sink.setSize.bind(sink),
		write: sink.write.bind(sink),
		getSize: sink.getSize.bind(sink)
	};
	if (sink.seek) {
		wrap.seek = sink.seek.bind(sink);
		wrap.getPosition = sink.getPosition!.bind(sink);
	}
	(wrap as any as Transferable).$_transferrable_type_id_$ = 'ByteSink';
	return wrap;
}

export class BytesFIFOBuffer {
	
	private queue: Uint8Array[] = [];
	private bytesLen = 0;
	get length(): number {
		return this.bytesLen;
	}
	get queueLength(): number {
		return this.queue.length;
	}
	
	constructor() {
		Object.seal(this);
	}

	clear(): void {
		this.queue = [];
		this.bytesLen = 0;
	}
	
	push(bytes: Uint8Array): void {
		if (bytes.length === 0) { return; }
		this.queue.push(bytes);
		this.bytesLen += bytes.length;
	}
	
	/**
	 * @param extractLen is number of bytes to extract. It must always be less,
	 * or equal to current length of queue.
	 * @return requested bytes
	 */
	private extractSomeBytesFrom(extractLen: number): Uint8Array|undefined {
		if (this.queue.length === 0) { return undefined; }
		const extract = new Uint8Array(extractLen);
		let offset = 0;
		while (offset < extractLen) {
			const chunk = this.queue[0];
			if ((offset + chunk.length) <= extractLen) {
				extract.set(chunk, offset);
				offset += chunk.length;
				this.queue.shift();
			} else {
				extract.set(chunk.subarray(0, extractLen-offset), offset);
				this.queue[0] = chunk.subarray(extractLen-offset);
				break;
			}
		}
		return extract;
	}
	
	private extractAllBytesFrom(): Uint8Array|undefined {
		return this.extractSomeBytesFrom(this.bytesLen);
	}
		
	/**
	 * @param len is a number of bytes to get.
	 * If undefined is given, all bytes should be returned.
	 * @return an array of bytes, or undefined, if there are not enough bytes.
	 */
	getBytes(len: number|undefined, canBeLess = false): Uint8Array|undefined {
		let extract: Uint8Array|undefined;
		if (typeof len !== 'number') {
			extract = this.extractAllBytesFrom();
		} else {
			if (len < 1) { throw new Error('Length parameter is illegal: '+len); }
			if (this.queue.length === 0) { return undefined; }
			if (this.bytesLen < len) {
				if (canBeLess) {
					extract = this.extractAllBytesFrom();
				} else {
					return undefined;
				}
			} else {
				extract = this.extractSomeBytesFrom(len);
			}
		}
		if (extract) {
			this.bytesLen -= extract.length;
		}
		return extract;
	}
	
}
Object.freeze(BytesFIFOBuffer.prototype);
Object.freeze(BytesFIFOBuffer);

/**
 * @param bytes
 * @return a seekable byte source, based on a given byte array.
 */
export function sourceFromArray(bytes: Uint8Array): ByteSource {
	let pos = 0;
	const src: ByteSource = {
		getPosition: async (): Promise<number> => { return pos; },
		getSize: async (): Promise<number> => { return bytes.length; },
		read: async (len: number|undefined): Promise<Uint8Array|undefined> => {
			if (len === undefined) { return bytes.subarray(pos); }
			if ((typeof len !== 'number') || (len < 0)) { throw new TypeError(
				`Illegal length parameter given: ${len}`); }
			const chunk = bytes.subarray(pos, pos+len);
			pos += chunk.length;
			return ((chunk.length === 0) ? undefined : chunk);
		},
		seek: async (newPos: number): Promise<void> => {
			if ((typeof newPos !== 'number') || (newPos < 0)) {
				throw new TypeError(`Illegal position given: ${newPos}`); }
			if (newPos > bytes.length) { throw new Error(
				`Position parameter is out of bound`); }
			pos = newPos;
		}
	};
	return src;
}

Object.freeze(exports);