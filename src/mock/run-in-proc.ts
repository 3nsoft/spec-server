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

import * as https from "https";
import { sslOpts } from './tls-options';
import { AppWithWSs } from '../lib-server/web-sockets/app';
import { mkdir } from '../lib-common/async-fs-node';
import { FileException } from '../lib-common/exceptions/file';
import { adminApp, Configurations, servicesApp } from '../services';
import * as dns from 'dns';
import { DNSMock, DnsTxtRecords } from './dns';
import { join } from 'path';

export function setTestCertsAndDNS(
	signupDomains: string[], srvDomain: string, port: number
): DNSMock {

	// allow client test calls to trust above self-signed cert
	https.globalAgent.options.ca = sslOpts.cert;

	// inject dns mock
	const thisLoc = `${srvDomain}:${port}`;
	const dnsRecs: DnsTxtRecords = {};
	for (const domain of signupDomains) {
		dnsRecs[domain] = [
			[ 'asmail', '=', `${thisLoc}/asmail` ],	// DNS txt with spaces
			[ 'mailerid=', `${thisLoc}/mailerid` ],	// DNS txt with space
			[ `3nstorage=${thisLoc}/3nstorage` ]	// DNS txt without spaces
		];
	}
	const dnsMock = new DNSMock(dnsRecs);
	(dns as any).resolveTxt = dnsMock.resolveTxt;

	return dnsMock;
}

export async function startOn(
	srvDomain: string, dataDir: string, port: number, signupDomains: string[]
): Promise<{ stop: () => Promise<void>; dnsMock: DNSMock; }> {

	const conf: Configurations = {
		rootFolder: join(dataDir, 'users'),
		domain: srvDomain,
		enabledServices: {
			asmail: true,
			mailerId: true,
			storage: true
		},
		signup: {
			domains: signupDomains
		},
		mailerId: {
			certs: join(dataDir, 'mid-certs.json')
		},
		servicesConnect: {
			port,
			sslOpts
		}
	};

	// prepare data folders
	await mkdir(dataDir)
	.then(() => mkdir(conf.rootFolder))
	.catch((exc: FileException) => {
		if (!exc.alreadyExists) { throw exc; }
	});

	// certs and DNS
	const dnsMock = setTestCertsAndDNS(signupDomains, srvDomain, port);

	// setup services and start
	const app = new AppWithWSs();
	app.use(adminApp(conf));
	app.use(servicesApp(conf));
	await app.start(conf.servicesConnect!.sslOpts, conf.servicesConnect!.port);

	return { dnsMock, stop: () => app.stop() };
}

export function startOnLocalhost(
	dataDir: string, port: number, signupDomains: string[]
): Promise<{ stop: () => Promise<void>; dnsMock: DNSMock; }> {
	return startOn('localhost', dataDir, port, signupDomains);
}