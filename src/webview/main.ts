/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  XML Navigator webview entry: acquire VS Code API, run the navigator app, register message listener, signal ready.
*/

import { initMessageListener, runNavigatorApp } from './navigatorApp';
import { initTooltips } from './tooltip';

declare const acquireVsCodeApi: () => { postMessage: (msg: unknown) => void; getState: () => unknown; setState: (s: unknown) => void };

const vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : { postMessage: () => {}, getState: () => null, setState: () => {} };

initTooltips();
const app = runNavigatorApp(vscode);
initMessageListener(app.handleIncomingMessage);
vscode.postMessage({ type: 'ready' });
