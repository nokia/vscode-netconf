/*
  @author Sven Wisotzky
  
  © 2025 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import * as vscode from 'vscode';
import * as ssh2 from 'ssh2';
import * as os from 'os';
import * as fs from 'fs';
import { ncclient } from './ncclient';
import { ExtensionLogger } from './vscExtensionLogger';
import xmlFormat from 'xml-formatter';

let logs = new ExtensionLogger('netconf')

interface ConnectInfo extends ssh2.ConnectConfig {
	id: string;
	clientCapabilities: string[];
}

function playAudio(soundFile: string) {
	// logs.debug(`playAudio(${soundFile})`)
	// const sound = new Audio(soundFile);
	// sound.volume = 1.0;
	// sound.play();
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

function showDocument(data: string) {
	vscode.workspace.openTextDocument({content: data}).then((doc) => {
		vscode.window.showTextDocument(doc);
	});
}

export function activate(context: vscode.ExtensionContext) {
	logs.info('Activating NETCONF client by Nokia');

	// --- audio files ------------------------------------------------------

	const expath = context.extensionUri;
    logs.info('vscode-netconf extension path:', expath.fsPath);

	const connectSound    = vscode.Uri.joinPath(expath, 'resources', 'audio', 'connect.oga'   ).fsPath;
	const disconnectSound = vscode.Uri.joinPath(expath, 'resources', 'audio', 'disconnect.oga').fsPath;

	const successSound    = vscode.Uri.joinPath(expath, 'resources', 'audio', 'success.oga'   ).fsPath;
	const clickSound      = vscode.Uri.joinPath(expath, 'resources', 'audio', 'click.oga'     ).fsPath;
	const eventSound      = vscode.Uri.joinPath(expath, 'resources', 'audio', 'event.oga'     ).fsPath;
	const messageSound    = vscode.Uri.joinPath(expath, 'resources', 'audio', 'message.oga'   ).fsPath;

	const infoSound       = vscode.Uri.joinPath(expath, 'resources', 'audio', 'info.oga'      ).fsPath;
	const warningSound    = vscode.Uri.joinPath(expath, 'resources', 'audio', 'warning.oga'   ).fsPath;
	const errorSound      = vscode.Uri.joinPath(expath, 'resources', 'audio', 'error.oga'     ).fsPath;
	const criticalSound   = vscode.Uri.joinPath(expath, 'resources', 'audio', 'critical.oga'  ).fsPath;

	// --- status bar entries -----------------------------------------------

	const statusbar_connect = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusbar_connect.command = 'netconf.connect';
	statusbar_connect.tooltip = 'NETCONF: disconnected';
	statusbar_connect.text = '$(terminal) netconf';
	statusbar_connect.show();

	const statusbar_server = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	statusbar_server.command = 'netconf.pickServer';
	statusbar_server.tooltip = 'NETCONF: server';
	statusbar_server.text = vscode.workspace.getConfiguration('netconf').get('activeServer') || "none";
	statusbar_server.show();

	const statusbar_notifications = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
	statusbar_notifications.hide();

	const statusbar_getcfg = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
	statusbar_getcfg.hide();

	const statusbar_get = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
	statusbar_get.hide();

	const statusbar_lock = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 94);
	statusbar_lock.hide();

	const statusbar_validate = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 93);
	statusbar_validate.hide();

	const statusbar_discard = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 92);
	statusbar_discard.hide();

	const statusbar_commit = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 91);
	statusbar_commit.hide();

	const statusbar_examples = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 91);
	statusbar_examples.command = 'netconf.examples';
	statusbar_examples.tooltip = 'Add netconf-examples to workspace';
	statusbar_examples.text = '$(cloud-download)';
	statusbar_examples.hide();

	const statusbar_busy = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
	statusbar_busy.hide();

	// --- event handlers ---------------------------------------------------

	const client = new ncclient(logs);
	let nlist : string[] = [];

	context.subscriptions.push(vscode.window.onDidChangeWindowState( (event : vscode.WindowState) => {
		// user is back
	}));

	client.on('sshBanner', (banner: string) => {
		vscode.window.showInformationMessage(banner, 'Open', 'Cancel').then( async (action) => {
			if ('Open' === action) {
				showDocument(banner);
			}
		});
	});

	client.on('sshGreeting', (greeting: string) => {
		vscode.window.showInformationMessage(greeting);
		playAudio(infoSound);
	});

	client.on('connected', (hello: string, caplist: string[], sessionId: Number) => {
		vscode.window.showInformationMessage(`session-id: ${sessionId} | NETCONF server capabilities: ${caplist.join(' ')}`, 'Open', 'Cancel').then( async (action) => {
			if ('Open' === action) {
				showXmlDocument(hello);
			}
		});

		// initialize/update statusbar
		statusbar_connect.command = 'netconf.disconnect';
		statusbar_connect.tooltip = 'NETCONF: connected';

		statusbar_server.command = undefined;

		statusbar_getcfg.command = 'netconf.getcfg';
		statusbar_getcfg.tooltip = 'NETCONF: <get-config>';
		statusbar_getcfg.text = '$(file-code)';
		statusbar_getcfg.show();

		statusbar_get.command = 'netconf.get';
		statusbar_get.tooltip = 'NETCONF: <get>';
		statusbar_get.text = '$(file-binary)';
		statusbar_get.show();

		if (caplist.includes('notification')) {
			statusbar_notifications.command = 'netconf.subscribe';
			statusbar_notifications.tooltip = 'NETCONF: subscribe notifications';
			statusbar_notifications.text = '$(comment-discussion)';
			statusbar_notifications.show();	
		}

		if (caplist.includes('candidate')) {
			statusbar_lock.command = 'netconf.lock';
			statusbar_lock.tooltip = 'NETCONF: lock candidate';
			statusbar_lock.text = '$(unlock)';		
			statusbar_lock.show();

			statusbar_validate.command = 'netconf.validate';
			statusbar_validate.tooltip = 'NETCONF: validate candidate';
			statusbar_validate.text = '$(tasklist)';		
			statusbar_validate.show();

			statusbar_discard.command = 'netconf.discard';
			statusbar_discard.tooltip = 'NETCONF: discard';
			statusbar_discard.text = '$(circle-slash)';
			statusbar_discard.show();

			statusbar_commit.command = 'netconf.commit';
			statusbar_commit.tooltip = 'NETCONF: commit';
			statusbar_commit.text = '$(live-share)';		
			statusbar_commit.show();
		}

		statusbar_busy.tooltip = 'NETCONF: busy';
		statusbar_busy.text = '$(loading~spin)';	
		statusbar_busy.hide();

		playAudio(connectSound);
	});

	client.on('disconnected', () => {
		statusbar_connect.command = 'netconf.connect';
		statusbar_connect.tooltip = 'NETCONF: disconnected';
		statusbar_connect.text = '$(terminal) netconf';

		statusbar_server.command = 'netconf.pickServer';

		statusbar_get.hide();		
		statusbar_getcfg.hide();

		if (nlist.length === 0) {
			statusbar_notifications.hide();
		}

		statusbar_lock.hide();
		statusbar_validate.hide();
		statusbar_discard.hide();
		statusbar_commit.hide();

		statusbar_busy.hide();

		playAudio(disconnectSound);
	});

	client.on('locked', () => {
		statusbar_lock.command = 'netconf.unlock';
		statusbar_lock.tooltip = 'NETCONF: unlock candidate';
		statusbar_lock.text = '$(lock)';
		playAudio(clickSound);
	});

	client.on('unlocked', () => {
		statusbar_lock.command = 'netconf.lock';
		statusbar_lock.tooltip = 'NETCONF: lock candidate';
		statusbar_lock.text = '$(unlock)';
		playAudio(clickSound);
	});

	client.on('click', () => {
		playAudio(clickSound);
	});

	client.on('rpcOk', (msgid, elapsed) => {
		vscode.window.showInformationMessage(`netconf #${msgid}: ok, time=${elapsed}`);
		playAudio(successSound);
	});

	client.on('rpcResponse', (msgid, data, elapsed) => {
		showXmlDocument(data);
		playAudio(successSound);
	});

	client.on('rpcError', (msgid, errmsg, msg, elapsed) => {
		vscode.window.showWarningMessage(`netconf #${msgid}: failed, time=${elapsed}`, 'Open', 'Cancel').then( async (action) => {
			if ('Open' === action) {
				showXmlDocument(msg);
			}
		});
		playAudio(warningSound);
	});

	client.on('netconfError', (errmsg, msg) => {
		vscode.window.showWarningMessage(errmsg, 'Open', 'Cancel').then( async (action) => {
			if ('Open' === action) {
				showXmlDocument(msg);
			}
		});
		playAudio(warningSound);
	});	

	client.on('rpcTimeout', (msgid) => {
		vscode.window.showInformationMessage(`netconf request #${msgid}: failed with timeout`);
		playAudio(warningSound);
	});

	client.on('busy', () => {
		statusbar_busy.show();
	});

	client.on('idle', () => {
		statusbar_busy.hide();
	});

	client.on('notification', (data: any) => {
		nlist.push(data);
		statusbar_notifications.command = 'netconf.notifications';
		statusbar_notifications.tooltip = `NETCONF: ${nlist.length} notifications received`;
		statusbar_notifications.text = `\$(comment) ${nlist.length}`;
		playAudio(eventSound);
	});	

	client.on('info', (message: string, details: string) => {
		logs.info(message, details);
		vscode.window.showInformationMessage(`${message}\n${details}`);
		playAudio(infoSound);
	});

	client.on('warning', (message: string, details: string) => {
		logs.warn(message, details);
		vscode.window.showWarningMessage(`${message}\n${details}`);
		playAudio(warningSound);
	});

	client.on('error', (message: string, details: string) => {
		logs.error(message, details);
		vscode.window.showErrorMessage(`${message}\n${details}`);
		playAudio(errorSound);
	});

	client.on('data', (bytes) => {
		if (bytes<10000000) {
			statusbar_connect.text = `\$(terminal) ${bytes>>10}KB`;
		} else {
			statusbar_connect.text = `\$(terminal) ${bytes>>20}MB`;
		}
	});

	// --- NETCONF connection -----------------------------------------------

	context.subscriptions.push(vscode.commands.registerCommand('netconf.pickServer', async () => {
		const servers : [ConnectInfo] | [] = vscode.workspace.getConfiguration('netconf').get('serverList') || [];

		if (servers) {
			let items = [];
			for (const idx in servers) {
				items.push({label: servers[idx].id, description: servers[idx].host});
			}

			const pickOp : vscode.QuickPickOptions = {
				title: "NETCONF server",
				placeHolder: "Select your netconf server from the list.",
				canPickMany: false,
				ignoreFocusOut: false,
				matchOnDescription: true,
				matchOnDetail: true
			}

			await vscode.window.showQuickPick(items, pickOp).then( async (selection) => {
				if (selection) {
					vscode.workspace.getConfiguration('netconf').update('activeServer', selection.label);
					statusbar_server.text = selection.label;
				}
			});
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('netconf.connect', async () => {
		const active : string | undefined = vscode.workspace.getConfiguration('netconf').get('activeServer') || undefined;
		const servers : [ConnectInfo] | [] = vscode.workspace.getConfiguration('netconf').get('serverList') || [];
		const keepAlive : number | undefined = vscode.workspace.getConfiguration('netconf').get('sshKeepAlive') || undefined; 
		const keysFile : string | undefined = vscode.workspace.getConfiguration('netconf').get('keysFile') || undefined;
		const sshdebug : boolean = vscode.workspace.getConfiguration('netconf').get('sshDebug') || false;

		for (const idx in servers) {
			if (servers[idx].id === active) {
				client.connect(servers[idx], keepAlive, keysFile, servers[idx].clientCapabilities, sshdebug);
				break;
			}
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('netconf.disconnect', async () => {
		client.disconnect();
	}));

	// --- NETCONF EXAMPLES -------------------------------------------------

	context.subscriptions.push(vscode.commands.registerCommand('netconf.examples', async () => {
		let gitPath = vscode.workspace.getConfiguration('git').get<string>('defaultCloneDirectory') || os.homedir();
		gitPath = gitPath.replace(/^~/, os.homedir());
		const gitUri = vscode.Uri.parse('file://'+gitPath);
		const repoUri = vscode.Uri.joinPath(gitUri, 'netconf-examples');

		if (fs.existsSync(repoUri.fsPath)) {
			logs.info('netconf-examples already exists, add to workspace');
			vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, null, { uri: repoUri});
		} else {
			logs.info('clone netconf-examples to add to workspace');
			vscode.commands.executeCommand('git.clone', 'https://github.com/nokia/netconf-examples.git', gitPath);
		}
	}));

	vscode.workspace.onDidChangeWorkspaceFolders(async () => {
		const workspaceFolders =  vscode.workspace.workspaceFolders ?  vscode.workspace.workspaceFolders : [];
		if (workspaceFolders.find( ({name}) => name === 'netconf-examples')) {
			statusbar_examples.hide();
		} else {
			statusbar_examples.show();
		}	
	});

	const workspaceFolders =  vscode.workspace.workspaceFolders ?  vscode.workspace.workspaceFolders : [];
	if (!(workspaceFolders.find( ({name}) => name === 'netconf-examples'))) {
		statusbar_examples.show();
	}	

	// --- NETCONF RPC ------------------------------------------------------

	context.subscriptions.push(vscode.commands.registerCommand('netconf.rpc', async () => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			if (editor.document) {
				client.rpc(editor.document.getText(), 300, (msgid : string, msg : string) => {
					logs.debug(`rpc #${msgid} done`);
				});
			}
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('netconf.getcfg', async () => {
		const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="getcfg" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><get-config><source><running/></source></get-config></rpc>';
		client.rpc(request, 300, (msgid : string, msg : string) => {
			logs.debug(`rpc #${msgid} done`);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('netconf.get', async () => {
		const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="getcfg" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><get/></rpc>';
		client.rpc(request, 300, (msgid : string, msg : string) => {
			logs.debug(`rpc #${msgid} done`);
		});
	}));

	// --- NETCONF notifications --------------------------------------------

	context.subscriptions.push(vscode.commands.registerCommand('netconf.subscribe', async () => {
		nlist = [];
		statusbar_notifications.command = undefined;
		statusbar_notifications.tooltip = undefined;
		statusbar_notifications.text = `\$(comment) 0`;

		const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="subscribe" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><create-subscription xmlns="urn:ietf:params:xml:ns:netconf:notification:1.0" /></rpc>';
		client.rpc(request, 60, (msgid : string, msg : string) => {
			logs.debug(`rpc #${msgid} done`);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('netconf.notifications', async () => {
		const events = nlist.length;

		if (events > 0) {
			let xmldoc = nlist.join('\n\n');
			nlist = [];
			if (events > 1) {
				const prettify : boolean = vscode.workspace.getConfiguration('netconf').get('prettify') || false;
				if (prettify) {
					xmldoc = '<?xml version="1.0" encoding="UTF-8"?>\n<notifications>\n'+xmldoc.replace(/\<\?xml.+\?\>\s*/g, '')+'\n</notifications>';
				}
			}
			showXmlDocument(xmldoc);
		}

		if (statusbar_connect.tooltip === 'NETCONF: disconnected') {
			statusbar_notifications.hide();
		} else {
			statusbar_notifications.command = undefined;
			statusbar_notifications.tooltip = undefined;
			statusbar_notifications.text = `\$(comment) 0`;	
		}

	}));	

	// --- NETCONF candidate ------------------------------------------------

	context.subscriptions.push(vscode.commands.registerCommand('netconf.commit', async () => {
		const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="commit" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><commit/></rpc>';
		client.rpc(request, 60, (msgid : string, msg : string) => {
			logs.debug(`rpc #${msgid} done`);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('netconf.discard', async () => {
		const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="discard" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><discard-changes/></rpc>';
		client.rpc(request, 60, (msgid : string, msg : string) => {
			logs.debug(`rpc #${msgid} done`);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('netconf.validate', async () => {
		const request = '<?xml version="1.0" encoding="UTF-8"?><rpc message-id="validate" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><validate><source><candidate/></source></validate></rpc>';
		client.rpc(request, 60, (msgid : string, msg : string) => {
			logs.debug(`rpc #${msgid} done`);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('netconf.lock', async () => {
		client.lock();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('netconf.unlock', async () => {
		client.unlock();
	}));
}