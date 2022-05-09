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
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

/**
 * This module constructs memory-backed sessions factories.
 */

import { InMemorySessions } from '../../lib-server/resources/mem-backed-sessions-factory';
import { Request as Req, Factory, Session, GenerateSession as GenSession, wrapFactory } from '../../lib-server/resources/sessions';
import { bind } from '../../lib-common/binding';

export interface SessionParams {
	recipient: string;
	sender: string|undefined;
	invite: string|undefined;
	maxMsgLength: number;
	currentMsgLength: number;
	msgId: string;
}

export type Request = Req<SessionParams>;
export type GenerateSession = GenSession<SessionParams>;
export type GetSessionForMsg = (recipient: string, msgId: string) =>
	Promise<Session<SessionParams>|undefined>;

export interface SessionsFactory extends Factory<SessionParams> {
	getSessionForMsg: GetSessionForMsg;
}

export class DeliverySessions extends InMemorySessions<SessionParams>
		implements SessionsFactory {

	/**
	 * Keys of this map identify messages, and format is 'recipient:msgId'.
	 * Values are respective session ids.
	 */
	private msgToSessionMap = new Map<string, string>();

	private constructor(timeoutSecs: number) {
		super(timeoutSecs, sessionId => this.makeSessionParams(sessionId));
		Object.seal(this);
	}

	private makeSessionParams(sessionId: string): SessionParams {
		const factory = this;
		let msgId: string = (undefined as any);
		const sParams: SessionParams = {
			recipient: (undefined as any),
			currentMsgLength: 0,
			maxMsgLength: (undefined as any),
			invite: undefined,
			sender: undefined,
			get msgId(): string {
				return msgId;
			},
			set msgId(id: string) {
				if (msgId) { throw new Error(`Message is is already set`); }
				if (typeof sParams.recipient !== 'string') {
					throw new Error(`Recipient should be set in session before setting message id`); }
				msgId = id;
				factory.msgToSessionMap.set(
					`${sParams.recipient}:${msgId}`, sessionId);
			}
		};
		return Object.seal(sParams);
	}

	protected async remove(s: Session<SessionParams>): Promise<void> {
		await super.remove(s);
		this.msgToSessionMap.delete(`${s.params.recipient}:${s.params.msgId}`);
	}

	async getSessionForMsg(
		recipient: string, msgId: string
	): Promise<Session<SessionParams>|undefined> {
		const sessionId = this.msgToSessionMap.get(`${recipient}:${msgId}`);
		if (sessionId) {
			const session = await this.get(sessionId);
			if (session) {
				session.lastAccessedAt = Date.now();
				return session;
			} else {
				console.warn(`Inconsistency in session factory state: session to msg mapping exists, while session doesn't exist.`);
			}
		}
		return;
	}

	/**
	 * This returns factory, that works properly in a single process application,
	 * clearing up sessions that past given timeout.
	 * @param timeout is a session timeout in seconds
	 */
	static make(timeout: number): SessionsFactory {
		const factory = new DeliverySessions(timeout);
		const wrap = wrapFactory(factory) as SessionsFactory;
		wrap.getSessionForMsg = bind(factory, factory.getSessionForMsg);
		return Object.freeze(wrap);
	}

}
Object.freeze(DeliverySessions.prototype);
Object.freeze(DeliverySessions);

Object.freeze(exports);