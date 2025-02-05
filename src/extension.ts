/*
  @author Sven Wisotzky
  
  © 2025 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import * as os from 'os';
import * as fs from 'fs';

import * as vscode from 'vscode';
import * as ssh2 from 'ssh2';

import xmlFormat from 'xml-formatter';

import { ncclient } from './ncclient';
import { ExtensionLogger } from './vscExtensionLogger';

interface ConnectInfo extends ssh2.ConnectConfig {
    id: string;
    clientCapabilities?: string[];
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
        const servers : ConnectInfo[] | [] = vscode.workspace.getConfiguration('netconf').get('serverList') ?? [];
        this.serverListEntries = servers.map(entry => new NetconfServerEntry(entry));

        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('netconf.serverList')) {
                const servers : ConnectInfo[] | [] = vscode.workspace.getConfiguration('netconf').get('serverList') ?? [];
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
        const id = await vscode.window.showInputBox({
            title: 'Add new NETCONF server',
            prompt: 'Enter user-friendly name for connection',
            placeHolder: 'connection name'            
        });
        if (!id) return;

        const host = await vscode.window.showInputBox({
            title: 'Add new NETCONF server',
            prompt: 'Enter IP address or hostname',
            placeHolder: 'hostname'
        });
        if (!host) return;

        const port = await vscode.window.showInputBox({
            title: 'Add new NETCONF server',
            prompt: 'Enter port',
            value:  vscode.workspace.getConfiguration("netconf").get("defaultPort", 830).toString()
        });
        if (!port) return;

        const user = await vscode.window.showInputBox({
            title: 'Add new NETCONF server',
            prompt: 'Enter username',
            value:  vscode.workspace.getConfiguration("netconf").get("defaultUser", "admin")
        });
        if (!user) return;

        const caps = vscode.workspace.getConfiguration("netconf").get("defaultCapabilities", [
            "urn:ietf:params:netconf:base:1.0", "urn:ietf:params:netconf:base:1.1"
        ]);

        if (id && host && port && user && caps) {
            const servers : ConnectInfo[] | [] = vscode.workspace.getConfiguration('netconf').get('serverList') ?? [];

            if (servers.some(e => e.id === id))
                vscode.window.showErrorMessage('Connection already exists! Provide unique connection name!');
            else {
                const newEntry : ConnectInfo = {
                    id: id,
                    host: host,
                    port: Number(port),
                    username: user,
                    clientCapabilities: caps
                };

                servers.push(newEntry);
                vscode.workspace.getConfiguration('netconf').update('serverList', servers, vscode.ConfigurationTarget.Global);
            }
        }
    }

    async clabAddHost(node: any) {
        if (node?.label && node?.v4Address && node?.kind) {
            const servers : ConnectInfo[] | [] = vscode.workspace.getConfiguration('netconf').get('serverList') ?? [];

            if (servers.some(e => e.id === node.label))
                vscode.window.showErrorMessage('Connection already exists!');
            else {
                const host = node.v4Address.split('/')[0];

                const user = vscode.workspace.getConfiguration("netconf").get("defaultUser", "admin");
                const port = vscode.workspace.getConfiguration("netconf").get("defaultPort", 830);
                const caps = vscode.workspace.getConfiguration("netconf").get("defaultCapabilities", [
                    "urn:ietf:params:netconf:base:1.0", "urn:ietf:params:netconf:base:1.1"
                ]);
    
                const newEntry : ConnectInfo = {
                    id: node.label,
                    host: host,
                    username: user,
                    port: port,
                    clientCapabilities: caps
                };
    
                servers.push(newEntry);
                vscode.workspace.getConfiguration('netconf').update('serverList', servers, vscode.ConfigurationTarget.Global);
            }
        } else {
            const logs = new ExtensionLogger(`netconf | clab`);
            logs.info('clab connect: ', JSON.stringify(node));
			logs.warn("Information from containerlab is not yet available! Need to wait...");
            vscode.window.showWarningMessage('Information from containerlab is not yet available! Please wait and try again...');
        }
    }

    async removeServer(server: NetconfServerEntry) {
        if (server.label) {
            let servers : ConnectInfo[] | [] = vscode.workspace.getConfiguration('netconf').get('serverList') ?? [];
            servers = servers.filter(entry => entry.id !== server.label);
            vscode.workspace.getConfiguration('netconf').update('serverList', servers, vscode.ConfigurationTarget.Global);
        }
    }
}

export class NetconfServerEntry extends vscode.TreeItem {
    public serverInfo: ConnectInfo;

    constructor(server : ConnectInfo) {
        super(server.id, vscode.TreeItemCollapsibleState.None);
        this.serverInfo = server;
        this.tooltip = new vscode.MarkdownString(`**${this.label}**\n\n**host:** ${this.serverInfo.host}\n\n**port:** ${this.serverInfo.port}\n\n**user:** ${this.serverInfo.username}`);
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
		const count = this.connections.length;
		if (count>0)
			updateBadge({value: count, tooltip: `${count} connections`});
		else
			updateBadge(undefined);

        this._onDidChangeTreeData.fire();
    }

    connect(server: NetconfServerEntry) {
        const connectionEntry = new NetconfConnectionEntry(server.serverInfo);
        this.connections.push(connectionEntry);

        connectionEntry.onDidChange(() => {
            this.connections = this.connections.filter(c => c.initializing || c.running);
            this.refresh();
        });
    }

    clabConnect(node: any) {    
        if (node?.label && node?.v4Address && node?.kind) {
            const host = node.v4Address.split('/')[0];
            const user = vscode.workspace.getConfiguration("netconf").get("defaultUser", "admin");
            const port = vscode.workspace.getConfiguration("netconf").get("defaultPort", 830);
            const caps = vscode.workspace.getConfiguration("netconf").get("defaultCapabilities", [
                "urn:ietf:params:netconf:base:1.0", "urn:ietf:params:netconf:base:1.1"
            ]);

            const serverInfo : ConnectInfo = {
                id: `${node.label} | ${user}@${host} | ${node.kind}`,
                host: host,
                username: user,
                port: port,
                clientCapabilities: caps
            };

            const connectionEntry = new NetconfConnectionEntry(serverInfo);
            this.connections.push(connectionEntry);
    
            connectionEntry.onDidChange(() => {
                this.connections = this.connections.filter(c => c.initializing || c.running);
                this.refresh();
            });
        } else {
            const logs = new ExtensionLogger(`netconf | clab`);
            logs.info('clab connect: ', JSON.stringify(node));
			logs.warn("Information from containerlab is not yet available! Need to wait...");
            vscode.window.showWarningMessage('Information from containerlab is not yet available! Please wait and try again...');
        }
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

    rpc(connection?: NetconfConnectionEntry) {
        if (connection) connection.rpc();
        else if (selection) selection.rpc();
    }

    getEvents(connection?: NetconfConnectionEntry) {
        if (connection) connection.getEvents();
        else if (selection) selection.getEvents();
    }
}

export class NetconfConnectionEntry extends vscode.TreeItem {
    private _onDidChange = new vscode.EventEmitter<NetconfConnectionEntry | undefined | null | void>();
    readonly onDidChange = this._onDidChange.event;

    public host: String;
    public user: String;
    public sessionId: Number;

    public logs: ExtensionLogger;
    public client : ncclient;

    public initializing : boolean;
    public running : boolean;

    private showSubscribe : boolean;
    private showCandidate : boolean;
    private isLocked : boolean;

    private startTS : number;
    private isBusy : boolean;
    private bytesReceived : number;
    private events : string[];

    private netcfgStatus: vscode.StatusBarItem | undefined;
    private eventStatus: vscode.StatusBarItem | undefined;


    constructor(server : ConnectInfo) {
        super(server.id, vscode.TreeItemCollapsibleState.None);

        this.host = server.host ?? "unknown";
        this.user = server.username ?? "unknown";
        this.sessionId = -1;

        this.initializing = true;
        this.running = false;
        this.showSubscribe = false;
        this.showCandidate = false;
        this.isLocked = false;
        this.isBusy = false;

        this.bytesReceived = 0;
        this.startTS = Date.now();
        this.events = [];

        this.logs = new ExtensionLogger(`netconf | ${server.host}`);
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
            vscode.window.showInformationMessage(`Connection established! Session-id: ${sessionId} | NETCONF server capabilities: ${caplist.join(' ')}`, 'Open', 'Cancel').then( async (action) => {
                if ('Open' === action) showXmlDocument(hello);
            });

            this.running = true;
            this.initializing = false;
            
            if (caplist.includes('notification'))
                this.showSubscribe = true;
    
            if (caplist.includes('candidate')) {
                this.showCandidate = true;
                this.isLocked = false;
            }

            this.sessionId = sessionId;

            this.refresh();
        });

        this.client.on('disconnected', () => {
            this.logs.info('session disconnected');
            this.running = false;
            this.initializing = false;
            this.spotlight(false);
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
            showXmlDocument(data);
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

        // --- update UI and connect --------------------------------------------

        const keysFile : string | undefined = vscode.workspace.getConfiguration('netconf').get('keysFile') || undefined;
        const sshdebug : boolean = vscode.workspace.getConfiguration('netconf').get('sshDebug') || false;

        if (!server.username)
            server.username = vscode.workspace.getConfiguration("netconf").get("defaultUser", "admin");

        if (!server.port)
            server.port = vscode.workspace.getConfiguration("netconf").get("defaultPort", 830);

        if (!server.clientCapabilities || server.clientCapabilities.length === 0)
            server.clientCapabilities = vscode.workspace.getConfiguration("netconf").get("defaultCapabilities", [
                "urn:ietf:params:netconf:base:1.0", "urn:ietf:params:netconf:base:1.1"
            ]);

        this.client.connect(server, keysFile, server.clientCapabilities, sshdebug, this.queryUserPassword);
    }

    spotlight(enable: boolean): void {
        if (enable) {
            if (!this.netcfgStatus) {
                this.netcfgStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 175);
                this.netcfgStatus.text = `$(terminal)`;
                this.netcfgStatus.command = 'netconf.rpc';
                this.netcfgStatus.tooltip = `send rpc to ${this.host}`;
                this.netcfgStatus.show();
            }
            if (!this.eventStatus) {
                this.eventStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 177);
                this.eventStatus.text = `$(terminal)`;
                this.eventStatus.command = 'netconf.getEvents';
                this.eventStatus.show();
            }
        } else {
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
            const lines:String[] = [];
            const received = this.bytesReceived < 10_000_000 ? (this.bytesReceived>>10)+'KB' : (this.bytesReceived>>20)+'MB';
            const events = this.events.length;

            lines.push(`**Session:** ${this.label} #${this.sessionId}`);
            lines.push(`**target:** ${this.user}@${this.host}`)
            lines.push(`**active:** ${(Date.now()-this.startTS)/1000 |0} seconds`);
            lines.push(`**received:** ${received}`);
            lines.push(`**events:** ${events}`);

            this.tooltip = new vscode.MarkdownString(lines.join('\n\n'), true);
            this.contextValue = this.computeContextValue();

            if (this.netcfgStatus)
                this.netcfgStatus.text = `$(terminal) ${this.label} ${received}`;

            if (this.eventStatus)
                this.eventStatus.text = `$(comment) ${events}`;

        } else {
            this.tooltip = new vscode.MarkdownString('disconnected');
            this.contextValue = undefined;    
        }

        this._onDidChange.fire();
    }

    async disconnect() {
        this.client.disconnect();
    }

	async rpc() {
		const editor = vscode.window.activeTextEditor;
		if (editor?.document)
			this.client?.rpc(editor.document.getText(), 300, (msgid : string, msg : string) => {
				this.logs.debug(`rpc #${msgid} done`);
			});
	}
    
	async get() {
		const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="getcfg" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><get/></rpc>';
		this.client?.rpc(request, 300, (msgid : string, msg : string) => {
			this.logs.debug(`rpc #${msgid} done`);
            this.refresh();
		});		
	}

	async getConfig() {
		const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="getcfg" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><get-config><source><running/></source></get-config></rpc>';
		this.client?.rpc(request, 300, (msgid : string, msg : string) => {
			this.logs.debug(`rpc #${msgid} done`);
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
		if (this.events.length > 1)
			showXmlDocument(`<?xml version="1.0" encoding="UTF-8"?>\n<notifications>\n${this.events.join('\n\n')}\n</notifications>`);
		else if (this.events.length > 0)
			showXmlDocument(`<?xml version="1.0" encoding="UTF-8"?>\n${this.events.join('\n\n')}`);

		this.events = [];
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
        return values.join(",");
    }
}

let updateBadge: (badge: vscode.ViewBadge | undefined ) => void;
let selection : NetconfConnectionEntry | undefined;

export function activate(context: vscode.ExtensionContext) {
	const ncsp = new NetconfServerProvider();
	vscode.window.registerTreeDataProvider('netconfServers', ncsp);

	const nccp = new NetconfConnectionProvider();
	const treeView = vscode.window.createTreeView('netconfConnections', { treeDataProvider: nccp });
    context.subscriptions.push(treeView);

    selection = undefined;
    treeView.onDidChangeSelection(event => {
        const newSelection = event.selection[0] as NetconfConnectionEntry || undefined;
        if (selection && selection !== newSelection)
            selection.spotlight(false);

        if (newSelection) {
            selection = newSelection;
            selection.spotlight(true);
        }
    });

	updateBadge = (badge: vscode.ViewBadge | undefined) => treeView.badge = badge;

	// --- server commands --------------------------------------------------

	context.subscriptions.push(vscode.commands.registerCommand('netconf.add',    () => ncsp.addServer()));
	context.subscriptions.push(vscode.commands.registerCommand('netconf.remove', ncsp.removeServer.bind(ncsp)));
    context.subscriptions.push(vscode.commands.registerCommand('netconf.update', () => {
        if (vscode.env.remoteName)
            vscode.commands.executeCommand('workbench.action.openRemoteSettings', 'netconf.serverList');
        else
            vscode.commands.executeCommand('workbench.action.openSettings', 'netconf.serverList');

        // For future consideration (going straight to JSON config):
        //
        // if (vscode.env.remoteName)
        //     vscode.commands.executeCommand('workbench.action.openRemoteSettingsFile');
        // else
        //     vscode.commands.executeCommand('workbench.action.openSettingsJson');
    }));

    // --- example command --------------------------------------------------

    context.subscriptions.push(vscode.commands.registerCommand('netconf.examples', () => {
		const gitPath   = vscode.workspace.getConfiguration('git').get('defaultCloneDirectory', os.homedir()).replace(/^~/, os.homedir());
        const gitRepo   = vscode.workspace.getConfiguration("netconf").get("examplesURL", "https://github.com/nokia/netconf-examples.git");
        const gitFolder = gitRepo.split('/').pop()?.replace('.git', '') ?? '';

        const gitUri = vscode.Uri.parse('file://'+gitPath);
		const repoUri = vscode.Uri.joinPath(gitUri, gitFolder);

		if (fs.existsSync(repoUri.fsPath)) {
            // netconf-examples already exists, add to workspace
			vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, null, { uri: repoUri});
		} else {
			// clone netconf-examples to add to workspace
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
}

export function deactivate() {
}