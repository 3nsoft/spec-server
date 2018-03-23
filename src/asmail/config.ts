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
 * express ASMail-Configuration application.
 */

import * as express from 'express';

// Internal libs
import { json as parseJSON, emptyBody }
	from '../lib-server/middleware/body-parsers';

// Resource/Data modules
import { SessionsFactory } from './resources/sessions';
import { Factory as usersFactory } from './resources/recipients';

// routes
import { MidAuthorizer, midLogin }
	from '../lib-server/routes/sessions/mid-auth';
import { startSession } from '../lib-server/routes/sessions/start';
import { closeSession } from '../lib-server/routes/sessions/close';
import { getParam } from './routes/config/param-getter';
import { setParam } from './routes/config/param-setter';

import * as api from '../lib-common/service-api/asmail/config';

export function makeApp(domain: string, sessions: SessionsFactory,
		recipients: usersFactory, midAuthorizer: MidAuthorizer):
		express.Express {
	
	const app = express();
	app.disable('etag');
	
	
	app.post('/'+api.midLogin.START_URL_END,
			sessions.checkSession(),
			parseJSON('1kb'),
			startSession(recipients.exists, sessions.generate));
	app.post('/'+api.midLogin.AUTH_URL_END,
			sessions.ensureOpenedSession(),
			parseJSON('4kb'),
			midLogin(domain, midAuthorizer));
	
	// *** Require authorized session for everything below ***
	app.use(sessions.ensureAuthorizedSession());
	
	app.post('/'+api.closeSession.URL_END,
			emptyBody(),
			closeSession());
	
	app.route('/'+api.p.initPubKey.URL_END)
	.get(getParam(recipients.getPubKey))
	.put(parseJSON('4kb', true),
		setParam(recipients.setPubKey));
	
	app.route('/'+api.p.anonSenderInvites.URL_END)
	.get(getParam(recipients.getAnonSenderInvites))
	.put(parseJSON('4kb', true),
		setParam(recipients.setAnonSenderInvites));
	
	return app;
}
Object.freeze(exports);