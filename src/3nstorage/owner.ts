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
 * express 3NStorage owners' application.
 */

import * as express from 'express';

// Internal libs
import { json as parseJSON, emptyBody }
	from '../lib-server/middleware/body-parsers';
import { allowCrossDomain } from '../lib-server/middleware/allow-cross-domain';
import { checkAndTransformAddress } from '../lib-common/canonical-address';

// Resource/Data modules
import { Factory as sessionsFactory } from '../lib-server/resources/sessions';
import { Factory as usersFactory } from './resources/users';

// routes
import { IMidAuthorizer, midLogin }
	from '../lib-server/routes/sessions/mid-auth';
import { startSession } from '../lib-server/routes/sessions/start';
import { closeSession } from '../lib-server/routes/sessions/close';
import { sessionParams } from './routes/owner/session-params';
import { startTransaction } from './routes/owner/start-trans';
import { closeTransaction } from './routes/owner/close-trans';
import { getObjSegments } from './routes/owner/get-segs';
import { saveObjSegments } from './routes/owner/put-segs';
import { getObjHeader } from './routes/owner/get-header';
import { saveObjHeader } from './routes/owner/put-header';
import { deleteObj } from './routes/owner/delete-obj';
import { archiveCurrentObjVersion } from './routes/owner/archive-obj-version';
import { listObjArchive } from './routes/owner/list-obj-archive';

import * as api from '../lib-common/service-api/3nstorage/owner';

let MAX_CHUNK_SIZE = '0.5mb';

export function makeApp(domain: string, sessions: sessionsFactory,
		users: usersFactory, midAuthorizer: IMidAuthorizer): express.Express {
	
	let app = express();
	app.disable('etag');
	
	app.use(allowCrossDomain(
			[ "Content-Type", "X-Session-Id", "X-Version",
				"X-Obj-Segments-Length" ],
			[ 'GET', 'POST', 'PUT', 'DELETE' ]));
	
	// Login
	app.post('/'+api.midLogin.START_URL_END,
			sessions.checkSession(),
			parseJSON('1kb'),
			startSession(checkAndTransformAddress,
				users.exists, sessions.generate));
	app.post('/'+api.midLogin.AUTH_URL_END,
			sessions.ensureOpenedSession(),
			parseJSON('4kb'),
			midLogin(domain, midAuthorizer));
	
	// *** Require authorized session for everything below ***
	app.use(sessions.ensureAuthorizedSession());

	app.post('/'+api.closeSession.URL_END,
			emptyBody(),
			closeSession());
	
	// Session params
	app.get('/'+api.sessionParams.URL_END,
			sessionParams(users.getKeyDerivParams, MAX_CHUNK_SIZE));
	
	// Starting and ending transactions
	app.post('/'+api.startTransaction.EXPRESS_URL_END,
			parseJSON('1kb'),
			startTransaction(false, users.startTransaction));
	app.post('/'+api.startRootTransaction.URL_END,
			parseJSON('1kb'),
			startTransaction(true, users.startTransaction));
	app.post('/'+api.finalizeTransaction.EXPRESS_URL_END,
			emptyBody(),
			closeTransaction(false, true, users.finalizeTransaction));
	app.post('/'+api.cancelTransaction.EXPRESS_URL_END,
			emptyBody(),
			closeTransaction(false, false, users.cancelTransaction));
	app.post('/'+api.finalizeRootTransaction.EXPRESS_URL_END,
			emptyBody(),
			closeTransaction(true, true, users.finalizeTransaction));
	app.post('/'+api.cancelRootTransaction.EXPRESS_URL_END,
			emptyBody(),
			closeTransaction(true, false, users.cancelTransaction));
	
	// Getting and saving root object
	app.route('/'+api.rootHeader.EXPRESS_URL_END)
	.get(getObjHeader(true, users.getRootHeader))
	.put(saveObjHeader(true, users.getRootObjHeaderSizeInTransaction,
		users.saveRootHeader));
	app.route('/'+api.rootSegs.EXPRESS_URL_END)
	.get(getObjSegments(true, users.getRootSegments))
	.put(saveObjSegments(true, users.saveRootSegments, MAX_CHUNK_SIZE));
	
	// Getting and saving non-root objects
	app.route('/'+api.objHeader.EXPRESS_URL_END)
	.get(getObjHeader(false, users.getObjHeader))
	.put(saveObjHeader(false, users.getObjHeaderSizeInTransaction,
		users.saveObjHeader));
	app.route('/'+api.objSegs.EXPRESS_URL_END)
	.get(getObjSegments(false, users.getObjSegments))
	.put(saveObjSegments(false, users.saveObjSegments, MAX_CHUNK_SIZE));

	// Root object archive
	app.route('/'+api.rootArchive.URL_END)
	.get(listObjArchive(true, users.listObjArchive))
	.put(archiveCurrentObjVersion(true, users.archiveObjVersion));

	// Non-root object archive
	app.route('/'+api.rootArchive.URL_END)
	.get(listObjArchive(false, users.listObjArchive))
	.put(archiveCurrentObjVersion(false, users.archiveObjVersion));

	// Removing archived versions of root object 
	app.delete('/'+api.deleteArchivedRootVersion.EXPRESS_URL_END,
			deleteObj(true, false, users.deleteObj));

	// Removing archived and current versions of non-root object 
	app.delete('/'+api.deleteArchivedObjVersion.EXPRESS_URL_END,
			deleteObj(false, false, users.deleteObj));
	app.delete('/'+api.deleteObj.EXPRESS_URL_END,
			deleteObj(false, true, users.deleteObj));
	
	return app;
}

Object.freeze(exports);