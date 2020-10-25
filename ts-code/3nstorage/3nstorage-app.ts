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

/**
 * This module gives a function that creates a mountable, or app.use()-able,
 * express 3NStorage application.
 */

import * as express from 'express';
import { makeFactory as makeUsersFactory } from './resources/users';
import { makeSessionFactory } from './resources/sessions';
import { MidAuthorizer } from '../lib-server/routes/sessions/mid-auth';
import { makeErrHandler } from '../lib-server/middleware/error-handler';
import { AppWithWSs } from '../lib-server/web-sockets/app';
import * as owners from './owner';
import * as sharing from './shared';

const PATHS = {
	owner: '/owner/',
	shared: '/shared/'
};

function setupStaticEntryRoute(app: express.Express): void {

	app.route('/')
	.get((req: express.Request, res: express.Response) => {
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

export function makeApp(
	dataFolder: string, domain: string, midAuthorizer: MidAuthorizer
): AppWithWSs {

	const app = new AppWithWSs();
	const ownersSessions = makeSessionFactory(20*60);
	const sharingSessions = makeSessionFactory(20*60);
	const users = makeUsersFactory(dataFolder);

	setupStaticEntryRoute(app.http);

	app.use(PATHS.owner,
		owners.makeApp(domain, ownersSessions, users, midAuthorizer));

	app.http.use(PATHS.shared,
		sharing.makeApp(sharingSessions, users));

	app.http.use(makeErrHandler((err: any, req: any): void => {
		if (typeof err.status !== 'number') {
			console.error(`\n --- Error occured in storage, when handling ${req.method} request to ${req.originalUrl}`);
			console.error(err);
		}
	}));

	return app;
}

Object.freeze(exports);