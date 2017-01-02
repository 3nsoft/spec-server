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
 * This creates a public key login 'start-login-exchange' route handler
 * for POST method.
 */

import { RequestHandler, Response, NextFunction } from 'express';
import { secret_box as sbox, arrays, nonce as nonceMod } from 'ecma-nacl';
import { base64 } from '../../../lib-common/buffer-utils';
import { bytes as randomBytes } from '../../../lib-common/random-node';
import { IGenerateSession, Request as SessReq, Session }
	from '../../resources/sessions';
import { SessionEncryptor, makeSessionEncryptor }
	from '../../../lib-common/session-encryptor';
import { start as api, ERR_SC, ErrorReply }
	from '../../../lib-common/service-api/pub-key-login';

const boxWN = sbox.formatWN;
const NONCE_LENGTH = sbox.NONCE_LENGTH;
const KEY_LENGTH = sbox.KEY_LENGTH;
const POLY_LENGTH = sbox.POLY_LENGTH;

export interface SessionParams {
	encryptor: SessionEncryptor;
	userId: string;
	sessionKey: Uint8Array;
	serverVerificationBytes: Uint8Array;
}

export type Request = SessReq<SessionParams>;

function addEncryptorToSession(session: Session<SessionParams>,
		sessionKey: Uint8Array, nonce: Uint8Array) {
	let encryptor = makeSessionEncryptor(sessionKey, nonce);
	session.params.encryptor = encryptor;
	session.addCleanUp(() => {
		encryptor.destroy();
		if (session.params.encryptor === encryptor) {
			session.params.encryptor = (undefined as any);
		}
	});
}

export interface UserPKeyAndKeyGenParams {
	pkey: Uint8Array;
	params?: any;
}

export interface ICheckAndTransformUserId {
	/**
	 * This function checks overall shape of a given user id, possibly
	 * transforming it to some canonical form, used by the service.
	 * @params initUserId is a an incoming string, that should be an id
	 * @return if incoming id is ok, same, or transformed id is returned,
	 * else, if incoming id is not ok, undefined is returned.
	 */
	(initUserId: string): string|undefined;
}

export interface IGetUserPKeyAndKeyGenParams {
	/**
	 * This returns a promise of user public key and related parameters.
	 * @param userId
	 * @param kid is a key id that should be used at login. Undefined value
	 * indicates that default key should be used.
	 */
	(userId: string, kid: string|undefined): Promise<UserPKeyAndKeyGenParams>;
}

export interface IComputeDHSharedKey {
	(userKey: Uint8Array): {
		dhsharedKey: Uint8Array;
		serverPubKey: Uint8Array;
	};
}

export function startPKLogin(
		checkIdFunc: ICheckAndTransformUserId,
		findUserParamsAndKeyFunc: IGetUserPKeyAndKeyGenParams,
		sessionGenFunc: IGenerateSession<SessionParams>,
		computeDHSharedKeyFunc: IComputeDHSharedKey): RequestHandler {
	if ('function' !== typeof checkIdFunc) { throw new TypeError(
			"Given argument 'checkIdFunc' must be function, but is not."); }
	if ('function' !== typeof findUserParamsAndKeyFunc) { throw new TypeError(
			"Given argument 'findUserParamsAndKeyFunc' must be function, but is not."); }
	if ('function' !== typeof sessionGenFunc) { throw new TypeError(
			"Given argument 'sessionGenFunc' must be function, but is not."); }
	if ('function' !== typeof computeDHSharedKeyFunc) { throw new TypeError(
			"Given argument 'computeDHSharedKeyFunc' must be function, but is not."); }

	return async function(req: Request, res: Response, next: NextFunction) {

		let userId = checkIdFunc((req.body as api.Request).userId);
		let kid = (req.body as api.Request).kid;
		let session = req.session;
		
		// missing userId makes a bad request
		if ('string' !== typeof userId) {
			res.status(ERR_SC.malformed).json( <ErrorReply> {
				error: "User id is missing in the request."
			});
			return;
		}

		if ((kid !== undefined) && (typeof kid !== 'string')) {
			res.status(ERR_SC.malformed).json( <ErrorReply> {
				error: "Key id is invalid in the request."
			});
			return;
		}
		
		// bounce off existing session
		if (session) {
			res.status(ERR_SC.duplicate).json( <ErrorReply> {
				error: `Repeated call: this session has already been authorized.`
			});
			return;
		}

		try {
			// find user info
			let userParamsAndKey = await findUserParamsAndKeyFunc(userId, kid);
			if (!userParamsAndKey) {
				res.status(api.SC.unknownUser).json( <ErrorReply> {
					error: `User ${userId} ${kid ? `and/or key ${kid} are` : 'is'} unknown.`
				});
				return;
			}
			
			// generate session, if it is not present
			if (!session) {
				session = await sessionGenFunc();
				session.params.userId = userId;
			}
			
			// get random bytes for session key and nonce
			let nonce = randomBytes(NONCE_LENGTH);
			let sessionKey = randomBytes(KEY_LENGTH);
			
			// compute DH-shared key for encrypting a challenge
			let compRes = computeDHSharedKeyFunc(userParamsAndKey.pkey)
			let dhsharedKey = compRes.dhsharedKey
			let serverPubKey = compRes.serverPubKey
			// make challenge with session key, removing and saving poly part
			// for sending it later as a server verification at the end
			let encryptedSessionKey = boxWN.pack(sessionKey, nonce, dhsharedKey)
			let serverVerificationBytes = encryptedSessionKey.subarray(
					NONCE_LENGTH, NONCE_LENGTH + POLY_LENGTH)
			let challengeWithSessionKey = new Uint8Array(NONCE_LENGTH + KEY_LENGTH);
			challengeWithSessionKey.set(
					encryptedSessionKey.subarray(0, NONCE_LENGTH));
			challengeWithSessionKey.set(
					encryptedSessionKey.subarray(NONCE_LENGTH + POLY_LENGTH),
					NONCE_LENGTH);
			
			// wipe the DH-shared key
			arrays.wipe(dhsharedKey);

			// add to session a corresponding encryptor for login completion, and,
			// may be for further use
			nonceMod.advanceEvenly(nonce);
			addEncryptorToSession(session, sessionKey, nonce);
			session.params.sessionKey = sessionKey;
			session.params.serverVerificationBytes = serverVerificationBytes;

			// send out reply
			res.status(api.SC.ok).json( <api.Reply> {
				sessionId: session.id,
				sessionKey: base64.pack(challengeWithSessionKey),
				serverPubKey: base64.pack(serverPubKey),
				keyDerivParams: userParamsAndKey.params
			});

		} catch (err) {
			next(err);
		}

	};
}

Object.freeze(exports);