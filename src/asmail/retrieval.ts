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
import { json as parseJSON, emptyBody }
	from '../lib-server/middleware/body-parsers';
import { checkAndTransformAddress } from '../lib-common/canonical-address';

// Resource/Data modules
import { Factory as sessionsFactory } from '../lib-server/resources/sessions';
import { Factory as recipFactory } from './resources/recipients';

// routes
import { IMidAuthorizer, midLogin }
	from '../lib-server/routes/sessions/mid-auth';
import { startSession } from '../lib-server/routes/sessions/start';
import { closeSession } from '../lib-server/routes/sessions/close';
import { listMsgIds } from './routes/retrieval/list-messages';
import { getMsgMeta } from './routes/retrieval/get-message-meta';
import { deleteMsg } from './routes/retrieval/remove-message';
import { getMsgObjBytes } from './routes/retrieval/get-message-bytes';

import * as api from '../lib-common/service-api/asmail/retrieval';

export function makeApp(domain: string, sessions: sessionsFactory,
		recipients: recipFactory, midAuthorizer: IMidAuthorizer):
		express.Express {
	
	let app = express();
	app.disable('etag');
	
	app.use(allowCrossDomain(
			[ "Content-Type", "X-Session-Id" ],
			[ 'GET', 'POST', 'DELETE' ]));
	
	app.post('/'+api.midLogin.START_URL_END,
			sessions.checkSession(),
			parseJSON('1kb'),
			startSession(checkAndTransformAddress,
				recipients.exists, sessions.generate));
	app.post('/'+api.midLogin.AUTH_URL_END,
			sessions.ensureOpenedSession(),
			parseJSON('4kb'),
			midLogin(domain, midAuthorizer));
	
	// *** Require authorized session for everything below ***
	app.use(sessions.ensureAuthorizedSession());
	
	app.post('/'+api.closeSession.URL_END,
			emptyBody(),
			closeSession());
	
	app.get('/'+api.listMsgs.URL_END,
			listMsgIds(recipients.getMsgIds));
	
	app.get('/'+api.msgMetadata.EXPRESS_URL_END,
			getMsgMeta(recipients.getMsgMeta));
	
	app.delete('/'+api.rmMsg.EXPRESS_URL_END,
			deleteMsg(recipients.deleteMsg));
	
	app.get('/'+api.msgObjHeader.EXPRESS_URL_END,
			getMsgObjBytes(recipients.getObjHeader));
	app.get('/'+api.msgObjSegs.EXPRESS_URL_END,
			getMsgObjBytes(recipients.getObjSegments));
	
	return app;
}
Object.freeze(exports);