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
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

/**
 * This module is a test-grade function to calculate DH-shared keys for login.
 */

import { box } from 'ecma-nacl';
import * as random from '../../lib-common/random-node';

// XXX update the key from time-to-time, and this must be single instance

const skeyForPKLChallenge = random.bytesSync(32);

const pkeyForPKLChallenge = box.generate_pubkey(skeyForPKLChallenge);

export function calcNaClBoxSharedKey(userPubKey: Uint8Array): {
	dhsharedKey: Uint8Array; serverPubKey: Uint8Array;
} {
	const dhsharedKey = box.calc_dhshared_key(userPubKey, skeyForPKLChallenge);
	return {
		dhsharedKey: dhsharedKey,
		serverPubKey: pkeyForPKLChallenge
	};
}

Object.freeze(exports);