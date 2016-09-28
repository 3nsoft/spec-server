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
 * express MailerId application.
 */

import * as express from 'express';

// Internal libs
import { allowCrossDomain } from '../lib-server/middleware/allow-cross-domain';
import { json as parseJSON, binary as parseBinary }
	from '../lib-server/middleware/body-parsers';
import { checkAndTransformAddress } from '../lib-common/canonical-address';

// Modules for certificate provisioning part of MailerId protocol
import { IComputeDHSharedKey, startPKLogin }
	from '../lib-server/routes/pub-key-login/start-exchange';
import { completePKLogin }
	from '../lib-server/routes/pub-key-login/complete-exchange';
import { certify } from './routes/certify';

// resources
import { Certifier } from './resources/certifier';
import { Factory as sessFactory } from '../lib-server/resources/sessions';
import { makeSingleProcFactory }
	from '../lib-server/resources/mem-backed-sessions-factory';
import { makeFactory as makeUserFactory, Factory as userFactory }
	from './resources/users';
import { makeSingleProcCertifier } from './resources/certifier';
import { calcNaClBoxSharedKey } from './resources/compute-login-dhshared-key';
import { makeErrHandler } from '../lib-server/middleware/error-handler';

import * as api from '../lib-common/service-api/mailer-id/provisioning';

// Constant url parts of MailerId provisioning requests
let PROVISIONING_PATH = '/prov/';

function provisioningApp(sessions: sessFactory,
		users: userFactory, certifier: Certifier,
		computeDHSharedKey: IComputeDHSharedKey): express.Express {
	
	let app = express();
	app.disable('etag');
	
	// MailerId certificate provisioning routes
	app.post('/' + api.pkl.START_URL_END,
			sessions.checkSession(),
			parseJSON('1kb'),
			startPKLogin(checkAndTransformAddress,
				users.getUserParamsAndKey, sessions.generate, computeDHSharedKey));
	app.post('/' + api.pkl.COMPL_URL_END,
			sessions.ensureOpenedSession(),
			parseBinary('1kb'),
			completePKLogin());
	app.post('/' + api.certify.URL_END,
			sessions.ensureAuthorizedSession(),
			parseBinary('16kb'),
			certify(certifier.certify));
	
	return app;
}

export function makeApp(rootFolder: string, domain: string, certFile: string):
		express.Express {
	
	let app = express();
	let certProvisSessions = makeSingleProcFactory(2*60);
	let users = makeUserFactory(rootFolder);
	let certifier = makeSingleProcCertifier(domain, certFile);
	
	// Make certificate provisioning CORS-available
	app.use(PROVISIONING_PATH, allowCrossDomain(
			[ "Content-Type", "X-Session-Id" ],
			[ 'POST' ]));
	
	app.use(PROVISIONING_PATH,
			provisioningApp(certProvisSessions, users, certifier,
				calcNaClBoxSharedKey));
	
	// Make display of service parameters CORS-available
	app.use('/', allowCrossDomain(
			[ "Content-Type" ],
			[ 'GET' ]));

	// MailerId display of service parameters, as per protocol
	app.get('/', (req: express.Request, res: express.Response) => {
		let path = req.originalUrl;
		if (path[path.length-1] !== '/') {
			path = path+'/';
		}
		let json = {
				"current-cert": certifier.getRootCert(),
				"previous-certs": certifier.getPrevCerts(),
				"provisioning": path+PROVISIONING_PATH.substring(1)
		};
		res.status(200).json(json);	// content type application/json
	});
	
	app.use(makeErrHandler());
	
	return app;
}

Object.freeze(exports);