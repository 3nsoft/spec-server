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

import { Component } from './component';
import { addUserIn } from './mailerid';
import { User } from '../pkl';
import { resolve as resolveUrl } from 'url';
import { getASMailServiceUrl } from '../asmail';
import * as fs from '../../../lib-common/async-fs-node';
import { addressToFName } from '../../../lib-server/resources/user-files';
import { Msg } from '../asmail';
import * as retrievalApi
	from '../../../lib-common/service-api/asmail/retrieval';
import { bytesEqual } from '../bytes-equal';
import { parseOpenObjFile } from '../../../lib-common/obj-file';

export class ASMailComponent extends Component {
	
	constructor(signupDomains: string[], public midServiceDomain: string) {
		super({
			rootFolder: (null as any),
			domain: midServiceDomain,
			signup: {
				domains: signupDomains
			},
			enabledServices: {
				mailerId: true,
				asmail: true
			},
			mailerId: {
				certs: (null as any)
			}
		});
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
		return `${this.conf.rootFolder}/users/${addressToFName(userId)}/mail`;
	}
	
	async msgExists(userId: string, msgId: string, deliveryComplete: boolean,
			msg?: Msg): Promise<boolean> {
		let meta: retrievalApi.msgMetadata.Reply
		let msgFolder = this.inboxFolder(userId) +
			(deliveryComplete ? '/messages/' : '/delivery/') + msgId;
		try {
			let metaFile = 'meta.json';
			meta = JSON.parse(await fs.readFile(
				msgFolder+'/'+metaFile, { encoding: 'utf8' }));
		} catch (exc) {
			if ((<fs.FileException> exc).notFound) { return false; }
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
			let fd = await fs.open(`${msgFolder}/${objId}`, 'r')
			.catch((exc: fs.FileException) => {
				if (exc.notFound) {
					fail(`missing file for object ${objId} in message ${msgId}`);
					return undefined;
				}
				throw exc;
			});
			if (fd === undefined) { return false; }
			try {
				// parse file
				const { headerOffset, segsOffset, diff, fileSize } =
					await parseOpenObjFile(fd);
				// check header
				let bytes = new Buffer(segsOffset - headerOffset);
				await fs.read(fd, headerOffset, bytes);
				expect(bytesEqual(bytes, obj.header)).toBeTruthy('header bytes must match');
				// check segments
				bytes = new Buffer(fileSize - segsOffset);
				await fs.read(fd, segsOffset, bytes);
				expect(bytesEqual(bytes, obj.segs)).toBeTruthy('segments bytes must match');
			} finally {
				await fs.close(fd);
			}
		}
		return true;
	}
	
}
Object.freeze(ASMailComponent.prototype);
Object.freeze(ASMailComponent);