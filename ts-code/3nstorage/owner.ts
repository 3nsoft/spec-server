/*
 Copyright (C) 2015 - 2017, 2022, 2024 3NSoft Inc.
 
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

/**
 * This module gives a function that creates a mountable, or app.use()-able,
 * express 3NStorage owners' application.
 */

import { Express } from 'express';
import { json as parseJSON, emptyBody } from '../lib-server/middleware/body-parsers';
import { UserSockets, AppWithWSs } from '../lib-server/web-sockets/app';
import { ServerEvents } from '../lib-server/web-sockets/server-events';
import { SessionsFactory } from './resources/sessions';
import { Factory as UsersFactory } from './resources/users';
import { MidAuthorizer } from '../lib-server/routes/sessions/mid-auth';
import { closeSession } from '../lib-server/routes/sessions/close';
import { sessionParams } from './routes/owner/session-params';
import { getParam } from './routes/owner/param-getter';
import { setParam } from './routes/owner/param-setter';
import { cancelTransaction } from './routes/owner/cancel-trans';
import { saveCurrentObj } from './routes/owner/put-current-obj';
import { getCurrentObj } from './routes/owner/get-current-obj';
import { getArchivedObjVersion } from './routes/owner/get-archived-obj-ver';
import { deleteArchivedObjVer, deleteCurrentObjVer } from './routes/owner/delete-obj';
import { archiveCurrentObjVersion } from './routes/owner/archive-obj-version';
import { getObjStatus } from './routes/owner/get-obj-status';
import * as api from '../lib-common/service-api/3nstorage/owner';
import { addMailerIdLoginRoutes } from '../lib-server/mid-access';
import { addPKLLoginRoutes } from '../lib-server/pkl-access';
import { calcNaClBoxSharedKey } from '../lib-server/resources/server-key-for-pkl-challenge';

export function makeOwnerStorageApp(
	domain: string, sessions: SessionsFactory, users: UsersFactory,
	midAuthorizer: MidAuthorizer
): AppWithWSs {

	const app = new AppWithWSs();

	const setupLoginRoutes: SetupLoginRoutes = (
		app, urlPrefix
	) => addMailerIdLoginRoutes(
		app, domain, urlPrefix, sessions, users.exists, midAuthorizer
	);

	setHttpPart(app.http, setupLoginRoutes, sessions, users);
	setWSPart(app, sessions, users);

	return app;
}

export function makeOwnerStorageForLocker(
	sessions: SessionsFactory, users: UsersFactory
): AppWithWSs {

	const app = new AppWithWSs();

	// XXX WIP

	// const setupLoginRoutes: SetupLoginRoutes = (
	// 	app, urlPrefix
	// ) => addPKLLoginRoutes(
	// 	app, urlPrefix, getUserParamsAndKey, sessions, calcNaClBoxSharedKey
	// );

	// setHttpPart(app.http, setupLoginRoutes, sessions, users);
	setWSPart(app, sessions, users);

	return app;
}

function setWSPart(
	app: AppWithWSs, sessions: SessionsFactory, users: UsersFactory
): void {
	const sockets = new UserSockets(
		sessions.ensureAuthorizedSessionForSocketStart()
	);
	
	const storageEvents = new ServerEvents(
		undefined, api.events.all, sockets.socketGetter
	);
	
	// give events ipc to both ends
	sockets.addSocketIPC(storageEvents);
	users.setStorageEventsSink(storageEvents.eventsSink);

	app.addWS(api.wsEventChannel.URL_END, sockets);
}

const MAX_CHUNK_SIZE = '0.5mb';

type SetupLoginRoutes = (app: Express, urlPrefix: string) => void;

function setHttpPart(
	app: Express, setupLoginRoutes: SetupLoginRoutes,
	sessions: SessionsFactory, users: UsersFactory
): void {

	app.disable('etag');

	// Login
	setupLoginRoutes(app, '/'+api.midLogin.URL_PART);

	// *** Require authorized session for everything below ***
	app.use(sessions.ensureAuthorizedSession());

	app.post('/'+api.closeSession.URL_END,
		emptyBody(),
		closeSession()
	);

	// Session params
	app.get('/'+api.sessionParams.URL_END,
		sessionParams(MAX_CHUNK_SIZE)
	);

	// Key derivation params
	app.route('/'+api.keyDerivParams.URL_END)
	.get(getParam(users.getKeyDerivParams))
	.put(parseJSON('1kb'),
		setParam(users.setKeyDerivParams)
	);

	// Transaction canceling
	app.post('/'+api.cancelTransaction.EXPRESS_URL_END,
		emptyBody(),
		cancelTransaction(false, users.cancelTransaction)
	);
	app.post('/'+api.cancelRootTransaction.EXPRESS_URL_END,
		emptyBody(),
		cancelTransaction(true, users.cancelTransaction)
	);

	// Getting and updating current root object
	app.route('/'+api.currentRootObj.EXPRESS_URL_END)
	.get(getCurrentObj(true, users.getCurrentRootObj))
	.put(saveCurrentObj(true, users.saveNewRootVersion, MAX_CHUNK_SIZE));

	// Getting, updating and removing current non-root objects
	app.route('/'+api.currentObj.EXPRESS_URL_END)
	.get(getCurrentObj(false, users.getCurrentObj))
	.delete(deleteCurrentObjVer(users.deleteCurrentObjVersion))
	.put(saveCurrentObj(false, users.saveNewObjVersion, MAX_CHUNK_SIZE));

	// Getting root archived versions
	app.route('/'+api.archivedRootVersion.EXPRESS_URL_END)
	.get(getArchivedObjVersion(true, users.getArchivedRootVersion));

	// Getting non-root object archived versions
	app.route('/'+api.archivedObjVersion.EXPRESS_URL_END)
	.get(getArchivedObjVersion(false, users.getArchivedObjVersion));

	// Archive root's current version
	app.route('/'+api.archiveRoot.EXPRESS_URL_END)
	.post(emptyBody(),
		archiveCurrentObjVersion(true, users.archiveObjVersion)
	)
	.delete(deleteArchivedObjVer(true, users.deleteArchivedObjVersion));

	// Archive non-root object's current version
	app.route('/'+api.archiveObj.EXPRESS_URL_END)
	.post(emptyBody(),
		archiveCurrentObjVersion(false, users.archiveObjVersion)
	)
	.delete(deleteArchivedObjVer(false, users.deleteArchivedObjVersion));

	// Getting root object status
	app.get('/'+api.rootStatus.EXPRESS_URL_END,
		getObjStatus(true, users.getObjStatus)
	);

	// Getting object status
	app.get('/'+api.objStatus.EXPRESS_URL_END,
		getObjStatus(false, users.getObjStatus)
	);

}

Object.freeze(exports);