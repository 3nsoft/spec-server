/*
 Copyright (C) 2017 3NSoft Inc.
 
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

import { startSession, SpecDescribe, TestSetup, User, StorageComponent }
	from '../test-utils';
import { currentObj as api, ERR_SC }
	from '../../../../../lib-common/service-api/3nstorage/owner';
import { beforeEachAsync, itAsync }
	from '../../../../libs-for-tests/async-jasmine';
import { RequestOpts, doBinaryRequest }
	from '../../../../libs-for-tests/xhr-utils';
import { Obj, getSessionParams } from '../../../../libs-for-tests/3nstorage';
import { expectNonAcceptanceOfBadSessionId,
	expectNonAcceptanceOfBadType, expectNonAcceptanceOfLongBody }
	from '../../../../shared-checks/requests';
import { bytes as randomBytes } from '../../../../../lib-common/random-node';
import { utf8 } from '../../../../../lib-common/buffer-utils';
import { resolve as resolveUrl } from 'url';
import { copy } from '../../../../libs-for-tests/json-copy';

export const specs: SpecDescribe[] = [];

const description = `Request to save non-root object`;

const objV1: Obj = {
	objId: 'aaaa',
	version: 1,
	header: randomBytes(100),
	segs: randomBytes(2345)
};
const objV5: Obj = {
	objId: objV1.objId,
	version: 5,	// recording 5-th version after the 1-st shows version leap
	header: randomBytes(110),
	segs: randomBytes(6543)
};

let fstReqOpts: RequestOpts;
let sndReqOpts: RequestOpts;
let storageServer: StorageComponent;
let user: User;
let sessionId: string;

async function setupSession(
		setup: () => TestSetup): Promise<void> {
	storageServer = setup().storageServer;
	user = setup().user;
	await storageServer.restartAndClearStorageFor(user.id);
	sessionId = await startSession(user);
	fstReqOpts = {
		url: resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
			objV1.objId, { ver: 1, header: objV1.header.length, segs: objV1.segs.length })),
		method: 'PUT',
		responseType: 'json',
		sessionId
	};
	sndReqOpts = {
		url: resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
			objV1.objId, { trans: 'some-trans' })),
		method: 'PUT',
		responseType: 'json',
		sessionId
	};
}

const fuzzingSpec: SpecDescribe = { description };
specs.push(fuzzingSpec);
fuzzingSpec.definition = (setup: () => TestSetup) => (() => {
	
	let maxChunkSize: number;

	beforeEachAsync(async () => {
		await setupSession(setup);
		const params = await getSessionParams(user.storageOwnerUrl, sessionId);
		maxChunkSize = params.maxChunkSize;
	});

	itAsync('fails for unknown object, in initial put request', async () => {
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
			'unknown-obj',
			{ ver: 67, header: objV1.header.length, segs: objV1.segs.length }));
		const rep = await doBinaryRequest<any>(opts, [ objV1.header, objV1.segs ]);
		expect(rep.status).toBe(api.SC.unknownObj, 'status for unknown object');
	});

	itAsync('fails for unknown object, in secondary put request', async () => {
		const opts = copy(sndReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
			'unknown-obj', { trans: 'some-trans', ofs: 0 }));
		const rep = await doBinaryRequest<any>(opts, objV1.segs);
		expect(rep.status).toBe(api.SC.unknownObj, 'status for unknown object');
	});

	itAsync('fails for incorrect transaction, in secondary put', async () => {
		const repToFstReq = await doBinaryRequest<api.ReplyToPut>(
			fstReqOpts, objV1.header);
		expect(repToFstReq.status).toBe(api.SC.okPut);
		const trans = repToFstReq.data.transactionId + ' - unknown';
		const opts = copy(sndReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
			objV1.objId, { trans, ofs: 0 }));
		const rep = await doBinaryRequest<any>(opts, objV1.segs);
		expect(rep.status).toBe(api.SC.unknownTransaction, 'status for unknown transaction');
	});

	itAsync('will not accept bad type', async () => {
		await expectNonAcceptanceOfBadType(fstReqOpts, 'application/octet-stream', objV1.segs);
		await expectNonAcceptanceOfBadType(sndReqOpts, 'application/octet-stream', objV1.segs);
	});

	itAsync('will not work outside of a valid session', async () => {
		await expectNonAcceptanceOfBadSessionId(fstReqOpts);
		await expectNonAcceptanceOfBadSessionId(sndReqOpts);
	});

	itAsync('first request is limited by session parameter', async () => {
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
			objV1.objId,
			{ ver: objV1.version, header: 100, segs: maxChunkSize }));
		await expectNonAcceptanceOfLongBody(opts, 'application/octet-stream',
			maxChunkSize+100);
	});

	itAsync('second request is limited by session parameter', async () => {
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
			objV1.objId, { ver: objV1.version, header: objV1.header.length, segs: maxChunkSize }));
		const rep = await doBinaryRequest<api.ReplyToPut>(opts, objV1.header);
		const trans = rep.data.transactionId!;
		opts.url = resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
			objV1.objId, { trans, ofs: 0, last: true }));
		await expectNonAcceptanceOfLongBody(opts, 'application/octet-stream',
			maxChunkSize);
	});

});

const specsForNonDiffSending: SpecDescribe = {
	description: `${description}, non-diff version,`
};
specs.push(specsForNonDiffSending);
specsForNonDiffSending.definition = (setup: () => TestSetup) => (() => {
	
	beforeEachAsync(() => setupSession(setup));

	itAsync(`writes whole object in one request`, async () => {
		expect(await storageServer.currentObjExists(user.id, objV1.objId)).toBeFalsy('initially, there is no object');

		// create object
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
			objV1.objId,
			{ ver: objV1.version, header: objV1.header.length, segs: objV1.segs.length }));
		let rep = await doBinaryRequest<api.ReplyToPut>(opts, [ objV1.header, objV1.segs ]);
		expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
		expect(rep.data.transactionId).toBeUndefined();
		expect(await storageServer.currentObjExists(user.id, objV1.objId, objV1.version, objV1)).toBeTruthy('first version of object is present on the server');
		
		// upload object's next version
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
			objV5.objId,
			{ ver: objV5.version, header: objV5.header.length, segs: objV5.segs.length }));
		rep = await doBinaryRequest<api.ReplyToPut>(opts, [ objV5.header, objV5.segs ]);
		expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
		expect(rep.data.transactionId).toBeUndefined();
		expect(await storageServer.currentObjExists(user.id, objV5.objId, objV5.version, objV5)).toBeTruthy('fifth version of object is present on the server');
		
		// returns current version, when trying to upload incorrect version,
		// like uploading existing version, or smaller
		const errRep = await doBinaryRequest<api.MismatchedObjVerReply>(opts, [ objV5.header, objV5.segs ]);
		expect(errRep.status).toBe(api.SC.mismatchedObjVer, 'status for mismatched upload version');
		expect(errRep.data.current_version).toBe(objV5.version, 'current object version on server');

	});

	itAsync(`writes object in several non-appending requests`, async () => {
		expect(await storageServer.currentObjExists(user.id, objV1.objId)).toBeFalsy('initially, there is no object');

		// create object
		// first request, to start non-appending transmission
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
			objV1.objId,
			{ ver: objV1.version, header: objV1.header.length, segs: objV1.segs.length }));
		let rep = await doBinaryRequest<api.ReplyToPut>(opts, objV1.header);
		expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
		expect(typeof rep.data.transactionId).toBe('string');
		let transactionId = rep.data.transactionId!;
		expect(await storageServer.transactionExists(user.id, objV1.objId, transactionId)).toBeTruthy(`transaction should be open, cause not all bytes have been sent in the first request`);
		expect(await storageServer.currentObjExists(user.id, objV1.objId, objV1.version)).toBeFalsy('upload is not complete, as transaction is not closed');

		// following requests
		for (let offset=0; offset<objV1.segs.length; offset+=512) {
			const last = ((offset + 512) >= objV1.segs.length);
			if (last) {
				opts.url = resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
					objV1.objId, { trans: transactionId, ofs: offset, last: true }));
				const chunk = objV1.segs.subarray(offset, offset + 512);
				const rep = await doBinaryRequest<api.ReplyToPut>(opts, chunk);
				expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
				expect(rep.data.transactionId).toBeUndefined();
			} else {
				opts.url = resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
					objV1.objId, { trans: transactionId, ofs: offset }));
				const chunk = objV1.segs.subarray(offset, offset + 512);
				const rep = await doBinaryRequest<api.ReplyToPut>(opts, chunk);
				expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
				expect(rep.data.transactionId).toBe(transactionId);
			}
		}
		expect(await storageServer.currentObjExists(user.id, objV1.objId, objV1.version, objV1)).toBeTruthy('first version of object is present on the server');

	});

	itAsync(`writes object in several appending requests`, async () => {
		expect(await storageServer.currentObjExists(user.id, objV1.objId)).toBeFalsy('initially, there is no object');

		// create object
		// first request, to start appending transmission
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
			objV1.objId,
			{ ver: objV1.version, header: objV1.header.length, append: true }));
		let rep = await doBinaryRequest<api.ReplyToPut>(opts, objV1.header);
		expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
		expect(typeof rep.data.transactionId).toBe('string');
		let transactionId = rep.data.transactionId!;
		expect(await storageServer.transactionExists(user.id, objV1.objId, transactionId)).toBeTruthy(`transaction should be open, cause not all bytes have been sent in the first request`);
		expect(await storageServer.currentObjExists(user.id, objV1.objId, objV1.version)).toBeFalsy('upload is not complete, as transaction is not closed');

		// following requests
		for (let offset=0; offset<objV1.segs.length; offset+=512) {
			const last = ((offset + 512) >= objV1.segs.length);
			if (last) {
				opts.url = resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
					objV1.objId, { trans: transactionId, append: true, last: true }));
				const chunk = objV1.segs.subarray(offset, offset + 512);
				const rep = await doBinaryRequest<api.ReplyToPut>(opts, chunk);
				expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
				expect(rep.data.transactionId).toBeUndefined();
			} else {
				opts.url = resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
					objV1.objId, { trans: transactionId, append: true }));
				const chunk = objV1.segs.subarray(offset, offset + 512);
				const rep = await doBinaryRequest<api.ReplyToPut>(opts, chunk);
				expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
				expect(rep.data.transactionId).toBe(transactionId);
			}
		}
		expect(await storageServer.currentObjExists(user.id, objV1.objId, objV1.version, objV1)).toBeTruthy('first version of object is present on the server');

	});

});

const diffVer: Obj = {
	objId: objV1.objId,
	version: objV1.version + 1,
	header: randomBytes(111),
	segs: randomBytes(1000),
	diff: {
		baseVersion: 1,
		segsSize: 1200,
		sections: [
			[ 0, 25, 100 ],
			[ 1, 0, 300 ],
			[ 0, 125, 100 ],
			[ 1, 300, 700 ] ]
	}
};

const specsForDiffTransaction: SpecDescribe = {
	description: `${description}, diff version,`
};
specs.push(specsForDiffTransaction);
specsForDiffTransaction.definition = (setup: () => TestSetup) => (() => {
	
	beforeEachAsync(async () => {
		await setupSession(setup);
		// upload first object version
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
			objV1.objId,
			{ ver: objV1.version, header: objV1.header.length, segs: objV1.segs.length }));
		await doBinaryRequest<api.ReplyToPut>(opts, [ objV1.header, objV1.segs ]);
	});


	itAsync(`writes whole object in one request`, async () => {
		expect(await storageServer.currentObjExists(user.id, objV1.objId, objV1.version)).toBeTruthy('initially, there is only first version of an object');

		const diffBytes = utf8.pack(JSON.stringify(diffVer.diff));

		// upload object's next version
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
			diffVer.objId,
			{ ver: diffVer.version, diff: diffBytes.length, header: diffVer.header.length, segs: diffVer.segs.length }));
		const rep = await doBinaryRequest<api.ReplyToPut>(opts, [ diffBytes, diffVer.header, diffVer.segs ]);
		expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
		expect(rep.data.transactionId).toBeUndefined();
		expect(await storageServer.currentObjExists(user.id, diffVer.objId, diffVer.version, diffVer)).toBeTruthy('second version of object is present on the server');

	});

	itAsync(`writes object in several appending requests`, async () => {
		expect(await storageServer.currentObjExists(user.id, objV1.objId, objV1.version)).toBeTruthy('initially, there is only first version of an object');

		const diffBytes = utf8.pack(JSON.stringify(diffVer.diff));

		// first request, to start appending transmission
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
			diffVer.objId,
			{ ver: diffVer.version, diff: diffBytes.length, header: diffVer.header.length, append: true }));
		let rep = await doBinaryRequest<api.ReplyToPut>(opts, [ diffBytes, diffVer.header ]);
		expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
		expect(typeof rep.data.transactionId).toBe('string');
		let transactionId = rep.data.transactionId!;
		expect(await storageServer.transactionExists(user.id, diffVer.objId, transactionId)).toBeTruthy(`transaction should be open, cause not all bytes have been sent in the first request`);
		expect(await storageServer.currentObjExists(user.id, diffVer.objId, diffVer.version)).toBeFalsy('upload is not complete, as transaction is not closed');

		// following requests
		for (let offset=0; offset<diffVer.segs.length; offset+=256) {
			const last = ((offset + 256) >= diffVer.segs.length);
			if (last) {
				opts.url = resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
					diffVer.objId, { trans: transactionId, append: true, last: true }));
				const chunk = diffVer.segs.subarray(offset, offset + 256);
				const rep = await doBinaryRequest<api.ReplyToPut>(opts, chunk);
				expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
				expect(rep.data.transactionId).toBeUndefined();
			} else {
				opts.url = resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
					diffVer.objId, { trans: transactionId, append: true }));
				const chunk = diffVer.segs.subarray(offset, offset + 256);
				const rep = await doBinaryRequest<api.ReplyToPut>(opts, chunk);
				expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
				expect(rep.data.transactionId).toBe(transactionId);
			}
		}
		expect(await storageServer.currentObjExists(user.id, diffVer.objId, diffVer.version, diffVer)).toBeTruthy('diff version of object is present on the server');

	});
		
});

Object.freeze(exports);