/*
 Copyright (C) 2016, 2019, 2022 3NSoft Inc.
 
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

import { User, doMailerIdLogin, provisionMidSigner } from './mailerid';
import { doJsonRequest, RequestOpts, doBodylessRequest, doBinaryRequest } from './xhr-utils';
import { resolve as resolveUrl } from 'url';
import { midLogin, PARAM_SC, p } from '../../lib-common/service-api/asmail/config';
import * as random from '../../lib-common/random-node';
import { base64 } from '../../lib-common/buffer-utils';
import { JsonKey } from '../../lib-common/jwkeys';
import { box } from 'ecma-nacl';
import * as deliveryApi from '../../lib-common/service-api/asmail/delivery';
import { BaseObj as Obj } from './3nstorage';
import { assert } from './assert';

export { BaseObj as Obj } from './3nstorage';

export async function getASMailServiceUrl(
	asmailUrl: string, service: 'delivery'|'retrieval'|'config'
): Promise<string> {
	const reqOpts: RequestOpts= {
		url: asmailUrl,
		method: 'GET',
		responseType: 'json'
	};
	const rep = await doBodylessRequest<any>(reqOpts);
	expect(rep.status).toBe(200);
	const serviceUrl: string = rep.data[service];
	expect(typeof serviceUrl).toBe('string');
	return resolveUrl(asmailUrl, serviceUrl);
}

export async function setInboxParams(
	asmailUrl: string, user: User, params: { [pUrl: string]: any; }
): Promise<void> {
	const confUrl = await getASMailServiceUrl(asmailUrl, 'config');
	const sessionId = await doMailerIdLogin(
		resolveUrl(confUrl, midLogin.MID_URL_PART), user
	);
	for (const pUrl of Object.keys(params)) {
		const reqOpts: RequestOpts= {
			url: resolveUrl(confUrl, pUrl),
			method: 'PUT',
			sessionId
		};
		const rep = await doJsonRequest<void>(reqOpts, params[pUrl]);
		expect(rep.status).toBe(PARAM_SC.ok);
	}
}

export const PUBLIC_KEY_USE = 'asmail-pub-key';

export async function generateInitPubKey(
	midUrl: string, user: User
): Promise<p.initPubKey.Certs> {
	const midSigner = await provisionMidSigner(midUrl, user);
	const skeyBytes = await random.bytes(box.KEY_LENGTH);
	const pkeyBytes = box.generate_pubkey(skeyBytes);
	const pkey: JsonKey = {
		use: PUBLIC_KEY_USE,
		alg: box.JWK_ALG_NAME,
		kid: await random.stringOfB64Chars(10),
		k: base64.pack(pkeyBytes)
	};
	const pkeyCert = midSigner.certifyPublicKey(pkey, 30*24*60*60);
	const certs: p.initPubKey.Certs = {
		pkeyCert,
		provCert: midSigner.providerCert,
		userCert: midSigner.userCert
	};
	return certs;
}

export async function startMsgDeliverySession(
	deliveryUrl: string, req: deliveryApi.sessionStart.Request
): Promise<deliveryApi.sessionStart.Reply> {
	const reqOpts: RequestOpts = {
		url: resolveUrl(deliveryUrl, deliveryApi.sessionStart.URL_END),
		method: 'POST',
		responseType: 'json'
	};
	const rep = await doJsonRequest<deliveryApi.sessionStart.Reply>(
		reqOpts, req
	);
	expect(rep.status).toBe(deliveryApi.sessionStart.SC.ok);
	return rep.data;
}

export interface DeliveryInfo extends
	deliveryApi.msgMeta.Reply, deliveryApi.sessionStart.Reply {}

export async function startMsgDelivery(
	deliveryUrl: string, firstReq: deliveryApi.sessionStart.Request,
	metaReq: deliveryApi.msgMeta.Request
): Promise<DeliveryInfo> {
	const info = (await startMsgDeliverySession(
		deliveryUrl, firstReq
	)) as DeliveryInfo;
	const reqOpts: RequestOpts = {
		url: resolveUrl(deliveryUrl, deliveryApi.msgMeta.URL_END),
		method: 'PUT',
		responseType: 'json',
		sessionId: info.sessionId
	};
	const rep = await doJsonRequest<deliveryApi.msgMeta.Reply>(reqOpts, metaReq);
	expect(rep.status).toBe(deliveryApi.msgMeta.SC.ok);
	for (const field of Object.keys(rep.data)) {
		info[field] = rep.data[field];
	}
	return info;
}

export async function sendMsgObj(
	deliveryUrl: string, sessionId: string, obj: Obj,
	chunkLimit: number|undefined
): Promise<void> {
	if (!obj.objId) { throw new Error(`Message object doesn't have an id`); }
	if (!chunkLimit) {
		chunkLimit = 512*1024;
	}
	
	let ofs = 0;
	const segsLen = obj.segs.length;
	while (ofs < segsLen) {
		const reqOpts: RequestOpts = { url: '', method: 'PUT', sessionId };
		let bytesToSend: Uint8Array | Uint8Array[];
		
		if (ofs === 0) {
			// first request starts with header
			const header = obj.header.length;
			const segsChunk = obj.segs.subarray(0, chunkLimit - header);
			const last = (segsChunk.length === obj.segs.length);
			bytesToSend = [ obj.header, segsChunk ];
			reqOpts.url = resolveUrl(deliveryUrl,
				deliveryApi.msgObj.firstPutReqUrlEnd(obj.objId, { header, last }));
			ofs += segsChunk.length;
		} else {
			// second request(s) send bytes
			bytesToSend = obj.segs.subarray(ofs, ofs+chunkLimit);
			const last = ((ofs + bytesToSend.length) === obj.segs.length);
			reqOpts.url = resolveUrl(deliveryUrl,
				deliveryApi.msgObj.secondPutReqUrlEnd(obj.objId, { ofs, last }));
			ofs += bytesToSend.length;
		}
		const rep = await doBinaryRequest<void>(reqOpts, bytesToSend);
		assert(rep.status === deliveryApi.msgObj.SC.ok, `Msg obj isn't saved: server status ${rep.status} instead of expected ${deliveryApi.msgObj.SC.ok}`);
	}
}

export interface Msg {
	cryptoMeta: deliveryApi.msgMeta.CryptoInfo,
	msgObjs: Obj[]
}

export async function sendMsg(
	deliveryUrl: string, recipient: string, msg: Msg
): Promise<string> {
	const stepsIter = msgSendingSteps(deliveryUrl, recipient, msg);
	const fstStep = await stepsIter.next();
	expect(fstStep.done).toBeFalsy();
	expect(fstStep.value).toBeDefined();
	const msgId = fstStep.value;
	let done: boolean;
	do {
		done = !!(await stepsIter.next()).done;
	} while (!done);
	return msgId;
}

export async function* msgSendingSteps(
	deliveryUrl: string, recipient: string, msg: Msg
): AsyncGenerator<string, string, unknown> {
	const meta = makeMetaFor(msg);
	const sessInfo = await startMsgDelivery(deliveryUrl, { recipient }, meta);
	yield sessInfo.msgId;
	for (const msgObj of msg.msgObjs) {
		await sendMsgObj(
			deliveryUrl, sessInfo.sessionId, msgObj, sessInfo.maxChunkSize
		);
		yield sessInfo.msgId;
	}
	const reqOpts: RequestOpts = {
		url: resolveUrl(deliveryUrl, deliveryApi.completion.URL_END),
		method: 'POST',
		sessionId: sessInfo.sessionId
	};
	const rep = await doBodylessRequest<void>(reqOpts);
	expect(rep.status).toBe(deliveryApi.completion.SC.ok);
	return sessInfo.msgId;
}

function makeMetaFor(msg: Msg): deliveryApi.msgMeta.Request {
	const meta = msg.cryptoMeta as deliveryApi.msgMeta.Request;
	meta.objIds = [];
	for (let i=0; i < msg.msgObjs.length; i+=1) {
		const objId = msg.msgObjs[i].objId;
		if (!objId) {
			throw new Error(`Message object #${i} doesn't have an id`);
		}
		meta.objIds[i] = objId;
	}
	return meta;
}


Object.freeze(exports);