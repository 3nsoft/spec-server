/*
 Copyright (C) 2015 - 2016, 2024 - 2025 3NSoft Inc.
 
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
import { json as parseJSON, emptyBody } from '../lib-server/middleware/body-parsers';
import { SessionsFactory } from './resources/sessions';
import { Factory as UsersFactory } from './resources/recipients';
import { MidAuthorizer } from '../lib-server/routes/sessions/mid-auth';
import { closeSession } from '../lib-server/routes/sessions/close';
import { getParam } from './routes/config/param-getter';
import { setParam } from './routes/config/param-setter';
import * as api from '../lib-common/service-api/asmail/config';
import { addMailerIdLoginRoutes } from '../lib-server/mid-access';

export function makeApp(
	domain: string, sessions: SessionsFactory, recipients: UsersFactory,midAuthorizer: MidAuthorizer
): express.Express {

	const app = express();
	app.disable('etag');

	// Login
	addMailerIdLoginRoutes(
		app, domain, '/'+api.midLogin.URL_PART,
		sessions, recipients.exists, midAuthorizer
	);

	// *** Require authorized session for everything below ***
	app.use(sessions.ensureAuthorizedSession());

	app.post('/'+api.closeSession.URL_END,
		emptyBody(),
		closeSession()
	);

	app.route('/'+api.p.initPubKey.URL_END)
	.get(getParam(recipients.getPubKey))
	.put(parseJSON('4kb', true),
		setParam(recipients.setPubKey)
	);

	app.route('/'+api.p.anonSenderPolicy.URL_END)
	.get(getParam(recipients.getAnonSenderPolicy))
	.put(parseJSON('40kb', true),
		setParam(recipients.setAnonSenderPolicy)
	);

	app.route('/'+api.p.anonSenderInvites.URL_END)
	.get(getParam(recipients.getAnonSenderInvites))
	.put(parseJSON('40kb', true),
		setParam(recipients.setAnonSenderInvites)
	);

	app.route('/'+api.p.authSenderPolicy.URL_END)
	.get(getParam(recipients.getAuthSenderPolicy))
	.put(parseJSON('4kb', true),
		setParam(recipients.setAuthSenderPolicy)
	);

	app.route('/'+api.p.authSenderInvites.URL_END)
	.get(getParam(recipients.getAuthSenderInvites))
	.put(parseJSON('40kb', true),
		setParam(recipients.setAuthSenderInvites)
	);

	app.route('/'+api.p.authSenderWhitelist.URL_END)
	.get(getParam(recipients.getAuthSenderWhitelist))
	.put(parseJSON('40kb', true),
		setParam(recipients.setAuthSenderWhitelist)
	);

	app.route('/'+api.p.authSenderBlacklist.URL_END)
	.get(getParam(recipients.getAuthSenderBlacklist))
	.put(parseJSON('40kb', true),
		setParam(recipients.setAuthSenderBlacklist)
	);

	return app;
}

Object.freeze(exports);