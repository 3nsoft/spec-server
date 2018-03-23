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
import { SpecDescribe, TestSetup, User, msg } from '../test-utils';
import { doBinaryRequest, RequestOpts }
	from '../../../../libs-for-tests/xhr-utils';
import { resolve as resolveUrl } from 'url';
import { msgObj as api, ERR_SC }
	from '../../../../../lib-common/service-api/asmail/delivery';
import { expectNonAcceptanceOfBadSessionId, expectNonAcceptanceOfBadType,
	expectNonAcceptanceOfLongBody }
	from '../../../../shared-checks/requests';
import { startMsgDelivery, startMsgDeliverySession }
	from '../../../../libs-for-tests/asmail';
import { copy } from '../../../../libs-for-tests/json-copy';

export const specs: SpecDescribe = {
	description: `Request to put message object's segments`
};

const obj1 = msg.msgObjs[0];
const obj2 = msg.msgObjs[1];

specs.definition = (setup: () => TestSetup) => (() => {

	let user2: User;
	let deliveryUrl: string;
	let fstReqOpts: RequestOpts;
	let sndReqOpts: RequestOpts;
	let maxChunkSize: number;

	beforeEachAsync(async () => {
		user2 = setup().user2;
		deliveryUrl = await setup().asmailServer.getDeliveryUrl();
		const sessInfo = await startMsgDelivery(deliveryUrl,
				{ recipient: user2.id },
				{ pid: msg.cryptoMeta.pid, objIds: [ obj1.objId, obj2.objId ] });
		maxChunkSize = sessInfo.maxChunkSize!;
		fstReqOpts = {
			url: resolveUrl(deliveryUrl, api.firstPutReqUrlEnd(
				obj1.objId,
				{ header: obj1.header.length, segs: obj1.segs.length })),
			method: 'PUT',
			sessionId: sessInfo.sessionId
		};
		sndReqOpts = {
			url: resolveUrl(deliveryUrl, api.secondPutReqUrlEnd(
				obj1.objId, { ofs: 0 })),
			method: 'PUT',
			sessionId: sessInfo.sessionId
		};
	});

	itAsync('fails for unknown object, in initial put request', async () => {
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(deliveryUrl, api.firstPutReqUrlEnd(
			'unknown-obj',
			{ header: obj1.header.length, segs: obj1.segs.length }));
		const rep = await doBinaryRequest<any>(opts, [ obj1.header, obj1.segs ]);
		expect(rep.status).toBe(api.SC.unknownObj, 'status for unknown object');
	});

	itAsync('fails for unknown object, in secondary put request', async () => {
		const opts = copy(sndReqOpts);
		opts.url = resolveUrl(deliveryUrl, api.secondPutReqUrlEnd(
			'unknown-obj', { ofs: 0 }));
		const rep = await doBinaryRequest<any>(opts, obj1.segs);
		expect(rep.status).toBe(api.SC.unknownObj, 'status for unknown object');
	});

	itAsync('will not work outside of a valid session', async () => {
		await expectNonAcceptanceOfBadSessionId(fstReqOpts);
		await expectNonAcceptanceOfBadSessionId(sndReqOpts);
	});

	itAsync('first request is limited by session parameter', async () => {
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(deliveryUrl, api.firstPutReqUrlEnd(
			obj1.objId, { header: 100, segs: maxChunkSize }));
		await expectNonAcceptanceOfLongBody(opts, 'application/octet-stream',
			maxChunkSize+100);
	});

	itAsync('second request is limited by session parameter', async () => {
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(deliveryUrl, api.firstPutReqUrlEnd(obj1.objId,
			{ header: obj1.header.length, segs: maxChunkSize+1 }));
		const rep = await doBinaryRequest<void>(opts, obj1.header);
		opts.url = resolveUrl(deliveryUrl, api.secondPutReqUrlEnd(
			obj1.objId, { ofs: 0 }));
		await expectNonAcceptanceOfLongBody(opts, 'application/octet-stream',
			maxChunkSize);
	});
	
	itAsync(`writes whole object in one request`, async () => {
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(deliveryUrl, api.firstPutReqUrlEnd(obj1.objId,
			{ header: obj1.header.length, segs: obj1.segs.length }));
		let rep = await doBinaryRequest<void>(opts, [ obj1.header, obj1.segs ]);
		expect(rep.status).toBe(api.SC.ok, 'status for successful writing of segments bytes');
	});

	itAsync(`writes object in several non-appending requests`, async () => {
		// first request, to start non-appending transmission
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(deliveryUrl, api.firstPutReqUrlEnd(
			obj2.objId,
			{ header: obj2.header.length, segs: obj2.segs.length }));
		// we send only header here, but we may send some segment bytes as well
		const rep = await doBinaryRequest<void>(opts, obj2.header);
		expect(rep.status).toBe(api.SC.ok, 'status for successful writing of segments bytes');

		// following requests
		for (let offset=0; offset<obj2.segs.length; offset+=512) {
			opts.url = resolveUrl(deliveryUrl, api.secondPutReqUrlEnd(obj2.objId,
				{ ofs: offset }));
			const chunk = obj2.segs.subarray(offset, offset + 512);
			const rep = await doBinaryRequest<void>(opts, chunk);
			expect(rep.status).toBe(api.SC.ok, 'status for successful writing of segments bytes');
		}

	});

	itAsync(`writes object in several appending requests`, async () => {
		// first request, to start appending transmission
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(deliveryUrl, api.firstPutReqUrlEnd(obj2.objId,
			{ header: obj2.header.length, append: true }));
		// we send only header here, but we may send some segment bytes as well
		let rep = await doBinaryRequest<void>(opts, obj2.header);
		expect(rep.status).toBe(api.SC.ok, 'status for successful writing of segments bytes');

		// following requests
		for (let offset=0; offset<obj2.segs.length; offset+=512) {
			const last = ((offset + 512) >= obj2.segs.length);
			opts.url = resolveUrl(deliveryUrl, api.secondPutReqUrlEnd(obj2.objId,
				{ append: true }));
			const chunk = obj2.segs.subarray(offset, offset + 512);
			const rep = await doBinaryRequest<void>(opts, chunk);
		}

	});
	
	itAsync(`should not work, if metadata hasn't been sent, yet`, async () => {
		const opts = copy(fstReqOpts);
		opts.sessionId = (await startMsgDeliverySession(
			deliveryUrl, { recipient: user2.id })).sessionId;
		let rep = await doBinaryRequest<void>(opts, obj1.header);
		expect(rep.status).toBe(ERR_SC.earlyReq, 'status for sending object bytes before sending message metadata');
		opts.url = sndReqOpts.url;
		rep = await doBinaryRequest<void>(opts, obj1.header);
		expect(rep.status).toBe(ERR_SC.earlyReq, 'status for sending object bytes before sending message metadata');
	});

	itAsync('will not accept bad type', async () => {
		await expectNonAcceptanceOfBadType(fstReqOpts, 'application/octet-stream', obj1.segs);
		await expectNonAcceptanceOfBadType(sndReqOpts, 'application/octet-stream', obj1.segs);
	});
	
	itAsync('requires messagedelivery session', async () => {
		await expectNonAcceptanceOfBadSessionId(fstReqOpts, true);
		await expectNonAcceptanceOfBadSessionId(sndReqOpts, true);
	});

});

Object.freeze(exports);