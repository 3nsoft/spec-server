/*
 Copyright (C) 2015 - 2017, 2025 3NSoft Inc.
 
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

import { RequestHandler, Response } from 'express';
import { SC as recipSC, MsgDelivery } from '../../resources/recipients';
import { preFlight as api, ERR_SC, ErrorReply } from '../../../lib-common/service-api/asmail/delivery';
import { Request } from '../../resources/delivery-sessions';
import { Redirect } from './start-session';
import { checkAndTransformAddress } from '../../../lib-common/canonical-address';

/**
 * This creates a pre-flight route handler.
 * @param allowedMsgSizeFunc is a function returning promises, that may resolve to
 * (1) undefined, if recipient is unknown,
 * (2) zero (0), if leaving mail is forbidden,
 * (3) greater than zero maximum message length, and
 * (4) -1, if mail cannot be accepted due to full mail box.
 * @param redirectFunc is an optional function that returns a promise,
 * resolvable to
 * (1) string with URI for ASMail service, which is serving given recipient,
 * (2) undefined, if it is this server should service given recipient. 
 */
export function preFlight(
	allowedMsgSizeFunc: MsgDelivery['allowedMaxMsgSize'], redirectFunc?: Redirect
): RequestHandler {
		
	async function serveRequestHere(
		recipient: string, sender: string|undefined,
		invitation: string|undefined, res: Response
	): Promise<void> {
		const msgSize = await allowedMsgSizeFunc(recipient, sender, invitation);
		if (msgSize > 0) {
			res.status(api.SC.ok).json( <api.Reply> {
				maxMsgLength: msgSize
			});
		} else if (msgSize === 0) {
			res.status(api.SC.senderNotAllowed).json( <ErrorReply> {
				error: `${sender ? sender : "Anonymous sender "} is not allowed to leave mail for ${recipient}`
			});
		} else if (msgSize === -1) {
			res.status(api.SC.inboxFull).json( <ErrorReply> {
				error: `Mail box for ${recipient} is full.`
			});
		} else {
			throw new Error(`Unrecognized code ${msgSize} for message size limits.`);
		}
	}

	return async (req: Request, res, next) => {

		const rb: api.Request = req.body;
		const recipient = checkAndTransformAddress(rb.recipient);
		let sender = rb.sender;
		const invitation = rb.invitation;
		const session = req.session;

		// already existing session indicates repeated call, which should be bounced off
		if (session) {
			res.status(ERR_SC.duplicateReq).json( <ErrorReply> {
				error: "This protocol request has already been served."
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

		// if sender is given, we canonicalize the address
		if (sender) {
			sender = checkAndTransformAddress(sender);
			if (!sender) {
				res.status(ERR_SC.malformed).json( <ErrorReply> {
					error: "Sender field is malformed"
				});
				return;
			}
		}

		// check invitation field
		if ((invitation !== undefined) && (typeof invitation !== 'string')) {
			res.status(ERR_SC.malformed).json( <ErrorReply> {
				error: "Inviation field is malformed"
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
					await serveRequestHere(recipient, sender, invitation, res);
				}
			} else {
				await serveRequestHere(recipient, sender, invitation, res);
			}
		} catch (err) {
			if (err === recipSC.USER_UNKNOWN) {
				res.status(api.SC.unknownRecipient).json( <ErrorReply> {
					error: `Recipient ${recipient} is unknown.`
				});
			} else {
				next(err);
			}
		}

	};
}

Object.freeze(exports);