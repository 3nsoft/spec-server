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

import * as fs from 'fs';
import { Configurations, servicesApp as makeServiceApp,
	adminApp as makeAdminApp } from './services';

const confFile = process.argv[2];
if (!confFile) {
	console.error('Configuration file is not given. '+
		'It should be the first script argument.');
}
const conf: Configurations =
	JSON.parse(fs.readFileSync(confFile, 'utf8'));

const serviceApp = makeServiceApp(conf);
const adminApp = makeAdminApp(conf);

(async () => {
	try {
		if (conf.servicesConnect) {
			const conn = conf.servicesConnect;
			await serviceApp.start(conn.sslOts, conn.port, conn.hostname);
			console.log('\nServices are up and running.');
		}
		if (conf.adminConnect) {
			const conn = conf.adminConnect;
			await adminApp.start(conn.sslOts, conn.port, conn.hostname);
			console.log('\Administration interface is up and running.');
		}
	} catch (err) {
		console.error(err);
		process.exit(-500);
	}
})();