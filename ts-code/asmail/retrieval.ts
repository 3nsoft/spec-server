/*
 Copyright (C) 2015 - 2016, 2025 3NSoft Inc.
 
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
import { emptyBody }	from '../lib-server/middleware/body-parsers';
import { UserSockets, AppWithWSs } from '../lib-server/web-sockets/app';
import { ServerEvents } from '../lib-server/web-sockets/server-events';
import { SessionsFactory } from './resources/sessions';
import { MsgRetrieval } from './resources/recipients';
import { MidAuthorizer } from '../lib-server/routes/sessions/mid-auth';
import { closeSession } from '../lib-server/routes/sessions/close';
import { listMsgIds } from './routes/retrieval/list-messages';
import { getMsgMeta } from './routes/retrieval/get-message-meta';
import { deleteMsg } from './routes/retrieval/remove-message';
import { getMsgObj } from './routes/retrieval/get-message-obj';
import * as api from '../lib-common/service-api/asmail/retrieval';
import { addMailerIdLoginRoutes } from '../lib-server/mid-access';

export function makeApp(
	domain: string, sessions: SessionsFactory, recipients: MsgRetrieval,
	midAuthorizer: MidAuthorizer
): AppWithWSs {
	
	const app = new AppWithWSs();
	
	setHttpPart(app.http, domain, sessions, recipients, midAuthorizer);
	setWSPart(app, sessions, recipients);

	return app;
}

function setWSPart(
	app: AppWithWSs, sessions: SessionsFactory, recipients: MsgRetrieval
): void {
	const sockets = new UserSockets(
		sessions.ensureAuthorizedSessionForSocketStart());
	
	const mailEvents = new ServerEvents(undefined,
		[ api.msgRecievedCompletely.EVENT_NAME,
			api.msgMainObjRecieved.EVENT_NAME ],
		sockets.socketGetter);
	
	// give events ipc to both ends
	sockets.addSocketIPC(mailEvents);
	recipients.setMailEventsSink(mailEvents.eventsSink);

	app.addWS(api.wsEventChannel.URL_END, sockets);
}

function setHttpPart(
	app: Express, domain: string, sessions: SessionsFactory,
	recipients: MsgRetrieval, midAuthorizer: MidAuthorizer
): void {
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
	
	app.get('/'+api.listMsgs.URL_END,
		listMsgIds(recipients.getMsgIds)
	);
	
	app.get('/'+api.msgMetadata.EXPRESS_URL_END,
		getMsgMeta(recipients.getMsgMeta)
	);
	
	app.delete('/'+api.rmMsg.EXPRESS_URL_END,
		deleteMsg(recipients.deleteMsg)
	);

	app.get('/'+api.msgObj.EXPRESS_URL_END,
		getMsgObj(recipients.getObj)
	);
}

Object.freeze(exports);