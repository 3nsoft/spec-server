/*
 Copyright (C) 2015 - 2017, 2020 3NSoft Inc.
 
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

/*
 * This puts together two express servers: one serves 3NWeb services, another
 * one is an administration interface.
 */

import * as https from "https";
import { validator } from './lib-server/resources/mailerid-authorizer';
import { AppWithWSs } from './lib-server/web-sockets/app';
import { makeApp as makeMailerIdApp } from './mailerId/mailerId-app';
import { makeApp as makeMailApp } from './asmail/asmail-app';
import { makeApp as makeStoreApp } from './3nstorage/3nstorage-app';
import { makeApp as makeAdminApp } from './admin/admin-app';
import { ErrLogger, makeErrLoggerToConsole } from "./lib-server/middleware/error-handler";

export interface Configurations {
	enabledServices: {
		asmail?: boolean;
		storage?: boolean;
		mailerId?: boolean;
	};
	servicesConnect?: {
		hostname?: string;
		port: number;
		sslOpts?: https.ServerOptions;
		letsencrypt?: string;
		skipReloadOnCertsChange?: boolean;
	};
	rootFolder: string;
	domain: string;
	mailerId?: {
		certs: string;
	};
	signup?: {
		noTokenFile?: string;
	};
}

export function servicesApp(
	conf: Configurations, errLogger?: ErrLogger|'console', logSetup?: 'console'
): AppWithWSs {

	if (!conf.enabledServices || (typeof conf.enabledServices !== 'object')) {
		throw new Error('Missing enabled-services sections in confs.');
	}

	const app = new AppWithWSs();
	const midAuthorizer = validator();	// share, allowing for caching of certs

	if (conf.enabledServices.mailerId) {
		app.http.use('/mailerid', makeMailerIdApp(
			conf.rootFolder, conf.domain, conf.mailerId!.certs,
			(errLogger === 'console') ? makeErrLoggerToConsole('MailerId') : errLogger
		));
		if (logSetup === 'console') {
			console.log(`Enabled MailerId service with provider domain ${conf.domain}`);
		}
	}

	if (conf.enabledServices.asmail) {
		app.use('/asmail', makeMailApp(
			conf.rootFolder, conf.domain, midAuthorizer,
			(errLogger === 'console') ? makeErrLoggerToConsole('ASMail') : errLogger
		));
		if (logSetup === 'console') {
			console.log(`Enabled ASMail service with provider domain ${conf.domain}`);
		}
	}

	if (conf.enabledServices.storage) {
		app.use('/3nstorage', makeStoreApp(
			conf.rootFolder, conf.domain, midAuthorizer,
			(errLogger === 'console') ? makeErrLoggerToConsole('3NStorage') : errLogger
		));
		if (logSetup === 'console') {
			console.log(`Enabled 3NStorage service with provider domain ${conf.domain}`);
		}
	}
	return app;
}

export function adminApp(
	conf: Configurations, errLogger?: ErrLogger|'console', logSetup?: 'console'
): AppWithWSs {
	if (errLogger === 'console') {
		errLogger = makeErrLoggerToConsole('3NWeb server admin');
	}
	return new AppWithWSs(makeAdminApp(conf, errLogger, logSetup));
}

Object.freeze(exports);