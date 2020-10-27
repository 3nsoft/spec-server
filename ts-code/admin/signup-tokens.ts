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


export type SignupContext = SingleUserSignupCtx | MultiDomainSignupCtx;

export interface SingleUserSignupCtx {
	type: 'single-user';
	userId: string;
	validTill?: number;
}

export interface MultiDomainSignupCtx {
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
	userId: string, validitySecs?: number
): SingleUserSignupCtx {
	const ctx: SingleUserSignupCtx = {
		type: 'single-user',
		userId: toCanonicalAddress(userId)
	};
	if (validitySecs) {
		ctx.validTill = Math.floor(Date.now()/1000) + validitySecs;
	}
	return ctx;
}

export function makeMultiDomainSignupCtx(
	signupDomains: string[], validitySecs?: number
): MultiDomainSignupCtx {
	assert(Array.isArray(signupDomains));
	const ctx: MultiDomainSignupCtx = {
		type: 'multi-domain',
		domains: signupDomains.map(toCanonicalAddress)
	};
	if (validitySecs) {
		ctx.validTill = Math.floor(Date.now()/1000) + validitySecs;
	}
	return ctx;
}


Object.freeze(exports);