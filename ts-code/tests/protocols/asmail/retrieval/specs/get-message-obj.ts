/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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

import { beforeEachAsync, itAsync }
	from '../../../../libs-for-tests/async-jasmine';
import { SpecDescribe, TestSetup, User, msg, ASMailComponent, startSession,
	sendMsg, Obj }
	from '../test-utils';
import { resolve as resolveUrl } from 'url';
import { msgObj as api, HTTP_HEADER, ERR_SC }
	from '../../../../../lib-common/service-api/asmail/retrieval';
import { RequestOpts, Reply, doBodylessRequest }
	from '../../../../libs-for-tests/xhr-utils';
import { expectNonAcceptanceOfBadSessionId }
	from '../../../../shared-checks/requests';
import { copy } from '../../../../libs-for-tests/json-copy';
import { bytesEqual } from '../../../../libs-for-tests/bytes-equal';

const obj1 = msg.msgObjs[0];
const obj2 = msg.msgObjs[1];

export const specs: SpecDescribe = {
	description: `Request to get message object`
};

function checkReplyExpectation(rep: Reply<Uint8Array>, obj: Obj,
		headerPresent: boolean, expectedSegsBytes: Uint8Array): void {
	// status
	expect(rep.status).toBe(api.SC.ok, 'status for returned bytes');

	// object's header length http header
	const headerLen = obj.header.length;
	if (headerPresent) {
		expect(parseInt(rep.headers!.get(HTTP_HEADER.objHeaderLength)!)).toBe(headerLen, 'object header size must be given in the reply header');
	}

	// segments length header
	expect(parseInt(rep.headers!.get(HTTP_HEADER.objSegmentsLength)!)).toBe(obj.segs.length, 'object segments size must be given in the reply header');

	// check body
	if (headerPresent) {
		expect(bytesEqual(rep.data.subarray(0, headerLen), obj.header)).toBe(true, 'reply should have header bytes at the front');
		expect(bytesEqual(rep.data.subarray(headerLen), expectedSegsBytes)).toBe(true, 'reply should have proper segments bytes, following header bytes');
	} else {
		expect(bytesEqual(rep.data, expectedSegsBytes)).toBe(true, 'reply should have proper segments bytes');
	}
}

specs.definition = (setup: () => TestSetup) => (() => {
	
	let asmailServer: ASMailComponent;
	let retrievalUrl: string;
	let deliveryUrl: string;
	let user1: User;
	let reqOpts: RequestOpts
	let msgId: string;

	beforeEachAsync(async () => {
		asmailServer = setup().asmailServer;
		retrievalUrl = await asmailServer.getRetrievalUrl();
		deliveryUrl = await asmailServer.getDeliveryUrl();
		user1 = setup().user1;
		msgId = await sendMsg(deliveryUrl, user1.id, msg);
		const sessionId = await startSession(user1, retrievalUrl);
		reqOpts = {
			url: resolveUrl(retrievalUrl, api.genUrlEnd(msgId, obj1.objId,
				{ header: true })),
			method: 'GET',
			responseType: 'arraybuffer',
			sessionId,
			responseHeaders: [ HTTP_HEADER.objHeaderLength,
				HTTP_HEADER.objSegmentsLength ]
		};
	});

	itAsync('fails when message does not exist', async () => {
		const opts = copy(reqOpts);
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd('unknown-message', 'some-obj'));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(api.SC.unknownMsgOrObj);
	});

	itAsync('fails when object does not exist', async () => {
		const unknownObj = 'unknown-obj';
		const opts = copy(reqOpts);
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId, unknownObj));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(api.SC.unknownMsgOrObj);
	});

	itAsync('will not accept bad parameters', async () => {
		const opts = copy(reqOpts);
		const objId = msg.msgObjs[0].objId;
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId, objId,
			{ ofs: -34 }));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(ERR_SC.malformed);
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId, objId,
			{ limit: -34 }));
		rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(ERR_SC.malformed);
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId, objId,
			{ ofs: 10, limit: 0 }));
		rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(ERR_SC.malformed);
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId, objId,
			{ header: true, ofs: 10 }));
		rep = await doBodylessRequest<Uint8Array>(opts);
		expect(rep.status).toBe(ERR_SC.malformed);
	});

	itAsync('returns header and all segments', async () => {
		const opts = copy(reqOpts);
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId, obj1.objId,
			{ header: true }));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj1, true, obj1.segs);
	});

	itAsync('returns header without segments', async () => {
		const opts = copy(reqOpts);
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId, obj1.objId, { header: true, limit: 0 }));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj1, true, new Uint8Array(0));
	});

	itAsync('returns all segments without header', async () => {
		const opts = copy(reqOpts);
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId, obj1.objId));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj1, false, obj1.segs);
	});

	itAsync('returns chunk, when offset and limit are given', async () => {
		const opts = copy(reqOpts);
		// with non-overflowing limit
		for (let offset=0; offset<=obj2.segs.length; offset+=512) {
			const chunkLen = Math.min(512, obj2.segs.length - offset);
			opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId, obj2.objId,
				{ ofs: offset, limit: chunkLen }));
			const rep = await doBodylessRequest<Uint8Array>(opts);
			checkReplyExpectation(rep, obj2, false, obj2.segs.subarray(offset, offset+chunkLen));
		}
		// with overflowing limit
		const offset = obj2.segs.length - 100;
		const requestedLen = 300
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId, obj2.objId,
			{ ofs: offset, limit: requestedLen }));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj2, false, obj2.segs.subarray(offset));
	});

	itAsync('reads segments from start, when offset is not given', async () => {
		const opts = copy(reqOpts);
		// with non-overflowing length
		const chunkLen = 512;
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId, obj2.objId,
			{ limit: chunkLen }));
		let rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj2, false, obj2.segs.subarray(0, chunkLen));
		// with overflowing length
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId, obj2.objId,
			{ limit: obj2.segs.length+300 }));
		rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj2, false, obj2.segs);
	});

	itAsync('reads segments to the end, when limit is not given', async () => {
		const opts = copy(reqOpts);
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId, obj2.objId,
			{ ofs: 1234 }));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj2, false, obj2.segs.subarray(1234));
	});

	itAsync('no-bytes read', async () => {
		const opts = copy(reqOpts);
		opts.url = resolveUrl(retrievalUrl, api.genUrlEnd(msgId, obj2.objId,
			{ ofs: obj2.segs.length, limit: 500 }));
		const rep = await doBodylessRequest<Uint8Array>(opts);
		checkReplyExpectation(rep, obj2, false, new Uint8Array(0));
	});
		
	itAsync(`requires open session`, async () => {
		const opts = copy(reqOpts);
		await expectNonAcceptanceOfBadSessionId(opts);
	});

});