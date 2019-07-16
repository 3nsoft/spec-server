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

import { Envelope, EventEnvelope, EventEndEnvelope, EventException, events,
	RequestEnvelope, ReplyEnvelope }
	from '../service-api/ipc-api';
import { ErrorWithCause } from '../exceptions/error';
import { bind } from '../binding';
import { MapOfSets } from '../map-of-sets';
import { NamedProcs } from '../processes';

export { Envelope, EventEnvelope, EventEndEnvelope, EventException,
	RequestEnvelope, ReplyEnvelope }
	from '../service-api/ipc-api';

export type RequestHandler<TReq, TRes> = web3n.ipc.RequestHandler<TReq, TRes>;
export type RequestingClient = web3n.ipc.RequestingClient;
export type RequestServer = web3n.ipc.RequestServer;
export type EventfulServer = web3n.ipc.EventfulServer;
export type SubscribingClient = web3n.ipc.SubscribingClient;
export type Observer<T> = web3n.Observer<T>;

interface TransferrableError {
	name?: string;
	message: string;
	stack?: string;
	cause?: any;
}

type RuntimeException = web3n.RuntimeException;

function toTransferrableError(e: ErrorWithCause): TransferrableError {
	const err: TransferrableError = {
		message: e.message,
		name: e.name,
		stack: e.stack,
	};
	if (e.cause) {
		if ((typeof e.cause !== 'object') ||
				(e.cause as any as RuntimeException).runtimeException) {
			err.cause = e.cause;
		} else {
			err.cause = toTransferrableError(e.cause);
		}
	}
	return err;
}

export type RawDuplex<T> = web3n.ipc.RawDuplex<T>;

interface Deferred {
	resolve(result?: any): void;
	reject(cause: any): void;
	notify(progress: any): void;
}

abstract class MessageHandler {

	private detachFromComm: (() => void)|undefined;
	private onEndCBs: ((err?: any) => void)[]|undefined = undefined;

	protected constructor(
			public channel: string|undefined,
			public rawDuplex: RawDuplex<Envelope>) {
		this.detachFromComm = this.rawDuplex.subscribe({
			next: env => this.handleMsg(env),
			complete: () => this.handleCompletion(),
			error: err => this.handleCompletion(err)
		});
	}

	protected abstract handleMsg(env: Envelope): void;

	protected handleCompletion(err?: any): void {
		if (!this.detachFromComm) { return; }
		this.rawDuplex = (undefined as any);
		this.detachFromComm = undefined;
		if (this.onEndCBs) {
			for (const cb of this.onEndCBs) {
				try {
					cb(err);
				} catch (err2) {
					console.error(err2);
				}
			}
			this.onEndCBs = undefined;
		}
	}

	on(event: 'end', cb: (err?: any) => void): void {
		if (!this.onEndCBs) {
			this.onEndCBs = [];
		}
		this.onEndCBs.push(cb);
	}

	close() {
		if (!this.detachFromComm) { return; }
		this.detachFromComm();
		this.handleCompletion();
	}

}
Object.freeze(MessageHandler.prototype);
Object.freeze(MessageHandler);

class RequestingSide extends MessageHandler implements RequestingClient {

	private counter = 0;
	private replyDeferreds = new Map<number, Deferred>();
	
	constructor(channel: string|undefined, comm: RawDuplex<Envelope>) {
		super(channel, comm);
	}
	
	protected handleMsg(env: Envelope): void {
		if (!env || (env.type !== 'reply')) { return; }
		if (this.channel && !env.reqName.startsWith(this.channel)) { return; }
		const deferredReply = this.replyDeferreds.get(env.reqCount);
		if (!deferredReply) { return; }
		if (env.isInProgress) {
			deferredReply.notify(env.rep)
		} else {
			if (env.err) {
				deferredReply.reject(env.err);
			} else {
				deferredReply.resolve(env.rep);
			}
			this.replyDeferreds.delete(env.reqCount);
		}
	}

	protected handleCompletion(err?: any): void {
		super.handleCompletion(err);
		this.rejectAndClearPendingRequests();
	}
	
	/**
	 * This rejects all pending request, clearing internal containers.
	 */
	private rejectAndClearPendingRequests(): void {
		for (const reqNum of this.replyDeferreds.keys()) {
			if (isNaN(reqNum)) { continue; }
			const deferred = this.replyDeferreds.get(reqNum);
			if (!deferred) { continue; }
			deferred.reject(new Error('All pending requests are flushed.'));
		}
		this.replyDeferreds.clear();
	}

	makeRequest<T>(name: string, req: any,
			notifyCallback?: (progress: any) => void): Promise<T> {
		this.counter += 1;
		if (this.counter === Number.MAX_SAFE_INTEGER) {
			this.counter = Number.MIN_SAFE_INTEGER;
		}
		if (this.channel) {
			name = `${this.channel}/${name}`;
		}
		const envelope: RequestEnvelope<any> = {
			type: 'request',
			name,
			count: this.counter,
			req: req
		};
		const promise = new Promise<T>((resolve, reject) => {
			const deferredReply: Deferred = {
				resolve, reject,
				notify: (notifyCallback ? notifyCallback : () => {})
			}
			this.replyDeferreds.set(this.counter, deferredReply)
		});
		this.rawDuplex.postMessage(envelope);		
		return promise;
	}

	wrap(): RequestingClient {
		const w: RequestingClient = {
			makeRequest: this.makeRequest.bind(this),
			close: bind(this, this.close),
			on: bind(this, this.on)
		};
		return Object.freeze(w);
	}

}
Object.freeze(RequestingSide.prototype);
Object.freeze(RequestingSide);

export function makeRequestingClient(channel: string|undefined,
		comm: RawDuplex<Envelope>): RequestingClient {
	return (new RequestingSide(channel, comm)).wrap();
}

class ReplyingSide extends MessageHandler implements RequestServer {

	private requestHandlers = new Map<string, RequestHandler<any, any>>();

	constructor(channel: string|undefined, comm: RawDuplex<Envelope>) {
		super(channel, comm);
	}
	
	protected async handleMsg(req: Envelope): Promise<void> {
		if (!req || (req.type !== 'request')) { return; }
		if (this.channel && !req.name.startsWith(this.channel)) { return; }
		const handler = this.requestHandlers.get(req.name);
		let reply: ReplyEnvelope<any>;
		if (handler) {
			try {
				const result = await handler(req);
				reply = this.normalReply(req, result);
			} catch (err) {
				reply = this.errorReply(req, err);
			}
		} else {
			reply = this.errorReply(req, new Error(
				`Have no handler for request named ${req.name}`));
		}
		this.sendReply(req, reply);
	}

	protected handleCompletion(err?: any): void {
		super.handleCompletion(err);
		this.requestHandlers.clear();
	}
	
	notifyOfProgressOnRequest<T>(env: RequestEnvelope<any>, rep: T): void {
		const reply = this.normalReply(env, rep, true);
		this.sendReply(env, reply);
	}

	private sendReply(req: RequestEnvelope<any>, reply: ReplyEnvelope<any>):
			void {
		if (this.rawDuplex) {
			this.rawDuplex.postMessage(reply);
		} else {
			console.warn(`Fail to send reply to request ${req.name} #${req.count}, due to ipc point being already disconnected.`);
		}
	}

	private errorReply(env: RequestEnvelope<any>,
			err: Error|RuntimeException): ReplyEnvelope<any> {
		const reply: ReplyEnvelope<any> =  {
			type: 'reply',
			reqName: env.name,
			reqCount: env.count,
			rep: null
		};
		if ((err as RuntimeException).runtimeException) {
			reply.err = err;
		} else {
			reply.err = toTransferrableError(err as ErrorWithCause);
		}
		return reply;
	}

	private normalReply<T>(env: RequestEnvelope<any>, rep: T,
			isInProgress = false): ReplyEnvelope<any> {
		const reply: ReplyEnvelope<T> = {
			type: 'reply',
			reqName: env.name,
			reqCount: env.count,
			rep: rep,
		};
		if (isInProgress) {
			reply.isInProgress = true;
		}
		return reply;
	}
	
	/**
	 * @param reqName is a name of request, to be handled by a given handler
	 * @param handler handles requests that come from the other side
	 */
	addHandler(reqName: string, handler: RequestHandler<any, any>): void {
		if (typeof handler !== 'function') { throw new Error(
			`Given handler for request ${reqName} is not a function`); }
		if (this.channel) {
			reqName = `${this.channel}/${reqName}`;
		}
		const existingHandler = this.requestHandlers.get(reqName);
		if (existingHandler) { throw new Error(
			`Handler is already set for request ${reqName}`); }
		this.requestHandlers.set(reqName, handler);
	}

	wrap(): RequestServer {
		const w: RequestServer = {
			addHandler: bind(this, this.addHandler),
			notifyOfProgressOnRequest: bind(this, this.notifyOfProgressOnRequest),
			close: bind(this, this.close),
			on: bind(this, this.on)
		};
		return Object.freeze(w);
	}

}
Object.freeze(ReplyingSide.prototype);
Object.freeze(ReplyingSide);

export function makeRequestServer(channel: string|undefined,
		comm: RawDuplex<Envelope>): RequestServer {
	return (new ReplyingSide(channel, comm)).wrap();
}

function makeUnknownEventException(): EventException {
	return {
		runtimeException: true,
		type: 'events',
		unknownEvent: true
	};
}

type SubscriptionHandler = (eventChannel: string) => Promise<void>;
type UnsubscriptionHandler = (eventChannel: string) => void;
type GroupInfo = {
	name: string;
	subscribe: SubscriptionHandler;
	unsubscribe?: UnsubscriptionHandler;
}

class EventsSendingSide extends ReplyingSide {
	
	private subscriptionGroups: GroupInfo[] = [];
	private subscribedEvents = new Set<string>();

	constructor(channel: string|undefined, comm: RawDuplex<Envelope>) {
		super(channel, comm);
		this.addHandler(events.subscribe.REQ_NAME,
			bind(this, this.handleSubscribe));
		this.addHandler(events.unsubscribe.REQ_NAME,
			bind(this, this.handleUnsubscribe));
	}

	private findGroup(eventChannel: string): GroupInfo|undefined {
		for (const gr of this.subscriptionGroups) {
			if (eventChannel.startsWith(gr.name)) { return gr; }
		}
		return;
	}

	private async handleSubscribe(env: RequestEnvelope<string>): Promise<void> {
		const event = env.req;
		const gr = this.findGroup(event);
		if (!gr) { throw makeUnknownEventException(); }
		this.subscribedEvents.add(event);
		await gr.subscribe(event);
	}

	private handleUnsubscribe(env: RequestEnvelope<string>): void {
		const event = env.req;
		const gr = this.findGroup(event);
		if (!gr) { throw makeUnknownEventException(); }
		this.subscribedEvents.delete(event);
		if (gr.unsubscribe) {
			gr.unsubscribe(event);
		}
	}

	addEventGroup(group: string,
			subscriptionHandler: SubscriptionHandler,
			unsubscriptionHandler?: UnsubscriptionHandler): void {
		if (this.findGroup(group)) { throw new Error(
			`Event subscription group ${group} is already present`); }
		const gr: GroupInfo = {
			name: group,
			subscribe: subscriptionHandler,
			unsubscribe: unsubscriptionHandler
		};
		this.subscriptionGroups.push(gr);
	}

	sendEvent<T>(channel: string, event: T): void {
		if (!this.rawDuplex) { return; }
		if (!this.subscribedEvents.has(channel)) { return; }
		if (this.channel) {
			channel = `${this.channel}/${channel}`;
		}
		const eventEnv: EventEnvelope<T> = {
			type: 'event',
			channel,
			event
		};
		this.rawDuplex.postMessage(eventEnv);
	}

	endEvent(channel: string, err?: any): void {
		if (!this.subscribedEvents.has(channel)) { return; }
		this.subscribedEvents.delete(channel);
		if (this.channel) {
			channel = `${this.channel}/${channel}`;
		}
		const eventEnv: EventEndEnvelope = {
			type: 'event-end',
			channel,
			err: (err ? toTransferrableError(err) : undefined)
		};
		this.rawDuplex.postMessage(eventEnv);
	}

	protected handleCompletion(err?: any): void {
		super.handleCompletion(err);
		this.subscribedEvents.clear();
		this.subscriptionGroups = [];
	}

	wrap(): EventfulServer {
		const reqServer = super.wrap();
		const w: EventfulServer = {
			addHandler: reqServer.addHandler,
			notifyOfProgressOnRequest: reqServer.notifyOfProgressOnRequest,
			close: reqServer.close,
			on: reqServer.on,
			addEventGroup: bind(this, this.addEventGroup),
			sendEvent: bind(this, this.sendEvent),
			endEvent: bind(this, this.endEvent)
		};
		return Object.freeze(w);
	}

}
Object.freeze(EventsSendingSide.prototype);
Object.freeze(EventsSendingSide);

export function makeEventfulServer(channel: string|undefined,
		comm: RawDuplex<Envelope>): EventfulServer {
	return (new EventsSendingSide(channel, comm)).wrap();
}


class EventListener<T> {
	constructor(
			private channel: string,
			public observer: Observer<T>,
			public detach: () => void) {
		Object.freeze(this);
	}
	processNext(o: T): boolean {
		try {
			if (this.observer.next) {
				this.observer.next(o);
			}
			return true;
		} catch (err) {
			if (this.observer.error) {
				try {
					this.observer.error(err);
				} catch (err2) {
					console.error(`Error occured when handling event ${this.channel}:`);
					console.error(err.stack ? err.stack : JSON.stringify(err, null, '  '));
					console.error(`Followed by error in error handling callback:`);
					console.error(err2.stack ?
						err2.stack : JSON.stringify(err2, null, '  '));
				}
			} else {
				console.error(`Error occured when handling event ${this.channel}:`);
				console.error(err.stack ? err.stack : JSON.stringify(err, null, '  '));
			}
			return false;
		}
	}
}
Object.freeze(EventListener.prototype);
Object.freeze(EventListener);

class EventsReceivingSide extends RequestingSide implements SubscribingClient {

	/**
	 * This is a map from ipc channel name to all listeners on it.
	 * Note is that ipc channel is /-concatenation of this.channel and a channel
	 * name, to which listener is attached.
	 */
	private listeners = new MapOfSets<string, EventListener<any>>();

	private channels: IpcEventChannels;
	
	constructor(channel: string|undefined, comm: RawDuplex<Envelope>) {
		super(channel, comm);
		this.channels = new IpcEventChannels(
			(ipcChannel: string) =>
				this.makeRequest<void>(events.subscribe.REQ_NAME, ipcChannel)
				.catch(err => this.completeEvent(ipcChannel, err)),
			(ipcChannel: string) =>
				this.makeRequest<void>(events.unsubscribe.REQ_NAME, ipcChannel)
				.catch(err => {}));
	}

	protected handleMsg(env: Envelope): void {
		if (env.type === 'event') {
			this.handleEvent(env);
		} else if (env.type === 'event-end') {
			this.handleEventEnd(env);
		} else {
			super.handleMsg(env);
		}
	}

	private handleEvent(env: EventEnvelope<any>): void {
		if (this.channel && !env.channel.startsWith(this.channel)) { return; }
		const listeners = this.listeners.get(env.channel);
		if (!listeners) { return; }
		let detachCalls: (() => void)[]|undefined = undefined;
		for (const listener of listeners) {
			if (listener.processNext(env.event)) { continue; }
			if (!detachCalls) {
				detachCalls = [];
			}
			detachCalls.push(listener.detach);
		}
		if (detachCalls) {
			for(const detach of detachCalls) {
				detach();
			}
			if (!this.listeners.get(env.channel)) {
				this.channels.unsubscribeFrom(env.channel);
			}
		}
	}

	private handleEventEnd(env: EventEndEnvelope): void {
		if (this.channel && !env.channel.startsWith(this.channel)) { return; }
		this.completeEvent(env.channel);
	}

	/**
	 * This removes given event from subscription, and removes listeners,
	 * triggering onend's.
	 * @param channel event that has been unsubscribed
	 * @param err
	 */
	private completeEvent(ipcChannel: string, err?: any): void {
		const listeners = this.listeners.get(ipcChannel);
		if (!listeners) { return; }
		this.listeners.removeAll(ipcChannel);
		for (const listener of listeners) {
			try {
				if (err === undefined) {
					if (listener.observer.complete) {
						listener.observer.complete();
					}
				} else {
					if (listener.observer.error) {
						listener.observer.error(err);
					}
				}
			} catch (err2) {
				console.error(err2);
			}
		}
	}

	protected handleCompletion(err?: any): void {
		super.handleCompletion(err);
		this.listeners.clear();
	}

	subscribe<T>(channel: string, observer: Observer<T>): () => void {
		if (!observer.next && !observer.complete && !observer.error) {
			throw new Error(`Given observer has no methods for events/notifications`); }
		const ipcChannel = this.channel ? `${this.channel}/${channel}` : channel;
		const detach = (): void => {
			this.listeners.remove(ipcChannel, listener);
			if (!this.listeners.get(ipcChannel)) {
				this.channels.unsubscribeFrom(ipcChannel);
			}
		}
		const listener = new EventListener<T>(channel, observer, detach);
		this.listeners.add(ipcChannel, listener);
		this.channels.subscribeTo(ipcChannel);
		return detach;
	}

	wrap(): SubscribingClient {
		const reqClient = super.wrap();
		const w: SubscribingClient = {
			makeRequest: reqClient.makeRequest,
			close: reqClient.close,
			on: reqClient.on,
			subscribe: bind(this, this.subscribe)
		};
		return Object.freeze(w);
	}

}
Object.freeze(EventsReceivingSide.prototype);
Object.freeze(EventsReceivingSide);

class IpcEventChannels {

	/**
	 * These are all subscribed ipc channels.
	 */
	private subscribedIpcChannels = new Set<string>();

	private subscriptionProcs = new NamedProcs();

	constructor(
			private subscribe: (ipcChannel: string) => Promise<void>,
			private unsubscribe: (ipcChannel: string) => void) {
		Object.freeze(this);
	}

	subscribeTo(ipcChannel: string): void {
		if (this.subscribedIpcChannels.has(ipcChannel)) { return; }
		this.subscriptionProcs.startOrChain(ipcChannel, async () => {
			if (this.subscribedIpcChannels.has(ipcChannel)) { return; }
			this.subscribedIpcChannels.add(ipcChannel);
			await this.subscribe(ipcChannel);
		});
	}

	async unsubscribeFrom(ipcChannel: string): Promise<void> {
		if (!this.subscribedIpcChannels.has(ipcChannel)) { return; }
		this.subscriptionProcs.startOrChain(ipcChannel, async () => {
			if (!this.subscribedIpcChannels.has(ipcChannel)) { return; }
			this.subscribedIpcChannels.delete(ipcChannel);
			this.unsubscribe(ipcChannel);
		});
	}

}
Object.freeze(IpcEventChannels.prototype);
Object.freeze(IpcEventChannels);

export function makeSubscribingClient(channel: string|undefined,
		comm: RawDuplex<Envelope>): SubscribingClient {
	return (new EventsReceivingSide(channel, comm)).wrap();
}

export class MultiObserverWrap<T> {
	
	private isDone = false;
	private obs = new Set<Observer<T>>();
	
	get done(): boolean {
		return this.isDone;
	}

	constructor() {
		Object.seal(this);
	}

	add(obs: Observer<T>): () => void {
		if (this.isDone) { throw new Error(
			`Cannot add observer, as this source is already done`); }
		this.obs.add(obs);
		return () => { this.obs.delete(obs); };
	}
	
	next(o: T): void {
		if (this.isDone) { return; }
		for (const obs of this.obs) {
			if (!obs.next) { continue; }
			obs.next(o);
		}
	}
	
	error(err: any): void {
		if (this.isDone) { return; }
		for (const obs of this.obs) {
			if (!obs.error) { continue; }
			obs.error(err);
		}
		this.setDone();
	}

	complete(): void {
		if (this.isDone) { return; }
		for (const obs of this.obs) {
			if (!obs.complete) { continue; }
			obs.complete();
		}
		this.setDone();
	}
	
	private setDone(): void {
		this.obs.clear();
		this.isDone = true;
	}
}
Object.freeze(MultiObserverWrap.prototype);
Object.freeze(MultiObserverWrap);

export class SingleObserverWrap<T> {
	
	private isDone = false;
	private obs?: Observer<T> = undefined;
	
	get done(): boolean {
		return this.isDone;
	}

	constructor() {
		Object.seal(this);
	}

	set(obs: Observer<T>): void {
		if (this.isDone) { throw new Error(
			`Cannot add observer, as this source is already done`); }
		if (this.obs) { throw new Error(
			`Single observer is already set at this source`); }
		this.obs = obs;
	}

	detach = () => this.setDone();
	
	next(o: T): void {
		if (this.isDone || !this.obs) { return; }
		if (this.obs.next) {
			this.obs.next(o);
		}
	}
	
	error(err: any): void {
		if (this.isDone) { return; }
		if (this.obs && this.obs.error) {
			this.obs.error(err);
		}
		this.setDone();
	}

	complete(): void {
		if (this.isDone) { return; }
		if (this.obs && this.obs.complete) {
			this.obs.complete();
		}
		this.setDone();
	}
	
	private setDone(): void {
		this.obs = undefined;
		this.isDone = true;
	}
}
Object.freeze(SingleObserverWrap.prototype);
Object.freeze(SingleObserverWrap);

Object.freeze(exports);