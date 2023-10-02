/*
 Copyright (C) 2019 - 2020 3NSoft Inc.
 
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

import { writeFile, FileException, mkdir, readFile, readdir } from '../lib-common/async-fs-node';
import { makeSingleUserSignupCtx, generateToken, tokenPath, MultiDomainSignupCtx, SingleUserSignupCtx, makeMultiDomainSignupCtx } from "../admin/signup-tokens";
import { tokensInRootFolder } from "../lib-server/resources/server-data-folders";
import { errWithCause } from '../lib-common/exceptions/error';
import { join } from 'path';


export async function addSingleUserSignup(
	rootFolder: string, userId: string
): Promise<string> {
	const token = await generateToken();
	const ctx = makeSingleUserSignupCtx(token, userId);
	const fPath = tokenPath(rootFolder, token);
	try {
		await writeFile(
			fPath, JSON.stringify(ctx), { encoding: 'utf8', flag: 'wx' }
		);
		return token;
	} catch(exc) {
		if ((exc as FileException).alreadyExists) {
			return addSingleUserSignup(rootFolder, userId);
		} else if ((exc as FileException).notFound) {
			await mkdir(tokensInRootFolder(rootFolder))
			.catch((exc: FileException) => {
				if (!exc.alreadyExists) { throw exc; }
			});
			return addSingleUserSignup(rootFolder, userId);
		} else {
			throw exc;
		}
	}
}

export async function addMultiDomainSignup(
	rootFolder: string, domains: string[]
): Promise<string> {
	const token = await generateToken();
	const ctx = makeMultiDomainSignupCtx(domains, token);
	const fPath = tokenPath(rootFolder, token);
	try {
		await writeFile(
			fPath, JSON.stringify(ctx), { encoding: 'utf8', flag: 'wx' }
		);
		return token;
	} catch(exc) {
		if ((exc as FileException).alreadyExists) {
			return addMultiDomainSignup(rootFolder, domains);
		} else if ((exc as FileException).notFound) {
			await mkdir(tokensInRootFolder(rootFolder))
			.catch((exc: FileException) => {
				if (!exc.alreadyExists) { throw exc; }
			});
			return addMultiDomainSignup(rootFolder, domains);
		} else {
			throw exc;
		}
	}
}

export async function readNoTokensFile(
	noTokenFile: string
): Promise<MultiDomainSignupCtx> {
	try {
		const str = await readFile(noTokenFile, { encoding: 'utf8' });
		return JSON.parse(str);	
	} catch (err) {
		throw errWithCause(err, `Fail to read "no tokens" signup context file ${noTokenFile}`);
	}
}

export async function readTokenFile(
	rootFolder: string, tokenId: string
): Promise<SingleUserSignupCtx|MultiDomainSignupCtx|undefined> {
	try {
		const fPath = join(tokensInRootFolder(rootFolder), tokenId);
		const str = await readFile(fPath, { encoding: 'utf8' });
		const ctx = JSON.parse(str) as SingleUserSignupCtx|MultiDomainSignupCtx;
		if (!ctx.token) {
			return;
		} else if (ctx.type === 'multi-domain') {
			return (ctx.domains ? ctx : undefined);
		} else if (ctx.type === 'single-user') {
			return (ctx.userId ? ctx : undefined);
		} else {
			return;
		}
	} catch (err) {
		console.error(err);
		return;
	}
}

export async function readAllSignupTokens(rootFolder: string): Promise<{
	singleUserTokens: { tokenId: string; ctx: SingleUserSignupCtx; }[],
	multiUserTokens: { tokenId: string; ctx: MultiDomainSignupCtx; }[]
}> {
	const singleUserTokens: {
		tokenId: string; ctx: SingleUserSignupCtx;
	}[] = [];
	const multiUserTokens: {
		tokenId: string; ctx: MultiDomainSignupCtx;
	}[] = [];
	const tokenIds = await readdir(tokensInRootFolder(rootFolder));
	for (const tokenId of tokenIds) {
		const ctx = await readTokenFile(rootFolder, tokenId);
		if (!ctx) { continue; }
		if (ctx.type === 'multi-domain') {
			multiUserTokens.push({ tokenId, ctx });
		} else {
			singleUserTokens.push({ tokenId, ctx });
		}
	}
	return { multiUserTokens, singleUserTokens };
}


Object.freeze(exports);