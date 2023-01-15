/*
 Copyright (C) 2015 - 2019 3NSoft Inc.
 
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

import { servicesApp, adminApp, AppWithWSs, getConfsFromEnv, getBindParamsFromEnv } from './lib';

(async () => {

	let app: AppWithWSs|undefined = undefined;

	async function stopProcess() {
		if (!app) { return; }
		app.stop().then(err => console.log(err));
		app = undefined;
	}

	try {
		
		const conf = getConfsFromEnv();

		app = new AppWithWSs();
		app.use(servicesApp(conf));
		app.use(adminApp(conf));

		const { address, port, sslOpts } = getBindParamsFromEnv();
		await app.start(sslOpts, port, address);
		console.log(`Started 3NWeb server at address ${address}, port ${port}, ${sslOpts? 'via TLS' : 'without TLS, and requiring TLS reverse proxy infront.'}`);

		process.on('SIGINT', stopProcess);
		process.on('SIGTERM', stopProcess);

	} catch (err) {
		stopProcess();
		console.error(err);
		process.exit(-500);
	}

})();