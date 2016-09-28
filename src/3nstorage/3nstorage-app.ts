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

/**
 * This module gives a function that creates a mountable, or app.use()-able,
 * express 3NStorage application.
 */

import * as express from 'express';

// Internal libs
import { makeSingleProcFactory } from 
	'../lib-server/resources/mem-backed-sessions-factory';
import { makeFactory as makeUsersFactory } from './resources/users';
import { allowCrossDomain } from '../lib-server/middleware/allow-cross-domain';
import { IMidAuthorizer } from '../lib-server/routes/sessions/mid-auth';
import { makeErrHandler } from '../lib-server/middleware/error-handler';

// 3NStorage inner parts
import * as owners from './owner';
import * as sharing from './shared';

const PATHS = {
		owner: '/owner/',
		shared: '/shared/'
};

function setupStaticEntryRoute(app: express.Express): void {
	
	app.route('/')
	.all(allowCrossDomain(
			[ "Content-Type" ],
			[ 'GET' ]))
	.get((req: express.Request, res: express.Response) => {
		let path = req.originalUrl;
		if (path[path.length-1] !== '/') {
			path = path+'/';
		}
		let json = {
			"owner": path+PATHS.owner.substring(1),
			"shared": path+PATHS.shared.substring(1)
		};
		// the following implicitly sets content type application/json
		res.status(200).json(json);
	});
	
}

export function makeApp(dataFolder: string, domain: string,
		midAuthorizer: IMidAuthorizer): express.Express {
	
	let app = express();
	let ownersSessions = makeSingleProcFactory(20*60);
	let sharingSessions = makeSingleProcFactory(20*60);
	let userSettingSessions = makeSingleProcFactory(20*60);
	let users = makeUsersFactory(dataFolder);
	
	setupStaticEntryRoute(app);
	
	app.use(PATHS.owner,
		owners.makeApp(domain, ownersSessions, users, midAuthorizer));
	
	app.use(PATHS.shared,
		sharing.makeApp(sharingSessions, users));
	
	app.use(makeErrHandler((err: any, req: any): void => {
		if (typeof err.status !== 'number') {
			console.error(`\n --- Error occured in storage, when handling ${req.method} request to ${req.originalUrl}`);
			console.error(err);
		}
	}));
	
	return app;
}

Object.freeze(exports);