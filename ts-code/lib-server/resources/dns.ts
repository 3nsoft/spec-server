/*
 Copyright (C) 2015 - 2016, 2023 3NSoft Inc.
 
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
function extractPair(
	txtRecords: string[][], serviceLabel: ServiceLabel
): string|undefined {
	for (const txtRecord of txtRecords) {
		let joinedTXTstanzas = txtRecord.join('');
		let record = getRecordAtStartOf(joinedTXTstanzas);
		while (record) {
			if (record.service === serviceLabel) {
				const value = record.value.trim();
				if (value.length > 0) {
					return value;
				}
			}
			if (record.txtTail) {
				record = getRecordAtStartOf(record.txtTail);
			} else {
				break;
			}
		}
	}
	return;
}

const recordsStarts: { [key in ServiceLabel]: string; } = {
	"3nstorage": '3nstorage=',
	asmail: 'asmail=',
	mailerid: 'mailerid='
}

function getRecordAtStartOf(txt: string): {
	service: ServiceLabel; value: string; txtTail?: string;
}|undefined {
	let service: ServiceLabel|undefined = undefined;
	for (const [ label, startSeq ] of Object.entries(recordsStarts)) {
		if (txt.startsWith(startSeq)) {
			service = label as ServiceLabel;
			txt = txt.substring(startSeq.length);
			break;
		}
	}
	if (!service) { return; }
	for (const delimiter of Object.values(recordsStarts)) {
		const endPos = txt.indexOf(delimiter);
		if (endPos >= 0) {
			return {
				service,
				value: txt.substring(0, endPos),
				txtTail: txt.substring(endPos)
			};
		}
	}
	return {
		service,
		value: txt
	};
}

export type ServiceLabel = 'asmail' | 'mailerid' | '3nstorage';

function resolveTxt(domain: string): Promise<string[][]> {
	return new Promise<string[][]>((resolve, reject) => {
		// As of March 2017, docs for node say that texts given in a callback
		// are string[][], and node works this way, but definition is incorrect.
		// Therefore, need to insert "as any" into resolve function.
		dns.resolveTxt(domain, (err, texts) => {
			if (err) {
				reject(err);
			} else {
				resolve(texts as any);
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
	const indOfAt = address.lastIndexOf('@');
	const domain = ((indOfAt < 0) ? address : address.substring(indOfAt+1));
	return domain;
}

export async function get3NWebRecords(address: string,
		serviceLabel: ServiceLabel): Promise<string> {
	try {
		const domain = domainOfAddress(address);
		const txtRecords = await resolveTxt(domain);
		const recValue = extractPair(txtRecords, serviceLabel);
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