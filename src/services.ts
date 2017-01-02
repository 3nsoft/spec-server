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

/*
 * This puts together two express servers: one serves 3NWeb services, another
 * one is an administration interface.
 */

import * as https from "https";
import * as fs from 'fs';
import * as express from 'express';
import { FileException, Code as excCode } from './lib-common/exceptions/file';
import { validator } from './lib-server/resources/mailerid-authorizer';

import { makeApp as makeMailerIdApp } from './mailerId/mailerId-app';
import { makeApp as makeMailApp } from './asmail/asmail-app';
import { makeApp as makeStoreApp } from './3nstorage/3nstorage-app';
import { makeApp as makeAdminApp } from './admin/admin-app';

export interface Configurations {
	enabledServices: {
		asmail?: boolean;
		storage?: boolean;
		mailerId?: boolean;
	};
	servicesConnect?: {
		hostname?: string;
		port: number;
		sslOts?: https.ServerOptions;
	};
	adminConnect?: {
		hostname?: string;
		port: number;
		sslOts?: https.ServerOptions;
	};
	rootFolder: string;
	domain: string;
	mailerId?: {
		certs: string;
	};
	signup: {
		domains: string[];
	};
}

export function servicesApp(conf: Configurations): express.Express {
	let serviceApp = express();
	let rootFolder = conf.rootFolder+'/users';
	if (!conf.enabledServices || (typeof conf.enabledServices !== 'object')) {
		throw new Error('Missing enabled-services sections in confs.');
	}
	let midAuthorizer = validator();	// share, allowing for caching of certs
	if (conf.enabledServices.mailerId) {
		serviceApp.use('/mailerid', makeMailerIdApp(
			rootFolder, conf.domain, conf.mailerId!.certs));
	}
	if (conf.enabledServices.asmail) {
		serviceApp.use('/asmail',
			makeMailApp(rootFolder, conf.domain, midAuthorizer));
	}
	if (conf.enabledServices.storage) {
		serviceApp.use('/3nstorage',
			makeStoreApp(rootFolder, conf.domain, midAuthorizer));
	}
	return serviceApp;
}

export function adminApp(conf: Configurations): express.Express {
	let adminApp = makeAdminApp(conf.signup.domains, conf.rootFolder);
	return adminApp;
}


Object.freeze(exports);