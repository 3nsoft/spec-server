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
import { SC as recipSC, IAllowedMaxMsgSize } from '../../resources/recipients';
import { preFlight as api, ERR_SC, ErrorReply }
	from '../../../lib-common/service-api/asmail/delivery';
import { Request } from './start-session';
import { checkAndTransformAddress }
	from '../../../lib-common/canonical-address';

export interface IRedirect {
	(userId: string): Promise<string>;
}

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
export function preFlight(allowedMsgSizeFunc: IAllowedMaxMsgSize,
		redirectFunc?: IRedirect): RequestHandler {
	if ('function' !== typeof allowedMsgSizeFunc) { throw new TypeError(
			"Given argument 'allowedMsgSizeFunc' must be function, but is not."); }
	if (('undefined' !== typeof redirectFunc) &&
			('function' !== typeof redirectFunc)) { throw new TypeError(
			"Given argument 'redirectFunc' must either be function, " +
			"or be undefined, but it is neither."); }
	
	return async function(req: Request, res: Response, next: NextFunction) {
		
		let rb: api.Request = req.body;
		let recipient = checkAndTransformAddress(rb.recipient);
		let sender = (rb.sender ? rb.sender : undefined);
		let invitation = (rb.invitation ? rb.invitation : undefined);
		let session = req.session;
		
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
					error: "Sender is is malformed"
				});
				return;
			}
		}
		
		async function serveRequestHere(): Promise<void> {
			let msgSize = await allowedMsgSizeFunc(recipient!, sender, invitation);
			if (msgSize > 0) {
				res.status(api.SC.ok).json( <api.Reply> {
					maxMsgLength: msgSize
				});
			} else if (msgSize === 0) {
				res.status(api.SC.senderNotAllowed).json( <ErrorReply> {
					error: (sender ? sender : "Anonymous sender ")+
					" is not allowed to leave mail for "+recipient
				});
			} else if (msgSize === -1) {
				res.status(api.SC.inboxFull).json( <ErrorReply> {
					error: "Mail box for "+recipient+" is full."
				});
			} else {
				throw new Error("Unrecognized code "+msgSize+
						" for message size limits.");
			}
		}

	 	try {
			if (redirectFunc) {
				let redirectTo = await redirectFunc(recipient);
				if (redirectTo) {
					res.status(api.SC.redirect).json(<api.RedirectReply> {
						redirect: redirectTo
					});
				} else {
					await serveRequestHere();
				}
			} else {
				await serveRequestHere();
			}
		} catch (err) {
			if (err === recipSC.USER_UNKNOWN) {
				res.status(api.SC.unknownRecipient).json( <ErrorReply> {
					error: "Recipient "+recipient+" is unknown."
				});
			} else {
				next(err);
			}
		}
		
	};
}
Object.freeze(exports);