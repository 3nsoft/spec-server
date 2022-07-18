/*
 Copyright (C) 2016, 2022 3NSoft Inc.
 
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

import { User, doMailerIdLogin } from '../../../libs-for-tests/mailerid';
import { resolve as resolveUrl } from 'url';
import * as api from '../../../../lib-common/service-api/3nstorage/owner';
import { StorageComponent } from '../../../libs-for-tests/server-components/3nstorage';
import { GenericSpecDescribe } from '../../../libs-for-tests/spec-assembly';
import { doBodylessRequest } from '../../../libs-for-tests/xhr-utils';
import { assert } from '../../../libs-for-tests/assert';

export { User } from '../../../libs-for-tests/mailerid';
export { StorageComponent } from '../../../libs-for-tests/server-components/3nstorage';

export interface TestSetup {
	user: User;
	storageServer: StorageComponent;
}

export type SpecDescribe = GenericSpecDescribe<TestSetup>;

export async function startSession(user: User): Promise<string> {
	return await doMailerIdLogin(
		resolveUrl(user.storageOwnerUrl, api.midLogin.MID_URL_PART),
		user);
}

export async function listArchived(
	user: User, objId: string|null, sessionId: string
): Promise<api.archiveObj.VersionsList> {
	const rep = await doBodylessRequest<api.archiveObj.VersionsList>({
		url: resolveUrl(user.storageOwnerUrl, (objId ?
			api.archiveObj.getReqUrlEnd(objId) : api.archiveRoot.getReqUrlEnd())),
		method: 'GET',
		sessionId,
		responseType: 'json'
	});
	assert(rep.status === api.archiveObj.SC.okGet, `Unexpected status ${rep.status} with data ${rep.data}, when listing archived versions of object ${objId}`);
	return rep.data;
}

export async function archiveObjVer(
	user: User, objId: string|null, version: number, sessionId: string
): Promise<void> {
	const rep = await doBodylessRequest<api.archiveObj.VersionsList>({
		url: resolveUrl(user.storageOwnerUrl, (objId ?
			api.archiveObj.postAndDelReqUrlEnd(objId, version) :
			api.archiveRoot.postAndDelReqUrlEnd(version))),
		method: 'POST',
		sessionId
	});
	assert(rep.status === api.archiveObj.SC.okPost, `Unexpected status ${rep.status} with data ${rep.data}, when archiving version ${version} of object ${objId}`);
}


Object.freeze(exports);