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
 * This creates a public key login 'complete-login-exchange' route handler
 * for POST method.
 */

import { RequestHandler, Response, NextFunction } from 'express';
import { compareVectors, arrays } from 'ecma-nacl';
import { Request } from './start-exchange';
import { complete as api, ERR_SC, ErrorReply }
	from '../../../lib-common/service-api/pub-key-login';

export function completePKLogin(): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		
		const session = req.session;
		
		// bounce off already authorized session
		if (session.isAuthorized) {
			res.status(ERR_SC.duplicate).json( <ErrorReply> {
				error: "Repeated call: this session has already been authorized."
			});
			return;
		}

		try {
			const c = new Uint8Array(req.body);
			const decryptedKey = session.params.encryptor.open(c);
			const key = session.params.sessionKey;
			if (!compareVectors(decryptedKey, key)) { throw new Error(); }
			session.isAuthorized = true;
			res.status(api.SC.ok).send(new Buffer(
				session.params.serverVerificationBytes));
		} catch (err) {
			session.close();
			res.status(api.SC.authFailed).json( <ErrorReply> {
				error: "Forbidden."
			});
		} finally {
			arrays.wipe(session.params.sessionKey);
			delete session.params.sessionKey;
			delete session.params.serverVerificationBytes;
		}
	};
}

Object.freeze(exports);