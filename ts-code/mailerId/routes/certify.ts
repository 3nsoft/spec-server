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

import { RequestHandler, Response, NextFunction } from 'express';
import { utf8, toBuffer } from '../../lib-common/buffer-utils';
import { ICertify } from '../resources/certifier';
import { Request } from '../resources/sessions';
import { certify as api } from '../../lib-common/service-api/mailer-id/provisioning';

export function certify(certifyingFunc: ICertify): RequestHandler {
	if ('function' !== typeof certifyingFunc) { throw new TypeError(
			"Given argument 'certifyingFunc' must be function, but is not."); }
	
	return function (req: Request, res: Response, next: NextFunction) {
		const session = req.session;
		const c = new Uint8Array(req.body);
		const encryptor = session.params.encryptor;
		const email = session.params.userId;
		let bodyBytes: Uint8Array;
		
		// decrypt request body
		try {
			bodyBytes = encryptor.open(c);
		} catch (err) {
			session.close();
			res.status(api.SC.cryptoVerifFail).send(
				'Bytes fail cryptographic verification.');
			return;
		}
		
		let signedCerts: api.Reply;
		
		// extract parameters and certify
		try {
			const reqParams: api.Request =
				JSON.parse(utf8.open(bodyBytes));
			if (!reqParams.pkey) { throw new Error("Missing field"); }
			signedCerts = certifyingFunc(
				reqParams.pkey, email, reqParams.duration);
		} catch (err) {
			session.close();
			res.status(api.SC.malformed).send(
				'Missing or incorrectly formatted payload.');
			return;
		}
		
		res.status(api.SC.ok).send(
			toBuffer(encryptor.pack(utf8.pack(JSON.stringify(signedCerts)))));
		session.close();
		
	};
}

Object.freeze(exports);