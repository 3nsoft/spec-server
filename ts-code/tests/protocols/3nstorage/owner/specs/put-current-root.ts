/*
 Copyright (C) 2017, 2019, 2025 3NSoft Inc.
 
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

import { startSession, SpecDescribe, TestSetup, User, StorageComponent } from '../test-utils';
import { currentRootObj as api } from '../../../../../lib-common/service-api/3nstorage/owner';
import { beforeEachAsync, itAsync } from '../../../../libs-for-tests/async-jasmine';
import { RequestOpts, doBinaryRequest } from '../../../../libs-for-tests/xhr-utils';
import { Obj, getSessionParams, saveObj } from '../../../../libs-for-tests/3nstorage';
import { expectNonAcceptanceOfBadSessionId, expectNonAcceptanceOfBadType, expectNonAcceptanceOfLongBody } from '../../../../shared-checks/requests';
import { bytesSync as randomBytes } from '../../../../../lib-common/random-node';
import { utf8 } from '../../../../../lib-common/buffer-utils';
import { resolve as resolveUrl } from 'url';
import { copy } from '../../../../libs-for-tests/json-copy';

export const specs: SpecDescribe[] = [];

const description = `Request to save root object`;

const objV1: Obj = {
	objId: 'aaaa',
	version: 1,
	header: randomBytes(100),
	segs: randomBytes(2345)
};
const objV2: Obj = {
	objId: objV1.objId,
	version: objV1.version + 1,
	header: randomBytes(110),
	segs: randomBytes(6543)
};

let fstReqOpts: RequestOpts;
let sndReqOpts: RequestOpts;
let storageServer: StorageComponent;
let user: User;
let sessionId: string;

async function setupSession(setup: () => TestSetup): Promise<void> {
	storageServer = setup().storageServer;
	user = setup().user;
	await storageServer.restartAndClearStorageFor(user.id);
	sessionId = await startSession(user);
	fstReqOpts = {
		url: resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
			{ ver: 1, header: objV1.header.length })),
		method: 'PUT',
		responseType: 'json',
		sessionId
	};
	sndReqOpts = {
		url: resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
			{ trans: 'some-trans', ofs: 0 })),
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

	itAsync('fails for incorrect transaction, in secondary put', async () => {
		const repToFstReq = await doBinaryRequest<api.ReplyToPut>(
			fstReqOpts, objV1.header);
		expect(repToFstReq.status).toBe(api.SC.okPut);
		const trans = repToFstReq.data.transactionId + ' - unknown';
		const opts = copy(sndReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
			{ trans, ofs: 0 }));
		const rep = await doBinaryRequest<any>(opts, objV1.segs);
		expect(rep.status).withContext('status for unknown transaction').toBe(api.SC.unknownTransaction);
	});

	itAsync('fails write for incorrect version', async () => {
		await saveObj(
			user.storageOwnerUrl, sessionId, null, objV1.version, objV1);
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
			{ ver: objV1.version + 5, header: objV1.header.length }));
		const rep = await doBinaryRequest<api.MismatchedObjVerReply>(
			opts, [ objV1.header, objV1.segs ]);
		expect(rep.status).toBe(api.SC.mismatchedObjVer);
		expect(typeof rep.data).toBe('object');
		expect(rep.data.current_version).toBe(objV1.version);
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
			{ ver: objV1.version, header: 100, last: true }));
		await expectNonAcceptanceOfLongBody(opts, 'application/octet-stream',
			maxChunkSize+100);
	});

	itAsync('second request is limited by session parameter', async () => {
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
			{ ver: objV1.version, header: objV1.header.length }));
		const rep = await doBinaryRequest<api.ReplyToPut>(opts, objV1.header);
		const trans = rep.data.transactionId!;
		opts.url = resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
			{ trans, ofs: 0, last: true }));
		await expectNonAcceptanceOfLongBody(opts, 'application/octet-stream',
			maxChunkSize+100);
	});

});

const specsForNonDiffSending: SpecDescribe = {
	description: `${description}, non-diff version,`
};
specs.push(specsForNonDiffSending);
specsForNonDiffSending.definition = (setup: () => TestSetup) => (() => {
	
	beforeEachAsync(() => setupSession(setup));

	itAsync(`writes whole object in one request`, async () => {
		expect(await storageServer.currentRootObjExists(user.id)).withContext('initially, there is no object').toBeFalsy();

		// create object
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd({
			ver: objV1.version, header: objV1.header.length, last: true
		}));
		let rep = await doBinaryRequest<api.ReplyToPut>(
			opts, [ objV1.header, objV1.segs ]);
		expect(rep.status).withContext('status for successful writing of segments bytes').toBe(api.SC.okPut);
		expect(rep.data.transactionId).toBeUndefined();
		expect(await storageServer.currentRootObjExists(user.id, objV1.version, objV1)).withContext('first version of object is present on the server').toBeTruthy();

		// upload object's next version
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd({
			ver: objV2.version, header: objV2.header.length, last: true
		}));
		rep = await doBinaryRequest<api.ReplyToPut>(
			opts, [ objV2.header, objV2.segs ]);
		expect(rep.status).withContext('status for successful writing of segments bytes').toBe(api.SC.okPut);
		expect(rep.data.transactionId).toBeUndefined();
		expect(await storageServer.currentRootObjExists(user.id, objV2.version, objV2)).withContext('second version of object is present on the server').toBeTruthy();
		expect(await storageServer.rootTransactionExists(user.id)).toBeFalsy();

		// returns current version, when trying to upload incorrect version,
		// like uploading existing version, or smaller
		const errRep = await doBinaryRequest<api.MismatchedObjVerReply>(opts, [ objV2.header, objV2.segs ]);
		expect(errRep.status).withContext('status for mismatched upload version').toBe(api.SC.mismatchedObjVer);
		expect(errRep.data.current_version).withContext('current object version on server').toBe(objV2.version);

	});

	itAsync(`writes object in several requests`, async () => {
		expect(await storageServer.currentRootObjExists(user.id)).withContext('initially, there is no object').toBeFalsy();

		// first request, to start transmission
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd({
			ver: objV1.version, header: objV1.header.length
		}));
		let rep = await doBinaryRequest<api.ReplyToPut>(opts, objV1.header);
		expect(rep.status).withContext('status for successful writing of segments bytes').toBe(api.SC.okPut);
		expect(typeof rep.data.transactionId).toBe('string');
		let transactionId = rep.data.transactionId!;
		expect(await storageServer.rootTransactionExists(user.id, transactionId)).withContext(`transaction should be open, cause not all bytes have been sent in the first request`).toBeTruthy();
		expect(await storageServer.currentRootObjExists(user.id, objV1.version)).withContext('upload is not complete, as transaction is not closed').toBeFalsy();

		// following requests
		for (let offset=0; offset<objV1.segs.length; offset+=512) {
			const last = ((offset + 512) >= objV1.segs.length);
			if (last) {
				opts.url = resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
					{ trans: transactionId, ofs: offset, last: true }));
				const chunk = objV1.segs.subarray(offset, offset + 512);
				const rep = await doBinaryRequest<api.ReplyToPut>(opts, chunk);
				expect(rep.status).withContext('status for successful writing of segments bytes').toBe(api.SC.okPut);
				expect(rep.data.transactionId).toBeUndefined();
			} else {
				opts.url = resolveUrl(user.storageOwnerUrl, api.secondPutReqUrlEnd(
					{ trans: transactionId, ofs: offset }));
				const chunk = objV1.segs.subarray(offset, offset + 512);
				const rep = await doBinaryRequest<api.ReplyToPut>(opts, chunk);
				expect(rep.status).withContext('status for successful writing of segments bytes').toBe(api.SC.okPut);
				expect(rep.data.transactionId).toBe(transactionId);
			}
		}
		expect(await storageServer.currentRootObjExists(user.id, objV1.version, objV1)).withContext('first version of object is present on the server').toBeTruthy();
		expect(await storageServer.rootTransactionExists(user.id)).toBeFalsy();

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
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd({
			ver: objV1.version, header: objV1.header.length, last: true
		}));
		await doBinaryRequest<api.ReplyToPut>(opts, [ objV1.header, objV1.segs ]);
	});

	// XXX can't write general diff-ed object in one request.
	// fitAsync(`writes whole object in one request`, async () => {
	// 	expect(await storageServer.currentRootObjExists(user.id, objV1.version)).withContext('initially, there is only first version of an object').toBeTruthy();

	// 	const diffBytes = utf8.pack(JSON.stringify(diffVer.diff));

	// 	// upload object's next version
	// 	const opts = copy(fstReqOpts);
	// 	opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd(
	// 		{ ver: diffVer.version, diff: diffBytes.length, header: diffVer.header.length, segs: diffVer.segs.length }));
	// 	const rep = await doBinaryRequest<api.ReplyToPut>(opts, [ diffBytes, diffVer.header, diffVer.segs ]);
	// 	expect(rep.status).withContext('status for successful writing of segments bytes').toBe(api.SC.okPut);
	// 	expect(rep.data.transactionId).toBeUndefined();
	// 	expect(await storageServer.currentRootObjExists(user.id, diffVer.version, diffVer)).withContext('second version of object is present on the server').toBeTruthy();

	// });

	itAsync(`writes object in several requests`, async () => {
		expect(await storageServer.currentRootObjExists(user.id, objV1.version)).withContext('initially, there is only first version of an object').toBeTruthy();

		const diffBytes = utf8.pack(JSON.stringify(diffVer.diff));

		// first request, to start transmission
		const opts = copy(fstReqOpts);
		opts.url = resolveUrl(user.storageOwnerUrl, api.firstPutReqUrlEnd({
			ver: diffVer.version, diff: diffBytes.length,
			header: diffVer.header.length
		}));
		let rep = await doBinaryRequest<api.ReplyToPut>(opts, [ diffBytes, diffVer.header ]);
		expect(rep.status).toBe(api.SC.okPut, 'status for successful writing of segments bytes');
		expect(typeof rep.data.transactionId).toBe('string');
		let transactionId = rep.data.transactionId!;
		expect(await storageServer.rootTransactionExists(user.id, transactionId)).withContext(`transaction should be open, cause not all bytes have been sent in the first request`).toBeTruthy();
		expect(await storageServer.currentRootObjExists(user.id, diffVer.version)).withContext('upload is not complete, as transaction is not closed').toBeFalsy();

		// following requests
		let ofs = 0;
		for (let [ isNew, dvOfs, len ] of diffVer.diff!.sections) {
			if (isNew === 0) {
				ofs += len;
				continue;
			}
			const last = ((dvOfs + len) >= diffVer.segs.length);
			const delta = 256;
			for (let ofsInSection=0; ofsInSection<len; ofsInSection+=delta) {
				const chunk = diffVer.segs.subarray(
					dvOfs, dvOfs + Math.min(delta, len-ofsInSection));
				if (last && ((ofsInSection+delta) >= len)) {
					opts.url = resolveUrl(user.storageOwnerUrl,
						api.secondPutReqUrlEnd({
							trans: transactionId, ofs, last: true
						}));
					const rep = await doBinaryRequest<api.ReplyToPut>(opts, chunk);
					expect(rep.status).withContext('status for successful writing of segments bytes').toBe(api.SC.okPut);
					expect(rep.data.transactionId).toBeUndefined();
				} else {
					opts.url = resolveUrl(user.storageOwnerUrl,
						api.secondPutReqUrlEnd({ trans: transactionId, ofs }));
					const rep = await doBinaryRequest<api.ReplyToPut>(opts, chunk);
					expect(rep.status).withContext('status for successful writing of segments bytes').toBe(api.SC.okPut);
					expect(rep.data.transactionId).toBe(transactionId);
				}
				dvOfs += chunk.length;
				ofs += chunk.length;
			}
		}
		expect(await storageServer.currentRootObjExists(user.id, diffVer.version, diffVer)).withContext('diff version of object is present on the server').toBeTruthy();
		expect(await storageServer.rootTransactionExists(user.id)).toBeFalsy();

	});
		
});

Object.freeze(exports);