/*
 Copyright (C) 2020 3NSoft Inc.
 
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

import { toCanonicalAddress } from '../lib-common/canonical-address';
import { assert } from '../lib-common/assert';
import { bytes as randomBytes } from '../lib-common/random-node';
import { base64urlSafe } from '../lib-common/buffer-utils';
import { tokensInRootFolder } from '../lib-server/resources/server-data-folders';
import { join } from 'path';
import { compareVectors } from 'ecma-nacl';


export type SignupContext = SingleUserSignupCtx | MultiDomainSignupCtx;

export interface SingleUserSignupCtx {
	token: string;
	type: 'single-user';
	userId: string;
	validTill?: number;
}

export interface MultiDomainSignupCtx {
	token?: string;
	type: 'multi-domain';
	domains: string[];
	validTill?: number;
}

export function canCreateUser(userId: string, ctx: SignupContext): boolean {
	if (ctx.validTill) {
		const now = Math.floor(Date.now()/1000);
		if (now > ctx.validTill) {
			return false;
		}
	}
	const cAddr = toCanonicalAddress(userId);
	if (ctx.type === 'single-user') {
		return (cAddr === ctx.userId);
	} else if (ctx.type === 'multi-domain') {
		return !!ctx.domains.find(d => cAddr.endsWith(d));
	} else {
		return false;
	}
}

export function addressesForName(
	name: string, ctx: SignupContext
): string[]|undefined {
	if (ctx.validTill) {
		const now = Math.floor(Date.now()/1000);
		if (now > ctx.validTill) {
			return;
		}
	}
	if (ctx.type === 'single-user') {
		const userId = `${name}${ctx.userId.substring(ctx.userId.indexOf('@'))}`;
		return ((toCanonicalAddress(userId) === ctx.userId) ?
			[ userId ] : [] );
	} else if (ctx.type === 'multi-domain') {
		return ctx.domains.map(d => `${name}${d}`);
	} else {
		throw Error(`Unknown signup context type ${(ctx as any).type}`);
	}
}

export function makeSingleUserSignupCtx(
	token: string, userId: string, validitySecs?: number
): SingleUserSignupCtx {
	const ctx: SingleUserSignupCtx = {
		token,
		type: 'single-user',
		userId: toCanonicalAddress(userId)
	};
	if (validitySecs) {
		ctx.validTill = Math.floor(Date.now()/1000) + validitySecs;
	}
	return ctx;
}

export function makeMultiDomainSignupCtx(
	signupDomains: string[], token?: string, validitySecs?: number
): MultiDomainSignupCtx {
	assert(Array.isArray(signupDomains));
	const ctx: MultiDomainSignupCtx = {
		token,
		type: 'multi-domain',
		domains: signupDomains.map(toCanonicalAddress)
	};
	if (validitySecs) {
		ctx.validTill = Math.floor(Date.now()/1000) + validitySecs;
	}
	return ctx;
}

const TOKEN_BYTES_LEN = 30;
const TOKEN_FILE_NAME_LEN = 10;

export async function generateToken(): Promise<string> {
	const tokenBytes = await randomBytes(TOKEN_BYTES_LEN);
	const token = base64urlSafe.pack(tokenBytes);
	return token;
}

export function parseToken(
	token: string
): { tokenBytes: Buffer; tokenFile: string; }|undefined {
	try {
		const tokenBytes = base64urlSafe.open(token) as Buffer;
		const tokenFile = tokenFileName(token);
		return { tokenBytes, tokenFile };
	} catch (err) {
		return;	// explicit undefined
	}
}

function tokenFileName(token: string): string {
	return token.substring(0, TOKEN_FILE_NAME_LEN);
}

export function tokenPath(rootFolder: string, token: string): string {
	return join(tokensInRootFolder(rootFolder), tokenFileName(token));
}

export function areTokensSame(t1: Buffer, t2: string): boolean {
	try {
		const t2Bytes = base64urlSafe.open(t2);
		return compareVectors(t1, t2Bytes);
	} catch (err) {
		return false;
	}
}


Object.freeze(exports);