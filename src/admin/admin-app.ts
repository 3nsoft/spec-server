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
 * This module defines administration interface for 3NWeb Home Server.
 */

import * as express from 'express';

// Internal libs
import { json as parseJSON } from '../lib-server/middleware/body-parsers';
import { makeErrHandler } from '../lib-server/middleware/error-handler';

// Resource/Data modules
import { Factory as sessionsFactory } from '../lib-server/resources/sessions';
import { Factory as usersFactory, makeFactory as makeUserFactory }
	from './resources/users';

// routes
import { addUser } from './routes/add';
import { isUserIdAvailable } from './routes/is-available';
import { availableAddresses } from './routes/get-available-addresses';

import * as signupApi from '../lib-common/admin-api/signup';

function apiPart(users: usersFactory): express.Express {
	const app = express();
	app.disable('etag');
	
	app.post('/'+signupApi.isAvailable.URL_END,
		parseJSON('1kb'),
		isUserIdAvailable(users.isIdOK, users.isIdAvailable));
	app.post('/'+signupApi.availableAddressesForName.URL_END,
		parseJSON('1kb'),
		availableAddresses(users.isNameOK, users.getAvailableAddresses));
	app.post('/'+signupApi.addUser.URL_END,
		parseJSON('4kb'),
		addUser(users.isIdOK, users.add));
	
	return app;
}

export function makeApp(domains: string[], rootFolder: string): express.Express {
	const app = express();
	const users = makeUserFactory(domains, rootFolder);
	
	app.use('/signup', apiPart(users));
	// TODO add static, only when it will be created
	// app.use(express.static(__dirname + '/public-content'));
	app.use(makeErrHandler());
	
	return app;
}



Object.freeze(exports);