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
import { IStartTransaction, SC as storeSC } from '../../resources/users';
import { startTransaction as api, ErrorReply, ERR_SC }
	from '../../../lib-common/service-api/3nstorage/owner';
import { Request } from '../../../lib-server/routes/sessions/start';

/**
 * @param trans
 * @return an error message string, if an error has been found in given
 * transaction parameters.
 */
function lookForError(trans: api.Request): string {
	let sizes = trans.sizes;
	if (!sizes || (typeof sizes !== 'object') ||
			(typeof sizes.header !== 'number') || (sizes.header < 1) ||
			(typeof sizes.segments !== 'number') || (sizes.segments < -1)) {
		return 'Bad sizes object';
	}
	if (typeof trans.version !== 'number') {
		return 'Bad version parameter';
	}
	if ((typeof trans.isNewObj !== 'undefined') &&
			(typeof trans.isNewObj !== 'boolean')) {
		return 'Bad new object flag';
	}
	let diff = trans.diff;
	if (diff) {
		if (trans.isNewObj) { return 'New object cannot be defined via diff'; }
		if (sizes.segments < 0) { return 'Bad sizes object'; }
		if ((typeof diff.baseVersion !== 'number') ||
				(diff.baseVersion >= trans.version) ||
				!Array.isArray(diff.sections) || (diff.sections.length === 0)) {
			return 'Bad diff parameter';
		}
		let newVerSegsSize = 0;
		for (let s of diff.sections) {
			if (!Array.isArray(s) || (s.length !== 3) ||
					((s[0] !== 0) && (s[0] !== 1)) ||
					(typeof s[1] !== 'number') || (s[1] < 0) ||
					(typeof s[2] !== 'number') || (s[2] < 1)) {
				return 'Bad diff parameter';
			}
			newVerSegsSize += s[2];
		}
		if (diff.segsSize !== newVerSegsSize) {
			return 'Bad diff parameter';
		}
	}
}

export function startTransaction(root: boolean,
		startTransFunc: IStartTransaction): RequestHandler {
	if ('function' !== typeof startTransFunc) { throw new TypeError(
			"Given argument 'startTransFunc' must be function, but is not."); }

	return async function(req: Request, res: Response, next: NextFunction) {
		
		let userId = req.session.params.userId;
		let objId: string = (root ? null : req.params.objId);
		let trans = <api.Request> req.body;
		
		let errMsg = lookForError(trans);
		if (errMsg) {
			res.status(ERR_SC.malformed).json(<ErrorReply> { error: errMsg });
			return;
		}
		
		try {
			let transactionId = await startTransFunc(userId, objId, trans);
			res.status(api.SC.ok).json( <api.Reply> {
				transactionId: transactionId
			});
		} catch (err) {
			if ("string" !== typeof err) {
				next(err);
			} else if (err === storeSC.CONCURRENT_TRANSACTION) {
				res.status(api.SC.concurrentTransaction).json(<ErrorReply> {
					error: `Object ${objId} is currently under a transaction.` });
			} else if (err === storeSC.OBJ_UNKNOWN) {
				res.status(api.SC.unknownObj).json(<ErrorReply> {
					error: `Object ${objId} is unknown.` });
			} else if (err === storeSC.OBJ_EXIST) {
				res.status(api.SC.objAlreadyExists).json(<ErrorReply> {
					error: `Object ${objId} already exists.` });
			} else if (err === storeSC.WRONG_OBJ_STATE) {
				res.status(api.SC.incompatibleObjState).json(<ErrorReply> {
					error: `Object ${objId} is in a state, that does not allow to procede with this request.` });
			} else if (err === storeSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).json(<ErrorReply> {
					error: "Recipient disappeared from the system." });
				req.session.close();
			} else {
				next(new Error(`Unhandled storage error code: ${err}`));
			}
		}
		
	};
};

Object.freeze(exports);