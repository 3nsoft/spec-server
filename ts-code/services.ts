/*
 Copyright (C) 2015 - 2017, 2020, 2024 - 2026 3NSoft Inc.
 
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
import { makeMailerIdApp } from './mailerId/mailerId-app';
import { makeASMailApp } from './asmail/asmail-app';
import { makeStorageApp } from './3nstorage/3nstorage-app';
import { makeSignupApp } from './signup/signup-app';
import { ErrLogger, makeErrLoggerToConsole } from "./lib-server/middleware/error-handler";
import { makeLockerApp } from "./locker/locker-app";
import { MidAuthorizer } from "./lib-server/routes/sessions/mid-auth";
import { makeWellKnownApp } from "./well-known/well-known-route-app";

export interface Configurations {
	enabledServices: {
		asmail?: boolean;
		storage?: boolean;
		mailerId?: boolean;
	};
	auxiliaryServices?: {
		locker?: boolean;
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
		serviceUrl?: string;
	};
	wellKnown3NWeb?: {
		mailerid?: string;
		asmail?: string;
		"3nstorage"?: string;
	};
}

export type OwnWellKnown = Configurations['wellKnown3NWeb'];

export function servicesApp(
	conf: Configurations, errLogger?: ErrLogger|'console', logSetup?: 'console'
): AppWithWSs {

	if (!conf.enabledServices || (typeof conf.enabledServices !== 'object')) {
		throw new Error('Missing enabled-services sections in confs.');
	}

	const app = new AppWithWSs();
	let midAuthorizer: MidAuthorizer;	// share, allowing for caching of certs

	if (conf.enabledServices.mailerId) {
		const { app: midApp, ownService } = makeMailerIdApp(
			conf.rootFolder, conf.domain, conf.mailerId!.certs,
			(errLogger === 'console') ? makeErrLoggerToConsole('MailerId') : errLogger
		);
		app.http.use('/mailerid', midApp);
		if (logSetup === 'console') {
			console.log(`Enabled MailerId service with provider domain ${conf.domain}`);
		}
		midAuthorizer = validator(ownService, conf.wellKnown3NWeb);
	} else {
		midAuthorizer = validator(undefined, conf.wellKnown3NWeb);
	}

	if (conf.enabledServices.asmail) {
		app.use('/asmail', makeASMailApp(
			conf.rootFolder, conf.domain, midAuthorizer,
			(errLogger === 'console') ? makeErrLoggerToConsole('ASMail') : errLogger
		));
		if (logSetup === 'console') {
			console.log(`Enabled ASMail service with provider domain ${conf.domain}`);
		}
	}

	if (conf.enabledServices.storage) {
		app.use('/3nstorage', makeStorageApp(
			conf.rootFolder, conf.domain, midAuthorizer,
			(errLogger === 'console') ? makeErrLoggerToConsole('3NStorage') : errLogger
		));
		if (logSetup === 'console') {
			console.log(`Enabled 3NStorage service with provider domain ${conf.domain}`);
		}
	}

	if (conf.auxiliaryServices?.locker) {
		app.use('/locker', makeLockerApp(
			conf.rootFolder,
			(errLogger === 'console') ? makeErrLoggerToConsole('Locker') : errLogger
		));
		if (logSetup === 'console') {
			console.log(`Enabled Locker service`);
		}
	}

	return app;
}

export function accountsApp(
	conf: Configurations, errLogger?: ErrLogger|'console', logSetup?: 'console'
): AppWithWSs {

	const app = new AppWithWSs();

	if (conf.signup) {
		app.http.use('/signup', makeSignupApp(
			conf,
			(errLogger === 'console') ? makeErrLoggerToConsole('Signup') : errLogger
		));
		if (logSetup === 'console') {
			console.log(`Enabled signup service.`);
		}
	}

	return app;
}

export function wellKnownApp(conf: Configurations): AppWithWSs {

	const app = new AppWithWSs();

	if (conf.wellKnown3NWeb) {
		app.http.use('/.well-known', makeWellKnownApp(conf.wellKnown3NWeb));
	}

	return app;
}

Object.freeze(exports);