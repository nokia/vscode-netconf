/*
  @author Sven Wisotzky
  
  © 2023 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

'use strict';

import {EventEmitter} from 'events';
import * as ssh2 from 'ssh2';
import {XMLParser, XMLBuilder} from 'fast-xml-parser';

export class ncclient extends EventEmitter {
	client: ssh2.Client;
	rawbuf: string;
	msgbuf: string;
	bytes: number;
	ncs: any;
	caplist: string[];
	callbacks: any;
	timestamp: any;
	connected: boolean;
	privkey: string | undefined;
	clientCapabilities: string[];
	base11Framing: boolean;

	constructor () {
		console.debug('ncclient:constructor()');
		super();

		this.client = new ssh2.Client();
		this._registerCallbacks();

		this.connected = false;
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
	}

	private _registerCallbacks() {
		this.client.on('error', (err: Error & ssh2.ClientErrorExtensions) => {
			console.error('ssh error');
			this.emit('error', 'SSH ERROR', err.toString());
		});

		this.client.on('connect', () => {
			console.log('ssh connect');
		});

		this.client.on('timeout', () => {
			console.error('ssh timeout');
		});

		this.client.on('close', () => {
			console.error('ssh close');
			this.emit('disconnected');
			this.connected = false;
			this.rawbuf = "";
			this.msgbuf = "";
			this.bytes = 0;
			this.ncs = null;
			this.caplist = [];
			this.base11Framing = false;
		});

		this.client.on('end', () => {
			console.log('ssh end');
		});

		this.client.on('banner', (message: string) => {
			this.emit('sshBanner', message);
		});

		this.client.on('greeting', (message: string) => {
			this.emit('sshGreeting', message);
		});

		this.client.on('ready', () => {
			console.log('ssh2 session is ready');

			this.client.subsys('netconf', (err: Error | undefined, stream: ssh2.ClientChannel) => {
				if (err) {
					console.error('error occured '+err.toString())
				} else {
					console.log('netconf subsystem is ready');
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
		const data = new XMLParser(options).parse(msg);

		if (data===null) {
			return this.emit('netconfError', 'Invalid XML', msg);
		}

		if (data.hello) {
			if (this.connected) {
				// Note: we are already connected; there should be no second hello-message
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
					console.log('[base:1.1] rfc6242 ch4.2 Chunked Framing');
					this.base11Framing = true;
				} else if (this.clientCapabilities.includes('urn:ietf:params:netconf:base:1.0') && serverCapabilities.includes('urn:ietf:params:netconf:base:1.0')) {
					console.log('[base:1.0] rfc6242 ch4.3 End-of-Message Framing');
					this.base11Framing = false;
				} else {
					console.error('[rfc6242] netconf-over-ssh framing incompatible')
					this.emit('netconfError', 'NETCONF capabilities incompatible', msg);
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
				return this.emit('connected', msg, this.caplist, sessionId);
			}
		} else if (!this.connected) {
			// Note: we are not yet connected; first server message must be <hello>
			this.emit('netconfError', 'expecting <hello> message', msg);
			return this.disconnect();
		} else if (data.notification) {
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
				if (Array.isArray(data['rpc-reply']['rpc-error'])) {
					errmsg = 'Multiple RPC errors';
				} else {
					errmsg = data['rpc-reply']['rpc-error']['error-message'].trim();
				}
				this.emit('rpcError', msgid, errmsg, msg, elapsed);
			} else if (msgid) {
				if (this.callbacks[msgid])
					this.callbacks[msgid](msgid, msg);

				if ('ok' in data['rpc-reply']) {
					this.emit('rpcOk', msgid, elapsed);
				} else {
					this.emit('rpcResponse', msgid, msg, elapsed);
				}
			} else {
				return this.emit('netconfError', 'rpc-reply w/o message-id received', msg);
			}

			if (msgid && this.callbacks[msgid]) delete this.callbacks[msgid];
			if (Object.keys(this.callbacks).length === 0) this.emit('idle');
		 } else {
			// Note: NETCONF server-message must be of type <hello>, <rpc-reply> or <notification>
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
				this.emit('error', 'base_1_1 error', 'chunk start not found');
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
		if (this.callbacks[msgid] != null) {
			this.emit('rpcTimeout', msgid);
			delete this.callbacks[msgid];
			if (Object.keys(this.callbacks).length === 0) this.emit('idle');
		}
		if (this.timestamp[msgid] != null) {
			delete this.timestamp[msgid];
		}
	}

	private _sshDebug(message: string) {
		console.debug("[ssh2]", message);
	}

	rpc(request: string, timeout: number = 300, callback: any = undefined) {
		if (this.connected) {
			this.emit('busy');
			const options = {
				attributeNamePrefix : "@_",
				ignoreAttributes: false,
				ignoreNameSpace: false,
				removeNSPrefix: true
			};
			const data = new XMLParser(options).parse(request);

			if (data['rpc']['@_message-id']) {
				const msgid = data['rpc']['@_message-id'];

				if (this.callbacks[msgid] != null) {
					return this.emit('error', 'NETCONF ERROR', 'message-id is already in-use');
				} else {
					this.callbacks[msgid] = callback;
					this.timestamp[msgid] = process.hrtime();
					setTimeout((() => this._msgTimeout(msgid)), timeout*1000);

					if (this.base11Framing) {
						this.ncs.write(`\n#${request.length}\n`);
						this.ncs.write(request);
						this.ncs.write('\n##\n');
					} else {
						this.ncs.write(request);
						this.ncs.write("]]>]]>");
					}
				}
			} else {
				return this.emit('error', 'NETCONF ERROR', 'message-id missing');
			}
		} else {
			return this.emit('error', 'NETCONF ERROR', 'client is not connected');
		}
	}

	lock() {
		console.debug("ncclient:lock()");
		if (this.connected) {
			const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="lock" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><lock><target><candidate/></target></lock></rpc>';
			this.rpc(request, 10,  (msgid : string, msg : string) => {
				console.debug(`#${msgid} ${msg}`);
				return this.emit('locked');
			});
		}
	}	

	unlock() {
		console.debug("ncclient:unlock()");
		if (this.connected) {
			const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="unlock" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><unlock><target><candidate/></target></unlock></rpc>';
			this.rpc(request, 10,  (msgid : string, msg : string) => {
				console.debug(`#${msgid} ${msg}`);
				return this.emit('unlocked');
			});
		}
	}
	
	closeSession() {
		console.debug('ncclient:closeSession()');
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

	connect(config: ssh2.ConnectConfig, sshKeepAlive: number | undefined, keyfile: string | undefined, clientCapabilities: string[] | undefined, sshdebug: boolean | undefined) {
		console.debug('ncclient:connect()');
		this.emit('busy');

		if (keyfile && !config.password && !config.privateKey) {
			if (keyfile.charAt(0)==="~") {
				keyfile = require('os').homedir+keyfile.substring(1);
			}
			try {
				config.privateKey = require('fs').readFileSync(keyfile).toString('utf-8');
			}
			catch (e) {
				if (typeof e === "string") {
					this.emit('error', 'SSH ERROR', "Can't load keys-file "+keyfile+"\n"+e);
				} else if (e instanceof Error) {
					this.emit('error', 'SSH ERROR', "Can't load keys-file "+keyfile+"\n"+e.message);
				}
			}
		}

		if (sshdebug) {
			// Enable Debugging
			config.debug = this._sshDebug;
		}

		if (sshKeepAlive) {
			// Enable SSH Session Keepalive (value in ms)
			config.keepaliveInterval = sshKeepAlive*1000;
		}

		if (clientCapabilities) {
			this.clientCapabilities = clientCapabilities;
		} else {
			this.clientCapabilities =  [
				"urn:ietf:params:netconf:base:1.0",
				"urn:ietf:params:netconf:base:1.1"
			];
		}

		try {
			this.client.connect(config);
		}
		catch (e) {
			if (typeof e === "string") {
				this.emit('error', 'SSH ERROR', e);
			} else if (e instanceof Error) {
				this.emit('error', 'SSH ERROR', e.message);
			}
		}
	}

	disconnect() {
		console.debug('ncclient:disconnect()');
		this.client.end();
	}
}