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

import { afterAllAsync, beforeAllAsync, itAsync }
	from '../../libs-for-tests/async-jasmine';
import { ASMailComponent } from '../../libs-for-tests/server-components/asmail';
import { User, doMailerIdLogin } from '../../libs-for-tests/mailerid';
import { RequestOpts, doBodylessRequest } from '../../libs-for-tests/xhr-utils';
import { expectNonAcceptanceOfBadSessionId, expectNonAcceptanceOfNonEmptyBody }
	from '../../shared-checks/requests';
import { midLoginSpecs } from '../../shared-checks/check-mid-login';
import { resolve as resolveUrl } from 'url';
import * as api from '../../../lib-common/service-api/asmail/retrieval';
import { bytes as randomBytes } from '../../../lib-common/random-node';
import { Msg, sendMsg } from '../../libs-for-tests/asmail';
import { bytesEqual } from '../../libs-for-tests/bytes-equal';

describe('ASMail retrieval service', () => {
	
	let asmailServer: ASMailComponent;
	const midServiceDomain = 'localhost';
	const signupDomains = [ 'company.inc', 'personal.net' ];
	let user1: User;
	let user2: User;
	let retrievalUrl: string;
	let deliveryUrl: string;
	
	let msg: Msg = {
		cryptoMeta: {
			pid: 'ephemeral pair id'
		},
		msgObjs: [ {
			objId: 'aaaa',
			header: randomBytes(100),
			segs: randomBytes(573)
		}, {
			objId: 'bbbb',
			header: randomBytes(100),
			segs: randomBytes(2*1024 + 7)
		} ]
	};
	
	beforeAllAsync(async () => {
		asmailServer = new ASMailComponent(signupDomains, midServiceDomain);
		await asmailServer.start();
		retrievalUrl = await asmailServer.getRetrievalUrl();
		if (!retrievalUrl.endsWith('/')) { retrievalUrl += '/'; }
		deliveryUrl = await asmailServer.getDeliveryUrl();
		if (!deliveryUrl.endsWith('/')) { deliveryUrl += '/'; }
		user1 = await asmailServer.addUser(
			`Bob Johnson @${signupDomains[0]}`);
		user2 = await asmailServer.addUser(
			`William Young @${signupDomains[1]}`);
	});
	
	afterAllAsync(async () => {
		await asmailServer.stop();
		asmailServer = (undefined as any);
	});
	
	describe('MailerId login', midLoginSpecs(
		() => resolveUrl(retrievalUrl, api.midLogin.MID_URL_PART),
		() => user1 ));
	
	async function startSession(user: User): Promise<string> {
		return await doMailerIdLogin(
			resolveUrl(retrievalUrl, api.midLogin.MID_URL_PART),
			user);
	}
	
	itAsync('closing session', async () => {
		let sessionId = await startSession(user1);
		
		let reqOpts: RequestOpts = {
			url: resolveUrl(retrievalUrl, api.closeSession.URL_END),
			method: 'POST',
			sessionId
		};
		
		// normal closing of a session
		let rep = await doBodylessRequest<void>(reqOpts);
		expect(rep.status).toBe(200, 'status for successful closing of session');
		
		// repeated call should see invalid session response
		rep = await doBodylessRequest<void>(reqOpts);
		expect(rep.status).toBe(api.ERR_SC.needAuth);
		
		reqOpts.sessionId = await startSession(user1);
		
		await expectNonAcceptanceOfNonEmptyBody(reqOpts);
		
		await expectNonAcceptanceOfBadSessionId(reqOpts);
		
	});
	
	itAsync('lists messages in inbox', async () => {
		let sessionId = await startSession(user1);
		
		// TODO add to this route time limits for listing
		
		let reqOpts: RequestOpts = {
			url: resolveUrl(retrievalUrl, api.listMsgs.URL_END),
			method: 'GET',
			responseType: 'json',
			sessionId
		};
		
		// there are no messages
		let rep = await doBodylessRequest<api.listMsgs.Reply>(reqOpts);
		expect(rep.status).toBe(api.listMsgs.SC.ok, 'normal status reply');
		expect(Array.isArray(rep.data)).toBe(true);
		expect(rep.data.length).toBe(0);
		
		// add one message, and see a change
		let msgId = await sendMsg(deliveryUrl, user1.id, msg);
		rep = await doBodylessRequest<api.listMsgs.Reply>(reqOpts);
		expect(rep.status).toBe(api.listMsgs.SC.ok, 'normal status reply');
		expect(Array.isArray(rep.data)).toBe(true);
		expect(rep.data).toContain(msgId);
		
		await expectNonAcceptanceOfBadSessionId(reqOpts);
		
	});
	
	itAsync('removes messages from inbox', async () => {
		let msgId = await sendMsg(deliveryUrl, user1.id, msg);
		expect(await asmailServer.msgExists(user1.id, msgId, true)).toBeTruthy();
		let sessionId = await startSession(user1);
		
		let reqOpts: RequestOpts = {
			url: resolveUrl(retrievalUrl, api.rmMsg.genUrlEnd(msgId)),
			method: 'DELETE',
			sessionId
		};
		
		let rep = await doBodylessRequest<void>(reqOpts);
		expect(rep.status).toBe(api.rmMsg.SC.ok, 'status when message was found and removed');
		expect(await asmailServer.msgExists(user1.id, msgId, true)).toBeFalsy('message should be removed from the server');
		
		// duplicate message, which means use of unknown message id
		rep = await doBodylessRequest<void>(reqOpts);
		expect(rep.status).toBe(api.rmMsg.SC.unknownMsg, 'status for unknown message');
		
		await expectNonAcceptanceOfBadSessionId(reqOpts);
		
	});
	
	itAsync('provides getting message metadata', async () => {
		let msgId = await sendMsg(deliveryUrl, user1.id, msg);
		let sessionId = await startSession(user1);
		
		let reqOpts: RequestOpts = {
			url: resolveUrl(retrievalUrl, api.msgMetadata.genUrlEnd(msgId)),
			method: 'GET',
			responseType: 'json',
			sessionId
		};
		
		let rep = await doBodylessRequest<api.msgMetadata.Reply>(reqOpts);
		expect(rep.status).toBe(api.msgMetadata.SC.ok, 'status for successfully found message');
		expect(rep.data.authSender).toBeFalsy();
		expect(typeof rep.data.deliveryStart).toBe('number');
		expect(typeof rep.data.deliveryCompletion).toBe('number');
		expect(rep.data.deliveryStart).not.toBeGreaterThan(
			rep.data.deliveryCompletion!);
		
		// unknown message
		reqOpts.url = resolveUrl(retrievalUrl, api.msgMetadata.genUrlEnd(
			'unknown-message'));
		rep = await doBodylessRequest<api.msgMetadata.Reply>(reqOpts);
		expect(rep.status).toBe(api.msgMetadata.SC.unknownMsg, 'status for unknown message');
		
		await expectNonAcceptanceOfBadSessionId(reqOpts);
		
	});
	
	itAsync('provides getting message object header', async () => {
		let msgId = await sendMsg(deliveryUrl, user1.id, msg);
		let sessionId = await startSession(user1);
		
		let reqOpts: RequestOpts = {
			url: resolveUrl(retrievalUrl, api.msgObjHeader.genUrlEnd(msgId,
				msg.msgObjs[0].objId)),
			method: 'GET',
			responseType: 'arraybuffer',
			sessionId
		};
		
		// getting complete object header
		let rep = await doBodylessRequest<Uint8Array>(reqOpts);
		expect(rep.status).toBe(api.msgObjHeader.SC.ok, 'status when object is found');
		expect(rep.data.length).toBe(msg.msgObjs[0].header.length, 'expected length of bytes');
		expect(bytesEqual(rep.data, msg.msgObjs[0].header)).toBe(true, 'complete header bytes should be same, as those that were sent');
		
		// getting part of object header
		reqOpts.url = resolveUrl(retrievalUrl, api.msgObjHeader.genUrlEnd(msgId,
			msg.msgObjs[0].objId, { ofs: 0, len: 50 }));
		rep = await doBodylessRequest<Uint8Array>(reqOpts);
		expect(rep.status).toBe(api.msgObjHeader.SC.ok, 'status when object is found');
		expect(rep.data.length).toBe(50, 'expected length of bytes');
		expect(bytesEqual(rep.data, msg.msgObjs[0].header.subarray(0, 50))).toBe(true, 'partial header bytes should be same, as those that were sent');
		reqOpts.url = resolveUrl(retrievalUrl, api.msgObjHeader.genUrlEnd(msgId,
			msg.msgObjs[0].objId, { ofs: 50 }));
		rep = await doBodylessRequest<Uint8Array>(reqOpts);
		expect(rep.status).toBe(api.msgObjHeader.SC.ok, 'status when object is found');
		expect(rep.data.length).toBe(msg.msgObjs[0].header.subarray(50).length, 'expected length of bytes');
		expect(bytesEqual(rep.data, msg.msgObjs[0].header.subarray(50))).toBe(true, 'partial header bytes should be same, as those that were sent');
		
		// unknown message
		reqOpts.url = resolveUrl(retrievalUrl, api.msgObjHeader.genUrlEnd(
			'unknown-message', 'object-id'));
		rep = await doBodylessRequest<Uint8Array>(reqOpts);
		expect(rep.status).toBe(api.msgObjHeader.SC.unknownMsgOrObj, 'status for unknown message');
		
		// unknown message object
		reqOpts.url = resolveUrl(retrievalUrl, api.msgObjHeader.genUrlEnd(msgId,
			'unknown-object'));
		rep = await doBodylessRequest<Uint8Array>(reqOpts);
		expect(rep.status).toBe(api.msgObjHeader.SC.unknownMsgOrObj, 'status for unknown message');
		
		await expectNonAcceptanceOfBadSessionId(reqOpts);
		
	});
	
	itAsync('provides getting message object segments', async () => {
		let msgId = await sendMsg(deliveryUrl, user1.id, msg);
		let sessionId = await startSession(user1);
		
		let reqOpts: RequestOpts = {
			url: resolveUrl(retrievalUrl, api.msgObjSegs.genUrlEnd(msgId,
				msg.msgObjs[0].objId)),
			method: 'GET',
			responseType: 'arraybuffer',
			sessionId
		};
		
		// getting complete object segments
		let rep = await doBodylessRequest<Uint8Array>(reqOpts);
		expect(rep.status).toBe(api.msgObjSegs.SC.ok, 'status when object is found');
		expect(rep.data.length).toBe(msg.msgObjs[0].segs.length, 'expected length of bytes');
		expect(bytesEqual(rep.data, msg.msgObjs[0].segs)).toBe(true, 'complete segments bytes should be same, as those that were sent');
		
		// getting part of object segments
		reqOpts.url = resolveUrl(retrievalUrl, api.msgObjSegs.genUrlEnd(msgId,
			msg.msgObjs[1].objId, { ofs: 0, len: 1024 }));
		rep = await doBodylessRequest<Uint8Array>(reqOpts);
		expect(rep.status).toBe(api.msgObjSegs.SC.ok, 'status when object is found');
		expect(rep.data.length).toBe(1024, 'expected length of bytes');
		expect(bytesEqual(rep.data, msg.msgObjs[1].segs.subarray(0, 1024))).toBe(true, 'partial segments bytes should be same, as those that were sent');
		reqOpts.url = resolveUrl(retrievalUrl, api.msgObjSegs.genUrlEnd(msgId,
			msg.msgObjs[1].objId, { ofs: 1024 }));
		rep = await doBodylessRequest<Uint8Array>(reqOpts);
		expect(rep.status).toBe(api.msgObjSegs.SC.ok, 'status when object is found');
		expect(rep.data.length).toBe(msg.msgObjs[1].segs.length - 1024, 'expected length of bytes');
		expect(bytesEqual(rep.data, msg.msgObjs[1].segs.subarray(1024))).toBe(true, 'partial segments bytes should be same, as those that were sent');
		
		// unknown message
		reqOpts.url = resolveUrl(retrievalUrl, api.msgObjSegs.genUrlEnd(
			'unknown-message', 'object-id'));
		rep = await doBodylessRequest<Uint8Array>(reqOpts);
		expect(rep.status).toBe(api.msgObjSegs.SC.unknownMsgOrObj, 'status for unknown message');
		
		// unknown message object
		reqOpts.url = resolveUrl(retrievalUrl, api.msgObjSegs.genUrlEnd(msgId,
			'unknown-object'));
		rep = await doBodylessRequest<Uint8Array>(reqOpts);
		expect(rep.status).toBe(api.msgObjSegs.SC.unknownMsgOrObj, 'status for unknown message');
		
		await expectNonAcceptanceOfBadSessionId(reqOpts);
		
	});
	
});