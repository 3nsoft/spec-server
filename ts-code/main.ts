/*
 Copyright (C) 2015 - 2016, 2019 3NSoft Inc.
 
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
 * This script starts server, according to settings, given in config file.
 */

import { Configurations, servicesApp, adminApp, AppWithWSs } from './lib';
import { readFileSync, writeFileSync } from 'fs';
import { unlink, readFile, FileException } from './lib-common/async-fs-node';
import { execSync } from 'child_process';
import { sleep } from './lib-common/processes';

const PID_FILE = '/var/3nweb/service.pid';

const confFile = process.argv[2];
if (!confFile) {
	console.error(`Configuration file is not given. It should be the first script argument.`);
	process.exit(-1);
}
const conf: Configurations = JSON.parse(readFileSync(confFile, 'utf8'));

const noop = () => {};

(async () => {

	if (!conf.servicesConnect) {
		console.error(`No connection settings found in ${confFile}.`);
		process.exit(-1);
		return;
	}

	try {
		const prevPidStr = await readFile(PID_FILE, { encoding: 'utf8' });
		const prevPid = Number.parseInt(prevPidStr);
		if (!Number.isNaN(prevPid)) {
			execSync(`kill -SIGTERM ${prevPid}`);
			while (!!execSync(`ps ${prevPid} | grep ${prevPid}`)) {
				await sleep(1000);
			}
			await unlink(PID_FILE).catch(noop);
		}
	} catch (err) {
		if (!(err as FileException).notFound) { throw err; }
	}
	
	let app: AppWithWSs|undefined = undefined;

	async function stopProcess() {
		if (!app) { return; }
		app.stop().then(err => console.log(err));
		app = undefined;
		unlink(PID_FILE).catch(noop);
	}

	try {

		app = new AppWithWSs();
		app.use(servicesApp(conf));
		app.use(adminApp(conf));

		const { hostname, port, sslOpts } = conf.servicesConnect;
		await app.start(sslOpts, port, hostname);
		console.log(`Started 3NWeb server at address "${hostname}", port ${port}, ${sslOpts? 'via TLS' : 'without TLS, and requiring TLS reverse proxy infront.'}`);

		writeFileSync(PID_FILE, `${process.pid}`);
		process.on('SIGINT', stopProcess);
		process.on('SIGTERM', stopProcess);

	} catch (err) {
		stopProcess();
		console.error(err);
		process.exit(-500);
	}
})();