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

import * as https from 'https';
import * as express from 'express';
import { SignedLoad, getKeyCert, getPrincipalAddress }
	from '../../lib-common/jwkeys';
import * as mid from '../../lib-common/mid-sigs-NaCl-Ed';
import { get3NWebRecords } from './dns';
import { IMidAuthorizer } from '../routes/sessions/mid-auth';

/**
 * @param serviceURL
 * @return a promise, resolvable to MailerId provider's current root
 * certificate.
 */
function getRootCert(serviceURL: string): Promise<SignedLoad> {
	return new Promise<SignedLoad>((resolve, reject) => {
		let req = https.request('https://'+serviceURL, (res) => {
			if (res.statusCode === 200) {
				res.setEncoding('utf8');
				let collectedString = '';
				res.on('data', (chunk) => {
					collectedString += chunk;
				});
				res.on('end', () => {
					let infoObj = JSON.parse(collectedString);
					let cert = infoObj['current-cert'];
					if (cert) {
						resolve(cert);
					} else {
						reject(new Error(
							"Info file "+serviceURL+", is malformed."));
					}
				});
				res.on('error', (err) => {
					reject(err);
				});
			} else {
				reject(new Error("Cannot get "+serviceURL+
					", returned " +"status code is "+res.statusCode));
			}
		});
		req.on('error', (err) => {
			reject(err);
		});
		req.end();
	});
}

// TODO need to add caching of certs using domain->(kid->cert)
//		(this will speed things up)

export function validator(): IMidAuthorizer {
	return (rpDomain: string, sessionId: string, userId: string,
			assertion: SignedLoad, userCert: SignedLoad, provCert: SignedLoad):
			Promise<boolean> => {
		return validate(rpDomain, sessionId, userId, assertion,
			userCert, provCert);
	};
}

async function validate(rpDomain: string, sessionId: string,
		userId: string, assertion: SignedLoad, userCert: SignedLoad,
		provCert: SignedLoad):
		Promise<boolean> {
	let validAt = Date.now() / 1000;
	try{
		// check that certificate is for the user
		let addressInCert = getPrincipalAddress(userCert);
		if (userId !== addressInCert) { return false; }
		
		// check that issuer is the one that provides MailerId service for
		// user's domain
		let issuer = getKeyCert(provCert).issuer;
		let serviceURL = await get3NWebRecords(addressInCert, 'mailerid');
		let domainInRecord = serviceURL.split('/')[0].split(':')[0];
		if (issuer !== domainInRecord) { return false; }
		
		// get root certificate and check the whole chain
		let rootCert = await getRootCert(serviceURL);
		let assertInfo = mid.relyingParty.verifyAssertion(assertion,
			{ user: userCert, prov: provCert, root: rootCert },
			issuer, validAt);
		if ((assertInfo.relyingPartyDomain === rpDomain) &&
				(assertInfo.sessionId === sessionId)) {
			return true;
		} else {
			return false;
		}
	} catch (e) {
		return false;
	}
}

Object.freeze(exports);