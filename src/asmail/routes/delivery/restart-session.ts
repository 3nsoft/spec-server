/*
 Copyright (C) 2017 3NSoft Inc.
 
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
import { SC as recipSC, IncompleteMsgDeliveryParams } from '../../resources/recipients';
import { sessionRestart as api, ERR_SC, ErrorReply } from '../../../lib-common/service-api/asmail/delivery';
import { Request, GenerateSession, GetSessionForMsg } from '../../resources/delivery-sessions';
import { Redirect } from './start-session';
import { checkAndTransformAddress } from '../../../lib-common/canonical-address';
import * as confUtil from '../../../lib-server/conf-util';

/**
 * This creates a session restart route handler.
 * @param sessionGenFunc is a promise returning function that generates new
 * session objects.
 * @param sessionForMsgFunc is a function that promises existing session for
 * a known message in delivery.
 * @param incompleteMsgFunc is a function that promises parameters of a message
 * that is still in delivery.
 * @param redirectFunc is an optional function that returns a promise,
 * resolvable to
 * (1) string with URI for ASMail service, which is serving given recipient,
 * (2) undefined, if it is this server should service given recipient. 
 */
export function restartSession(sessionGenFunc: GenerateSession,
		sessionForMsgFunc: GetSessionForMsg,
		incompleteMsgFunc: IncompleteMsgDeliveryParams,
		maxChunk: string|number,
		redirectFunc?: Redirect): RequestHandler {
	if (typeof sessionGenFunc !== 'function') { throw new TypeError(
		`Given argument 'sessionGenFunc' must be function, but is not.`); }
	if (typeof sessionForMsgFunc !== 'function') { throw new TypeError(
		`Given argument 'sessionForMsgFunc' must be function, but is not.`); }
	if (typeof incompleteMsgFunc !== 'function') { throw new TypeError(
		`Given argument 'incompleteMsgFunc' must be function, but is not.`); }
	if ((redirectFunc !== undefined) && (typeof redirectFunc !== 'function')) {
		throw new TypeError(`Given argument 'redirectFunc' must either be function, or be undefined, but it is neither.`); }
	const maxChunkSize = confUtil.stringToNumOfBytes(maxChunk);
		
	async function serveRequestHere(recipient: string, msgId: string,
			res: Response): Promise<void> {
		let session = await sessionForMsgFunc(recipient, msgId);
		if (!session) {
			const msgParams = await incompleteMsgFunc(recipient, msgId);
			session = await sessionGenFunc();
			session.isAuthorized = true;
			session.params.recipient = recipient;
			session.params.msgId = msgId;
			session.params.currentMsgLength = msgParams.currentMsgLength;
			session.params.maxMsgLength = msgParams.maxMsgLength;
		}
		res.status(api.SC.ok).json( <api.Reply> {
			maxMsgLength: session.params.maxMsgLength,
			sessionId: session.id,
			maxChunkSize
		});
	}
	
	return async function(req: Request, res: Response, next: NextFunction) {
		
		const rb: api.Request = req.body;
		const recipient = checkAndTransformAddress(rb.recipient);
		const msgId = rb.msgId;
		const session = req.session;
		
		// session is opened, and is even mentioned in a header
		if (session) {
			res.status(api.SC.ok).json( <api.Reply> {
				maxMsgLength: session.params.maxMsgLength,
				sessionId: session.id,
				maxChunkSize
			});
			return;
		}
		
		// missing recipient makes a bad request
		if (!recipient) {
			res.status(ERR_SC.malformed).json( <ErrorReply> {
				error: "Recipient is either missing in the request, or is malformed"
			});
			return;
		}
		
		// check message id
		if (typeof msgId !== 'string') {
			res.status(ERR_SC.malformed).json( <ErrorReply> {
				error: "Message id is either missing, or is malformed"
			});
			return;
		}

	 	try {
			if (redirectFunc) {
				const redirectTo = await redirectFunc(recipient);
				if (redirectTo) {
					res.status(api.SC.redirect).json(<api.RedirectReply> {
						redirect: redirectTo
					});
				} else {
					await serveRequestHere(recipient, msgId, res);
				}
			} else {
				await serveRequestHere(recipient, msgId, res);
			}
		} catch (err) {
			if (err === recipSC.USER_UNKNOWN) {
				res.status(api.SC.unknownRecipient).json( <ErrorReply> {
					error: `Recipient ${recipient} is unknown.`
				});
			} else if (err === recipSC.MSG_UNKNOWN) {
				res.status(api.SC.unknownMsg).json( <ErrorReply> {
					error: `Recipient ${recipient} is unknown.`
				});
			} else {
				next(err);
			}
		}

	};
}
Object.freeze(exports);