/*
  @author Sven Wisotzky
  
  © 2025 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

'use strict';

import {Logger, ConsoleLogger} from './logger';
import {EventEmitter} from 'events';
import * as ssh2 from 'ssh2';
import {XMLValidator, XMLParser, XMLBuilder} from 'fast-xml-parser';
import xmlFormat from 'xml-formatter';

export type netconfCallback = (msgid: string, msg: string) => void;
export type passwordCallback = (host: string, username: string) => Thenable<string | undefined>;

export class ncclient extends EventEmitter {
	client: ssh2.Client;
	rawbuf: string;
	msgbuf: string;
	bytes: number;
	ncs: any;
	caplist: string[];
	callbacks: Record<string,  netconfCallback>;
	queryUserPassword: passwordCallback;
	timestamp: any;
	connected: boolean;
	privkey: string | undefined;
	clientCapabilities: string[];
	base11Framing: boolean;
	logger: Logger;

	private connectInfo: ssh2.ConnectConfig;

	constructor (logger: Logger|undefined = undefined) {
		super();

		if (logger)
			this.logger = logger.clone();
		else
			this.logger = new ConsoleLogger();

		this.rawbuf = "";
		this.msgbuf = "";
		this.bytes = 0;
		this.ncs = undefined;
		this.caplist = [];
		this.callbacks = {};
		this.timestamp = {};
		this.privkey = undefined;
		this.clientCapabilities = [];
		this.base11Framing = false;
		this.queryUserPassword = (host: string, username: string) => Promise.resolve(undefined);

		this.connected = false;
		this.connectInfo = {};
	
		this.client = new ssh2.Client();
		this._registerCallbacks();
	
		this.logger.debug('ncclient object created');
	}

	private _dumpXML(data: string): string {
		try {
			return '\n'+xmlFormat(data, {indentation: '  ', collapseContent: true, lineSeparator: '\n', whiteSpaceAtEndOfSelfclosingTag: true});
		} catch (e) {
			return `\n${data}`;
		}
	}

	private _registerCallbacks() {
		this.client.on('error', async (err: Error & ssh2.ClientErrorExtensions) => {
			if (err.toString().toLowerCase().includes('all configured authentication') && this.connectInfo.host && this.connectInfo.username) {
				this.logger.warn('Authentication failed. Ask user to enter password and retry!');
				this.connectInfo.password = await this.queryUserPassword(this.connectInfo.host, this.connectInfo.username);
				if (this.connectInfo.password) return this._connect();
			}

			this.emit('error', 'SSH ERROR', err.toString().replace(/^Error:/, '').trim());
		});

		this.client.on('connect', () => {
			this.logger.info('SSH CONNECT EVENT');
		});

		this.client.on('timeout', () => {
			this.logger.warn('SSH TIMEOUT EVENT');
		});

		this.client.on('close', () => {
			this.logger.info('SSH CLOSE EVENT');
			if (this.connected) {
				this.connected = false;
				// this.logger.setContext(undefined);
				this.rawbuf = "";
				this.msgbuf = "";
				this.bytes = 0;
				this.ncs = null;
				this.caplist = [];
				this.base11Framing = false;
				this.emit('disconnected');
			}
		});

		this.client.on('end', () => {
			this.logger.info('SSH END EVENT');
		});

		this.client.on('banner', (message: string) => {
			this.logger.info('SSH BANNER EVENT', message.trim());
			this.emit('sshBanner', message);
		});

		this.client.on('greeting', (message: string) => {
			this.logger.info('SSH GREETING EVENT', message.trim());
			this.emit('sshGreeting', message);
		});

		this.client.on('ready', () => {
			this.logger.info('SSH READY EVENT');
			// this.logger.setContext(`[${this.connectInfo.username}@${this.connectInfo.host}]`);
	
			this.client.subsys('netconf', (err: Error | undefined, stream: ssh2.ClientChannel) => {
				if (err) {
					this.emit('error', 'SSH ERROR', err.toString().replace(/^Error:/, '').trim());
					this.client.end();
				} else {
					this.logger.info('SSH subsystem netconf entered');
					this.ncs = stream;
					stream.on('data', (data: any) => {this._dataHandler(data)});
				}
			});
		});
	}

	private _msgHandler(msg: string) {
		const options = {
			attributeNamePrefix : "@_",
			ignoreAttributes: false,
			ignoreNameSpace: false,
			removeNSPrefix: true
		};

		const validationResult = XMLValidator.validate(msg);
		if (validationResult !== true) {
			const errmsg = `Malformed response, ${validationResult.err.code}, Details: ${validationResult.err.msg}`;
			this.logger.error('NETCONF ERROR', `${errmsg}\n${msg}`);
			return this.emit('netconfError', errmsg, msg);
		}

		const data = new XMLParser(options).parse(msg);
		if (data.hello) {
			if (this.connected) {
				// Note: we are already connected; there should be no second hello-message
				this.logger.error('NETCONF ERROR', 'unexpected <hello> message', this._dumpXML(msg));
				return this.emit('netconfError', 'unexpected <hello> message', msg);
			} else {
				const sessionId = data.hello['session-id'];
				const serverCapabilities = data.hello.capabilities.capability;
				this.caplist = [];
				if (serverCapabilities.includes('urn:ietf:params:netconf:base:1.0')) this.caplist.push('base:1.0');
				if (serverCapabilities.includes('urn:ietf:params:netconf:base:1.1')) this.caplist.push('base:1.1');
				if (serverCapabilities.includes('urn:ietf:params:netconf:capability:candidate:1.0')) this.caplist.push('candidate');
				if (serverCapabilities.includes('urn:ietf:params:netconf:capability:confirmed-commit:1.1')) this.caplist.push('confirmed-commit');
				if (serverCapabilities.includes('urn:ietf:params:netconf:capability:rollback-on-error:1.0')) this.caplist.push('rollback-on-error');
				if (serverCapabilities.includes('urn:ietf:params:netconf:capability:notification:1.0')) this.caplist.push('notification');
				if (serverCapabilities.includes('urn:ietf:params:netconf:capability:interleave:1.0')) this.caplist.push('interleave');
				if (serverCapabilities.includes('urn:ietf:params:netconf:capability:validate:1.0') ||
					serverCapabilities.includes('urn:ietf:params:netconf:capability:validate:1.1')) this.caplist.push('validate');
				if (serverCapabilities.includes('urn:ietf:params:netconf:capability:startup:1.0')) this.caplist.push('startup');
				if (serverCapabilities.includes('urn:ietf:params:netconf:capability:with-defaults:1.0')) this.caplist.push('with-defaults');
				if (serverCapabilities.includes('urn:ietf:params:netconf:capability:yang-library:1.1')) this.caplist.push('yang-library');
				if (serverCapabilities.includes('urn:ietf:params:xml:ns:yang:ietf-netconf-monitoring')) this.caplist.push('netconf-monitoring');
				if (serverCapabilities.includes('urn:ietf:params:xml:ns:yang:ietf-netconf-nmda?module=ietf-netconf-nmda')) this.caplist.push('netconf-nmda');

				if (this.clientCapabilities.includes('urn:ietf:params:netconf:base:1.1') && serverCapabilities.includes('urn:ietf:params:netconf:base:1.1')) {
					this.logger.info('Framing: [base:1.1] rfc6242 ch4.2 Chunked Framing');
					this.base11Framing = true;
				} else if (this.clientCapabilities.includes('urn:ietf:params:netconf:base:1.0') && serverCapabilities.includes('urn:ietf:params:netconf:base:1.0')) {
					this.logger.info('Framing: [base:1.0] rfc6242 ch4.3 End-of-Message Framing');
					this.base11Framing = false;
				} else {
					this.logger.error('NETCONF ERROR', 'netconf-over-ssh framing capabilities incompatible', this._dumpXML(msg));
					this.emit('netconfError', '[rfc6242] netconf-over-ssh framing capabilities incompatible', msg);
					return this.disconnect();
				}

				// Say hello to NETCONF server
				const hello = {
					"hello": {
						"@_xmlns": "urn:ietf:params:xml:ns:netconf:base:1.0",
						"capabilities": {
							"capability": this.clientCapabilities
						}
					}
				}
				const netconfHello = new XMLBuilder(options).build(hello);
				this.ncs.write(`<?xml version="1.0" encoding="UTF-8"?>\n${netconfHello}]]>]]>`);

				this.connected = true;
				this.logger.info(`Connection established, session-id=${sessionId}`, this._dumpXML(msg));
				this.logger.info('Server capabilities: ', this.caplist);
				return this.emit('connected', msg, this.caplist, sessionId);
			}
		} else if (!this.connected) {
			// Note: we are not yet connected; first server message must be <hello>
			this.logger.error('NETCONF ERROR', 'expecting <hello> message', this._dumpXML(msg));
			this.emit('netconfError', 'expecting <hello> message', msg);
			return this.disconnect();
		} else if (data.notification) {
			this.logger.info('netconf notification received', this._dumpXML(msg));
			return this.emit('notification', msg);
		} else if (data['rpc-reply']) {
			let msgid = undefined;
			if (data['rpc-reply']['@_message-id']) {
				msgid = data['rpc-reply']['@_message-id'];
			}

			let elapsed = undefined;
			if (msgid) {
				if (this.timestamp[msgid]) {
					const t = process.hrtime(this.timestamp[msgid]);
					if (t[0]>3600)
						elapsed = `${t[0]/3600|0}h ${(t[0]/60%60)|0}min ${t[0]%60}sec`;
					else if (t[0]>60)
						elapsed = `${t[0]/60|0}min ${t[0]%60}sec`;
					else  if (t[0]>0)
						elapsed = `${t[0]}sec ${t[1]/1000000|0}ms`;
					else
						elapsed = `${t[1]/1000000|0}ms`;
					delete this.timestamp[msgid];
				}
			}

			if ('rpc-error' in data['rpc-reply']) {
				let errmsg : string;
				const rpcError = data['rpc-reply']['rpc-error'];

				if (Array.isArray(rpcError)) {
					errmsg = 'Multiple RPC errors';
				} else {
					const entry = Object.entries(rpcError).find(([key, value]) => key.startsWith('error-message'));
					if (entry && typeof entry[1] === 'string')
						errmsg = entry[1].trim();
					else
						errmsg = "Unsupported Error Message Format";
				}
				this.logger.warn(`${msgid} RPC-ERROR received, time=${elapsed}`, this._dumpXML(msg));
				this.emit('rpcError', msgid, errmsg, msg, elapsed);
			} else if (msgid) {
				if (msgid in this.callbacks)
					this.callbacks[msgid](msgid, msg);

				if ('ok' in data['rpc-reply']) {
					this.logger.info(`${msgid} RPC-OK received, time=${elapsed}`, this._dumpXML(msg))				
					this.emit('rpcOk', msgid, elapsed);
				} else {
					this.logger.info(`${msgid} response received, time=${elapsed}`, this._dumpXML(msg))				
					this.emit('rpcResponse', msgid, msg, elapsed);
				}
			} else {
				this.logger.error('NETCONF ERROR', 'rpc-reply w/o message-id received', this._dumpXML(msg));
				return this.emit('netconfError', 'rpc-reply w/o message-id received', msg);
			}

			if (msgid && msgid in this.callbacks) delete this.callbacks[msgid];
			if (Object.keys(this.callbacks).length === 0) this.emit('idle');
		 } else {
			// Note: NETCONF server-message must be of type <hello>, <rpc-reply> or <notification>
			this.logger.error('NETCONF ERROR', 'unsupported message received', this._dumpXML(msg));
			return this.emit('netconfError', 'Unsupported message received', msg);
		}
	}

	private _dataHandler(data: any) {
		let chunk = data.toString('utf-8');

		// convert multi-byte unicode back to utf-8 single byte characters
		chunk = chunk.replace(/[\u00e0-\u00ef][\u0080-\u00bf][\u0080-\u00bf]/g, function(c: { charCodeAt: (arg0: number) => number; }) {
			// convert 3 byte characters
			const cc = ((c.charCodeAt(0) & 0x0f) << 12) | ((c.charCodeAt(1) & 0x3f) << 6) | (c.charCodeAt(2) & 0x3f);
			return String.fromCharCode(cc);
		}).replace(/[\u00c0-\u00df][\u0080-\u00bf]/g, function(c: { charCodeAt: (arg0: number) => number; }) {
			// convert 2 byte characters
			const cc = ((c.charCodeAt(0) & 0x1f) << 6) | (c.charCodeAt(1) & 0x3f);
			return String.fromCharCode(cc);
		});

		this.rawbuf += chunk;
		this.bytes += chunk.length;
		this.emit('data', this.bytes);

		if (this.base11Framing) {
			let pos = 0;
			while ((pos+3)<this.rawbuf.length) {
			  if (this.rawbuf.slice(pos, pos+4) === "\n##\n") {
				if (this.msgbuf.length>0) {
				  this._msgHandler(this.msgbuf);
				  this.msgbuf = "";
				}
				pos = pos+4;
			  } else if (this.rawbuf.slice(pos, pos+2) === "\n#") {
				const idx = this.rawbuf.indexOf("\n", pos+2);
				if (idx!==-1) {
				  const bytes = Number(this.rawbuf.slice(pos+2, idx));
				  if ((idx+1+bytes) <= this.rawbuf.length) {
					this.msgbuf += this.rawbuf.slice(idx+1, idx+1+bytes);
					pos = idx+1+bytes;
				  } else {
					break;  // need to wait for more bytes to come
				  }
				} else {
				  break;    // need to wait for more bytes to come
				}
			  } else {
				this.rawbuf = "";
				this.msgbuf = "";
				pos = 0;
				this.emit('error', 'BASE_1_1 FRAME ERROR', 'chunk start not found');
				return;
			  }
			}
			if (pos>0) {
			  // skip parts next time which are already copied to msgbuf
			  this.rawbuf = this.rawbuf.slice(pos);
			}
		} else {
			if (this.rawbuf.match("]]>]]>")) {
				const msgs = this.rawbuf.split("]]>]]>");
				this.rawbuf = msgs.pop() || "";
				for (const [idx, msg] of msgs.entries()) this._msgHandler(msg);
			}	
		}
	}

	private _msgTimeout(msgid: string ) {
		if (msgid in this.callbacks) {
			this.logger.error('ERROR', 'netconf-rpc timeout');
			this.emit('rpcTimeout', msgid);
			
			delete this.callbacks[msgid];
			if (Object.keys(this.callbacks).length === 0) this.emit('idle');
		}

		if (msgid in this.timestamp)
			delete this.timestamp[msgid];
	}

	private _sshDebug(message: string) {
		this.logger.debug("[ssh2]", message);
	}

	/**
	 * Executes NETCONF RPC on the connected NETCONF server
	 * 
	 * @param request Complete(!) NETCONF RPC request including `message-id` as XML string
	 * @param timeout How long to wait for the NETCONF response, default: 300s (5min)
	 * @param callback Callback to be triggered when the response comes back
	 * 
	 */

	rpc(request: string, timeout: number = 300, callback: netconfCallback) {
		this.logger.debug('ncclient:rpc()');

		if (!this.connected)
			return this.emit('error', 'NETCONF ERROR', 'Client is not connected');

		const options = {
			attributeNamePrefix : "@_",
			ignoreAttributes: false,
			ignoreNameSpace: false,
			removeNSPrefix: true
		};

		const validationResult = XMLValidator.validate(request);
		if (validationResult !== true)
			return this.emit('error', 'BAD REQUEST', `${validationResult.err.code}, ${validationResult.err.msg}`);

		this.logger.info('execute netconf rpc-request', this._dumpXML(request));

		const data = new XMLParser(options).parse(request);

		if (!('rpc' in data))
			return this.emit('error', 'BAD REQUEST', 'Missing: rpc');

		if (!('@_message-id' in data.rpc))
			return this.emit('error', 'BAD REQUEST', 'Missing: message-id');

		const msgid = data.rpc['@_message-id'];

		if (msgid in this.callbacks)
			return this.emit('error', 'BAD REQUEST', 'Message-id is already in-use');

		this.callbacks[msgid] = callback;
		this.timestamp[msgid] = process.hrtime();
		setTimeout((() => this._msgTimeout(msgid)), timeout*1000);
		this.emit('busy');

		if (this.base11Framing) {
			this.ncs.write(`\n#${request.length}\n`);
			this.ncs.write(request);
			this.ncs.write('\n##\n');
		} else {
			this.ncs.write(request);
			this.ncs.write("]]>]]>");
		}
	}

	/**
	 * Lock candidate datastore
	 */

	lock() {
		this.logger.debug('ncclient:lock()');
		if (this.connected) {
			const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="lock" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><lock><target><candidate/></target></lock></rpc>';
			this.rpc(request, 10,  (msgid : string, msg : string) => {
				this.logger.info('candidate datastore successfully locked');
				return this.emit('locked');
			});
		}
	}	

	unlock() {
		this.logger.debug('ncclient:unlock()');
		if (this.connected) {
			const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="unlock" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><unlock><target><candidate/></target></unlock></rpc>';
			this.rpc(request, 10,  (msgid : string, msg : string) => {
				this.logger.info('candidate datastore successfully unlocked');
				return this.emit('unlocked');
			});
		}
	}

	/**
	 * Close NETCONF session
	 */
	
	closeSession() {
		this.logger.debug('ncclient:closeSession()');
		if (this.connected) {
			this.emit('busy');
			const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="disconnect" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><close-session/></rpc>';
			if (this.base11Framing) {
				this.ncs.write(`\n#${request.length}\n`);
				this.ncs.write(request);
				this.ncs.write('\n##\n');
			} else {
				this.ncs.write(request);
				this.ncs.write("]]>]]>");
			}
			return setTimeout((() => this.disconnect()), 1000);			
		}
	}

	private _connect() {
		this.client.connect(this.connectInfo);
	}

	/**
	 * Connect to NETCONF server
	 * 
	 * @param {ssh2.ConnectConfig} config SSH2 Connection Information: host, port, username, password, ...
	 * @param {string} keyfile File to be used that stores the private keys
	 * @param {string[]} clientCapabilities Custom NETCONF capabilities to be sent as part of client hello message
	 * @param {boolean} sshdebug Used to enable/disable debugging for underlying SSH2 transport layer (debugging KEX errors, etc.)
	 * 
	 */

	connect(config: ssh2.ConnectConfig, keyfile: string | undefined, clientCapabilities: string[] | undefined, sshdebug: boolean | undefined, queryUserPassword : passwordCallback) {
		this.logger.debug('ncclient:connect()');

		if (this.connected)
			return this.emit('error', 'CLIENT ERROR', `Already connected to ${this.connectInfo.username}@${this.connectInfo.host}! Disconnect before establish a new connection!`);

		this.emit('busy');	

		if (keyfile && !config.password && !config.privateKey) {
			if (keyfile.charAt(0)==="~") {
				keyfile = require('os').homedir+keyfile.substring(1);
			}
			try {
				config.privateKey = require('fs').readFileSync(keyfile).toString('utf-8');
			}
			catch (e) {
				const errmsg = e instanceof Error ? e.message : String(e);
				this.emit('error', 'KEYFILE ERROR', errmsg.replace(/^[A-Z0-9]+:/, '').trim());
			}
		}

		// Enable Debugging
		if (sshdebug) config.debug = this._sshDebug;

		// Set Hello Capabilities for NETCONF Client
		if (clientCapabilities)
			this.clientCapabilities = clientCapabilities;
		else
			this.clientCapabilities = ["urn:ietf:params:netconf:base:1.0", "urn:ietf:params:netconf:base:1.1"];

		this.connectInfo = config;
		this.queryUserPassword = queryUserPassword;

		this._connect();
	}

	/**
	 * Disconnect from NETCONF server
	 */

	disconnect() {
		this.logger.debug('ncclient:disconnect()');
		this.client.end();
	}
}