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


import { afterAllAsync, beforeAllAsync }
	from '../../libs-for-tests/async-jasmine';
import { ASMailComponent } from '../../libs-for-tests/server-components/asmail';
import { User } from '../../libs-for-tests/mailerid';
import { p } from '../../../lib-common/service-api/asmail/config';
import { setInboxParams, generateInitPubKey }
	from '../../libs-for-tests/asmail';
import { resolve } from 'path';
import { addSpecsFrom } from '../../libs-for-tests/spec-assembly';

const SPECS_FOLDER = resolve(__dirname, './delivery/specs');

describe('ASMail delivery service', () => {
	
	let asmailServer: ASMailComponent;
	const midServiceDomain = 'localhost';
	const signupDomains = [ 'company.inc', 'personal.net' ];
	let user1: User;
	let user2: User;
	
	beforeAllAsync(async () => {
		asmailServer = new ASMailComponent(signupDomains, midServiceDomain);
		await asmailServer.start();
		user1 = await asmailServer.addUser(`Bob Johnson @${signupDomains[0]}`);
		user2 = await asmailServer.addUser(`William Young @${signupDomains[1]}`);
		const user2Params = <any> {};
		user2Params[p.initPubKey.URL_END] = await generateInitPubKey(
			asmailServer.midUrl, user2);
		await setInboxParams(asmailServer.asmailUrl, user2, user2Params);
	});
	
	afterAllAsync(async () => {
		await asmailServer.stop();
		asmailServer = (undefined as any);
	});
	
	addSpecsFrom(SPECS_FOLDER, () => ({ asmailServer, user1, user2 }));
	
});