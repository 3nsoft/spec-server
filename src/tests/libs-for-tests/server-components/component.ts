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

import { ServerRunner } from '../server-runner';
import { mkdir, rmDirWithContent } from '../../../lib-common/async-fs-node';
import { FileException } from '../../../lib-common/exceptions/file';
import * as express from 'express';
import { adminApp as makeAdminApp, Configurations,
	servicesApp as makeServicesApp } from '../../../services';
import { DNSMock } from '../../../mock/dns';
import * as dns from 'dns';

const DEFAULT_SERVICE_PORT = 8088;
const DEFAULT_DATA_FOLDER = __dirname+'/../../../test-data';

export abstract class Component extends ServerRunner {
	
	dns: DNSMock;
	
	constructor(
			protected conf: Configurations,
			servicePort = DEFAULT_SERVICE_PORT,
			protected dataFolder = DEFAULT_DATA_FOLDER) {
		super(servicePort);
		this.conf.rootFolder = this.dataFolder + (this.conf.rootFolder ? 
			this.conf.rootFolder : '/users');
		if (this.conf.mailerId) {
			let certs = this.conf.mailerId.certs;
			this.conf.mailerId.certs = this.dataFolder + (certs ?
				certs : '/mid-certs.json');
		}
		let urlWithoutProto = this.url.substring(this.url.indexOf('://'+3))
		this.dns = new DNSMock(urlWithoutProto+'mailerid/');
	}
	
	async prepToRun(): Promise<express.Express> {
		
		// prepare data folders
		try {
			await mkdir(this.dataFolder);
			await mkdir(this.conf.rootFolder);
		} catch (exc) {
			if (!(<FileException> exc).alreadyExists) { throw exc; }
		}
		
		// inject dns mock
		(dns as any).resolveTxt = this.dns.resolveTxt;

		// setup servers
		let app = express();
		app.use(makeAdminApp(this.conf));
		app.use(makeServicesApp(this.conf));
		
		return app;
	}
	
	async clean(): Promise<void> {
		await rmDirWithContent(this.dataFolder).catch((exc: FileException) => {
			if (!exc.notFound) { throw exc; }
		});
	}
	
}
Object.freeze(Component.prototype);
Object.freeze(Component);

Object.freeze(exports);