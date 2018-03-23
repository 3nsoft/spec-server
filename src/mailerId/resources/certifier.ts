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

import { signing } from 'ecma-nacl';
import { relyingParty as midRP, idProvider as midIdP, KEY_USE }
	from '../../lib-common/mid-sigs-NaCl-Ed';
import { getKeyCert, JsonKey, SignedLoad, keyFromJson }
	from '../../lib-common/jwkeys';
import * as random from '../../lib-common/random-node';
import { readFileSync, writeFileSync } from 'fs';
import { FileException, Code as excCode }
	from '../../lib-common/exceptions/file';

export const ROOT_CERT_VALIDITY = 365*24*60*60;
export const PROVIDER_CERT_VALIDITY = 10*24*60*60;
export const MAX_USER_CERT_VALIDITY = 24*60*60;

export interface RootCerts {
	current: SignedLoad;
	previous: SignedLoad[];
}

interface LogFn {
	(msg: string): void;
}

function loadOrGenerateRootCert(domain: string, path: string):
		{ certs: RootCerts; skey: JsonKey; } {
	let certsAndKey: { certs: RootCerts; skey: JsonKey; };
	try {
		certsAndKey = JSON.parse(
			readFileSync(path, { encoding: 'utf8', flag: 'r' }));
	} catch (err) {
		if ((<FileException> err).code === excCode.notFound) {
			return createFirstCert(domain, path);
		} else {
			throw err;
		}
	}
	const certDomain = getKeyCert(certsAndKey.certs.current).issuer;
	if (certDomain !== domain) {
		throw new Error('Give domain '+domain+
			' does not equal domain in certificates file: '+certDomain);
	}
	try {
		const pkeyBytes = signing.extract_pkey(keyFromJson(
			certsAndKey.skey, KEY_USE.ROOT, signing.JWK_ALG_NAME,
			signing.SECRET_KEY_LENGTH).k);
		const rootPKey = {
			k: pkeyBytes,
			kid: certsAndKey.skey.kid,
			alg: certsAndKey.skey.alg,
			use: certsAndKey.skey.use
		};
		midRP.verifyKeyCert(certsAndKey.certs.current, domain,
			rootPKey, Math.floor(Date.now()/1000)+PROVIDER_CERT_VALIDITY);
		return certsAndKey;
	} catch (err) {
		return updateCert(domain, path, certsAndKey.certs);
	}
}

function createFirstCert(domain: string, path: string, log?: LogFn):
		{ certs: RootCerts; skey: JsonKey; } {
	if (log) { log("\nMailerId service: Creating and saving new root certificate."); } 
	const root = midIdP.generateRootKey(
		domain, ROOT_CERT_VALIDITY, random.bytes);
	const toSave = {
		skey: root.skey,
		certs: {
			current: root.cert,
			previous: []
		}
	};
	writeFileSync(path, JSON.stringify(toSave),
		{ encoding: 'utf8', flag: 'wx' });
	return toSave;
}

function updateCert(domain: string, path: string, certs: RootCerts,
		log?: LogFn): { certs: RootCerts; skey: JsonKey; } {
	if (log) { log("\nMailerId service: Updating root certificate."); }
	const root = midIdP.generateRootKey(
		domain, ROOT_CERT_VALIDITY, random.bytes);
	const toSave = {
		skey: root.skey,
		certs: {
			current: root.cert,
			previous: [ certs.current ].concat(certs.previous)
		}
	};
	writeFileSync(path, JSON.stringify(toSave),
		{ encoding: 'utf8', flag: 'w' });
	return toSave;
}

export interface ICertify {
	(userPKey: JsonKey, address: string, validFor?: number):
		{ userCert: SignedLoad; provCert: SignedLoad; };
}
export interface Certifier {
	certify: ICertify;
	getRootCert(): SignedLoad;
	getPrevCerts(): SignedLoad[];
}

const UPDATE_PERIOD = 8*60*60;

if (UPDATE_PERIOD >= PROVIDER_CERT_VALIDITY) {
	throw new Error('Either provider certificate validity is to too short, '+
		'or an update period is too long.');
}

export function makeSingleProcCertifier(domain: string, certsPath: string):
		Certifier {
	
	let rootCerts: RootCerts;
	let certifier: midIdP.IdProviderCertifier;
	let provCert: SignedLoad;
	let updateTime: number;
	
	function updateCertifier() {
		if (certifier) {
			if (updateTime > Date.now()) { return; }
			certifier.destroy();
		}
		
		let certsAndKey = loadOrGenerateRootCert(domain, certsPath);
		rootCerts = certsAndKey.certs;
		
		const provider = midIdP.generateProviderKey(
				domain, PROVIDER_CERT_VALIDITY, certsAndKey.skey, random.bytes);
		certsAndKey = (undefined as any);
		
		provCert = provider.cert;
		Object.freeze(provCert);
	
		certifier = midIdP.makeIdProviderCertifier(
				domain, MAX_USER_CERT_VALIDITY, provider.skey);
		
		updateTime = (getKeyCert(provCert).expiresAt - 2*UPDATE_PERIOD)*1000;
	}
	
	updateCertifier();
	const timer: NodeJS.Timer = <any> setInterval(
		updateCertifier, UPDATE_PERIOD*1000);
	timer.unref();
	
	const fact: Certifier = {
		certify: (userPKey: JsonKey, address: string, validFor?: number) => {
			return {
				userCert: certifier.certify(userPKey, address, validFor),
				provCert: provCert
			};
		},
		getRootCert: () => {
			return rootCerts.current;
		},
		getPrevCerts: () => {
			return rootCerts.previous;
		}
	};
	Object.freeze(fact);
	return fact;
}

Object.freeze(exports);