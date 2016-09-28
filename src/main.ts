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
 * This script starts server, according to settings, given in config file.
 */

import * as https from "https";
import * as http from "http";
import * as fs from 'fs';
import { Configurations, servicesApp as makeServiceApp,
	adminApp as makeAdminApp } from './services';
import { startService } from './lib-server/async-server';

let confFile = process.argv[2];
if (!confFile) {
	console.error('Configuration file is not given. '+
		'It should be the first script argument.');
}
let conf: Configurations =
	JSON.parse(fs.readFileSync(confFile, 'utf8'));

let serviceApp = makeServiceApp(conf);
let serviceServer = (conf.servicesConnect.sslOts ?
	https.createServer(conf.servicesConnect.sslOts, serviceApp) :
	http.createServer(serviceApp));

let adminApp = makeAdminApp(conf);
let adminServer = (conf.adminConnect.sslOts ?
	https.createServer(conf.servicesConnect.sslOts, adminApp) :
	http.createServer(adminApp));

(async () => {
	try {
		await startService(serviceServer,
			conf.servicesConnect.port,
			conf.servicesConnect.hostname)
		console.log('\nServices are up and running.');
		// TODO start administrative interface
		// await startService(adminServer,
		// 	conf.adminConnect.port,
		// 	conf.adminConnect.hostname)
		// console.log('\Administration interface is up and running.');
	} catch (err) {
		console.error(err);
		process.exit(-500);
	}
})();