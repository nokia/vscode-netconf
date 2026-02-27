/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ConnectInfo } from './server-provider';
import type { Logger } from '../common/logger';
import { OutputChannelLogger } from '../common/output-channel-logger';
import { ncclient } from '../ncclient/ncclient';

export interface ConnectionProviderDeps {
    showXmlDocument: (data: string) => void;
    getSelection: () => NetconfConnectionEntry | undefined;
    setSelection: (entry: NetconfConnectionEntry | undefined) => void;
}

export class NetconfConnectionProvider implements vscode.TreeDataProvider<NetconfConnectionEntry> {
    private _onDidChangeTreeData = new vscode.EventEmitter<NetconfConnectionEntry | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private connections: NetconfConnectionEntry[];
    private secrets: vscode.SecretStorage;
    private log: Logger;
    private deps: ConnectionProviderDeps;
    private updateBadgeFn: ((badge: vscode.ViewBadge | undefined) => void) | undefined;

    constructor(secrets: vscode.SecretStorage, log: Logger, deps: ConnectionProviderDeps) {
        this.connections = [];
        this.secrets = secrets;
        this.log = log;
        this.deps = deps;
    }

    setUpdateBadge(fn: (badge: vscode.ViewBadge | undefined) => void): void {
        this.updateBadgeFn = fn;
    }

    refresh(): void {
        this.connections = this.connections.filter(c => c.initializing || c.running);

        const count = this.connections.length;
        if (this.updateBadgeFn) {
            if (count > 0)
                this.updateBadgeFn({ value: count, tooltip: `${count} connections` });
            else
                this.updateBadgeFn(undefined);
        }

        const selection = this.deps.getSelection();
        if (count === 1 && selection === undefined)
            this.connections[0].spotlight(true);

        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: NetconfConnectionEntry): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(_element?: NetconfConnectionEntry | undefined): vscode.ProviderResult<NetconfConnectionEntry[]> {
        return this.connections;
    }

    connect(server: import('./server-provider').NetconfServerEntry) {
        const connectionEntry = new NetconfConnectionEntry(server.serverInfo, '(managed)', this.secrets, this.deps);
        this.connections.push(connectionEntry);
        connectionEntry.onDidChange(() => this.refresh());
    }

    clabConnect(node: { name?: string; label?: string; kind?: string; v6Address?: string; v4Address?: string; cID?: string }) {
        let sshTarget: string | undefined;

        if (node.name) {
            sshTarget = node.name;
        } else if (node.v6Address) {
            sshTarget = node.v6Address;
        } else if (node.v4Address) {
            sshTarget = node.v4Address;
        } else if (node.cID) {
            sshTarget = node.cID;
        } else {
            this.log.warn("Information from containerlab is not yet available! Need to wait...");
            return vscode.window.showWarningMessage('Information from containerlab is not yet available! Please wait and try again...');
        }
        if (!sshTarget) return;

        const serverInfo: ConnectInfo = {
            id: node.label ?? sshTarget ?? 'containerlab',
            host: sshTarget,
            username: vscode.workspace.getConfiguration("netconf").get("defaultUser", "admin"),
            port: vscode.workspace.getConfiguration("netconf").get("defaultPort", 830),
            clientCapabilities: vscode.workspace.getConfiguration("netconf").get("defaultCapabilities", ["urn:ietf:params:netconf:base:1.0", "urn:ietf:params:netconf:base:1.1"]),
            keepaliveCountMax: 3,
            keepaliveInterval: 5000,
            tryKeyboard: true
        };

        const connectionEntry = new NetconfConnectionEntry(serverInfo, `(containerlab: ${node.kind})`, this.secrets, this.deps);
        this.connections.push(connectionEntry);
        connectionEntry.onDidChange(() => this.refresh());
    }

    disconnect(connection: NetconfConnectionEntry) { connection.disconnect(); }
    commit(connection: NetconfConnectionEntry) { connection.commit(); }
    discard(connection: NetconfConnectionEntry) { connection.discard(); }
    validate(connection: NetconfConnectionEntry) { connection.validate(); }
    unlock(connection: NetconfConnectionEntry) { connection.unlock(); }
    lock(connection: NetconfConnectionEntry) { connection.lock(); }
    getConfig(connection: NetconfConnectionEntry) { connection.getConfig(); }
    get(connection: NetconfConnectionEntry) { connection.get(); }
    subscribe(connection: NetconfConnectionEntry) { connection.subscribe(); }

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

    async rpc(context?: NetconfConnectionEntry | vscode.Uri) {
        const selection = this.deps.getSelection();
        if (context instanceof NetconfConnectionEntry) {
            const editor = vscode.window.activeTextEditor;
            if (editor?.document && editor.document.languageId === "xml")
                context.rpc(editor.document.getText());
            else {
                const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
                if (input !== null && typeof input === "object" && "uri" in input) {
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
                const document = await vscode.workspace.openTextDocument(context);
                selection.rpc(document.getText());
            } else {
                const editor = vscode.window.activeTextEditor;
                if (editor?.document && editor.document.languageId === "xml")
                    selection.rpc(editor.document.getText());
                else {
                    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
                    if (input !== null && typeof input === "object" && "uri" in input) {
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
        const selection = this.deps.getSelection();
        if (connection) connection.getEvents();
        else if (selection) selection.getEvents();
    }
}

export class NetconfConnectionEntry extends vscode.TreeItem {
    private _onDidChange = new vscode.EventEmitter<NetconfConnectionEntry | undefined | null | void>();
    readonly onDidChange = this._onDidChange.event;

    public host: string;
    public user: string;
    public sessionId: number;

    public logs: OutputChannelLogger;
    public client: ncclient;

    public initializing: boolean;
    public running: boolean;

    private showSubscribe: boolean;
    private showCandidate: boolean;
    private showLibrary: boolean;
    private isLocked: boolean;

    private established: string;
    private isBusy: boolean;
    private bytesReceived: number;
    private events: string[];

    private additionalInfo: string;

    private netcfgStatus: vscode.StatusBarItem | undefined;
    private eventStatus: vscode.StatusBarItem | undefined;

    private deps: ConnectionProviderDeps;
    private _secrets: vscode.SecretStorage;

    constructor(server: ConnectInfo, extraInfo: string | undefined, secrets: vscode.SecretStorage, deps: ConnectionProviderDeps) {
        super(server.id, vscode.TreeItemCollapsibleState.None);

        this.deps = deps;
        this._secrets = secrets;
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
        this.established = new Intl.DateTimeFormat('en-US', { year: "numeric", month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' }).format(Date.now());

        this.additionalInfo = '';
        this.events = [];

        this.logs = new OutputChannelLogger(`netconf | ${server.id}`);
        this.client = new ncclient(this.logs);

        this.logs.info(`Connecting to ${this.user}@${this.host}...`);

        this.netcfgStatus = undefined;
        this.eventStatus = undefined;

        this.client.on('sshBanner', (banner: string) => {
            if (banner.trim().length > 0)
                vscode.window.showInformationMessage(banner);
        });

        this.client.on('sshGreeting', (greeting: string) => {
            if (greeting.trim().length > 0)
                vscode.window.showInformationMessage(greeting);
        });

        this.client.on('connected', (hello: string, caplist: string[], sessionId: number) => {
            vscode.window.showInformationMessage(`Session-id: ${sessionId} | NETCONF server capabilities: ${caplist.join(' ')}`, 'Open', 'Cancel').then(async (action) => {
                if ('Open' === action) deps.showXmlDocument(hello);
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
            if (this.deps.getSelection() === this)
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
            const autoOpen: boolean = vscode.workspace.getConfiguration('netconf').get('autoOpenResponses', true);
            if (autoOpen) {
                deps.showXmlDocument(data);
            } else {
                vscode.window.showInformationMessage(`netconf #${msgid}: success, time=${elapsed}`, 'Open', 'Cancel').then(async (action) => {
                    if ('Open' === action)
                        deps.showXmlDocument(data);
                });
            }
            this.refresh();
        });

        this.client.on('rpcError', (msgid, errmsg, msg, elapsed) => {
            vscode.window.showWarningMessage(`netconf #${msgid}: failed, time=${elapsed}`, 'Open', 'Cancel').then(async (action) => {
                if ('Open' === action) deps.showXmlDocument(msg);
            });
            this.refresh();
        });

        this.client.on('netconfError', (errmsg, msg) => {
            vscode.window.showWarningMessage(errmsg, 'Open', 'Cancel').then(async (action) => {
                if ('Open' === action) deps.showXmlDocument(msg);
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

        this.client.on('notification', (data: string) => {
            this.events.push(data.replace(/<\?xml.+?\?>\s*/g, ''));
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
            if (idx < total)
                this.additionalInfo = `>>> yang download ${idx}/${total}; ${module}@${revision} done`;
            else
                this.additionalInfo = '';

            this.refresh();
        });

        this.connect(server);
    }

    async connect(server: ConnectInfo): Promise<void> {
        const keysFile: string | undefined = vscode.workspace.getConfiguration('netconf').get('keysFile') || undefined;
        const sshdebug: boolean = vscode.workspace.getConfiguration('netconf').get('sshDebug') || false;

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
            config.password = await this._secrets.get(`${config.username}@${config.host}`);

        this.client.connect(config, keysFile, server.clientCapabilities, sshdebug, this.queryUserPassword);
    }

    spotlight(enable: boolean): void {
        if (enable) {
            this.deps.setSelection(this);
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
            this.deps.setSelection(undefined);
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
            const lines: string[] = [];
            const received = this.bytesReceived < 10_000_000 ? (this.bytesReceived >> 10) + 'KB' : (this.bytesReceived >> 20) + 'MB';
            const events = this.events.length;

            lines.push(`**Session:** ${this.label} #${this.sessionId}`);
            lines.push(`**target:** ${this.user}@${this.host}`);
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

    async rpc(request: string) {
        this.client?.rpc(request, 300, (msgid: string, _msg: string) => {
            this.logs.debug(`rpc #${msgid} done`);
            this.refresh();
        });
    }

    async get() {
        const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="getcfg" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><get/></rpc>';
        this.client?.rpc(request, 300, (msgid: string, _msg: string) => {
            this.logs.debug(`rpc #${msgid} done`);
            this.refresh();
        });
    }

    async getConfig() {
        const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="getcfg" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><get-config><source><running/></source></get-config></rpc>';
        this.client?.rpc(request, 300, (msgid: string, _msg: string) => {
            this.logs.debug(`rpc #${msgid} done`);
            this.refresh();
        });
    }

    async subscribe() {
        this.events = [];
        this.showSubscribe = false;
        this.refresh();

        const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="subscribe" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><create-subscription xmlns="urn:ietf:params:xml:ns:netconf:notification:1.0" /></rpc>';
        this.client?.rpc(request, 60, (msgid: string, _msg: string) => {
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
            this.deps.showXmlDocument(`<?xml version="1.0" encoding="UTF-8"?>\n<notifications>\n${events}\n</notifications>`);
            this.events = [];
        } else this.deps.showXmlDocument(`<?xml version="1.0" encoding="UTF-8"?>\n${this.events.pop()}`);

        this.refresh();
    }

    async commit() {
        const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="commit" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><commit/></rpc>';
        this.client?.rpc(request, 60, (msgid: string, _msg: string) => {
            this.logs.debug(`rpc #${msgid} done`);
            this.refresh();
        });
    }

    async discard() {
        const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="discard" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><discard-changes/></rpc>';
        this.client?.rpc(request, 60, (msgid: string, _msg: string) => {
            this.logs.debug(`rpc #${msgid} done`);
            this.refresh();
        });
    }

    async validate() {
        const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="validate" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><validate><source><candidate/></source></validate></rpc>';
        this.client?.rpc(request, 60, (msgid: string, _msg: string) => {
            this.logs.debug(`rpc #${msgid} done`);
            this.refresh();
        });
    }

    async getSchemas(folder: string) {
        const addRevisions: boolean = vscode.workspace.getConfiguration('netconf').get('yangRevisions') || false;
        this.client?.getYangLibrary(folder, addRevisions);
    }

    async lock() {
        this.client?.lock();
    }

    async unlock() {
        this.client?.unlock();
    }

    queryUserPassword = (host: string, username: string): Thenable<string | undefined> => {
        return vscode.window.showInputBox({
            password: true,
            title: "Provide NETCONF password",
            placeHolder: `Enter password for ${username}@${host}`,
            prompt: "Authentication failure.",
            ignoreFocusOut: true
        }).then(password => {
            if (password) this._secrets.store(`${username}@${host}`, password);
            return password;
        });
    };

    private computeContextValue(): string {
        const values = [];
        if (this.events.length > 0) values.push("events");
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
