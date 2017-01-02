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
 * This script starts a demo with everything running in one server.
 */

import { Configurations, servicesApp as makeServiceApp,
	adminApp as makeAdminApp } from './services';
import * as http from "http";
import * as express from 'express';
import * as fs from 'fs';
import { existsFolderSync } from './lib-common/async-fs-node';
import { FileException, Code as excCode } from './lib-common/exceptions/file';
import { startService } from './lib-server/async-server';

(async () => {
	try {
		
		// Make data folders
		let dataFolder = __dirname+'/../../data';
		function ensureFolderPresence(path: string, doLog?: boolean): void {
			if (existsFolderSync(path)) {
				if (doLog) { console.log('Using existing data folder '+path); }
			} else {
				fs.mkdirSync(path);
				if (doLog) { console.log('Created '+fs.realpathSync(path)); }
			}
		}
		ensureFolderPresence(dataFolder, true);
		dataFolder = fs.realpathSync(dataFolder);
		let rootFolder = dataFolder+'/users';
		ensureFolderPresence(rootFolder, true);
		
		let conf: Configurations = {
			enabledServices: {
				asmail: true,
				storage: true,
				mailerId: true
			},
			rootFolder: rootFolder,
			// domain: 'staging.3nsoft.net',
			domain: '3nweb.net',
			mailerId: {
				certs: dataFolder+'/mid-certs.json'
			},
			signup: {
// XXX check domains on app start
				// domains: [ 'staging.3nsoft.net' ]
				domains: [ '3nweb.com', '3nweb.ch', '3nweb.is', '3nweb.de',
								'3nweb.ru', '3nweb.by', '3nweb.com.ua' ]
			}
		}
		
		let app = express();
		app.use(makeServiceApp(conf));
		app.use(makeAdminApp(conf));
		
		await startService(http.createServer(app), 8080)
		console.log('\nStaged services are up on localhost:8080');
	} catch (err) {
		console.error(err);
		process.exit(-500);
	}
})();