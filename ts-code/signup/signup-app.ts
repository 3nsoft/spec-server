/*
 Copyright (C) 2015 - 2016, 2020 - 2021, 2024 3NSoft Inc.
 
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

import * as express from 'express';
import { json as parseJSON } from '../lib-server/middleware/body-parsers';
import { ErrLogger, makeErrHandler } from '../lib-server/middleware/error-handler';
import { makeFactory as makeUserFactory } from './resources/users';
import { addUser } from './routes/add';
import { availableAddresses } from './routes/get-available-addresses';
import { availableDomains } from './routes/get-available-domains';
import * as signupApi from '../lib-common/admin-api/signup';
import { Configurations } from '../services';


export function makeSignupApp(
	conf: Configurations, errLogger?: ErrLogger
): express.Express {
	const app = express();
	app.disable('etag');

	const noTokenFile = (conf.signup ? conf.signup.noTokenFile : undefined);
	const users = makeUserFactory(conf.rootFolder, noTokenFile);

	app.post('/'+signupApi.availableDomains.URL_END,
		parseJSON('1kb'),
		availableDomains(users.getAvailableDomains));
	app.post('/'+signupApi.availableAddressesForName.URL_END,
		parseJSON('1kb'),
		availableAddresses(users.getAvailableAddresses));
	app.post('/'+signupApi.addUser.URL_END,
		parseJSON('4kb'),
		addUser(users.add));

	app.use(makeErrHandler(errLogger));
	
	return app;
}


Object.freeze(exports);