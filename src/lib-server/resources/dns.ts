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

import * as dns from 'dns';

export const SC = {
	RECORDS_MISSING: 'records missing',
	DOMAIN_NOT_FOUND: 'domain not found'
};
Object.freeze(SC);

const DNS_ERR_CODE = {
	NODATA: 'ENODATA',
	NOTFOUND: 'ENOTFOUND'
};
Object.freeze(DNS_ERR_CODE);

interface DnsError extends Error {
	code: string;
	hostname: string;
}

/**
 * This implementation extracts exactly one string value for a given service.
 * All other values are ignored, without raising error about misconfiguration.
 * In time we may have several records for the same service type, yet, for now
 * only one TXT per service per domain is considered valid.
 * @param txtRecords are TXT records from dns.
 * @param serviceLabel is a label of service, for which we want to get string
 * value from TXT record.
 * @return string value for a given service among given dns TXT records.  
 */
function extractPair(txtRecords: string[][], serviceLabel: string): string {
	for (let txtRecord of txtRecords) {
		let txt = txtRecord.join(' ');
		let eqPos = txt.indexOf('=');
		if (eqPos < 0) { continue; }
		let name = txt.substring(0, eqPos).trim();
		if (name === serviceLabel) {
			let value = txt.substring(eqPos+1).trim();
			return value;
		}
	}
	return;
}

export type ServiceLabel = 'asmail' | 'mailerid' | '3nstorage';

function resolveTxt(domain: string): Promise<string[][]> {
	return new Promise<string[][]>((resolve, reject) => {
		dns.resolveTxt(domain, (err, texts) => {
			if (err) {
				reject(err);
			} else {
				resolve(texts);
			}
		});
	});
}

/**
 * @param address
 * @return domain string, extracted from a given address
 */
function domainOfAddress(address: string): string {
	address = address.trim();
	let indOfAt = address.lastIndexOf('@');
	let domain = ((indOfAt < 0) ? address : address.substring(indOfAt+1));
	return domain;
}

export async function get3NWebRecords(address: string,
		serviceLabel: ServiceLabel): Promise<string> {
	try {
		let domain = domainOfAddress(address);
		let txtRecords = await resolveTxt(domain);
		let recValue = extractPair(txtRecords, serviceLabel);
		if (!recValue) { throw SC.RECORDS_MISSING; }
		return recValue;
	} catch (err) {
		if ((<DnsError> err).code === DNS_ERR_CODE.NODATA) {
			throw SC.RECORDS_MISSING;
		} else if ((<DnsError> err).code === DNS_ERR_CODE.NOTFOUND) {
			throw SC.DOMAIN_NOT_FOUND;
		} else {
			throw err;
		}
	}
}

Object.freeze(exports);