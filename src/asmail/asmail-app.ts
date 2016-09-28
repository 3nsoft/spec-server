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
 * express ASMail application.
 */

import * as express from 'express';

// Internal libs
import { allowCrossDomain } from '../lib-server/middleware/allow-cross-domain';

// Resource/Data modules
import { makeSingleProcFactory }
	from '../lib-server/resources/mem-backed-sessions-factory';
import { makeFactory as makeUsersFactory } from './resources/recipients';
import { IMidAuthorizer } from '../lib-server/routes/sessions/mid-auth';
import { makeErrHandler } from '../lib-server/middleware/error-handler';

// ASMail inner parts
import { makeApp as makeConfApp } from './config';
import { makeApp as makeDeliveryApp } from './delivery';
import { makeApp as makeRetrievalApp } from './retrieval';

let PATHS = {
	delivery: '/delivery/',
	retrieval: '/retrieval/',
	config: '/config/'
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
			"delivery": path+PATHS.delivery.substring(1),
			"retrieval": path+PATHS.retrieval.substring(1),
			"config": path+PATHS.config.substring(1)
		};
		// the following implicitly sets content type application/json
		res.status(200).json(json);
	});
	
}

export function makeApp(rootFolder: string, domain: string,
		midAuthorizer: IMidAuthorizer): express.Express {
	
	let app = express();
	let mailDeliverySessions = makeSingleProcFactory(5*60);
	let recipientsSessions = makeSingleProcFactory(10*60);
	let userSettingSessions = makeSingleProcFactory(10*60);
	let recipients = makeUsersFactory(rootFolder);
	
	setupStaticEntryRoute(app);
	
	app.use(PATHS.delivery, makeDeliveryApp(domain,
			mailDeliverySessions, recipients, midAuthorizer));
	
	app.use(PATHS.retrieval, makeRetrievalApp(domain,
			recipientsSessions, recipients, midAuthorizer));
	
	app.use(PATHS.config, makeConfApp(domain,
			recipientsSessions, recipients, midAuthorizer));
	
	app.use(makeErrHandler((err: any, req: any): void => {
		if (typeof err.status !== 'number') {
			console.error(`\n --- Error occured in asmail, when handling ${req.method} request to ${req.originalUrl}`);
			console.error(err);
		}
	}));
	
	return app;
}
Object.freeze(exports);