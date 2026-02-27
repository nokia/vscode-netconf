/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

'use strict';

import type { Logger } from '../common/logger';
import { ConsoleLogger } from '../common/console-logger';
import { EventEmitter } from 'events';

import * as fs from 'fs';
import * as os from 'os';
import * as ssh2 from 'ssh2';
import * as path from 'path';

import { XMLValidator, XMLParser, XMLBuilder } from 'fast-xml-parser';
import xmlFormat from 'xml-formatter';

export type netconfCallback = (msgid: string, msg: string) => void;
export type passwordCallback = (host: string, username: string) => Thenable<string | undefined>;

interface yangModuleBase {
  name: string;
  revision: string;
  location?: string;
}

interface yangModule extends yangModuleBase {
  namespace: string;
  submodule?: yangModuleBase[];
  feature?: string;
}

interface yangModuleSet {
  name: string;
  module: yangModule[];
  'import-only-module': yangModule[];
}

export type libraryCallback = (modules: yangModule[]) => void;
export type schemaCallback = (schema: string) => void;

export class ncclient extends EventEmitter {
  client: ssh2.Client;
  rawbuf: Buffer;
  msgbuf: string;
  bytes: number;
  ncs: ssh2.ClientChannel | undefined;
  caplist: string[];
  callbacks: Record<string, netconfCallback>;
  queryUserPassword: passwordCallback;
  timestamp: Record<string, [number, number]>;
  connected: boolean;
  privkey: string | undefined;
  clientCapabilities: string[];
  base11Framing: boolean;
  logger: Logger;

  requestId: number;
  sessionId: number;

  private connectInfo: ssh2.ConnectConfig;

  constructor(logger: Logger | undefined = undefined) {
    super();

    if (logger) this.logger = logger.clone();
    else this.logger = new ConsoleLogger();

    this.rawbuf = Buffer.alloc(0);
    this.msgbuf = '';
    this.bytes = 0;
    this.ncs = undefined;
    this.caplist = [];
    this.requestId = 0;
    this.sessionId = -1;
    this.callbacks = {};
    this.timestamp = {};
    this.privkey = undefined;
    this.clientCapabilities = [];
    this.base11Framing = false;
    this.queryUserPassword = (_host: string, _username: string) => Promise.resolve(undefined);

    this.connected = false;
    this.connectInfo = {};

    this.client = new ssh2.Client();
    this._registerCallbacks();

    this.logger.debug('ncclient object created');
  }

  private _dumpXML(data: string): string {
    try {
      return '\n' + xmlFormat(data, { indentation: '  ', collapseContent: true, lineSeparator: '\n', whiteSpaceAtEndOfSelfclosingTag: true });
    } catch {
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

    this.client.on('keyboard-interactive', async (
      name: string,
      instructions: string,
      instructionsLang: string,
      prompts: ssh2.Prompt[],
      finish: (responses: string[]) => void
    ) => {
      this.logger.info('Keyboard interactive!', name, instructions, instructionsLang, prompts);
      finish([this.connectInfo.password || '']);
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
        this.rawbuf = Buffer.alloc(0);
        this.msgbuf = '';
        this.bytes = 0;
        this.ncs = undefined;
        this.caplist = [];
        this.sessionId = -1;
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

      this.client.subsys('netconf', (err: Error | undefined, stream: ssh2.ClientChannel) => {
        if (err) {
          this.emit('error', 'SSH ERROR', err.toString().replace(/^Error:/, '').trim());
          this.client.end();
        } else {
          this.logger.info('SSH subsystem netconf entered');
          this.ncs = stream;
          stream.on('data', (data: Buffer | string) => { this._dataHandler(Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')); });
        }
      });
    });
  }

  private _msgHandler(msg: string) {
    const options = {
      attributeNamePrefix: '@_',
      ignoreAttributes: false,
      ignoreNameSpace: false,
      removeNSPrefix: true
    };

    const validationResult = XMLValidator.validate(msg);
    if (validationResult !== true) {
      const errmsg = `Malformed response, ${validationResult.err.code}, Details: ${validationResult.err.msg}`;
      return this.emit('netconfError', errmsg, msg);
    }

    const data = new XMLParser(options).parse(msg);
    if (data.hello) {
      if (this.connected) {
        this.logger.error('NETCONF ERROR', 'unexpected <hello> message', this._dumpXML(msg));
        return this.emit('netconfError', 'unexpected <hello> message', msg);
      } else {
        this.sessionId = data.hello['session-id'];
        const serverCapabilities = data.hello.capabilities.capability;
        this.caplist = [];
        this.requestId = 10000;
        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:netconf:base:1.0'))) this.caplist.push('base:1.0');
        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:netconf:base:1.1'))) this.caplist.push('base:1.1');
        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:netconf:capability:candidate:1.0'))) this.caplist.push('candidate');
        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:netconf:capability:confirmed-commit:1.'))) this.caplist.push('confirmed-commit');
        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:netconf:capability:rollback-on-error:1.0'))) this.caplist.push('rollback-on-error');
        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:netconf:capability:notification:1.0'))) this.caplist.push('notification:1.0');
        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:netconf:capability:notification:2.0'))) this.caplist.push('notification:2.0');
        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:netconf:capability:interleave:1.0'))) this.caplist.push('interleave');
        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:netconf:capability:validate:1.'))) this.caplist.push('validate');
        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:netconf:capability:startup:1.0'))) this.caplist.push('startup');
        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:netconf:capability:with-defaults:1.0'))) this.caplist.push('with-defaults');
        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:netconf:capability:yang-library:1.0'))) this.caplist.push('yang-library:1.0');
        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:netconf:capability:yang-library:1.1'))) this.caplist.push('yang-library:1.1');

        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:xml:ns:yang:ietf-netconf-monitoring'))) this.caplist.push('netconf-monitoring');
        if (serverCapabilities.some((cap: string) => cap.startsWith('urn:ietf:params:xml:ns:yang:ietf-netconf-nmda'))) this.caplist.push('netconf-nmda');

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

        const hello = {
          hello: {
            '@_xmlns': 'urn:ietf:params:xml:ns:netconf:base:1.0',
            capabilities: {
              capability: this.clientCapabilities
            }
          }
        };
        const netconfHello = new XMLBuilder(options).build(hello);
        if (this.ncs) this.ncs.write(`<?xml version="1.0" encoding="UTF-8"?>\n${netconfHello}]]>]]>`);

        this.connected = true;
        this.logger.info(`Connection established, session-id=${this.sessionId}`, this._dumpXML(msg));
        this.logger.info('Server capabilities: ', this.caplist);
        return this.emit('connected', msg, this.caplist, this.sessionId);
      }
    } else if (!this.connected) {
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
          if (t[0] > 3600) elapsed = `${t[0] / 3600 | 0}h ${(t[0] / 60 % 60) | 0}min ${t[0] % 60}sec`;
          else if (t[0] > 60) elapsed = `${t[0] / 60 | 0}min ${t[0] % 60}sec`;
          else if (t[0] > 0) elapsed = `${t[0]}sec ${t[1] / 1000000 | 0}ms`;
          else elapsed = `${t[1] / 1000000 | 0}ms`;
          delete this.timestamp[msgid];
        }
      }

      if ('rpc-error' in data['rpc-reply']) {
        let errmsg: string;
        const rpcError = data['rpc-reply']['rpc-error'];

        if (Array.isArray(rpcError)) {
          errmsg = 'Multiple RPC errors';
        } else {
          const entry = Object.entries(rpcError).find(([key]) => key.startsWith('error-message'));
          if (entry && typeof entry[1] === 'string') errmsg = entry[1].trim();
          else errmsg = 'Unsupported Error Message Format';
        }
        this.logger.warn(`${msgid} RPC-ERROR received, time=${elapsed}`, this._dumpXML(msg));
        this.emit('rpcError', msgid, errmsg, msg, elapsed);
      } else if (msgid) {
        if (msgid in this.callbacks) this.callbacks[msgid](msgid, msg);

        if ('ok' in data['rpc-reply']) {
          this.logger.info(`${msgid} RPC-OK received, time=${elapsed}`, this._dumpXML(msg));
          this.emit('rpcOk', msgid, elapsed);
        } else {
          this.logger.info(`${msgid} response received, time=${elapsed}`, this._dumpXML(msg));
          this.emit('rpcResponse', msgid, msg, elapsed);
        }
      } else {
        this.logger.error('NETCONF ERROR', 'rpc-reply w/o message-id received', this._dumpXML(msg));
        return this.emit('netconfError', 'rpc-reply w/o message-id received', msg);
      }

      if (msgid && msgid in this.callbacks) delete this.callbacks[msgid];
      if (Object.keys(this.callbacks).length === 0) this.emit('idle');
    } else {
      this.logger.error('NETCONF ERROR', 'unsupported message received', this._dumpXML(msg));
      return this.emit('netconfError', 'Unsupported message received', msg);
    }
  }

  private _dataHandler(data: Buffer) {
    this.rawbuf = Buffer.concat([this.rawbuf, data]);
    this.bytes += data.length;
    this.emit('data', this.bytes);

    if (this.base11Framing) {
      // Process all complete base:1.1 chunks in the buffer; exit on break when more data needed
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const pos = this.rawbuf.indexOf('\n', 1, 'utf-8');

        if (pos > 0) {
          const line1 = this.rawbuf.toString('utf-8', 0, pos + 1);
          if (line1 === '\n##\n') {
            if (this.msgbuf.length > 0) this._msgHandler(this.msgbuf);
            this.rawbuf = this.rawbuf.subarray(4);
            this.msgbuf = '';
          } else if (/\n#\d+\n/.test(line1)) {
            const chunkSize = parseInt(this.rawbuf.toString('utf-8', 2, pos));
            if (pos + chunkSize < this.rawbuf.length) {
              this.msgbuf += this.rawbuf.toString('utf-8', pos + 1, pos + 1 + chunkSize);
              this.rawbuf = this.rawbuf.subarray(pos + 1 + chunkSize);
            } else {
              break;
            }
          } else {
            this.emit('error', 'BASE_1_1 FRAME ERROR', 'chunk start not found');
            this.rawbuf = Buffer.alloc(0);
            this.msgbuf = '';
          }
        } else {
          break;
        }
      }
    } else {
      const pos = this.rawbuf.lastIndexOf(']]>]]>');
      if (pos > 0) {
        const msgs = this.rawbuf.toString('utf8', 0, pos).split(']]>]]>');
        msgs.forEach(msg => this._msgHandler(msg));
        this.rawbuf = this.rawbuf.subarray(pos + 6);
      }
    }
  }

  private _msgTimeout(msgid: string) {
    if (msgid in this.callbacks) {
      this.logger.error('ERROR', 'netconf-rpc timeout');
      this.emit('rpcTimeout', msgid);

      delete this.callbacks[msgid];
      if (Object.keys(this.callbacks).length === 0) this.emit('idle');
    }

    if (msgid in this.timestamp) delete this.timestamp[msgid];
  }

  private _sshDebug(message: string) {
    this.logger.debug('[ssh2]', message);
  }

  rpc(request: string, timeout = 300, callback: netconfCallback) {
    this.logger.debug('ncclient:rpc()');

    if (!this.connected) return this.emit('error', 'NETCONF ERROR', 'Client is not connected');

    const options = {
      attributeNamePrefix: '@_',
      ignoreAttributes: false,
      ignoreNameSpace: false,
      removeNSPrefix: true
    };

    const validationResult = XMLValidator.validate(request);
    if (validationResult !== true)
      return this.emit('error', 'BAD REQUEST', `${validationResult.err.code}, ${validationResult.err.msg}`);

    this.logger.info('execute netconf rpc-request', this._dumpXML(request));

    const data = new XMLParser(options).parse(request);

    if (!('rpc' in data)) return this.emit('error', 'BAD REQUEST', 'Missing: rpc');

    let msgid = 'unknown';
    if ('@_message-id' in data.rpc) {
      msgid = data.rpc['@_message-id'];
    } else {
      msgid = `${this.sessionId}:${this.requestId++}`;
      request = request.replace(/<([a-zA-Z][a-zA-Z0-9_-]*:)?rpc\b([^>]*)>/i, `<$1rpc$2 message-id="${msgid}">`);
    }

    if (msgid in this.callbacks) return this.emit('error', 'BAD REQUEST', 'Message-id is already in-use');

    this.callbacks[msgid] = callback;
    this.timestamp[msgid] = process.hrtime();
    setTimeout(() => this._msgTimeout(msgid), timeout * 1000);
    this.emit('busy');

    const rawbuf = Buffer.from(request, 'utf-8');
    const ncs = this.ncs;
    if (ncs) {
      if (this.base11Framing) {
        ncs.write(`\n#${rawbuf.length}\n`);
        ncs.write(rawbuf);
        ncs.write('\n##\n');
      } else {
        ncs.write(rawbuf);
        ncs.write(']]>]]>');
      }
    }
  }

  lock() {
    this.logger.debug('ncclient:lock()');
    if (this.connected) {
      const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="lock" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><lock><target><candidate/></target></lock></rpc>';
      this.rpc(request, 10, (_msgid: string, _msg: string) => {
        this.logger.info('candidate datastore successfully locked');
        return this.emit('locked');
      });
    }
  }

  unlock() {
    this.logger.debug('ncclient:unlock()');
    if (this.connected) {
      const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="unlock" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><unlock><target><candidate/></target></unlock></rpc>';
      this.rpc(request, 10, (_msgid: string, _msg: string) => {
        this.logger.info('candidate datastore successfully unlocked');
        return this.emit('unlocked');
      });
    }
  }

  getYangLibrary(folder: string, revisions = true) {
    this.logger.debug('ncclient:getYangLibrary()');

    const options = {
      attributeNamePrefix: '@_',
      ignoreAttributes: false,
      ignoreNameSpace: false,
      removeNSPrefix: true
    };

    if (this.caplist.includes('yang-library:1.1')) {
      const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="get-yang-library" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><get><filter type="subtree"><yang-library xmlns="urn:ietf:params:xml:ns:yang:ietf-yang-library"/></filter></get></rpc>';
      this.rpc(request, 10, (msgid: string, msg: string) => {
        const data = new XMLParser(options).parse(msg);

        let moduleSets = data?.['rpc-reply']?.data?.['yang-library']?.['module-set'];
        if (moduleSets) {
          if (!Array.isArray(moduleSets)) moduleSets = [moduleSets];

          moduleSets.forEach((entry: yangModuleSet) => {
            if (entry.module) {
              if (!Array.isArray(entry.module)) entry.module = [entry.module];
              entry.module.forEach((entry: yangModule) => {
                if (entry.submodule && !Array.isArray(entry.submodule)) entry.submodule = [entry.submodule];
              });
            }
            if (entry['import-only-module']) {
              if (!Array.isArray(entry['import-only-module'])) entry['import-only-module'] = [entry['import-only-module']];
              entry['import-only-module'].forEach((entry: yangModule) => {
                if (entry.submodule && !Array.isArray(entry.submodule)) entry.submodule = [entry.submodule];
              });
            }
          });
          this.logger.info(`sets: ${JSON.stringify(moduleSets)}`);

          const yangModules = moduleSets.flatMap((setEntry: yangModuleSet) => [
            ...(setEntry.module ?? []).flatMap((module) => [module, ...(module.submodule ?? [])]),
            ...(setEntry['import-only-module'] ?? []).flatMap((module) => [module, ...(module.submodule ?? [])])
          ]);

          this.logger.info(`modules: ${JSON.stringify(yangModules)}`);
          this.getSchemas(yangModules, yangModules.length, folder, revisions);
        } else {
          const errmsg = `Malformed yang-library:1.1 response, Message: ${msg}`;
          return this.emit('netconfError', errmsg, msg);
        }
      });
    } else if (this.caplist.includes('yang-library:1.0')) {
      const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="get-yang-library" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><get><filter type="subtree"><modules-state xmlns="urn:ietf:params:xml:ns:yang:ietf-yang-library"/></filter></get></rpc>';
      this.rpc(request, 10, (msgid: string, msg: string) => {
        const data = new XMLParser(options).parse(msg);

        let modules = data?.['rpc-reply']?.data?.['modules-state']?.module;
        if (modules) {
          if (!Array.isArray(modules)) modules = [modules];

          modules.forEach((entry: yangModule) => {
            if (entry.submodule && !Array.isArray(entry.submodule)) entry.submodule = [entry.submodule];
          });

          const yangModules = modules.flatMap((module: yangModule) => [module, ...(module.submodule ?? [])]);

          this.logger.info(`modules: ${JSON.stringify(yangModules)}`);
          this.getSchemas(yangModules, yangModules.length, folder, revisions);
        } else {
          const errmsg = `Malformed yang-library:1.0 response, Message: ${msg}`;
          return this.emit('netconfError', errmsg, msg);
        }
      });
    }
  }

  getSchemas(modules: yangModule[], total: number, folder: string, revisions: boolean) {
    this.logger.debug('ncclient:getSchemas()');

    const options = {
      attributeNamePrefix: '@_',
      ignoreAttributes: false,
      ignoreNameSpace: false,
      removeNSPrefix: true
    };

    const module = modules.pop();
    const index = total - modules.length;
    this.logger.info(JSON.stringify(module));

    if (module?.name) {
      let request;
      if (module?.revision) {
        request = `<?xml version="1.0" encoding="UTF-8"?><rpc xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><get-schema xmlns="urn:ietf:params:xml:ns:yang:ietf-netconf-monitoring"><identifier>${module.name}</identifier><version>${module.revision}</version><format>yang</format></get-schema></rpc>`;
      } else {
        request = `<?xml version="1.0" encoding="UTF-8"?><rpc xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><get-schema xmlns="urn:ietf:params:xml:ns:yang:ietf-netconf-monitoring"><identifier>${module.name}</identifier><format>yang</format></get-schema></rpc>`;
      }

      this.rpc(request, 300, (msgid: string, msg: string) => {
        const data = new XMLParser(options).parse(msg);

        let yangspec = data?.['rpc-reply']?.data;
        if (yangspec) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic decode at runtime
          yangspec = (require('he') as { decode: (s: string) => string }).decode(yangspec).trim();

          this.emit('yangDefinition', module.name, module.revision, yangspec, index, total);
          if (folder) {
            if (revisions) fs.writeFileSync(path.join(folder, `${module.name}@${module.revision}.yang`), yangspec);
            else fs.writeFileSync(path.join(folder, `${module.name}.yang`), yangspec);
          }
        }

        this.getSchemas(modules, total, folder, revisions);
      });
    }
  }

  closeSession() {
    this.logger.debug('ncclient:closeSession()');
    if (this.connected) {
      this.emit('busy');
      const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="disconnect" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><close-session/></rpc>';
      const ncs = this.ncs;
      if (ncs) {
        if (this.base11Framing) {
          ncs.write(`\n#${request.length}\n`);
          ncs.write(request);
          ncs.write('\n##\n');
        } else {
          ncs.write(request);
          ncs.write(']]>]]>');
        }
      }
      return setTimeout(() => this.disconnect(), 1000);
    }
  }

  private _connect() {
    this.client.connect(this.connectInfo);
  }

  connect(config: ssh2.ConnectConfig, keyfile: string | undefined, clientCapabilities: string[] | undefined, sshdebug: boolean | undefined, queryUserPassword: passwordCallback) {
    this.logger.debug('ncclient:connect()');

    if (this.connected)
      return this.emit('error', 'CLIENT ERROR', `Already connected to ${this.connectInfo.username}@${this.connectInfo.host}! Disconnect before establish a new connection!`);

    this.emit('busy');

    if (keyfile && !config.password && !config.privateKey) {
      if (keyfile.charAt(0) === '~') {
        keyfile = os.homedir + keyfile.substring(1);
      }
      try {
        config.privateKey = fs.readFileSync(keyfile).toString('utf-8');
      } catch (e) {
        const errmsg = e instanceof Error ? e.message : String(e);
        this.emit('error', 'KEYFILE ERROR', errmsg.replace(/^[A-Z0-9]+:/, '').trim());
      }
    }

    if (sshdebug) config.debug = this._sshDebug.bind(this);

    if (clientCapabilities) this.clientCapabilities = clientCapabilities;
    else this.clientCapabilities = ['urn:ietf:params:netconf:base:1.0', 'urn:ietf:params:netconf:base:1.1'];

    this.connectInfo = config;
    this.queryUserPassword = queryUserPassword;

    this._connect();
  }

  disconnect() {
    this.logger.debug('ncclient:disconnect()');
    this.client.end();
  }
}
