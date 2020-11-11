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
import { mkdir, writeFile } from '../lib-common/async-fs-node';
import { FileException } from '../lib-common/exceptions/file';
import { adminApp, Configurations, servicesApp } from '../services';
import * as dns from 'dns';
import { DNSMock, DnsTxtRecords } from './dns';
import { join } from 'path';
import { makeMultiDomainSignupCtx } from "../admin/signup-tokens";

export function setTestCertsAndDNS(
	domains: string[], thisSrvLoc: string
): DNSMock {
	if (thisSrvLoc.endsWith('/')) { throw new Error(
		`Location value shouldn't have trailing slash`); }

	// allow client test calls to trust above self-signed cert
	https.globalAgent.options.ca = sslOpts.cert;

	// inject dns mock
	const dnsRecs: DnsTxtRecords = {};
	for (const domain of domains) {
		dnsRecs[domain] = [
			[ 'asmail', '=', `${thisSrvLoc}/asmail` ],	// DNS txt with spaces
			[ 'mailerid=', `${thisSrvLoc}/mailerid` ],	// DNS txt with space
			[ `3nstorage=${thisSrvLoc}/3nstorage` ]	// DNS txt without spaces
		];
	}
	const dnsMock = new DNSMock(dnsRecs);
	(dns as any).resolveTxt = dnsMock.resolveTxt;

	return dnsMock;
}

export async function startOn(
	srvDomain: string, dataDir: string, port: number,
	domains: { noTokenSignup: string[]; other: string[]; }
): Promise<{ stop: () => Promise<void>; dnsMock: DNSMock; }> {

	const noTokensFilePath = join(dataDir, 'no-tokens-signup.json');
	const conf: Configurations = {
		rootFolder: dataDir,
		domain: srvDomain,
		enabledServices: {
			asmail: true,
			mailerId: true,
			storage: true
		},
		signup: {
			noTokenFile: noTokensFilePath
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
	.catch((exc: FileException) => {
		if (!exc.alreadyExists) { throw exc; }
	});
	// write to-tokens signup file
	const noTokenCtx = makeMultiDomainSignupCtx(domains.noTokenSignup);
	await writeFile(
		noTokensFilePath, JSON.stringify(noTokenCtx), { encoding: 'utf8' }
	);

	// certs and DNS
	const allDomains = domains.noTokenSignup.concat(domains.other);
	const dnsMock = setTestCertsAndDNS(allDomains, `${srvDomain}:${port}`);

	// setup services and start
	const app = new AppWithWSs();
	app.use(adminApp(conf));
	app.use(servicesApp(conf));
	await app.start(conf.servicesConnect!.sslOpts, conf.servicesConnect!.port);

	return { dnsMock, stop: () => app.stop() };
}

export function startOnLocalhost(
	dataDir: string, port: number,
	domains: { noTokenSignup: string[]; other: string[]; }
): Promise<{ stop: () => Promise<void>; dnsMock: DNSMock; }> {
	return startOn('localhost', dataDir, port, domains);
}