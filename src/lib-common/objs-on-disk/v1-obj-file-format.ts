/*
 Copyright (C) 2019 3NSoft Inc.
 
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

import { HeaderChunkInfo, SegsChunk } from "./file-layout";

export const V1_FILE_START = Buffer.from('1xsp', 'utf8');

/**
 * @param u is an unsigned integer up to 32-bits to be stored big-endian way in
 * 4 bytes.
 * @return a byte array with number stored in it.
 */
function uintTo4Bytes(u: number): Buffer {
	if (u >= 0x100000000) { throw new Error(
		'Cannot store number bigger than 2^32-1'); }
	const x = Buffer.allocUnsafe(4);
	x[0] = u >>> 24;
	x[1] = u >>> 16;
	x[2] = u >>> 8;
	x[3] = u;
	return x;
}

/**
 * @param x
 * @param i
 * @return unsigned integer (up to 32 bits), stored big-endian way
 * in 4 bytes of x, starting at index i.
 */
function uintFrom4Bytes(x: Uint8Array, i = 0): number {
	if (x.length < i+4) { throw new Error(
		'Given array has less than 4 bytes, starting with a given index.'); }
	return ((x[i] << 24) | (x[i+1] << 16) | (x[i+2] << 8) | x[i+3]);
}

/**
 * @param u is an unsigned integer up to 53-bits to be stored big-endian way in
 * 8 bytes.
 * @return a byte array with number stored in it.
 */
export function uintTo8Bytes(u: number): Buffer {
	if (u > Number.MAX_SAFE_INTEGER) { throw new Error(
		'Cannot store number bigger than 2^53-1'); }
	const x = Buffer.allocUnsafe(8);
	const h = Math.floor(u / 0x100000000);
	const l = u % 0x100000000;
	x[0] = h >>> 24;
	x[1] = h >>> 16;
	x[2] = h >>> 8;
	x[3] = h;
	x[4] = l >>> 24;
	x[5] = l >>> 16;
	x[6] = l >>> 8;
	x[7] = l;
	return x;
}

/**
 * @param x
 * @param i
 * @return unsigned integer (up to 53 bits), stored big-endian way
 * in 8 bytes of x, starting at index i.
 */
export function uintFrom8Bytes(x: Uint8Array, i = 0): number {
	if (x.length < i+8) { throw new Error(
		'Given array has less than 8 bytes, starting with a given index.'); }
	const h = (x[i] << 24) | (x[i+1] << 16) | (x[i+2] << 8) | x[i+3];
	const l = (x[i+4] << 24) | (x[i+5] << 16) | (x[i+6] << 8) | x[i+7];
	return (h*0x100000000 + l);
}

namespace headerChunkInfo {

	export function toBytes(hInfo: HeaderChunkInfo): Buffer {
		const buf = Buffer.allocUnsafe(12);
		buf.set(uintTo4Bytes(hInfo.len));
		buf.set(uintTo8Bytes(hInfo.fileOfs), 4);
		return buf;
	}

	export function fromBytes(b: Uint8Array, i: number):
			{ hInfo: HeaderChunkInfo; bytesRead: number; } {
		let bytesRead = 0;
		const len = uintFrom4Bytes(b, i + bytesRead);
		bytesRead += 4;
		const fileOfs = uintFrom8Bytes(b, i + bytesRead);
		bytesRead += 8;
		const hInfo: HeaderChunkInfo = { len, fileOfs };
		return { hInfo: Object.freeze(hInfo), bytesRead };
	}

}
Object.freeze(headerChunkInfo);

namespace segsChunkInfo {

	const IS_ENDLESS_BITMASK = 0b00000001;
	const FILE_OFS_PRESENT_BITMASK = 0b00000010;
	const BASE_VER_OFS_PRESENT_BITMASK = 0b00000100;

	export function toBytes(sInfo: SegsChunk): Buffer {
		let flag = 0;
		let bufSize = 17;
		if ((sInfo.type === 'new-on-disk') || (sInfo.type === 'base-on-disk')) {
			flag |= FILE_OFS_PRESENT_BITMASK;
			bufSize += 8;
		}
		if ((sInfo.type === 'base') || (sInfo.type === 'base-on-disk')) {
			flag |= BASE_VER_OFS_PRESENT_BITMASK;
			bufSize += 8;
		}
		const buf = Buffer.allocUnsafe(bufSize);
		let i = 0;
		buf[i] = flag;
		i += 1;
		buf.set(uintTo8Bytes(sInfo.thisVerOfs), i);
		i += 8;
		if (sInfo.type !== 'new-endless') {
			buf.set(uintTo8Bytes(sInfo.len), 9);
			i += 8;
		}
		if ((sInfo.type === 'new-on-disk') || (sInfo.type === 'base-on-disk')) {
			buf.set(uintTo8Bytes(sInfo.fileOfs), i);
			i += 8;
		}
		if ((sInfo.type === 'base') || (sInfo.type === 'base-on-disk')) {
			buf.set(uintTo8Bytes(sInfo.baseVerOfs), i);
		}
		return buf;
	}

	export function fromBytes(b: Uint8Array, i: number):
			{ sInfo: SegsChunk; bytesRead: number; } {
		let bytesRead = 0
		const flag = b[i + bytesRead];
		bytesRead += 1;
		const thisVerOfs = uintFrom8Bytes(b, i + bytesRead);
		bytesRead += 8;
		let len: number|undefined = undefined;
		if ((flag & IS_ENDLESS_BITMASK) === 0) {
			len = uintFrom8Bytes(b, i + bytesRead);
			bytesRead += 8;
		}
		let fileOfs: number|undefined = undefined;
		if (flag & FILE_OFS_PRESENT_BITMASK) {
			fileOfs = uintFrom8Bytes(b, i + bytesRead);
			bytesRead += 8;
		}
		let baseVerOfs: number|undefined = undefined;
		if (flag & BASE_VER_OFS_PRESENT_BITMASK) {
			baseVerOfs = uintFrom8Bytes(b, i + bytesRead);
			bytesRead += 8;
		}
		const isOnDisk = (fileOfs !== undefined);
		const isBase = (baseVerOfs !== undefined);
		const isFinite = (len !== undefined);
		let sInfo: SegsChunk;
		if (isOnDisk) {
			if (!isFinite) { throw new Error(`Obj file segments chunk flag says that bytes are on disk, when chunk is infinite`); }
			if (isBase) {
				sInfo = {
					type: 'base-on-disk',
					thisVerOfs,
					len: len!,
					fileOfs: fileOfs!,
					baseVerOfs: baseVerOfs!
				};
			} else {
				sInfo = {
					type: 'new-on-disk',
					thisVerOfs,
					len: len!,
					fileOfs: fileOfs!
				};
			}
		} else {
			if (isBase) {
				sInfo = {
					type: 'base',
					thisVerOfs,
					len: len!,
					baseVerOfs: baseVerOfs!
				};
			} else if (isFinite) {
				sInfo = {
					type: 'new',
					thisVerOfs,
					len: len!
				};
			} else {
				sInfo = {
					type: 'new-endless',
					thisVerOfs
				};
			}
		}
		return { sInfo, bytesRead };
	}

}
Object.freeze(segsChunkInfo);

export namespace layoutV1 {

	const HEADER_PRESENT_BITMASK = 0b00000001;
	const BASE_PRESENT_BITMASK = 0b00000010;
	const SEGS_LAYOUT_FROZEN_BITMASK = 0b00000100;
	const TOTAL_SIZE_NOT_SET_BITMASK = 0b00001000;
	const VERSION_FILE_COMPLETE_BITMASK = 0b00010000;
	const ALL_BASE_BYTES_IN_FILE_BITMASK = 0b00100000;

	export interface Attrs {
		fileComplete: boolean;
		segsChunks: SegsChunk[];
		headerChunk?: HeaderChunkInfo;
		segsLayoutFrozen: boolean;
		baseVersion?: number;
		sizeUnknown: boolean;
		allBaseBytesInFile: boolean;
	}

	function validateAttrs(attrs: Attrs): void {
		// XXX check consistency of attrs
	
	}

	export function toBytes(a: Attrs): Buffer {
		let flag = 0;
		let baseBytes: Buffer|undefined = undefined;
		if (a.baseVersion !== undefined) {
			flag |= BASE_PRESENT_BITMASK;
			baseBytes = uintTo8Bytes(a.baseVersion);
			if (a.allBaseBytesInFile) {
				flag |= ALL_BASE_BYTES_IN_FILE_BITMASK;
			}
		}
		let headerInfoBytes: Buffer|undefined = undefined;
		if (a.headerChunk) {
			flag |= HEADER_PRESENT_BITMASK;
			headerInfoBytes = headerChunkInfo.toBytes(a.headerChunk);
			if (a.fileComplete) {
				flag |= VERSION_FILE_COMPLETE_BITMASK;
			}
		}
		if (a.segsLayoutFrozen) {
			flag |= SEGS_LAYOUT_FROZEN_BITMASK;
		}
		if (a.sizeUnknown) {
			flag |= TOTAL_SIZE_NOT_SET_BITMASK;
		}
		const segsInfoBytes = a.segsChunks.map(s => segsChunkInfo.toBytes(s));
		const buf = Buffer.allocUnsafe(1 +
			(baseBytes ? 8 : 0) +
			(headerInfoBytes ? headerInfoBytes.length : 0) +
			totalLenOf(segsInfoBytes));
		buf[0] = flag;
		let i = 1;
		if (baseBytes) {
			buf.set(baseBytes, i);
			i += 8;
		}
		if (headerInfoBytes) {
			buf.set(headerInfoBytes, i);
			i += headerInfoBytes.length;
		}
		for (const chunk of segsInfoBytes) {
			buf.set(chunk, i);
			i += chunk.length;
		}
		return buf;
	}

	export function fromBytes(b: Uint8Array, i: number): Attrs {
		const flag = b[i];
		i += 1;
		let baseVersion: number|undefined = undefined;
		if (flag & BASE_PRESENT_BITMASK) {
			baseVersion = uintFrom8Bytes(b, i);
			i += 8;
		}
		let headerChunk: HeaderChunkInfo|undefined = undefined;
		if (flag & HEADER_PRESENT_BITMASK) {
			const { hInfo, bytesRead } = headerChunkInfo.fromBytes(b, i);
			headerChunk = hInfo;
			i += bytesRead;
		}
		const fileComplete = !!(flag & VERSION_FILE_COMPLETE_BITMASK);
		const segsLayoutFrozen = !!(flag & SEGS_LAYOUT_FROZEN_BITMASK);
		const sizeUnknown = !!(flag & TOTAL_SIZE_NOT_SET_BITMASK);
		const allBaseBytesInFile = !!(flag && ALL_BASE_BYTES_IN_FILE_BITMASK);
		const segsChunks: SegsChunk[] = [];
		while (i < b.length) {
			const { sInfo, bytesRead } = segsChunkInfo.fromBytes(b, i);
			segsChunks.push(sInfo);
			i += bytesRead;
		}
		const attrs = { fileComplete, segsChunks, headerChunk, segsLayoutFrozen,
			baseVersion, sizeUnknown, allBaseBytesInFile };
		validateAttrs(attrs);
		return attrs;
	}

}
Object.freeze(layoutV1);

function totalLenOf(arrs: Uint8Array[]): number {
	let totalLen = 0;
	for (const arr of arrs) {
		totalLen += arr.length;
	}
	return totalLen;
}


Object.freeze(exports);