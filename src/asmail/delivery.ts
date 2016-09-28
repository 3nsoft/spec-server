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

// Resource/Data modules
import { Factory as sessionsFactory } from '../lib-server/resources/sessions';
import { Factory as recipFactory } from './resources/recipients';

// Modules for ASMail delivery protocol
import { startSession } from './routes/delivery/start-session';
import { preFlight } from './routes/delivery/pre-flight';
import { IMidAuthorizer, authorize }
	from './routes/delivery/sender-authorization';
import { getRecipientPubKey }
	from './routes/delivery/provide-recipient-pubkey';
import { saveMetadata } from './routes/delivery/put-metadata';
import { saveMsgObjBytes } from './routes/delivery/put-bytes';
import { finalizeDelivery } from './routes/delivery/finalize-delivery';

import * as api from '../lib-common/service-api/asmail/delivery';

const MAX_CHUNK_SIZE = '0.5mb';

export function makeApp(domain: string,
		sessions: sessionsFactory, recipients: recipFactory,
		midAuthorizer: IMidAuthorizer): express.Express {
	
	let app = express();
	app.disable('etag');
	
	app.use(allowCrossDomain(
			[ "Content-Type", "X-Session-Id" ],
			[ 'GET', 'POST', 'PUT' ]));
	
	app.post('/'+api.sessionStart.URL_END,
			sessions.checkSession(),
			parseJSON('1kb'),
			startSession(recipients.allowedMaxMsgSize, sessions.generate));
	
	app.post('/'+api.preFlight.URL_END,
			sessions.checkSession(),
			parseJSON('1kb'),
			preFlight(recipients.allowedMaxMsgSize));
	
	//
	// TODO add /restart-session/msg/:msgId for completion of aborted sending,
	//		due to long term (5 minutes and  more) loss of communication (e.g. 3G)
	//
	
	app.post('/'+api.authSender.URL_END,
			sessions.ensureOpenedSession(),
			parseJSON('4kb'),
			authorize(domain, midAuthorizer));
	
	// *** Require authorized session for everything below ***
	app.use(sessions.ensureAuthorizedSession());
	
	app.get('/'+api.initPubKey.URL_END,
			getRecipientPubKey(recipients.getPubKey));
	
	app.put('/'+api.msgMeta.URL_END,
			parseJSON('16kb'),
			saveMetadata(recipients.setMsgStorage, MAX_CHUNK_SIZE));
	
	app.put('/'+api.msgObjHeader.EXPRESS_URL_END,
			saveMsgObjBytes(recipients.saveObjHeader, MAX_CHUNK_SIZE));
	app.put('/'+api.msgObjSegs.EXPRESS_URL_END,
			saveMsgObjBytes(recipients.saveObjSegments, MAX_CHUNK_SIZE));
	
	app.post('/'+api.completion.URL_END,
			emptyBody(),
			finalizeDelivery(recipients.finalizeDelivery));
	
	return app;
}
Object.freeze(exports);