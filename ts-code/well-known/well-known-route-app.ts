/*
 Copyright (C) 2026 3NSoft Inc.
 
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

import * as express from 'express';
import { Configurations } from '../services';

export function makeWellKnownApp(w3n: NonNullable<Configurations['wellKnown3NWeb']>): express.Application {

	const app = express();

	const w3nJson = confTo3NWebJSON(w3n);

	app.get('3nweb.json', (req, res) => {
		// the following implicitly sets content type application/json
		res.status(200).json(w3nJson);
	});

	return app;
}

interface WellKnown3NWeb {
  mailerid?: string;
  asmail?: string;
  '3nstorage'?: string;
  report?: string;
  'w3n-app'?: string;
}

function confTo3NWebJSON(conf: NonNullable<Configurations['wellKnown3NWeb']>): WellKnown3NWeb {
	const json: WellKnown3NWeb = {};
	const fields: (keyof WellKnown3NWeb)[] = [ '3nstorage', 'asmail', 'mailerid' ];
	for (const field in fields) {
		const href = conf[field];
		if (href) {
			let u: URL;
			try {
				u = new URL(href);
			} catch (err) {
				console.error(` ❌  Configuration field ${field} for well-known needs potocol section`);
				throw err;
			}
			if ((u.protocol !== 'https:') && (u.protocol !== 'http:')) {
				throw new Error(` ❌  Configuration field ${field} for well-known needs potocol section`);
			}
			json[field] = href;
		}
	}
	return json;
}


Object.freeze(exports);