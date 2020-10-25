/*
 Copyright (C) 2016, 2020 3NSoft Inc.
 
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

import { ServerRunner } from '../server-runner';
import { mkdir, rmDirWithContent, writeFile } from '../../../lib-common/async-fs-node';
import { FileException } from '../../../lib-common/exceptions/file';
import { adminApp as makeAdminApp, Configurations, servicesApp as makeServicesApp } from '../../../services';
import { DNSMock } from '../../../mock/dns';
import * as dns from 'dns';
import { AppWithWSs } from '../../../lib-server/web-sockets/app';
import { join } from 'path';
import { makeMultiDomainSignupCtx } from '../../../admin/signup-tokens';

const DEFAULT_SERVICE_PORT = 8088;
const DEFAULT_DATA_FOLDER = join(__dirname, '/../../../../test-data');

export abstract class Component extends ServerRunner {

	dns: DNSMock;

	constructor(
		protected conf: Configurations,
		private signupDomains: string[],
		servicePort = DEFAULT_SERVICE_PORT,
		protected dataFolder = DEFAULT_DATA_FOLDER
	) {
		super(servicePort);
		this.conf.rootFolder = this.dataFolder;
		this.conf.signup!.noTokenFile = join(
			this.dataFolder, 'no-tokens-signup.json');
		if (this.conf.mailerId) {
			const certs = this.conf.mailerId.certs;
			this.conf.mailerId.certs = join(
				this.dataFolder, (certs ? certs : 'mid-certs.json'));
		}
		const urlWithoutProto = this.url.substring(this.url.indexOf('://')+3);
		this.dns = new DNSMock(urlWithoutProto+'mailerid/');
	}

	async prepToRun(): Promise<AppWithWSs> {

		// prepare data folders
		try {
			await mkdir(this.dataFolder);
			// write to-tokens signup file
			const noTokenCtx = makeMultiDomainSignupCtx(this.signupDomains);
			await writeFile(
				this.conf.signup!.noTokenFile!, JSON.stringify(noTokenCtx),
				{ encoding: 'utf8' }
			);
		} catch (exc) {
			if (!(exc as FileException).alreadyExists) { throw exc; }
		}

		// inject dns mock
		(dns as any).resolveTxt = this.dns.resolveTxt;

		// setup servers
		const app = new AppWithWSs();
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