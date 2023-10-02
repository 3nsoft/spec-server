/*
 Copyright (C) 2023 3NSoft Inc.
 
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

import { readFileSync } from "fs";
import { ServerOptions } from "https";
import { join } from "path";

export type CertsUpdateListener = (
	newOpts: ServerOptions, originalOpts: ServerOptions
) => Promise<void>;

export function sslOptsFromConfig(
	letsencrypt: string|undefined, sslOpts: ServerOptions|undefined,
	skipReloadOnCertsChange: boolean|undefined
): {
	sslOpts: ServerOptions;
	onCertsUpdate?: (listener: CertsUpdateListener) => (() => void);
}|undefined {
	if (!sslOpts) {
		sslOpts = {};
	}
	if (letsencrypt) {
		sslOpts.cert = readFileSync(join(letsencrypt, 'fullchain.pem'));
		sslOpts.key = readFileSync(join(letsencrypt, 'privkey.pem'));
		if (skipReloadOnCertsChange) {
			return { sslOpts };
		}
		const onCertsUpdate = makeCertsUpdatesWatch();
		return { sslOpts, onCertsUpdate };
	} else if (sslOpts.cert && sslOpts.key) {
		sslOpts.cert = readFileSync(sslOpts.cert as string);
		sslOpts.key = readFileSync(sslOpts.key as string);
		if (skipReloadOnCertsChange) {
			return { sslOpts };
		}
		const onCertsUpdate = makeCertsUpdatesWatch();
		return { sslOpts, onCertsUpdate };
	} else if ((!sslOpts.cert && sslOpts.key)
	|| (sslOpts.cert && !sslOpts.key)) {
		throw new Error(`servicesConnect.sslOpts section must have both key and cert fields pointing to respective files.`);
	} else {
		return;
	}
}

function makeCertsUpdatesWatch(
	// XXX pass locations, or some fs watching object
): (listener: CertsUpdateListener) => (() => void) {
	return listener => {

		// XXX start watching a signal

		const stopWatching = () => {};
		return stopWatching;
	}
}



Object.freeze(exports);