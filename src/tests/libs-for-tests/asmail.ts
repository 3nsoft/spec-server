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

import { User, doMailerIdLogin, provisionMidSigner } from './mailerid';
import { doJsonRequest, RequestOpts, doBodylessRequest, doBinaryRequest }
	from '../libs-for-tests/xhr-utils';
import { resolve as resolveUrl } from 'url';
import { midLogin, PARAM_SC, p }
	from '../../lib-common/service-api/asmail/config';
import * as random from '../../lib-common/random-node';
import { base64 } from '../../lib-common/buffer-utils';
import { JsonKey } from '../../lib-common/jwkeys';
import { box } from 'ecma-nacl';
import * as deliveryApi from '../../lib-common/service-api/asmail/delivery';
import { BaseObj as Obj } from './3nstorage';

export { BaseObj as Obj } from './3nstorage';

export async function getASMailServiceUrl(asmailUrl: string,
		service: 'delivery'|'retrieval'|'config'): Promise<string> {
	let reqOpts: RequestOpts= {
		url: asmailUrl,
		method: 'GET',
		responseType: 'json'
	};
	let rep = await doBodylessRequest<any>(reqOpts);
	expect(rep.status).toBe(200);
	let serviceUrl: string = rep.data[service];
	expect(typeof serviceUrl).toBe('string');
	return resolveUrl(asmailUrl, serviceUrl);
}

export async function setInboxParams(asmailUrl: string, user: User,
		params: { [pUrl: string]: any; }): Promise<void> {
	let confUrl = await getASMailServiceUrl(asmailUrl, 'config');
	let sessionId = await doMailerIdLogin(resolveUrl(
		confUrl, midLogin.MID_URL_PART), user);
	for (let pUrl of Object.keys(params)) {
		let reqOpts: RequestOpts= {
			url: resolveUrl(confUrl, pUrl),
			method: 'PUT',
			sessionId
		};
		let rep = await doJsonRequest<void>(reqOpts, params[pUrl]);
		expect(rep.status).toBe(PARAM_SC.ok);
	}
}

export const PUBLIC_KEY_USE = 'asmail-pub-key';

export async function generateInitPubKey(midUrl: string, user: User):
		Promise<p.initPubKey.Certs> {
	let midSigner = await provisionMidSigner(midUrl, user);
	let skeyBytes = random.bytes(box.KEY_LENGTH);
	let pkeyBytes = box.generate_pubkey(skeyBytes);
	let pkey: JsonKey = {
		use: PUBLIC_KEY_USE,
		alg: box.JWK_ALG_NAME,
		kid: random.stringOfB64Chars(10),
		k: base64.pack(pkeyBytes)
	};
	let pkeyCert = midSigner.certifyPublicKey(pkey, 30*24*60*60);
	let certs: p.initPubKey.Certs = {
		pkeyCert,
		provCert: midSigner.providerCert,
		userCert: midSigner.userCert
	};
	return certs;
}

export async function startMsgDeliverySession(deliveryUrl: string,
		req: deliveryApi.sessionStart.Request):
		Promise<deliveryApi.sessionStart.Reply> {
	let reqOpts: RequestOpts = {
		url: resolveUrl(deliveryUrl, deliveryApi.sessionStart.URL_END),
		method: 'POST',
		responseType: 'json'
	};
	let rep = await doJsonRequest<deliveryApi.sessionStart.Reply>(reqOpts, req);
	expect(rep.status).toBe(deliveryApi.sessionStart.SC.ok);
	return rep.data;
}

export interface DeliveryInfo extends
	deliveryApi.msgMeta.Reply, deliveryApi.sessionStart.Reply {}

export async function startMsgDelivery(deliveryUrl: string,
		firstReq: deliveryApi.sessionStart.Request,
		metaReq: deliveryApi.msgMeta.Request): Promise<DeliveryInfo> {
	let info = <DeliveryInfo> (await startMsgDeliverySession(
		deliveryUrl, firstReq));
	let reqOpts: RequestOpts = {
		url: resolveUrl(deliveryUrl, deliveryApi.msgMeta.URL_END),
		method: 'PUT',
		responseType: 'json',
		sessionId: info.sessionId
	};
	let rep = await doJsonRequest<deliveryApi.msgMeta.Reply>(reqOpts, metaReq);
	expect(rep.status).toBe(deliveryApi.msgMeta.SC.ok);
	for (let field of Object.keys(rep.data)) {
		info[field] = rep.data[field];
	}
	return info;
}

export async function sendMsgObj(deliveryUrl: string, sessionId: string,
		obj: Obj): Promise<void> {
	let reqOpts: RequestOpts = {
		url: resolveUrl(deliveryUrl, deliveryApi.msgObjHeader.genUrlEnd(
			obj.objId, { total: obj.header.length, ofs: 0 })),
		method: 'PUT',
		sessionId: sessionId
	};
	let rep = await doBinaryRequest<void>(reqOpts, obj.header);
	expect(rep.status).toBe(deliveryApi.msgObjHeader.SC.ok);
	reqOpts.url = resolveUrl(deliveryUrl, deliveryApi.msgObjSegs.genUrlEnd(
		obj.objId, { total: obj.segs.length, ofs: 0 }));
	rep = await doBinaryRequest<void>(reqOpts, obj.segs);
	expect(rep.status).toBe(deliveryApi.msgObjHeader.SC.ok);
}

export interface Msg {
	cryptoMeta: deliveryApi.msgMeta.CryptoInfo,
	msgObjs: Obj[]
}

export async function sendMsg(deliveryUrl: string, recipient: string,
		msg: Msg): Promise<string> {
	let meta = <deliveryApi.msgMeta.Request> msg.cryptoMeta;
	meta.objIds = new Array<string>(msg.msgObjs.length);
	for (let i=0; i < msg.msgObjs.length; i+=1) {
		meta.objIds[i] = msg.msgObjs[i].objId;
	}
	let sessInfo = await startMsgDelivery(deliveryUrl, { recipient }, meta);
	for (let msgObj of msg.msgObjs) {
		await sendMsgObj(deliveryUrl, sessInfo.sessionId, msgObj);
	}
	let reqOpts: RequestOpts = {
		url: resolveUrl(deliveryUrl, deliveryApi.completion.URL_END),
		method: 'POST',
		sessionId: sessInfo.sessionId
	};
	let rep = await doBodylessRequest<void>(reqOpts);
	expect(rep.status).toBe(deliveryApi.completion.SC.ok);
	return sessInfo.msgId;
}


Object.freeze(exports);