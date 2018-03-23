/*
 Copyright (C) 2015 - 2017 3NSoft Inc.
 
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
 * express 3NStorage owners' application.
 */

import * as express from 'express';

// Internal libs
import { json as parseJSON, emptyBody }
	from '../lib-server/middleware/body-parsers';
import { UserSockets, AppWithWSs } from '../lib-server/web-sockets/app';
import { ServerEvents } from '../lib-server/web-sockets/server-events';

// Resource/Data modules
import { SessionsFactory } from './resources/sessions';
import { Factory as usersFactory } from './resources/users';

// routes
import { MidAuthorizer, midLogin }
	from '../lib-server/routes/sessions/mid-auth';
import { startSession } from '../lib-server/routes/sessions/start';
import { closeSession } from '../lib-server/routes/sessions/close';
import { sessionParams } from './routes/owner/session-params';
import { getParam } from './routes/owner/param-getter';
import { setParam } from './routes/owner/param-setter';
import { cancelTransaction } from './routes/owner/cancel-trans';
import { saveCurrentObj } from './routes/owner/put-current-obj';
import { getCurrentObj } from './routes/owner/get-current-obj';
import { getArchivedObjVersion } from './routes/owner/get-archived-obj-ver';
import { deleteObj } from './routes/owner/delete-obj';
import { archiveCurrentObjVersion } from './routes/owner/archive-obj-version';
import { listObjArchive } from './routes/owner/list-obj-archive';

import * as api from '../lib-common/service-api/3nstorage/owner';

export function makeApp(domain: string, sessions: SessionsFactory,
		users: usersFactory, midAuthorizer: MidAuthorizer): AppWithWSs {
	
	const app = new AppWithWSs();
	
	setHttpPart(app, domain, sessions, users, midAuthorizer);
	setWSPart(app, sessions, users);

	return app;
}

function setWSPart(app: AppWithWSs, sessions: SessionsFactory,
		users: usersFactory): void {
	const sockets = new UserSockets(
		sessions.ensureAuthorizedSessionForSocketStart());
	
	const storageEvents = new ServerEvents(undefined,
		[ api.objChanged.EVENT_NAME,
			api.objRemoved.EVENT_NAME ],
		sockets.socketGetter);
	
	// give events ipc to both ends
	sockets.addSocketIPC(storageEvents);
	users.setStorageEventsSink(storageEvents.eventsSink);

	app.addWS(api.wsEventChannel.URL_END, sockets);
}

const MAX_CHUNK_SIZE = '0.5mb';

function setHttpPart(app: AppWithWSs, domain: string,
		sessions: SessionsFactory, users: usersFactory,
		midAuthorizer: MidAuthorizer): void {
	
	app.http.disable('etag');
	
	// Login
	app.http.post('/'+api.midLogin.START_URL_END,
			sessions.checkSession(),
			parseJSON('1kb'),
			startSession(users.exists, sessions.generate));
	app.http.post('/'+api.midLogin.AUTH_URL_END,
			sessions.ensureOpenedSession(),
			parseJSON('4kb'),
			midLogin(domain, midAuthorizer));
	
	// *** Require authorized session for everything below ***
	app.http.use(sessions.ensureAuthorizedSession());

	app.http.post('/'+api.closeSession.URL_END,
			emptyBody(),
			closeSession());
	
	// Session params
	app.http.get('/'+api.sessionParams.URL_END,
			sessionParams(MAX_CHUNK_SIZE));
	
	// Key derivation params
	app.http.route('/'+api.keyDerivParams.URL_END)
	.get(getParam(users.getKeyDerivParams))
	.put(parseJSON('1kb'),
		setParam(users.setKeyDerivParams));
	
	// Transaction canceling
	app.http.post('/'+api.cancelTransaction.EXPRESS_URL_END,
			emptyBody(),
			cancelTransaction(false, users.cancelTransaction));
	app.http.post('/'+api.cancelRootTransaction.EXPRESS_URL_END,
			emptyBody(),
			cancelTransaction(true, users.cancelTransaction));
	
	// Getting current root object
	app.http.route('/'+api.currentRootObj.EXPRESS_URL_END)
	.get(getCurrentObj(true, users.getCurrentRootObj))
	.put(saveCurrentObj(true, users.saveNewRootVersion, MAX_CHUNK_SIZE));
	
	// Getting current non-root objects
	app.http.route('/'+api.currentObj.EXPRESS_URL_END)
	.get(getCurrentObj(false, users.getCurrentObj))
	.delete(deleteObj(false, true, users.deleteObj))
	.put(saveCurrentObj(false, users.saveNewObjVersion, MAX_CHUNK_SIZE));

	// Archive root's current version
	app.http.route('/'+api.archiveRoot.URL_END)
	.get(listObjArchive(true, users.listObjArchive))
	.put(emptyBody(),
		archiveCurrentObjVersion(true, users.archiveObjVersion));

	// Archive non-root object's current version
	app.http.route('/'+api.archiveObj.EXPRESS_URL_END)
	.get(listObjArchive(false, users.listObjArchive))
	.put(emptyBody(),
		archiveCurrentObjVersion(false, users.archiveObjVersion));

	// Archived root versions
	app.http.route('/'+api.archivedRootVersion.EXPRESS_URL_END)
	.get(getArchivedObjVersion(true, users.getArchivedRootVersion))
	.delete(deleteObj(true, false, users.deleteObj));

	// Removing archived and current versions of non-root object 
	app.http.route('/'+api.archivedObjVersion.EXPRESS_URL_END)
	.get(getArchivedObjVersion(true, users.getArchivedObjVersion))
	.delete(deleteObj(false, false, users.deleteObj));
	
}

Object.freeze(exports);