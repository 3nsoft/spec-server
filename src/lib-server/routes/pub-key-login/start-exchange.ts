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
 * This creates a public key login 'start-login-exchange' route handler
 * for POST method.
 */

import { RequestHandler, Response, NextFunction } from 'express';
import { secret_box as sbox, arrays, nonce as nonceMod } from 'ecma-nacl';
import { base64 } from '../../../lib-common/buffer-utils';
import { bytes as randomBytes } from '../../../lib-common/random-node';
import { GenerateSession, Request as SessReq, Session,
	SessionParams as UserParams } from '../../resources/sessions';
import { SessionEncryptor, makeSessionEncryptor }
	from '../../../lib-common/session-encryptor';
import { start as api, ERR_SC, ErrorReply }
	from '../../../lib-common/service-api/pub-key-login';
import { checkAndTransformAddress }
	from '../../../lib-common/canonical-address';

const boxWN = sbox.formatWN;
const NONCE_LENGTH = sbox.NONCE_LENGTH;
const KEY_LENGTH = sbox.KEY_LENGTH;
const POLY_LENGTH = sbox.POLY_LENGTH;

export interface SessionParams extends UserParams {
	encryptor: SessionEncryptor;
	sessionKey: Uint8Array;
	serverVerificationBytes: Uint8Array;
}

export type Request = SessReq<SessionParams>;

function addEncryptorToSession(session: Session<SessionParams>,
		sessionKey: Uint8Array, nonce: Uint8Array) {
	const encryptor = makeSessionEncryptor(sessionKey, nonce);
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

/**
 * This function checks overall shape of a given user id, possibly
 * transforming it to some canonical form, used by the service.
 * If incoming id is ok, function returns it in a canonical form.
 * Else, if incoming id is not ok, undefined is returned.
 * @params initUserId is a an incoming string, that should be an id
 */
export type CheckAndTransformUserId = (initUserId: string) => string|undefined;

/**
 * This returns a promise of user public key and related parameters.
 * If user is not found, undefined is returned.
 * @param userId
 * @param kid is a key id that should be used at login. Undefined value
 * indicates that default key should be used.
 */
export type GetUserPKeyAndKeyGenParams =
	(userId: string, kid: string|undefined) =>
		Promise<UserPKeyAndKeyGenParams|undefined>;

export type ComputeDHSharedKey = (userKey: Uint8Array) =>
	{ dhsharedKey: Uint8Array; serverPubKey: Uint8Array; };

export function startPKLogin(
		findUserParamsAndKeyFunc: GetUserPKeyAndKeyGenParams,
		sessionGenFunc: GenerateSession<SessionParams>,
		computeDHSharedKeyFunc: ComputeDHSharedKey): RequestHandler {
	if ('function' !== typeof findUserParamsAndKeyFunc) { throw new TypeError(
			"Given argument 'findUserParamsAndKeyFunc' must be function, but is not."); }
	if ('function' !== typeof sessionGenFunc) { throw new TypeError(
			"Given argument 'sessionGenFunc' must be function, but is not."); }
	if ('function' !== typeof computeDHSharedKeyFunc) { throw new TypeError(
			"Given argument 'computeDHSharedKeyFunc' must be function, but is not."); }

	return async function(req: Request, res: Response, next: NextFunction) {

		const userId = checkAndTransformAddress((req.body as api.Request).userId);
		const kid = (req.body as api.Request).kid;
		let session = req.session;
		
		// missing userId makes a bad request
		if (!userId) {
			res.status(ERR_SC.malformed).json( <ErrorReply> {
				error: "User id is either malformed, or missing."
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
			const userParamsAndKey = await findUserParamsAndKeyFunc(userId, kid);
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
			const nonce = randomBytes(NONCE_LENGTH);
			const sessionKey = randomBytes(KEY_LENGTH);
			
			// compute DH-shared key for encrypting a challenge
			const compRes = computeDHSharedKeyFunc(userParamsAndKey.pkey)
			const dhsharedKey = compRes.dhsharedKey
			const serverPubKey = compRes.serverPubKey
			// make challenge with session key, removing and saving poly part
			// for sending it later as a server verification at the end
			const encryptedSessionKey = boxWN.pack(sessionKey, nonce, dhsharedKey)
			const serverVerificationBytes = encryptedSessionKey.subarray(
					NONCE_LENGTH, NONCE_LENGTH + POLY_LENGTH)
			const challengeWithSessionKey = new Uint8Array(NONCE_LENGTH + KEY_LENGTH);
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