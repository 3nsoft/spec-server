/*
 Copyright (C) 2024 3NSoft Inc.
 
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

import { Express } from 'express';
import { json as parseJSON } from '../lib-server/middleware/body-parsers';
import { ErrLogger, makeErrHandler } from '../lib-server/middleware/error-handler';
import { AppWithWSs } from '../lib-server/web-sockets/app';
import { makeSessionFactory } from './resources/sessions';
import { makeStorageAppForLocker } from '../3nstorage/3nstorage-app';
import { createLocker } from './routes/create-locker';
import * as api from '../lib-common/service-api/locker';


function addLockerSetupRoutes(app: Express): void {

	app.put('/'+api.createLocker.URL_END,
		parseJSON('1kb'),
		// createLocker()
	);

}

export function makeLockerApp(
	rootFolder: string, errLogger?: ErrLogger
): AppWithWSs {
	const ownersSessions = makeSessionFactory(20*60);
	const sharingSessions = makeSessionFactory(20*60);

	const app = new AppWithWSs();

	app.http.disable('etag');

	addLockerSetupRoutes(app.http);

	const lockers = undefined as any;

	app.use('/3nstorage', makeStorageAppForLocker(
		lockers, ownersSessions, sharingSessions, errLogger
	));

	app.http.use(makeErrHandler(errLogger));

	return app;
}

Object.freeze(exports);