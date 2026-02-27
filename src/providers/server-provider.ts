/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import * as ssh2 from 'ssh2';
import * as vscode from 'vscode';
import type { Logger } from '../common/logger';

export interface ConnectInfo extends ssh2.ConnectConfig {
    id: string;
    clientCapabilities?: string[];
}

export class NetconfServerProvider implements vscode.TreeDataProvider<NetconfServerEntry> {
    private _onDidChangeTreeData = new vscode.EventEmitter<NetconfServerEntry | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private serverListEntries: NetconfServerEntry[];
    private log: Logger;

    constructor(log: Logger) {
        this.log = log;
        const servers: ConnectInfo[] = vscode.workspace.getConfiguration('netconf').get('serverList', []);
        this.serverListEntries = servers.map(entry => new NetconfServerEntry(entry));

        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('netconf.serverList')) {
                const servers: ConnectInfo[] = vscode.workspace.getConfiguration('netconf').get('serverList', []);
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

    getChildren(_element?: NetconfServerEntry | undefined): vscode.ProviderResult<NetconfServerEntry[]> {
        return this.serverListEntries;
    }

    async addServer(secrets: vscode.SecretStorage) {
        const servers: ConnectInfo[] = vscode.workspace.getConfiguration('netconf').get('serverList', []);

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
            value: vscode.workspace.getConfiguration("netconf").get("defaultPort", 830).toString()
        });
        if (!port) return;

        const user = await vscode.window.showInputBox({
            title: 'Add new managed device (step 4/5)',
            prompt: 'Enter username',
            value: vscode.workspace.getConfiguration("netconf").get("defaultUser", "admin")
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

        const newEntry: ConnectInfo = {
            id: id,
            host: host,
            port: Number(port),
            username: user,
            clientCapabilities: caps,
            keepaliveCountMax: 3,
            keepaliveInterval: 5000,
            tryKeyboard: true
        };
        servers.push(newEntry);

        try {
            await vscode.workspace.getConfiguration('netconf').update('serverList', servers, vscode.ConfigurationTarget.Global);
        }
        catch (e) {
            const errmsg = (e instanceof Error ? e.message : String(e)).replace(/^[A-Z0-9]+:/, '').trim();
            vscode.window.showErrorMessage(errmsg);
            this.log.error(errmsg);
        }
    }

    async clabAddHost(node: { name?: string; label?: string; kind?: string; v6Address?: string; v4Address?: string; cID?: string }) {
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

        const servers: ConnectInfo[] = vscode.workspace.getConfiguration('netconf').get('serverList', []);

        const newEntry: ConnectInfo = {
            id: node.label ?? sshTarget ?? 'containerlab',
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
            this.log.error(errmsg);
        }
    }
}

export class NetconfServerEntry extends vscode.TreeItem {
    public serverInfo: ConnectInfo;

    constructor(server: ConnectInfo) {
        super(server.id, vscode.TreeItemCollapsibleState.None);
        this.serverInfo = server;
        this.tooltip = new vscode.MarkdownString(`**${this.label}**\n\n**host:** ${this.serverInfo.host}\n\n**port:** ${this.serverInfo.port ?? "default"}\n\n**user:** ${this.serverInfo.username ?? "default"}`);
    }
}
