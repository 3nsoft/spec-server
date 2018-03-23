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
import { SC as storeSC } from '../../resources/users';
import { PARAM_SC, ERR_SC }
	from '../../../lib-common/service-api/3nstorage/owner';
import { Request } from '../../resources/sessions';

export function setParam<T>(
		paramSetter: (userId: string, param: T) => Promise<boolean>):
		RequestHandler {
	
	if ('function' !== typeof paramSetter) { throw new TypeError(
			"Given argument 'paramSetter' must be function, but is not."); }
	
	return async function(req: Request, res: Response, next: NextFunction) {
		
		const session = req.session;
		const userId = session.params.userId;
		const pValue: T = req.body;
		
		try{
			const valChanged = await paramSetter(userId, pValue)
			if (valChanged) {
				res.status(PARAM_SC.ok).end();
			} else {
				res.status(ERR_SC.malformed).send(
					'Malformed parameter value.');
			}
		} catch (err) {
			if (err === storeSC.USER_UNKNOWN) {
				res.status(ERR_SC.server).send(
					"Recipient disappeared from the system.");
				session.close();
			} else {
				next(err);
			}
			
		}
		
	};
	
};