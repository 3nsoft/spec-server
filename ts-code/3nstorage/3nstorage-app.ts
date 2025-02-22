/*
 Copyright (C) 2015 - 2016, 2020 3NSoft Inc.
 
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
import { makeFactory as makeUsersFactory, Factory as UsersFactory } from './resources/users';
import { makeSessionFactory, SessionsFactory } from './resources/sessions';
import { MidAuthorizer } from '../lib-server/routes/sessions/mid-auth';
import { ErrLogger, makeErrHandler } from '../lib-server/middleware/error-handler';
import { AppWithWSs } from '../lib-server/web-sockets/app';
import { makeOwnerStorageApp, makeOwnerStorageForLocker } from './owner';
import { makeSharedStorageApp } from './shared';

const PATHS = {
	owner: '/owner/',
	shared: '/shared/'
};

function setupStaticStorageEntryRoute(app: Express): void {

	app.route('/')
	.get((req, res) => {
		let path = req.originalUrl;
		if (path[path.length-1] !== '/') {
			path = path+'/';
		}
		const json = {
			"owner": path+PATHS.owner.substring(1),
			"shared": path+PATHS.shared.substring(1)
		};
		// the following implicitly sets content type application/json
		res.status(200).json(json);
	});

}

export function makeStorageApp(
	dataFolder: string, domain: string, midAuthorizer: MidAuthorizer,
	errLogger?: ErrLogger
): AppWithWSs {

	const app = new AppWithWSs();
	const ownersSessions = makeSessionFactory(20*60);
	const sharingSessions = makeSessionFactory(20*60);
	const users = makeUsersFactory(dataFolder);

	setupStaticStorageEntryRoute(app.http);

	app.use(PATHS.owner,
		makeOwnerStorageApp(domain, ownersSessions, users, midAuthorizer)
	);

	app.http.use(PATHS.shared,
		makeSharedStorageApp(sharingSessions, users)
	);

	app.http.use(makeErrHandler(errLogger));

	return app;
}

export function makeStorageAppForLocker(
	users: UsersFactory,
	ownersSessions: SessionsFactory, sharingSessions: SessionsFactory,
	errLogger?: ErrLogger
): AppWithWSs {

	const app = new AppWithWSs();

	setupStaticStorageEntryRoute(app.http);

	app.use(PATHS.owner,
		makeOwnerStorageForLocker(ownersSessions, users)
	);

	app.http.use(PATHS.shared,
		makeSharedStorageApp(sharingSessions, users)
	);

	app.http.use(makeErrHandler(errLogger));

	return app;
}

Object.freeze(exports);