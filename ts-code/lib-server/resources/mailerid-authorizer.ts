/*
 Copyright (C) 2015 - 2016, 2019, 2025 - 2026 3NSoft Inc.
 
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

import * as https from 'https';
import { SignedLoad, getKeyCert, getPrincipalAddress } from '../../lib-common/jwkeys';
import * as mid from '../../lib-common/mid-sigs-NaCl-Ed';
import { get3NWebRecords } from './dns';
import { MidAuthorizer } from '../routes/sessions/mid-auth';
import { serviceRoot } from '../../lib-common/service-api/mailer-id/provisioning';
import type { OwnWellKnown } from '../../services';

/**
 * @param serviceRecordInDNS
 * @return a promise, resolvable to MailerId provider's current root
 * certificate.
 */
function getRootCert(serviceRecordInDNS: string): Promise<SignedLoad> {
	return new Promise<SignedLoad>((resolve, reject) => {
		const req = https.request('https://'+serviceRecordInDNS, (res) => {
			if (res.statusCode === 200) {
				res.setEncoding('utf8');
				let collectedString = '';
				res.on('data', (chunk) => {
					collectedString += chunk;
				});
				res.on('end', () => {
					const infoObj: serviceRoot.Reply = JSON.parse(collectedString);
					const cert = infoObj['current-cert'];
					if (cert) {
						resolve(cert);
					} else {
						reject(new Error(
							"Info file "+serviceRecordInDNS+", is malformed."));
					}
				});
				res.on('error', (err) => {
					reject(err);
				});
			} else {
				reject(new Error("Cannot get "+serviceRecordInDNS+
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

export function validator(
	ownMidService: OwnMidService|undefined, ownWellKnown: OwnWellKnown|undefined
): MidAuthorizer {
	return (
		rpDomain, sessionId, userId, assertion, userCert, provCert
	) => validate(
		rpDomain, sessionId, userId, assertion, userCert, provCert, ownMidService, ownWellKnown
	);
}

export interface OwnMidService { domain: string; getRoot: () => SignedLoad; }

async function validate(
	rpDomain: string, sessionId: string, userId: string,
	assertion: SignedLoad, userCert: SignedLoad, provCert: SignedLoad,
	ownMidService: OwnMidService|undefined, ownWellKnown: OwnWellKnown|undefined
): Promise<boolean> {
	const validAt = Date.now() / 1000;
	try{
		// check that certificate is for the user
		const addressInCert = getPrincipalAddress(userCert);
		if (userId !== addressInCert) { return false; }

		const issuer = getKeyCert(provCert).issuer;

		// get root certificate
		let rootCert: SignedLoad;
		if (useWellKnownNamingFor(userId)) {
			if (ownMidService && ownWellKnown?.mailerid
				&& (domainInAddress(userId) === rpDomain) // this instance serves naming for given user
				&& (issuer === domainInURL(ownWellKnown.mailerid)) // naming confirms issuer
				&& (issuer === ownMidService.domain) // issuer is our own MailerId service
			) {
				rootCert = ownMidService.getRoot();
			} else {
				throw `Looking at other well-known onion/i2p isn't implemented, yet`;
			}
		} else {	
			const serviceRecordInDNS = await get3NWebRecords(addressInCert, 'mailerid');
			const domainInRecord = serviceRecordInDNS.split('/')[0].split(':')[0];
			if (issuer !== domainInRecord) { return false; }
			rootCert = ((ownMidService && (issuer === ownMidService.domain)) ?
				ownMidService.getRoot() : await getRootCert(serviceRecordInDNS)
			);
		}

		// check the whole chain
		const assertInfo = mid.relyingParty.verifyAssertion(
			assertion,
			{ user: userCert, prov: provCert, root: rootCert },
			issuer, validAt
		);
		if ((assertInfo.relyingPartyDomain === rpDomain)
		&& (assertInfo.sessionId === sessionId)) {
			return true;
		} else {
			return false;
		}
	} catch (e) {
		return false;
	}
}

function useWellKnownNamingFor(userId: string): boolean {
	return (userId.endsWith('.onion') || userId.endsWith('.i2p'));
}

function domainInURL(url: string) {
	return (new URL(url)).hostname;	
}

function domainInAddress(userId: string): string {
	return userId.substring(userId.lastIndexOf('@')+1);
}


Object.freeze(exports);