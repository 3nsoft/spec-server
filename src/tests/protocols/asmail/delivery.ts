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


import { afterAllAsync, beforeAllAsync, beforeEachAsync, itAsync }
	from '../../libs-for-tests/async-jasmine';
import { ASMailComponent } from '../../libs-for-tests/server-components/asmail';
import { User } from '../../libs-for-tests/mailerid';
import { doJsonRequest, RequestOpts, doBodylessRequest, doBinaryRequest }
	from '../../libs-for-tests/xhr-utils';
import { expectNonAcceptanceOfBadJsonRequest, UNAUTHORIZED_STATUS,
	expectNonAcceptanceOfBadSessionId, expectNonAcceptanceOfBadType,
	expectNonAcceptanceOfNonEmptyBody }
	from '../../shared-checks/requests';
import { resolve as resolveUrl } from 'url';
import * as api from '../../../lib-common/service-api/asmail/delivery';
import { p } from '../../../lib-common/service-api/asmail/config';
import { bytes as randomBytes } from '../../../lib-common/random-node';
import { setInboxParams, generateInitPubKey, Msg, Obj, startMsgDeliverySession,
	DeliveryInfo, startMsgDelivery, sendMsgObj }
	from '../../libs-for-tests/asmail';

describe('ASMail delivery service', () => {
	
	let asmailServer: ASMailComponent;
	const midServiceDomain = 'localhost';
	const signupDomains = [ 'company.inc', 'personal.net' ];
	let user1: User;
	let user2: User;
	let deliveryUrl: string;
	
	beforeAllAsync(async () => {
		asmailServer = new ASMailComponent(signupDomains, midServiceDomain);
		await asmailServer.start();
		deliveryUrl = await asmailServer.getDeliveryUrl();
		if (!deliveryUrl.endsWith('/')) { deliveryUrl += '/'; }
		user1 = await asmailServer.addUser(`Bob Johnson @${signupDomains[0]}`);
		user2 = await asmailServer.addUser(`William Young @${signupDomains[1]}`);
		let user2Params = <any> {};
		user2Params[p.initPubKey.URL_END] = await generateInitPubKey(
			asmailServer.midUrl, user2);
		await setInboxParams(asmailServer.asmailUrl, user2, user2Params);
	});
	
	afterAllAsync(async () => {
		await asmailServer.stop();
		asmailServer = null;
	});
	
	itAsync('first request starts delivery session', async () => {
		
		let reqOpts: RequestOpts = {
			url: resolveUrl(deliveryUrl, api.sessionStart.URL_END),
			method: 'POST',
			responseType: 'json'
		};
		
		let req: api.sessionStart.Request = {
			recipient: user2.id
		};
		
		let rep = await doJsonRequest<api.sessionStart.Reply>(reqOpts, req);
		expect(rep.status).toBe(api.sessionStart.SC.ok, 'successful session start status');
		expect(typeof rep.data.sessionId).toBe('string');
		expect(rep.data.sessionId.length).toBeGreaterThan(0);
		expect(typeof rep.data.maxMsgLength).toBe('number');
		expect(rep.data.maxMsgLength).toBeGreaterThan(0);
		
		// unknown recipient
		req = { recipient: 'unknown user@bank.com' };
		rep = await doJsonRequest<api.sessionStart.Reply>(reqOpts, req);
		expect(rep.status).toBe(api.sessionStart.SC.unknownRecipient, 'status for unknown recipient');
		
		// bad JSON's
		const REQ_SIZE_LIMIT = 1024;
		let badJSONs: any[] = [ null, undefined, 1, 'string',
			[1,2], [], { a:1, b:2 }];
		await expectNonAcceptanceOfBadJsonRequest(reqOpts, REQ_SIZE_LIMIT,
			badJSONs);
			
	});
	
	itAsync('provides recipient\'s registered initial key', async () => {

		let sessInfo = await startMsgDeliverySession(
			deliveryUrl, { recipient: user2.id });
		let reqOpts: RequestOpts = {
			url: resolveUrl(deliveryUrl, api.initPubKey.URL_END),
			method: 'GET',
			responseType: 'json',
			sessionId: sessInfo.sessionId
		};
		let rep = await doBodylessRequest<api.initPubKey.Reply>(reqOpts);
		expect(rep.status).toBe(api.initPubKey.SC.ok, 'status for successfully getting a key');
		// TODO add check of certs, together with adding check in setting pkey
		
		// recipient doesn't have initial public key registered
		sessInfo = await startMsgDeliverySession(
			deliveryUrl, { recipient: user1.id });
		reqOpts = {
			url: resolveUrl(deliveryUrl, api.initPubKey.URL_END),
			method: 'GET',
			responseType: 'json',
			sessionId: sessInfo.sessionId
		};
		rep = await doBodylessRequest<api.initPubKey.Reply>(reqOpts);
		expect(rep.status).toBe(api.initPubKey.SC.pkeyNotRegistered, 'status for no key registered with server');
		
		// session is closed, when there is no key, so repeat request is denied
		rep = await doBodylessRequest<api.initPubKey.Reply>(reqOpts);
		expect(rep.status).toBe(UNAUTHORIZED_STATUS, 'status for closed session');
		
		await expectNonAcceptanceOfBadSessionId(reqOpts);
		
	});
	
	let obj1: Obj = {
		objId: 'aaaa',
		header: randomBytes(100),
		segs: randomBytes(573)
	};
	let obj2: Obj = {
		objId: 'bbbb',
		header: randomBytes(100),
		segs: randomBytes(2*1024 + 7)
	};
	let msg: Msg = {
		cryptoMeta: { pid: 'xxxx' },
		msgObjs: [ obj1, obj2 ]
	}
	
	itAsync('starts actual message delivery with taking metadata',
			async () => {
		
		let sessInfo = await startMsgDeliverySession(
			deliveryUrl, { recipient: user1.id });
		
		let reqOpts: RequestOpts = {
			url: resolveUrl(deliveryUrl, api.msgMeta.URL_END),
			method: 'PUT',
			responseType: 'json',
			sessionId: sessInfo.sessionId
		};
		
		let req: api.msgMeta.Request = {
			pid: msg.cryptoMeta.pid,
			objIds: [ msg.msgObjs[0].objId, msg.msgObjs[1].objId ]
		};
		
		let rep = await doJsonRequest<api.msgMeta.Reply>(reqOpts, req);
		expect(rep.status).toBe(api.msgMeta.SC.ok, 'status for normal meta acceptance and issue of a corresponding message id');
		expect(typeof rep.data.msgId).toBe('string');
		let msgId = rep.data.msgId;
		expect(msgId.length).toBeGreaterThan(0);
		expect(typeof rep.data.maxChunkSize).toBe('number');
		expect(rep.data.maxChunkSize).not.toBeLessThan(64*1024);
		expect(await asmailServer.msgExists(user1.id, msgId, false)).toBeTruthy('message is knownto be in delivery');
		
		// bad JSON's
		const REQ_SIZE_LIMIT = 16*1024;
		let badJSONs: any[] = [ null, undefined, 1, 'string',
			// XXX add meta checks to screen out these
			// [1,2], [], { a:1, b:2 }
			];
		await expectNonAcceptanceOfBadJsonRequest(reqOpts, REQ_SIZE_LIMIT,
			badJSONs);
		
		await expectNonAcceptanceOfBadSessionId(reqOpts, true);
		
	});
	
	itAsync('is not allowing message with object ids that are either same, or are equal to letter case', async () => {
		let sessInfo = await startMsgDeliverySession(
			deliveryUrl, { recipient: user1.id });
		let reqOpts: RequestOpts = {
			url: resolveUrl(deliveryUrl, api.msgMeta.URL_END),
			method: 'PUT',
			responseType: 'json',
			sessionId: sessInfo.sessionId
		};
		
		// request with exact object ids
		let req: api.msgMeta.Request = {
			pid: msg.cryptoMeta.pid,
			objIds: [ msg.msgObjs[0].objId, msg.msgObjs[0].objId ]
		};
		let rep = await doJsonRequest<api.msgMeta.Reply>(reqOpts, req);
		expect(rep.status).toBe(api.ERR_SC.malformed, 'same object ids are not allowed');
		
		// request with object ids that differ only in letter case
		req.objIds = [ msg.msgObjs[0].objId, msg.msgObjs[0].objId.toUpperCase() ];
		rep = await doJsonRequest<api.msgMeta.Reply>(reqOpts, req);
		expect(rep.status).toBe(api.ERR_SC.malformed, 'object ids, equal to letter case, are not allowed');
		
	});
	
	describe('message\'s object(s) delivery', () => {
		
		let sessInfo: DeliveryInfo;
		
		beforeEachAsync(async () => {
			sessInfo = await startMsgDelivery(deliveryUrl,
				{ recipient: user1.id },
				{ pid: msg.cryptoMeta.pid,
					objIds: [ msg.msgObjs[0].objId, msg.msgObjs[1].objId ] });
		});
		
		itAsync('takes object header', async () => {
			
			// TODO change to simple, complete header delivery, with no options
			
			let reqOpts: RequestOpts = {
				url: resolveUrl(deliveryUrl, api.msgObjHeader.genUrlEnd(
					obj1.objId, { total: obj1.header.length, ofs: 0 })),
				method: 'PUT',
				sessionId: sessInfo.sessionId
			};
			
			let rep = await doBinaryRequest<void>(reqOpts, obj1.header);
			expect(rep.status).toBe(api.msgObjHeader.SC.ok, 'status for successful saving of object\'s header');
			
			// duplicate request
			rep = await doBinaryRequest<void>(reqOpts, obj1.header);
			expect(rep.status).toBe(api.msgObjHeader.SC.objAlreadyExists);
			
			// unknown object id
			reqOpts.url = resolveUrl(deliveryUrl, api.msgObjHeader.genUrlEnd(
				'unknown obj', { total: obj1.header.length, ofs: 0 }));
			rep = await doBinaryRequest<void>(reqOpts, obj1.header);
			expect(rep.status).toBe(api.msgObjHeader.SC.unknownObj, 'status for unknown object');
			
			await expectNonAcceptanceOfBadType(reqOpts, 'application/octet-stream',
				new Uint8Array(128));
			
			await expectNonAcceptanceOfBadSessionId(reqOpts, true);
			
			// uploading should not work, if metadata hasn't been sent
			reqOpts.sessionId = (await startMsgDeliverySession(
				deliveryUrl, { recipient: user1.id })).sessionId;
			rep = await doBinaryRequest<void>(reqOpts, obj1.header);
			expect(rep.status).toBe(api.ERR_SC.earlyReq, 'status for sending object bytes before sending message metadata');
			
		});
		
		itAsync('takes object segments completely', async () => {
			
			// TODO add simple, complete segs delivery with no options,
			//		and this test should be for it
			
			let reqOpts: RequestOpts = {
				url: resolveUrl(deliveryUrl, api.msgObjSegs.genUrlEnd(
					obj1.objId, { total: obj1.segs.length, ofs: 0 })),
				method: 'PUT',
				sessionId: sessInfo.sessionId
			};
			
			let rep = await doBinaryRequest<void>(reqOpts, obj1.segs);
			expect(rep.status).toBe(api.msgObjSegs.SC.ok, 'status for successful saving of object\'s segment bytes');
			
			// duplicate request
			rep = await doBinaryRequest<void>(reqOpts, obj1.segs);
			expect(rep.status).toBe(api.msgObjSegs.SC.objAlreadyExists);
			
			// unknown object id
			reqOpts.url = resolveUrl(deliveryUrl, api.msgObjHeader.genUrlEnd(
				'unknown obj', { total: obj1.segs.length, ofs: 0 }));
			rep = await doBinaryRequest<void>(reqOpts, obj1.segs);
			expect(rep.status).toBe(api.msgObjSegs.SC.unknownObj, 'status for unknown object');
			
			await expectNonAcceptanceOfBadType(reqOpts, 'application/octet-stream',
				new Uint8Array(128));
			
			await expectNonAcceptanceOfBadSessionId(reqOpts, true);
			
			// uploading should not work, if metadata hasn't been sent
			reqOpts.sessionId = (await startMsgDeliverySession(
				deliveryUrl, { recipient: user1.id })).sessionId;
			reqOpts.url = resolveUrl(deliveryUrl, api.msgObjSegs.genUrlEnd(
					obj1.objId, { total: obj1.segs.length, ofs: 0 }));
			rep = await doBinaryRequest<void>(reqOpts, obj1.segs);
			expect(rep.status).toBe(api.ERR_SC.earlyReq, 'status for sending object bytes before sending message metadata');
			
		});
		
		itAsync('takes object segments partially', async () => {
			
			let reqOpts: RequestOpts = {
				url: resolveUrl(deliveryUrl, api.msgObjSegs.genUrlEnd(
					obj2.objId, { total: obj2.segs.length, ofs: 0 })),
				method: 'PUT',
				sessionId: sessInfo.sessionId
			};
			
			// sending first chunk
			let rep = await doBinaryRequest<void>(reqOpts,
				obj2.segs.subarray(0, 1024));
			expect(rep.status).toBe(api.msgObjSegs.SC.ok, 'status for successful saving of object\'s segment bytes');
			
			// duplicating first chunk request, i.e. with total size in options
			rep = await doBinaryRequest<void>(reqOpts, obj2.segs.subarray(1024));
			expect(rep.status).toBe(api.msgObjSegs.SC.objAlreadyExists, 'status for already created object');
			
			// sending following chunks
			reqOpts.url = resolveUrl(deliveryUrl, api.msgObjSegs.genUrlEnd(
				obj2.objId, { ofs: 1024 }));
			rep = await doBinaryRequest<void>(reqOpts, obj2.segs.subarray(1024));
			expect(rep.status).toBe(api.msgObjSegs.SC.ok, 'status for successful saving of object\'s segment bytes');
			
			// sending first chunk without total in options
			reqOpts.url = resolveUrl(deliveryUrl, api.msgObjSegs.genUrlEnd(
				obj1.objId, { ofs: 0 }));
			rep = await doBinaryRequest<void>(reqOpts, obj1.segs);
			expect(rep.status).toBe(api.msgObjSegs.SC.unknownObj, 'status for known object, since upload hasn\'t been started, yet');
			
			await expectNonAcceptanceOfBadType(reqOpts, 'application/octet-stream',
				new Uint8Array(128));
			
			await expectNonAcceptanceOfBadSessionId(reqOpts, true);
			
			// uploading should not work, if metadata hasn't been sent
			reqOpts.sessionId = (await startMsgDeliverySession(
				deliveryUrl, { recipient: user1.id })).sessionId;
			reqOpts.url = resolveUrl(deliveryUrl, api.msgObjSegs.genUrlEnd(
					obj2.objId, { total: obj2.segs.length, ofs: 0 }));
			rep = await doBinaryRequest<void>(reqOpts, obj2.segs.subarray(1024));
			expect(rep.status).toBe(api.ERR_SC.earlyReq, 'status for sending object bytes before sending message metadata');
			
		});
		
	});
	
	async function startSessionAndSendMsgObjs(recipient: string, msg: Msg):
		Promise<DeliveryInfo> {
		let sessInfo = await startMsgDelivery(deliveryUrl,
			{ recipient },
			{ pid: msg.cryptoMeta.pid,
				objIds: [ msg.msgObjs[0].objId, msg.msgObjs[1].objId ] });
		await sendMsgObj(deliveryUrl, sessInfo.sessionId, msg.msgObjs[0]);
		await sendMsgObj(deliveryUrl, sessInfo.sessionId, msg.msgObjs[1]);
		return sessInfo;
	}
	
	itAsync('last request ensures delivery completion', async () => {
		let sessInfo = await startSessionAndSendMsgObjs(user1.id, msg);
		expect(await asmailServer.msgExists(user1.id, sessInfo.msgId, false)).toBeTruthy('message is known to be in delivery');
		
		let reqOpts: RequestOpts = {
			url: resolveUrl(deliveryUrl, api.completion.URL_END),
			method: 'POST',
			sessionId: sessInfo.sessionId
		};
		
		let rep = await doBodylessRequest<void>(reqOpts);
		expect(rep.status).toBe(api.completion.SC.ok, 'normal end of message delivering session');
		expect(await asmailServer.msgExists(user1.id, sessInfo.msgId, true, msg)).toBeTruthy('message is now delivered');
		
		// duplicate should not work, as session is already closed
		rep = await doBodylessRequest<void>(reqOpts);
		expect(rep.status).toBe(UNAUTHORIZED_STATUS);
		
		sessInfo = await startSessionAndSendMsgObjs(user1.id, msg);
		reqOpts.sessionId = sessInfo.sessionId;
		
		await expectNonAcceptanceOfNonEmptyBody(reqOpts);
		
		await expectNonAcceptanceOfBadSessionId(reqOpts);
		
	});
	
});