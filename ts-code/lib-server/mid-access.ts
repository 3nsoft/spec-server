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

import { json as parseJSON } from './middleware/body-parsers';
import { Factory as SessionsFactory, SessionParams } from './resources/sessions';
import { startSession } from './routes/sessions/start';
import { midLogin } from './routes/sessions/mid-auth';
import { MidAuthorizer } from "./routes/sessions/mid-auth";
import * as api from '../lib-common/service-api/mailer-id/login';
import { Express } from 'express';

export type AccountExists = (id: string) => Promise<boolean>;

export function addMailerIdLoginRoutes(
	app: Express, domain: string, urlPrefix: string,
	sessions: SessionsFactory<SessionParams>,
	accountExists: AccountExists, midAuthorizer: MidAuthorizer
): void {

	app.post(urlPrefix+api.startSession.URL_END,
		sessions.checkSession(),
		parseJSON('1kb'),
		startSession(accountExists, sessions.generate)
	);
	app.post(urlPrefix+api.authSession.URL_END,
		sessions.ensureOpenedSession(),
		parseJSON('4kb'),
		midLogin(domain, midAuthorizer)
	);

}
