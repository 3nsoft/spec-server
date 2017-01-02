/*
 Copyright (C) 2016 3NSoft Inc.
 
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
import { DiffInfo } from '../../lib-common/service-api/3nstorage/owner';
import { errWithCause } from '../../lib-common/exceptions/error';

/**
 * This byte sequence starts file with the following layout:
 * 1) 3 bytes with this sequence;
 * 2) 5 bytes with offset, at which segments start;
 * 3) header bytes up to start of segments;
 * 4) segments bytes up to file end.
 */
const ALL_BYTES_FILE_START = new Buffer('all', 'utf8');
/**
 * This byte sequence starts file with the following layout:
 * 1) 3 bytes with this sequence;
 * 2) 5 bytes with offset, at which header starts;
 * 3) 5 bytes with offset, at which segments start;
 * 4) header bytes up to start of segments;
 * 5) segments bytes up to file end.
 */
const DIFF_BYTES_FILE_START = new Buffer('dif', 'utf8');

/**
 * @param u is an unsigned integer (up to 40-bit) to be stored littleendian
 * way in 5 bytes.
 * @return a byte array with number stored in it.
 */
function uintTo5Bytes(u: number): Buffer {
	if (u >= 0x10000000000) { throw new Error(
		'Cannot store number bigger than 2^40-1'); }
	let x = new Buffer(5);
	x[0] = (u / 0x100000000) | 0;
	x[1] = u >>> 24;
	x[2] = u >>> 16;
	x[3] = u >>> 8;
	x[4] = u;
	return x;
}

/**
 * @param x
 * @param i
 * @return unsigned integer (up to 40 bits), stored littleendian way
 * in 5 bytes of x, starting at index i.
 */
function uintFrom5Bytes(x: Buffer, i = 0): number {
	if (x.length < i+5) { throw new Error(
		'Given array has less than 5 bytes, starting with a given index.'); }
	var l = (x[1] << 24) | (x[2] << 16) | (x[3] << 8) | x[4];
	return (x[0] * 0x100000000) + l;
}

function bytesEqual(a: Buffer, b: Buffer): boolean {
	if (a.length !== b.length) { return false; }
	for (let i=0; i < a.length; i+=1) {
		if (a[i] !== b[i]) { return false; }
	}
	return true;
}

export async function parseObjFile(fd: number):
		Promise<{ headerOffset: number; segsOffset: number; diff?: DiffInfo; }> {
	let buf = new Buffer(13);
	await fs.read(fd, 0, buf).catch((exc: fs.FileException) => {
		if (exc.endOfFile) { throw new Error(
			'File is too short to contain object'); }
		throw exc;
	});
	let fileStart = buf.slice(0, 3);
	if (bytesEqual(fileStart, ALL_BYTES_FILE_START)) {
		return {
			headerOffset: 8,
			segsOffset: uintFrom5Bytes(buf.slice(3, 8))
		};
	} else if (bytesEqual(fileStart, DIFF_BYTES_FILE_START)) {
		let headerOffset = uintFrom5Bytes(buf.slice(3, 8));
		let diffBytes = new Buffer(headerOffset - 13);
		await fs.read(fd, 13, diffBytes);
		let diff: DiffInfo;
		try {
			diff = JSON.parse(diffBytes.toString('utf8'));
		} catch (err) {
			throw errWithCause(err, 'Cannot parse diff from object file');
		}
		return {
			headerOffset,
			segsOffset: uintFrom5Bytes(buf.slice(8, 13)),
			diff
		};
	} else {
		throw new Error('Object\'s file does not have recognizable byte signature at its start');
	}	
}

async function writeObjFileToDisk(path: string, fileSize: number,
		headerOffset: number, segsOffset: number, diffBytes: Buffer|null):
		Promise<void> {
	let fd = (await fs.createEmptyFile(path, fileSize, true))!;
	try {
		if (diffBytes) {
			await fs.write(fd, 0, DIFF_BYTES_FILE_START);
			await fs.write(fd, 3, uintTo5Bytes(headerOffset));
			await fs.write(fd, 8, uintTo5Bytes(segsOffset));
			await fs.write(fd, 13, diffBytes);
		} else {
			await fs.write(fd, 0, ALL_BYTES_FILE_START);
			await fs.write(fd, 3, uintTo5Bytes(segsOffset));
		}
	} finally {
		await fs.close(fd);
	}
}

export function structureObjFile(path: string, headerSize: number,
		segsSize: number, diff?: DiffInfo):
		{ headerOffset: number; segsOffset: number; fileSize: number;
			writeToDisk: () => Promise<void> } {
	let diffBytes = (diff ? new Buffer(JSON.stringify(diff), 'utf8') : null);
	let headerOffset = (diffBytes ? 13 + diffBytes.length : 8);
	let segsOffset = headerOffset + headerSize;
	let fileSize = segsOffset + ((segsSize > 0) ? segsSize : 0);
	let writeToDisk = () => writeObjFileToDisk(
		path, fileSize, headerOffset, segsOffset, diffBytes);
	return { headerOffset, segsOffset, fileSize, writeToDisk };
}
