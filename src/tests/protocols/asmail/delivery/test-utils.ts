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

import { ASMailComponent }
	from '../../../libs-for-tests/server-components/asmail';
import { User } from '../../../libs-for-tests/mailerid';
import { GenericSpecDescribe } from '../../../libs-for-tests/spec-assembly';
import { bytesSync as randomBytes } from '../../../../lib-common/random-node';
import { Msg, Obj, DeliveryInfo, startMsgDelivery, sendMsgObj }
	from '../../../libs-for-tests/asmail';

export { ASMailComponent }
	from '../../../libs-for-tests/server-components/asmail';
export { User } from '../../../libs-for-tests/mailerid';

export interface TestSetup {
	asmailServer: ASMailComponent;
	user1: User;
	user2: User;
}

export type SpecDescribe = GenericSpecDescribe<TestSetup>;
	
export const obj1: Obj = {
	objId: 'aaaa',
	header: randomBytes(100),
	segs: randomBytes(573)
};
export const obj2: Obj = {
	objId: 'bbbb',
	header: randomBytes(100),
	segs: randomBytes(20*1024 + 7)
};
export const msg: Msg = {
	cryptoMeta: { pid: 'xxxx' },
	msgObjs: [ obj1, obj2 ]
}

export async function startSessionAndSendMsgObjs(deliveryUrl: string,
		recipient: string, msg: Msg): Promise<DeliveryInfo> {
	const sessInfo = await startMsgDelivery(deliveryUrl,
		{ recipient },
		{ pid: msg.cryptoMeta.pid,
			objIds: [ msg.msgObjs[0].objId, msg.msgObjs[1].objId ] });
	await sendMsgObj(deliveryUrl, sessInfo.sessionId, msg.msgObjs[0],
		sessInfo.maxChunkSize);
	await sendMsgObj(deliveryUrl, sessInfo.sessionId, msg.msgObjs[1],
		sessInfo.maxChunkSize);
	return sessInfo;
}

Object.freeze(exports);