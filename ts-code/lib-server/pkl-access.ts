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
import { json as parseJSON, binary as parseBinary } from './middleware/body-parsers';
import { Factory as SessionsFactory } from './resources/sessions';
import { ComputeDHSharedKey, GetUserPKeyAndKeyGenParams, SessionParams, startPKLogin } from './routes/pub-key-login/start-exchange';
import { completePKLogin } from './routes/pub-key-login/complete-exchange';
import * as api from '../lib-common/service-api/pub-key-login';


export function addPKLLoginRoutes(
	app: Express, urlPrefix: string,
	getUserParamsAndKey: GetUserPKeyAndKeyGenParams,
	sessions: SessionsFactory<SessionParams>,
	computeDHSharedKey: ComputeDHSharedKey
): void {

	app.post(urlPrefix + api.start.URL_END,
		sessions.checkSession(),
		parseJSON('1kb'),
		startPKLogin(
			getUserParamsAndKey, sessions.generate, computeDHSharedKey
		)
	);
	app.post(urlPrefix + api.complete.URL_END,
		sessions.ensureOpenedSession(),
		parseBinary('1kb'),
		completePKLogin()
	);

}
