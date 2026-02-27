/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import * as os from 'os';
import * as fs from 'fs';
import * as vscode from 'vscode';

import { spawn } from 'child_process';

import xmlFormat from 'xml-formatter';

import { OutputChannelLogger } from './common/output-channel-logger';
import { NetconfServerProvider, NetconfServerEntry, ConnectInfo } from './providers/server-provider';
import { NetconfConnectionProvider, NetconfConnectionEntry } from './providers/connection-provider';

const log: OutputChannelLogger = new OutputChannelLogger('netconf | common');
let secrets: vscode.SecretStorage;

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
    const prettify : boolean = vscode.workspace.getConfiguration('netconf').get('prettify', false);

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

export async function activate(context: vscode.ExtensionContext) {
	secrets = context.secrets;

	let selection: NetconfConnectionEntry | undefined = undefined;
	const connectionDeps = {
		showXmlDocument,
		getSelection: () => selection,
		setSelection: (entry: NetconfConnectionEntry | undefined) => { selection = entry; }
	};

	const ncsp = new NetconfServerProvider(log);
	vscode.window.registerTreeDataProvider('netconfServers', ncsp);

	const nccp = new NetconfConnectionProvider(secrets, log, connectionDeps);
	const treeView = vscode.window.createTreeView('netconfConnections', { treeDataProvider: nccp });
	context.subscriptions.push(treeView);

	const treeViewM = vscode.window.createTreeView('netconfConnectionMgmt', { treeDataProvider: nccp });
	context.subscriptions.push(treeViewM);

	nccp.setUpdateBadge((badge: vscode.ViewBadge | undefined) => { treeViewM.badge = badge; });

	treeViewM.onDidChangeSelection(event => {
		const newSelection = event.selection[0] as NetconfConnectionEntry | undefined;
		if (selection !== newSelection) selection?.spotlight(false);
		if (newSelection) newSelection.spotlight(true);
	});

	// --- server commands --------------------------------------------------

	context.subscriptions.push(vscode.commands.registerCommand('netconf.add', () => ncsp.addServer(secrets)));

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

            const newEntry : ConnectInfo = { ...server.serverInfo };
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
    
    context.subscriptions.push(vscode.commands.registerCommand('netconf.examples', async () => {
        let gitPath = vscode.workspace.getConfiguration('git').get<string>('defaultCloneDirectory') || os.homedir();
        const gitRepo = vscode.workspace.getConfiguration("netconf").get<string>("examplesURL") || "https://github.com/nokia/netconf-examples.git";

        gitPath = gitPath.replace(/^~/, os.homedir());

        const examplesPath = vscode.Uri.joinPath(
            vscode.Uri.file(gitPath),
            gitRepo.split('/').pop()?.replace(/\.git$/, '') ?? ''
        );

        const openExamplesPath = vscode.Uri.joinPath(examplesPath, 'LICENSE');

        if (fs.existsSync(examplesPath.fsPath)) {
            log.info(`Adding ${examplesPath.fsPath} to workspace`);
            await vscode.commands.executeCommand('workbench.view.explorer');
            vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, null, { uri: examplesPath});

            await new Promise(r => setTimeout(r, 1500));
            log.info(`Showing ${openExamplesPath.fsPath} in workspace`);
            await vscode.commands.executeCommand('revealInExplorer', openExamplesPath);
        } else {
            log.warn(`❌ Git clone failed`);

            log.info(`Cloning ${gitRepo} using git shell-command...`);
            const child = spawn("git", ["clone", gitRepo], {cwd: gitPath, shell: true});

            child.stdout.on("data", (data) => log.debug(data.toString()) );
            child.stderr.on("data", (data) => log.debug(data.toString()) );

            child.on("close", async (code) => {
                if (code === 0) {
                    log.info("✅ Git clone completed successfully!");

                    log.info(`Adding ${examplesPath.fsPath} to workspace`);
                    vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, null, { uri: examplesPath});

                    vscode.window.showInformationMessage('NETCONF examples cloned successfully!', 'Open').then( async (action) => {
                        if ('Open' === action) {
                            log.info(`Showing ${openExamplesPath.fsPath} in workspace`);
                            await vscode.commands.executeCommand('workbench.view.explorer');
                            await vscode.commands.executeCommand('revealInExplorer', openExamplesPath);
                        }
                    });
                } else {
                    log.warn(`❌ Git clone failed with exit code ${code}`);
                    vscode.window.showErrorMessage('Failed to clone NETCONF examples!');
                }
            });

            child.on("error", (err) => {
                log.error(`🔥 Failed to run git shell-command as sub-process: ${err.message}`);
                vscode.window.showErrorMessage('Failed to clone NETCONF examples!');
            });
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

	// --- XML Navigator -------------------------------------------------------
	context.subscriptions.push(
		vscode.commands.registerCommand('netconf.xml.openNavigator', async () => {
			let isXmlDocument: (doc: vscode.TextDocument) => boolean;
			try {
				const mod = await import('./webview-backend/xml-navigator-panel');
				isXmlDocument = mod.isXmlDocument;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				vscode.window.showErrorMessage(`XML Navigator: failed to load. ${msg}`);
				log.error('XML Navigator: failed to load provider', err);
				return;
			}
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showWarningMessage('No active editor. Open an XML document first.');
				return;
			}
			const document = editor.document;
			if (!isXmlDocument(document)) {
				vscode.window.showWarningMessage(
					'Current document is not recognized as XML. Set language to XML or ensure content starts with <?xml or <.'
				);
				return;
			}
			const { XmlNavigatorPanel } = await import('./webview-backend/xml-navigator-panel');
			const panel = XmlNavigatorPanel.getOrCreate(context, log);
			panel.openNavigator(document);
		}),
		vscode.commands.registerCommand('netconf.xml.revealInNavigator', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) return;
			const document = editor.document;
			let isXmlDocument: (doc: vscode.TextDocument) => boolean;
			try {
				const mod = await import('./webview-backend/xml-navigator-panel');
				isXmlDocument = mod.isXmlDocument;
			} catch {
				return;
			}
			if (!isXmlDocument(document)) return;
			const { parseXml } = await import('./parser');
			const { getPathForNavigatorAtCursor } = await import('./webview-backend/xml-navigator-panel');
			const parseResult = parseXml(document.getText());
			if (parseResult.rootId < 0) return;
			const path = getPathForNavigatorAtCursor(document, parseResult);
			if (!path) return;
			const { XmlNavigatorPanel } = await import('./webview-backend/xml-navigator-panel');
			const panel = XmlNavigatorPanel.getOrCreate(context, log);
			panel.navigateToPath(document, path);
		})
	);
	try {
		const { XmlNavigatorPanel } = await import('./webview-backend/xml-navigator-panel');
		context.subscriptions.push(XmlNavigatorPanel.register(context, log));
	} catch (err) {
		log.error('XML Navigator: failed to register provider', err);
	}
}

export function deactivate(): void {
    // Extension teardown; no-op when no resources to release.
}