/*
 Copyright (C) 2016 - 2017, 2019 - 2020 3NSoft Inc.
 
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

import { Component } from './component';
import { addUserIn } from './mailerid';
import { User } from '../pkl';
import { resolve as resolveUrl } from 'url';
import { getASMailServiceUrl } from '../asmail';
import * as fs from '../../../lib-common/async-fs-node';
import { Msg } from '../asmail';
import * as retrievalApi from '../../../lib-common/service-api/asmail/retrieval';
import { bytesEqual } from '../bytes-equal';
import { join } from 'path';
import { ObjVersionFile } from '../../../lib-common/objs-on-disk/obj-file';
import { joinByteArrs } from '../../../lib-common/buffer-utils';
import { userDataInRootFolder } from '../../../lib-server/resources/server-data-folders';

export class ASMailComponent extends Component {
	
	constructor(
		signupDomains: string[],
		public midServiceDomain: string
	) {
		super(
			{
				rootFolder: (null as any),
				domain: midServiceDomain,
				signup: {},
				enabledServices: {
					mailerId: true,
					asmail: true
				},
				mailerId: {
					certs: (null as any)
				}
			},
			signupDomains
		);
		Object.seal(this);
	}
	
	async addUser(userId: string, configureDNS = true): Promise<User> {
		if (configureDNS) { this.dns.configureFor(userId); }
		let user = await addUserIn(this.url, userId);
		user.midUrl = this.midUrl;
		return user;
	}
	
	get midUrl(): string {
		return resolveUrl(this.url, 'mailerid/');
	}
	
	get asmailUrl(): string {
		return resolveUrl(this.url, 'asmail/');
	}
	
	getConfUrl(): Promise<string> {
		return getASMailServiceUrl(this.asmailUrl, 'config');
	}
	
	getDeliveryUrl(): Promise<string> {
		return getASMailServiceUrl(this.asmailUrl, 'delivery');
	}
	
	getRetrievalUrl(): Promise<string> {
		return getASMailServiceUrl(this.asmailUrl, 'retrieval');
	}
	
	private inboxFolder(userId: string): string {
		return join(userDataInRootFolder(this.conf.rootFolder, userId), 'mail');
	}

	private msgFolder(
		userId: string, msgId: string, deliveryComplete: boolean
	): string {
		return join(this.inboxFolder(userId),
			(deliveryComplete ? 'messages' : 'delivery'), msgId);
	}
	
	// XXX adopt new file access
	async msgExists(userId: string, msgId: string, deliveryComplete: boolean,
			msg?: Msg): Promise<boolean> {
		let meta: retrievalApi.msgMetadata.Reply
		let msgFolder = this.msgFolder(userId, msgId, deliveryComplete);
		try {
			let metaFile = join(msgFolder, 'meta.json');
			meta = JSON.parse(await fs.readFile(metaFile, { encoding: 'utf8' }));
		} catch (exc) {
			if ((exc as fs.FileException).notFound) { return false; }
			else { throw exc; }
		}
		let extMeta = meta.extMeta;
		if (!deliveryComplete || ! msg) { return true; }

		// check meta
		if (msg.cryptoMeta.pid) {
			expect(extMeta.pid).toBe(msg.cryptoMeta.pid, 'correct key-pair id in meta');
		}
		if (msg.cryptoMeta.recipientKid) {
			expect(extMeta.recipientKid).toBe(msg.cryptoMeta.recipientKid, 'correct recipient key id in meta');
		}
		if (msg.cryptoMeta.senderPKey) {
			expect(extMeta.senderPKey).toBe(msg.cryptoMeta.senderPKey, 'correct sender\'s public key');
		}
		expect(extMeta.objIds.length).toBe(msg.msgObjs.length, 'correct number of message objects in meta');
		expect(Object.keys(meta.objs).length).toBe(msg.msgObjs.length, 'correct number of message object sizes in meta');
		
		for (let i=0; i < msg.msgObjs.length; i+=1) {
			// check meta info for each object
			let obj = msg.msgObjs[i];
			let objId = obj.objId!;
			expect(extMeta.objIds[i]).toBe(objId);
			expect(meta.objs[objId].size.header).toBe(obj.header.length, 'header length of a message object');
			expect(meta.objs[objId].size.segments).toBe(obj.segs.length, 'segments length of a message object');
			expect(meta.objs[objId].completed).toBe(true, 'completness flag of a message object');

			// check object file
			const filePath = join(msgFolder, objId);
			const file = await ObjVersionFile.forExisting(filePath)
			.catch((exc: fs.FileException) => {
				if (exc.notFound) { return undefined; }
				throw exc;
			});
			if (!file) { return false; }
			const headerInFile = await file.readHeader();
			if (!headerInFile
			|| !bytesEqual(headerInFile, obj.header)) { return false; }
			const segsInFile = joinByteArrs(
				await file.readSegs(0, file.getTotalSegsLen()));
			if (!bytesEqual(segsInFile, obj.segs)) { return false; }
		}

		return true;
	}
	
}
Object.freeze(ASMailComponent.prototype);
Object.freeze(ASMailComponent);
