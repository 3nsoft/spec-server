/*
 Copyright (C) 2016 3NSoft Inc.
 
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

import { Component } from './component';
import { resolve as resolveUrl } from 'url';
import { doJsonRequest, RequestOpts } from '../xhr-utils';
import * as signup from '../../../lib-common/admin-api/signup';
import { User } from '../pkl';
import * as random from '../../../lib-common/random-node';
import { box } from 'ecma-nacl';
import { use } from '../../../lib-common/jwkeys';
import { base64 } from '../../../lib-common/buffer-utils';
import { getProvPath } from '../mailerid';

export async function addUserIn(rootServerUrl: string, userId: string): Promise<User> {
	let reqOpts: RequestOpts = {
		url: resolveUrl(resolveUrl(
			rootServerUrl, 'signup/'), signup.addUser.URL_END),
		method: 'POST'
	};
	let user: User = {
		id: userId,
		loginDefaultSKey: random.bytes(box.KEY_LENGTH),
		loginLabeledSKey: {
			k: random.bytes(box.KEY_LENGTH),
			kid: random.stringOfB64Chars(12)
		},
		midUrl: (undefined as any),
		storageOwnerUrl: (undefined as any)
	};
	let req: signup.addUser.Request = {
		userId: user.id,
		storage: {
			params: {}
		},
		mailerId: {
			defaultPKey: {
				pkey: {
					alg: box.JWK_ALG_NAME,
					kid: '_',
					use: use.MID_PKLOGIN,
					k: base64.pack(box.generate_pubkey(user.loginDefaultSKey))
				},
				params: {}
			},
			otherPKeys: [ {
					alg: box.JWK_ALG_NAME,
					kid: user.loginLabeledSKey.kid,
					use: use.MID_PKLOGIN,
					k: base64.pack(box.generate_pubkey(user.loginLabeledSKey.k))
				} ]
		}
	};
	let rep = await doJsonRequest<string[]>(reqOpts, req);
	expect(rep.status).toBe(signup.addUser.SC.ok);
	return user;
}

export class MailerIdComponent extends Component {
	
	constructor(signupDomains: string[], public midServiceDomain: string) {
		super({
			rootFolder: (null as any),
			domain: midServiceDomain,
			signup: {
				domains: signupDomains
			},
			enabledServices: {
				mailerId: true
			},
			mailerId: {
				certs: (null as any)
			}
		});
		Object.seal(this);
	}
	
	addUser(userId: string): Promise<User> {
		return addUserIn(this.url, userId);
	}
	
	get midUrl(): string {
		return resolveUrl(this.url, 'mailerid/');
	}
	
	getProvUrl(): Promise<string> {
		return getProvPath(this.midUrl);
	}
	
}
Object.freeze(MailerIdComponent.prototype);
Object.freeze(MailerIdComponent);

Object.freeze(exports);