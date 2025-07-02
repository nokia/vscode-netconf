/*
  @author Sven Wisotzky
  
  © 2025 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import * as os from 'os';
import * as fs from 'fs';

import * as ssh2 from 'ssh2';
import * as path from 'path';
import * as vscode from 'vscode';

import xmlFormat from 'xml-formatter';

import { ncclient } from './ncclient';
import { ExtensionLogger } from './vscExtensionLogger';

const log : ExtensionLogger = new ExtensionLogger(`netconf | common`);
let updateBadge: (badge: vscode.ViewBadge | undefined ) => void;
let selection : NetconfConnectionEntry | undefined;
let secrets : vscode.SecretStorage;

interface ConnectInfo extends ssh2.ConnectConfig {
    id: string;
    clientCapabilities?: string[];
}

async function openSettingsEntry(section: string, key: string, value: string) {
    let refreshTimer = 500;

    if (vscode.env.remoteName) {
        vscode.commands.executeCommand('workbench.action.openRemoteSettingsFile');
        refreshTimer = 1000;
    } else vscode.commands.executeCommand('workbench.action.openSettingsJson');

    setTimeout(async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document) {
            const content = editor.document.getText();

            const idx1 = content.indexOf(`"${section}"`);
            const idx2 = content.indexOf(`"${key}": "${value}"`, idx1);
            if (idx2 === -1) {
                const pos = editor.document.positionAt(idx1);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            } else {
                const pos1 = editor.document.positionAt(content.slice(idx1, idx2).lastIndexOf('{') + idx1);
                const pos2 = editor.document.positionAt(content.indexOf('}', idx2)+1);
                editor.selection = new vscode.Selection(pos1, pos2);
                editor.revealRange(new vscode.Range(pos1, pos2), vscode.TextEditorRevealType.InCenter);
            }
        }
    }, refreshTimer);
}

function showXmlDocument(data: string) {
    const prettify : boolean = vscode.workspace.getConfiguration('netconf').get('prettify') || false;

    if (prettify) {
        data = xmlFormat(data, {
            indentation: '  ',
            collapseContent: true,
            lineSeparator: '\r\n',
            whiteSpaceAtEndOfSelfclosingTag: true
        });
    }

    vscode.workspace.openTextDocument({content: data, language: 'xml'}).then((xmldoc) => {
        vscode.window.showTextDocument(xmldoc);
    });
}

export class NetconfServerProvider implements vscode.TreeDataProvider<NetconfServerEntry> {
    private _onDidChangeTreeData = new vscode.EventEmitter<NetconfServerEntry | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private serverListEntries: NetconfServerEntry[];
  
    constructor() {
        const servers : ConnectInfo[] = vscode.workspace.getConfiguration('netconf').get('serverList', []);
        this.serverListEntries = servers.map(entry => new NetconfServerEntry(entry));

        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('netconf.serverList')) {
                const servers : ConnectInfo[] = vscode.workspace.getConfiguration('netconf').get('serverList', []);
                this.serverListEntries = servers.map(entry => new NetconfServerEntry(entry));
                this.refresh();
            }
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
  
    getTreeItem(element: NetconfServerEntry): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: NetconfServerEntry | undefined): vscode.ProviderResult<NetconfServerEntry[]> {
        return this.serverListEntries;
    }

    async addServer() {
        const servers : ConnectInfo[] = vscode.workspace.getConfiguration('netconf').get('serverList', []);

        let id: string | undefined;
        do {
            id = await vscode.window.showInputBox({
                title: 'Add new managed device (step 1/5)',
                prompt: 'Enter user-friendly name for connection',
                placeHolder: 'connection-name'            
            });
            if (!id) return;
            if (servers.some(e => e.id === id))
                vscode.window.showErrorMessage('Connection already exists! Provide unique connection name!');
        } while (servers.some(e => e.id === id));

        const host = await vscode.window.showInputBox({
            title: 'Add new managed device (step 2/5)',
            prompt: 'Enter IP address or hostname',
            placeHolder: 'hostname'
        });
        if (!host) return;
        if (servers.some(e => e.host === host))
            vscode.window.showWarningMessage('There is already a connection to the same host!');

        const port = await vscode.window.showInputBox({
            title: 'Add new managed device (step 3/5)',
            prompt: 'Enter SSH port (default: 830)',
            value:  vscode.workspace.getConfiguration("netconf").get("defaultPort", 830).toString()
        });
        if (!port) return;

        const user = await vscode.window.showInputBox({
            title: 'Add new managed device (step 4/5)',
            prompt: 'Enter username',
            value:  vscode.workspace.getConfiguration("netconf").get("defaultUser", "admin")
        });
        if (!user) return;

        const password = await vscode.window.showInputBox({
            title: 'Add new managed device step (5/5)',
            prompt: 'Enter password',
            password: true
        });
        if (password) secrets.store(`${user}@${host}`, password);

        const caps = vscode.workspace.getConfiguration("netconf").get("defaultCapabilities", [
            "urn:ietf:params:netconf:base:1.0", "urn:ietf:params:netconf:base:1.1"
        ]);

        const newEntry : ConnectInfo = {
            id: id,
            host: host,
            port: Number(port),
            username: user,
            clientCapabilities: caps,
            keepaliveCountMax: 3,
            keepaliveInterval: 5000
        };
        servers.push(newEntry);
        
        try {
            await vscode.workspace.getConfiguration('netconf').update('serverList', servers, vscode.ConfigurationTarget.Global);
        }
        catch (e) {
            const errmsg = (e instanceof Error ? e.message : String(e)).replace(/^[A-Z0-9]+:/, '').trim();
            vscode.window.showErrorMessage(errmsg);
            log.error(errmsg);
        }
    }

    async clabAddHost(node: any) {
        let sshTarget: string | undefined;

        if (node.name) {
            sshTarget = node.name
        } else if (node.v6Address) {
            sshTarget = node.v6Address;
        } else if (node.v4Address) {
            sshTarget = node.v4Address
        } else if (node.cID) {
            sshTarget = node.cID
        } else {
			log.warn("Information from containerlab is not yet available! Need to wait...");
            return vscode.window.showWarningMessage('Information from containerlab is not yet available! Please wait and try again...');
        }

        const servers : ConnectInfo[] = vscode.workspace.getConfiguration('netconf').get('serverList', []);

        const newEntry : ConnectInfo = {
            id: node.label,
            host: sshTarget,
            username: vscode.workspace.getConfiguration("netconf").get("defaultUser", "admin"),
            port: vscode.workspace.getConfiguration("netconf").get("defaultPort", 830),
            clientCapabilities: vscode.workspace.getConfiguration("netconf").get("defaultCapabilities", ["urn:ietf:params:netconf:base:1.0", "urn:ietf:params:netconf:base:1.1"]),
            keepaliveCountMax: 3,
            keepaliveInterval: 5000,
            tryKeyboard: true
        };

        if (servers.some(e => e.id === newEntry.id)) {
            return vscode.window.showErrorMessage('Connection already exists!');   
        }

        servers.push(newEntry);
        try {
            await vscode.workspace.getConfiguration('netconf').update('serverList', servers, vscode.ConfigurationTarget.Global);
        }
        catch (e) {
            const errmsg = (e instanceof Error ? e.message : String(e)).replace(/^[A-Z0-9]+:/, '').trim();
            vscode.window.showErrorMessage(errmsg);
            log.error(errmsg);
        }
    }
}

export class NetconfServerEntry extends vscode.TreeItem {
    public serverInfo: ConnectInfo;

    constructor(server : ConnectInfo) {
        super(server.id, vscode.TreeItemCollapsibleState.None);
        this.serverInfo = server;
        this.tooltip = new vscode.MarkdownString(`**${this.label}**\n\n**host:** ${this.serverInfo.host}\n\n**port:** ${this.serverInfo.port ?? "default"}\n\n**user:** ${this.serverInfo.username ?? "default"}`);
    }
}

export class NetconfConnectionProvider implements vscode.TreeDataProvider<NetconfConnectionEntry> {
    private _onDidChangeTreeData = new vscode.EventEmitter<NetconfConnectionEntry | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private connections: NetconfConnectionEntry[];

    constructor() {
        this.connections = [];
    }
    
    getTreeItem(element: NetconfConnectionEntry): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: NetconfConnectionEntry | undefined): vscode.ProviderResult<NetconfConnectionEntry[]> {
        return this.connections;
    }

    refresh(): void {
        // cleanup old connections:
        this.connections = this.connections.filter(c => c.initializing || c.running);

        // update user-interface
		const count = this.connections.length;
		if (count>0)
			updateBadge({value: count, tooltip: `${count} connections`});
		else
			updateBadge(undefined);

        if (count === 1 && selection === undefined)
            this.connections[0].spotlight(true);
        
        this._onDidChangeTreeData.fire();
    }

    connect(server: NetconfServerEntry) {
        const connectionEntry = new NetconfConnectionEntry(server.serverInfo, '(managed)');
        this.connections.push(connectionEntry);
        connectionEntry.onDidChange(() => this.refresh());
    }

    clabConnect(node: any) {
        let sshTarget: string | undefined;

        if (node.name) {
            sshTarget = node.name
        } else if (node.v6Address) {
            sshTarget = node.v6Address;
        } else if (node.v4Address) {
            sshTarget = node.v4Address
        } else if (node.cID) {
            sshTarget = node.cID
        } else {
			log.warn("Information from containerlab is not yet available! Need to wait...");
            return vscode.window.showWarningMessage('Information from containerlab is not yet available! Please wait and try again...');
        }

        const serverInfo : ConnectInfo = {
            id: node.label,
            host: sshTarget,
            username: vscode.workspace.getConfiguration("netconf").get("defaultUser", "admin"),
            port: vscode.workspace.getConfiguration("netconf").get("defaultPort", 830),
            clientCapabilities: vscode.workspace.getConfiguration("netconf").get("defaultCapabilities", ["urn:ietf:params:netconf:base:1.0", "urn:ietf:params:netconf:base:1.1"]),
            keepaliveCountMax: 3,
            keepaliveInterval: 5000,
            tryKeyboard: true
        };

        const connectionEntry = new NetconfConnectionEntry(serverInfo, `(containerlab: ${node.kind})`);
        this.connections.push(connectionEntry);
        connectionEntry.onDidChange(() => this.refresh());
    }

    disconnect(connection: NetconfConnectionEntry) { connection.disconnect(); }
    commit    (connection: NetconfConnectionEntry) { connection.commit();     }
    discard   (connection: NetconfConnectionEntry) { connection.discard();    }
    validate  (connection: NetconfConnectionEntry) { connection.validate();   }
    unlock    (connection: NetconfConnectionEntry) { connection.unlock();     }
    lock      (connection: NetconfConnectionEntry) { connection.lock();       }
    getConfig (connection: NetconfConnectionEntry) { connection.getConfig();  }
    get       (connection: NetconfConnectionEntry) { connection.get();        }
    subscribe (connection: NetconfConnectionEntry) { connection.subscribe();  }

    async getSchemas(connection: NetconfConnectionEntry) {
        const uri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select YANG folder'
        });

        if (uri && uri.length === 1) {
            const yangdir = await vscode.window.showInputBox({
                title: `Download YANG modules from ${connection.host}`,
                value: path.join(uri[0].fsPath, connection.host, 'yang')
            });

            if (yangdir) {
                fs.mkdirSync(yangdir, { recursive: true });
                connection.getSchemas(yangdir);
            }
        }
    }

    async rpc(context? : NetconfConnectionEntry | vscode.Uri) {
        if (context instanceof NetconfConnectionEntry) {
            // triggered from: view/item/context (treeView: NetconfConnectionEntry)
            const editor = vscode.window.activeTextEditor;
            if (editor?.document && editor.document.languageId === "xml")
                context.rpc(editor.document.getText());
            else {
                const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
                if (input !== null &&  typeof input === "object" && "uri" in input) {
                        const uri = input.uri;
                        if (uri instanceof vscode.Uri) {
                            const document = await vscode.workspace.openTextDocument(uri);
                            if (document.languageId === "xml")
                                context.rpc(document.getText());
                            else
                                vscode.window.showWarningMessage('Select a XML document containing custom <rpc>');
                        } 
                    }
                }
        }
        else if (selection) {
            if (context) {
                // triggered from: editor/title/run
                const document = await vscode.workspace.openTextDocument(context);
                selection.rpc(document.getText());
            } else {
                // triggered from: statusBar
                const editor = vscode.window.activeTextEditor;
                if (editor?.document && editor.document.languageId === "xml")
                    selection.rpc(editor.document.getText());
                else {
                    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
                    if (input !== null &&  typeof input === "object" && "uri" in input) {
                        const uri = input.uri;
                        if (uri instanceof vscode.Uri) {
                            const document = await vscode.workspace.openTextDocument(uri);
                            if (document.languageId === "xml")
                                selection.rpc(document.getText());
                            else
                                vscode.window.showWarningMessage('Select a XML document containing custom <rpc>');
                        }
                    }
                }
            }
        } else vscode.window.showWarningMessage('Select netconf connection in side-bar to send custom <rpc>');
    }

    getEvents(connection?: NetconfConnectionEntry) {
        if (connection) connection.getEvents();
        else if (selection) selection.getEvents();
    }
}

export class NetconfConnectionEntry extends vscode.TreeItem {
    private _onDidChange = new vscode.EventEmitter<NetconfConnectionEntry | undefined | null | void>();
    readonly onDidChange = this._onDidChange.event;

    public host: string;
    public user: string;
    public sessionId: Number;

    public logs: ExtensionLogger;
    public client : ncclient;

    public initializing : boolean;
    public running : boolean;

    private showSubscribe : boolean;
    private showCandidate : boolean;
    private showLibrary : boolean;
    private isLocked : boolean;

    private established : string;
    private isBusy : boolean;
    private bytesReceived : number;
    private events : string[];

    private additionalInfo: string;

    private netcfgStatus: vscode.StatusBarItem | undefined;
    private eventStatus: vscode.StatusBarItem | undefined;


    constructor(server : ConnectInfo, extraInfo? : string) {
        super(server.id, vscode.TreeItemCollapsibleState.None);

        if (extraInfo)
            this.description = extraInfo;
        else
            this.description = "";

        this.host = server.host ?? "unknown";
        this.user = server.username ?? "unknown";
        this.sessionId = -1;

        this.initializing = true;
        this.running = false;
        this.showSubscribe = false;
        this.showCandidate = false;
        this.showLibrary = false;
        this.isLocked = false;
        this.isBusy = false;

        this.bytesReceived = 0;
        this.established = new Intl.DateTimeFormat('en-US', {year: "numeric", month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short'}).format(Date.now());

        this.additionalInfo = '';
        
        Date.now();
        this.events = [];

        this.logs = new ExtensionLogger(`netconf | ${server.id}`);
        this.client = new ncclient(this.logs);

        this.logs.info(`Connecting to ${this.user}@${this.host}...`);

        this.netcfgStatus = undefined;
        this.eventStatus = undefined;

        // --- event handlers ---------------------------------------------------

        this.client.on('sshBanner', (banner: string) => {
            if (banner.trim().length > 0)
                vscode.window.showInformationMessage(banner);
        });

        this.client.on('sshGreeting', (greeting: string) => {
            if (greeting.trim().length > 0)
                vscode.window.showInformationMessage(greeting);
        });

        this.client.on('connected', (hello: string, caplist: string[], sessionId: Number) => {
            vscode.window.showInformationMessage(`Session-id: ${sessionId} | NETCONF server capabilities: ${caplist.join(' ')}`, 'Open', 'Cancel').then( async (action) => {
                if ('Open' === action) showXmlDocument(hello);
            });

            this.running = true;
            this.initializing = false;

            if (caplist.includes('notification:1.0') || caplist.includes('notification:2.0'))
                this.showSubscribe = true;
    
            if (caplist.includes('candidate')) {
                this.showCandidate = true;
                this.isLocked = false;
            }

            if (caplist.includes('yang-library:1.0') || caplist.includes('yang-library:1.1'))
                this.showLibrary = true;

            this.sessionId = sessionId;
            this.description = `#${sessionId} ${this.description}`;

            this.refresh();
        });

        this.client.on('disconnected', () => {
            this.logs.info('session disconnected');
            this.running = false;
            this.initializing = false;
            if (selection === this)
                this.spotlight(false);
            else
                this.refresh();
        });

        this.client.on('locked', () => {
            this.isLocked = true;
            this.refresh();
        });
    
        this.client.on('unlocked', () => {
            this.isLocked = false;
            this.refresh();
        });
    
        this.client.on('rpcOk', (msgid, elapsed) => {
            vscode.window.showInformationMessage(`netconf #${msgid}: ok, time=${elapsed}`);
            this.refresh();
        });
    
        this.client.on('rpcResponse', (msgid, data, elapsed) => {
            // showXmlDocument(data);
            this.refresh();
        });
    
        this.client.on('rpcError', (msgid, errmsg, msg, elapsed) => {
            vscode.window.showWarningMessage(`netconf #${msgid}: failed, time=${elapsed}`, 'Open', 'Cancel').then( async (action) => {
                if ('Open' === action)
                    showXmlDocument(msg);
            });
            this.refresh();
        });

        this.client.on('netconfError', (errmsg, msg) => {
            vscode.window.showWarningMessage(errmsg, 'Open', 'Cancel').then( async (action) => {
                if ('Open' === action)
                    showXmlDocument(msg);
            });
            this.initializing = false;
            this.refresh();
        });	
    
        this.client.on('rpcTimeout', (msgid) => {
            vscode.window.showInformationMessage(`netconf request #${msgid}: failed with timeout`);
            this.refresh();
        });
    
        this.client.on('busy', () => {
            this.isBusy = true;
        });
    
        this.client.on('idle', () => {
            this.isBusy = false;
        });
    
        this.client.on('notification', (data: any) => {
            this.events.push(data.replace(/\<\?xml.+\?\>\s*/g, ''));
            this.refresh();
        });	
    
        this.client.on('info', (message: string, details: string) => {
            this.logs.info(message, details);
            vscode.window.showInformationMessage(`${message}\n${details}`);
            this.refresh();
        });
    
        this.client.on('warning', (message: string, details: string) => {
            this.logs.warn(message, details);
            vscode.window.showWarningMessage(`${message}\n${details}`);
            this.refresh();
        });
    
        this.client.on('error', (message: string, details: string) => {
            this.logs.error(message, details);
            vscode.window.showErrorMessage(`${message}\n${details}`);
            this.initializing = false;
            this.refresh();
        });

        this.client.on('data', (bytes) => {
            this.bytesReceived = bytes;
            this.refresh();
        });

        this.client.on('yangDefinition', (module: string, revision: string, yangspec: string, idx: number, total: number) => {
            if (idx<total)
                this.additionalInfo = `>>> yang download ${idx}/${total}; ${module}@${revision} done`;
            else
                this.additionalInfo = '';

            this.refresh();
        });

        // --- update UI and connect --------------------------------------------

        this.connect(server);
    }

    async connect(server : ConnectInfo): Promise<void> {
        const keysFile : string | undefined = vscode.workspace.getConfiguration('netconf').get('keysFile') || undefined;
        const sshdebug : boolean = vscode.workspace.getConfiguration('netconf').get('sshDebug') || false;

        const config = { ...server };

        if (!config.username)
            config.username = vscode.workspace.getConfiguration("netconf").get("defaultUser", "admin");

        if (!config.port)
            config.port = vscode.workspace.getConfiguration("netconf").get("defaultPort", 830);

        if (!config.clientCapabilities || config.clientCapabilities.length === 0)
            config.clientCapabilities = vscode.workspace.getConfiguration("netconf").get("defaultCapabilities", [
                "urn:ietf:params:netconf:base:1.0", "urn:ietf:params:netconf:base:1.1"
            ]);

        if (!config.password)
            config.password = await secrets.get(`${config.username}@${config.host}`);

        this.client.connect(config, keysFile, server.clientCapabilities, sshdebug, this.queryUserPassword);
    }

    spotlight(enable: boolean): void {
        if (enable) {
            selection = this;
            this.logs.show();
            if (!this.netcfgStatus) {
                this.netcfgStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 177);
                this.netcfgStatus.text = `$(terminal)`;
                this.netcfgStatus.command = 'netconf.rpc';
                this.netcfgStatus.tooltip = `Send custom <rpc> to ${this.host}`;
                this.netcfgStatus.show();
            }
            if (!this.eventStatus) {
                this.eventStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 175);
                this.eventStatus.text = `$(terminal)`;
                this.eventStatus.command = 'netconf.getEvents';
                this.eventStatus.tooltip = `Event notifications from ${this.host}`;
                this.eventStatus.show();
            }
        } else {
            selection = undefined;
            if (this.netcfgStatus) {
                this.netcfgStatus.hide();
                this.netcfgStatus.dispose();
                this.netcfgStatus = undefined;
            }
            if (this.eventStatus) {
                this.eventStatus.hide();
                this.eventStatus.dispose();
                this.eventStatus = undefined;
            }    
        }
        this.refresh();
    }

    refresh(): void {
        if (this.running) {
            const lines:string[] = [];
            const received = this.bytesReceived < 10_000_000 ? (this.bytesReceived>>10)+'KB' : (this.bytesReceived>>20)+'MB';
            const events = this.events.length;
    
            lines.push(`**Session:** ${this.label} #${this.sessionId}`);
            lines.push(`**target:** ${this.user}@${this.host}`)
            lines.push(`**established:** ${this.established}`);
            lines.push(`**received:** ${received}`);

            if (events)
                lines.push(`**buffered notifications:** ${events}`);

            this.tooltip = new vscode.MarkdownString(lines.join('\n\n'), true);
            this.contextValue = this.computeContextValue();

            if (this.netcfgStatus)
                this.netcfgStatus.text = `$(terminal) ${this.label} #${this.sessionId} ${received} ${this.additionalInfo}`;

            if (this.eventStatus) {
                if (events) {
                    this.eventStatus.text = `$(comment) ${events}`;
                    this.eventStatus.show();
                } else this.eventStatus.hide();
            }

        } else {
            this.tooltip = new vscode.MarkdownString('disconnected');
            this.contextValue = undefined;    
        }

        this._onDidChange.fire();
    }

    async disconnect() {
        this.client.disconnect();
    }

	async rpc(request : string) {
        this.client?.rpc(request, 300, (msgid : string, msg : string) => {
            this.logs.debug(`rpc #${msgid} done`);
            showXmlDocument(msg);
        });
	}
    
	async get() {
		const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="getcfg" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><get/></rpc>';
		this.client?.rpc(request, 300, (msgid : string, msg : string) => {
			this.logs.debug(`rpc #${msgid} done`);
            showXmlDocument(msg);
            this.refresh();
		});		
	}

	async getConfig() {
		const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="getcfg" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><get-config><source><running/></source></get-config></rpc>';
		this.client?.rpc(request, 300, (msgid : string, msg : string) => {
			this.logs.debug(`rpc #${msgid} done`);
            showXmlDocument(msg);
            this.refresh();
		});		
	}

    async subscribe() {
		this.events = [];
        this.showSubscribe = false;
        this.refresh();

		const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="subscribe" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><create-subscription xmlns="urn:ietf:params:xml:ns:netconf:notification:1.0" /></rpc>';
		this.client?.rpc(request, 60, (msgid : string, msg : string) => {
			this.logs.debug(`rpc #${msgid} done`);
            this.refresh();
		});
    }

	async getEvents() {
        if (this.events.length === 0) {
            vscode.window.showWarningMessage(`No more event notification from ${this.host}!`);
            return;
        }

		if (this.events.length > 1) {
            const events = this.events.map(event => event.split('\n').map(line => `  ${line}`).join('\n')).join('\n\n');
            showXmlDocument(`<?xml version="1.0" encoding="UTF-8"?>\n<notifications>\n${events}\n</notifications>`);
            this.events = [];
        } else showXmlDocument(`<?xml version="1.0" encoding="UTF-8"?>\n${this.events.pop()}`);
        
        this.refresh();
	}

	async commit() {
		const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="commit" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><commit/></rpc>';
		this.client?.rpc(request, 60, (msgid : string, msg : string) => {
			this.logs.debug(`rpc #${msgid} done`);
            this.refresh();
		});
	}

	async discard() {
		const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="discard" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><discard-changes/></rpc>';
		this.client?.rpc(request, 60, (msgid : string, msg : string) => {
			this.logs.debug(`rpc #${msgid} done`);
            this.refresh();
		});
	}

	async validate() {
		const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="validate" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><validate><source><candidate/></source></validate></rpc>';
		this.client?.rpc(request, 60, (msgid : string, msg : string) => {
			this.logs.debug(`rpc #${msgid} done`);
            this.refresh();
		});		
	}

    async getSchemas(folder: string) {
        const addRevisions : boolean = vscode.workspace.getConfiguration('netconf').get('yangRevisions') || false;
        this.client?.getYangLibrary(folder, addRevisions);
    }

	async lock() {
		this.client?.lock();
	}

	async unlock() {
		this.client?.unlock();
	}

    queryUserPassword(host: string, username: string): Thenable<string | undefined> {
        return vscode.window.showInputBox({
            password: true,
            title: "Provide NETCONF password",
            placeHolder: `Enter password for ${username}@${host}`,
            prompt: "Authentication failure.",
            ignoreFocusOut: true
        }).then(password => {
            if (password) secrets.store(`${username}@${host}`, password);
            return password;
        });
    }

    private computeContextValue(): string {
        let values = [];
        if (this.events.length>0) values.push("events");
        if (this.showSubscribe) values.push("showSubscribe");
        if (this.showCandidate) {
            values.push("showCandidate");
            if (this.isLocked)
                values.push("locked"); 
            else
                values.push("open");
        }
        if (this.showLibrary)
            values.push("yangLibrary");

        return values.join(",");
    }
}

export function activate(context: vscode.ExtensionContext) {
	const ncsp = new NetconfServerProvider();
	vscode.window.registerTreeDataProvider('netconfServers', ncsp);

	const nccp = new NetconfConnectionProvider();
	const treeView = vscode.window.createTreeView('netconfConnections', { treeDataProvider: nccp });
    context.subscriptions.push(treeView);

	const treeViewM = vscode.window.createTreeView('netconfConnectionMgmt', { treeDataProvider: nccp });
    context.subscriptions.push(treeViewM);

    secrets = context.secrets;

    selection = undefined;
    treeViewM.onDidChangeSelection(event => {
        const newSelection = event.selection[0] as NetconfConnectionEntry || undefined;
        if (selection !== newSelection) selection?.spotlight(false);
        if (newSelection) newSelection.spotlight(true);
    });

	updateBadge = (badge: vscode.ViewBadge | undefined) => treeViewM.badge = badge;

	// --- server commands --------------------------------------------------

	context.subscriptions.push(vscode.commands.registerCommand('netconf.add',    () => ncsp.addServer()));

	context.subscriptions.push(vscode.commands.registerCommand('netconf.remove', async (server: NetconfServerEntry) => {
        if (server?.label) {
            let servers : ConnectInfo[] = vscode.workspace.getConfiguration('netconf').get('serverList', []);
            servers.filter(entry => entry.id === server.label).forEach(server => secrets.delete(`${server.username}@${server.host}`));
            servers = servers.filter(entry => entry.id !== server.label);

            try {
                await vscode.workspace.getConfiguration('netconf').update('serverList', servers, vscode.ConfigurationTarget.Global);
            }
            catch (e) {
                const errmsg = (e instanceof Error ? e.message : String(e)).replace(/^[A-Z0-9]+:/, '').trim();
                vscode.window.showErrorMessage(errmsg);
                log.error(errmsg);
            }
        }
    }));

	context.subscriptions.push(vscode.commands.registerCommand('netconf.clone', async (server: NetconfServerEntry) => {
        if (server?.label) {
            const servers : ConnectInfo[] = vscode.workspace.getConfiguration('netconf').get('serverList', []);

            let id: string | undefined;
            do {
                id = await vscode.window.showInputBox({
                    title: `Clone managed device entry ${server.label}`,
                    prompt: 'Enter user-friendly name for connection',
                    placeHolder: server.serverInfo.id
                });
                if (!id) return;
                if (servers.some(e => e.id === id))
                    vscode.window.showErrorMessage('Entry already exists! Provide unique name!');
            } while (servers.some(e => e.id === id));

            const host = await vscode.window.showInputBox({
                title: `Clone managed device entry ${server.label}`,
                prompt: 'Enter IP address or hostname',
                value: server.serverInfo.host
            });
            if (!host) return;

            let newEntry : ConnectInfo = { ...server.serverInfo };
            newEntry.id = id;
            newEntry.host = host;
            servers.push(newEntry);

            try {
                await vscode.workspace.getConfiguration('netconf').update('serverList', servers, vscode.ConfigurationTarget.Global);
            }
            catch (e) {
                const errmsg = (e instanceof Error ? e.message : String(e)).replace(/^[A-Z0-9]+:/, '').trim();
                vscode.window.showErrorMessage(errmsg);
                log.error(errmsg);
            }
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('netconf.update', async (server: NetconfServerEntry) => {
        if (server?.label)
            openSettingsEntry('netconf.serverList', 'id', server.label.toString());
    }));

    // --- example command --------------------------------------------------

    context.subscriptions.push(vscode.commands.registerCommand('netconf.examples', () => {
        const gitPath = vscode.workspace.getConfiguration('git').get('defaultCloneDirectory', '~').replace(/^~/, os.homedir());
        const gitRepo = vscode.workspace.getConfiguration("netconf").get("examplesURL", "https://github.com/nokia/netconf-examples.git");

        const examplesPath = vscode.Uri.joinPath(
            vscode.Uri.file(gitPath),
            gitRepo.split('/').pop()?.replace(/\.git$/, '') ?? ''
        );

		if (fs.existsSync(examplesPath.fsPath)) {
            log.info(`Adding ${examplesPath.fsPath} to workspace`);
			vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, null, { uri: examplesPath});
		} else {
            log.info(`Cloning ${gitRepo} and ask the user to add to workspace`);
			vscode.commands.executeCommand('git.clone', gitRepo, gitPath);
		}
	}));

	// --- connect command --------------------------------------------------

	context.subscriptions.push(vscode.commands.registerCommand('netconf.connect', nccp.connect.bind(nccp)));

	// --- containerlab commands --------------------------------------------
    
	context.subscriptions.push(vscode.commands.registerCommand('netconf.clabConnect', nccp.clabConnect.bind(nccp)));
	context.subscriptions.push(vscode.commands.registerCommand('netconf.clabAddHost', ncsp.clabAddHost.bind(ncsp)));

	// --- connection commands ----------------------------------------------

	context.subscriptions.push(vscode.commands.registerCommand('netconf.disconnect', nccp.disconnect.bind(nccp)));

	context.subscriptions.push(vscode.commands.registerCommand('netconf.commit', nccp.commit.bind(nccp)));
	context.subscriptions.push(vscode.commands.registerCommand('netconf.discard', nccp.discard.bind(nccp)));
	context.subscriptions.push(vscode.commands.registerCommand('netconf.validate', nccp.validate.bind(nccp)));
	context.subscriptions.push(vscode.commands.registerCommand('netconf.unlock', nccp.unlock.bind(nccp)));
	context.subscriptions.push(vscode.commands.registerCommand('netconf.lock', nccp.lock.bind(nccp)));

	context.subscriptions.push(vscode.commands.registerCommand('netconf.getConfig', nccp.getConfig.bind(nccp)));
	context.subscriptions.push(vscode.commands.registerCommand('netconf.get', nccp.get.bind(nccp)));
	context.subscriptions.push(vscode.commands.registerCommand('netconf.rpc', nccp.rpc.bind(nccp)));

	context.subscriptions.push(vscode.commands.registerCommand('netconf.getEvents', nccp.getEvents.bind(nccp)));
	context.subscriptions.push(vscode.commands.registerCommand('netconf.subscribe', nccp.subscribe.bind(nccp)));
	context.subscriptions.push(vscode.commands.registerCommand('netconf.getSchemas', nccp.getSchemas.bind(nccp)));
}

export function deactivate() {
}