/*
 Copyright (C) 2016 3NSoft Inc.
 
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

import { commToParent, RequestEnvelope } from './node-child-ipc';
import { Configurations, servicesApp as makeServicesApp, adminApp as makeAdminApp } from '../services';
import * as dns from 'dns';
import { DNSMock, DnsTxtRecords } from './dns';
import { mkdir, rmDirWithContent } from '../lib-common/async-fs-node';
import { FileException } from '../lib-common/exceptions/file';
import * as https from "https";
import { sslOpts } from './tls-options';
import { AppWithWSs } from '../lib-server/web-sockets/app';

const SERVER_MOCK_CHANNEL = 'server-mock';

const parent = commToParent(SERVER_MOCK_CHANNEL);

const DEFAULT_SERVICE_PORT = 8088;
const DEFAULT_DATA_FOLDER = __dirname+'/../../mock-data';

let dnsMock: DNSMock;
let app: AppWithWSs|undefined;

parent.addHandler('set-dns-mock', setDnsMock);
async function setDnsMock(env: RequestEnvelope<DnsTxtRecords>) {
	dnsMock = new DNSMock(env.req);
	(dns as any).resolveTxt = dnsMock.resolveTxt;
}

interface ServiceUrls {
	mailerId: string;
	asmail: string;
	storage: string;
	signup: string;
	tlsCert: string;
}

interface MockConfAtStart {
	port?: number;
	dataFolder?: string;
	midServiceDomain: string;
	signupDomains: string[];
}

async function cleanDataFolder(): Promise<void> {
	await rmDirWithContent(DEFAULT_DATA_FOLDER).catch((exc: FileException) => {
		if (!exc.notFound) { throw exc; }
	});
}

parent.addHandler('start', start);
async function start(env: RequestEnvelope<MockConfAtStart>):
		Promise<ServiceUrls> {
	
	// get configurations to start services
	const servicePort = (env.req.port ? env.req.port : DEFAULT_SERVICE_PORT);
	const dataFolder = (env.req.dataFolder ?
		env.req.dataFolder : DEFAULT_DATA_FOLDER);
	const conf: Configurations = {
		rootFolder: dataFolder+'/users',
		domain: env.req.midServiceDomain,
		signup: {
			domains: env.req.signupDomains
		},
		enabledServices: {
			mailerId: true,
			asmail: true,
			storage: true
		},
		mailerId: {
			certs: dataFolder+'/mid-certs.json'
		}
	};

	// prepare data folders
	await cleanDataFolder();
	await mkdir(dataFolder);
	await mkdir(conf.rootFolder);

	// setup app
	app = new AppWithWSs();
	app.use(makeAdminApp(conf));
	app.use(makeServicesApp(conf));

	// start app
	await app.start(sslOpts, servicePort);

	// set client https to trust the cert (MailerId checks need this)
	(<any> https.globalAgent).options.ca = sslOpts.cert;

	// return services' urls
	const urls: ServiceUrls = {
		mailerId: `${conf.domain}:${servicePort}/mailerid/`,
		asmail: `${conf.domain}:${servicePort}/asmail/`,
		storage: `${conf.domain}:${servicePort}/3nstorage/`,
		signup: `${conf.domain}:${servicePort}/signup/`,
		tlsCert: sslOpts.cert as string
	};
	return urls;
}

parent.addHandler('stop', stop);
async function stop(env: RequestEnvelope<void>): Promise<void> {
	if (!app) { return; }
	await app.stop();
	app = undefined;
	await cleanDataFolder();
}