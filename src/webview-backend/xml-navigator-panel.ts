/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  XML Navigator provider: single shared Webview panel (Table View / Element View).

  Entry: extension.ts registers command "XML: Open XML Navigator" and this provider.
  XML changes: all document edits are triggered by webview messages in attachMessageHandler()
  (edit, editBatch, deleteNode, addLeafListItem, addListRow, pasteGrid); each builds a
  WorkspaceEdit via documentSync and applies it with workspace.applyEdit.
  No UI here: parsing, path filter, table/dict building, and edit mapping live in
  parser, filter, pathResolver, tableBuilder, dictBuilder, documentSync.
*/

import * as vscode from 'vscode';
import { parseXml, publishParseDiagnostics, isParseUsable, filterNodesByPath } from '../parser';
import { suggestDefaultPath } from './path-resolver';
import { createDebouncedApplier } from './document-sync';
import { getTableColumnKey } from '../common/table-column-helpers';
import { buildListView } from './table-builder';
import { buildDictEntries, type DictEntry } from './dict-builder';
import type { XmlParseResult } from '../parser/types';
import { getHtmlForWebview } from './webview-html';
import { strings } from '../webview/strings';
import {
  dispatchMessage,
  type NavigatorMessageContext,
  type PanelState as MessagePanelState,
  type IncomingMessage,
} from './message-handlers';
import type { Logger } from '../common/logger';

const SHARED_VIEW_TYPE = 'netconf.xml.navigator';

function getShowAttributesSetting(): boolean {
  return vscode.workspace.getConfiguration('netconf.xml').get<boolean>('showAttributes', false);
}

/**
 * Get path for the XML Navigator when user invokes "Reveal in Navigator" at cursor.
 * Elevates to parent so we never navigate to leaf/leaf-list: show the dict or list that contains the clicked element.
 */
export function getPathForNavigatorAtCursor(document: vscode.TextDocument, parseResult: XmlParseResult): string {
  const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === document.uri.toString());
  if (!editor) return '';
  const offset = editor.document.offsetAt(editor.selection.start);
  const nodeId = parseResult.nodeAtOffset(offset);
  if (nodeId < 0) return '';
  const node = parseResult.nodesById.get(nodeId);
  if (!node) return '';
  const { nodesById } = parseResult;

  // Leaf (no element children): show parent dict. Root leaf stays at root.
  if (node.childIds.length === 0) {
    if (node.parentId < 0) return node.pathFromRoot.join('/');
    const parent = nodesById.get(node.parentId);
    return parent ? parent.pathFromRoot.join('/') : node.pathFromRoot.join('/');
  }

  // List entry (parent has multiple same-tag children): show the list (table view).
  if (node.parentId >= 0) {
    const parent = nodesById.get(node.parentId);
    if (!parent) return node.pathFromRoot.join('/');
    const sameTagSiblings = parent.childIds.filter((id) => nodesById.get(id)?.tagName === node.tagName);
    if (sameTagSiblings.length > 1) {
      return [...parent.pathFromRoot, node.tagName].join('/');
    }
  }

  // List container (this node has multiple same-tag children): show the list (table view).
  const firstChild = nodesById.get(node.childIds[0]);
  if (node.childIds.length > 1 && firstChild && node.childIds.every((id) => nodesById.get(id)?.tagName === firstChild.tagName)) {
    return [...node.pathFromRoot, firstChild.tagName].join('/');
  }

  // Dict or single container: show this node.
  return node.pathFromRoot.join('/');
}

function textContentForDisplay(s: string): string {
  return s.replace(/\\n/g, '\n');
}

function dictEntriesForDisplay(entries: DictEntry[]): DictEntry[] {
  return entries.map((e) => ({
    ...e,
    value: e.value != null ? textContentForDisplay(e.value) : e.value,
    leafListValues: e.leafListValues?.map((v) => ({ ...v, value: textContentForDisplay(v.value) })) as DictEntry['leafListValues'],
    children: e.children ? dictEntriesForDisplay(e.children) : e.children,
  }));
}

/**
 * Only update the XML text editor's selection when the Navigator is the source of the action.
 * If the XML document is the active editor, never change its selection (avoid disrupting the user).
 */
function shouldUpdateTextEditorSelection(uri: string): boolean {
  const active = vscode.window.activeTextEditor;
  if (!active) return true;
  return active.document.uri.toString() !== uri;
}

function revealInTextEditor(uri: string, startOffset: number, endOffset: number, forceUpdate = false): void {
  if (!forceUpdate && !shouldUpdateTextEditorSelection(uri)) return;
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
  if (!doc) return;
  const start = doc.positionAt(Math.max(0, startOffset - 1));
  const end = doc.positionAt(endOffset);
  const range = new vscode.Range(start, end);
  const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri);
  if (editor) {
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(start, end);
  }
}

/**
 * Compute the XML range that corresponds to the current path view:
 * - Single node (dict): the entire element with all its children.
 * - Multiple nodes (list/table): the entire list container (parent element), or first-to-last span, or first list entry.
 */
function getSelectionRangeForPath(
  parseResult: XmlParseResult,
  nodeIds: number[]
): { startOffset: number; endOffset: number } | null {
  if (nodeIds.length === 0) return null;
  if (nodeIds.length === 1) {
    const node = parseResult.nodesById.get(nodeIds[0]);
    return node ? { startOffset: node.startOffset, endOffset: node.endOffset } : null;
  }
  // List/table: try entire list container (parent), then span of all items, then first entry only.
  const firstNode = parseResult.nodesById.get(nodeIds[0]);
  if (!firstNode) return null;
  const parentId = firstNode.parentId;
  if (parentId >= 0) {
    const parent = parseResult.nodesById.get(parentId);
    if (parent) return { startOffset: parent.startOffset, endOffset: parent.endOffset };
  }
  const lastNode = parseResult.nodesById.get(nodeIds[nodeIds.length - 1]);
  if (lastNode) return { startOffset: firstNode.startOffset, endOffset: lastNode.endOffset };
  // Fallback: select first list entry only.
  return { startOffset: firstNode.startOffset, endOffset: firstNode.endOffset };
}

/** Sync XML editor selection to the current path (dict = whole element, list = whole list). Use when path was changed by user. */
function syncSelectionToPath(uri: string, parseResult: XmlParseResult, pathFilter: string, forceUpdate: boolean): void {
  const nodeIds = pathFilter ? filterNodesByPath(parseResult, pathFilter) : parseResult.rowOrder;
  const range = getSelectionRangeForPath(parseResult, nodeIds);
  if (range) revealInTextEditor(uri, range.startOffset, range.endOffset, forceUpdate);
}



/** Panel state for the shared Navigator; also used by message handlers. */
type PanelState = MessagePanelState;

export class XmlNavigatorPanel {
  private static instance: XmlNavigatorPanel | null = null;

  private readonly diagnosticCollection: vscode.DiagnosticCollection;
  private sharedPanel: vscode.WebviewPanel | null = null;
  private sharedState: (PanelState & { uri: string }) | null = null;
  private lastActiveXmlUri: string | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log?: Logger
  ) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('netconf.xml');
  }

  public static getOrCreate(context: vscode.ExtensionContext, log?: Logger): XmlNavigatorPanel {
    if (!XmlNavigatorPanel.instance) {
      XmlNavigatorPanel.instance = new XmlNavigatorPanel(context, log);
    }
    return XmlNavigatorPanel.instance;
  }

  public static register(context: vscode.ExtensionContext, log?: Logger): vscode.Disposable {
    const provider = XmlNavigatorPanel.getOrCreate(context, log);
    const activeEditorSub = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isXmlDocument(editor.document)) {
        provider.setLastActiveXmlUri(editor.document.uri.toString());
        provider.refreshIfShowing(editor.document);
      }
    });
    const closeDocSub = vscode.workspace.onDidCloseTextDocument((document) => {
      if (provider.isShowingDocument(document.uri.toString())) {
        provider.showDocumentClosedError();
      }
    });
    return vscode.Disposable.from(provider.diagnosticCollection, activeEditorSub, closeDocSub);
  }

  public setLastActiveXmlUri(uri: string): void {
    this.lastActiveXmlUri = uri;
  }

  /** Open XML Navigator with the given document (create panel if needed, then show this doc). */
  public openNavigator(document: vscode.TextDocument): void {
    this.lastActiveXmlUri = document.uri.toString();
    if (this.sharedPanel) {
      this.sharedPanel.reveal(undefined, true);
      this.updateSharedPanelContent(document);
      return;
    }
    this.sharedPanel = vscode.window.createWebviewPanel(
      SHARED_VIEW_TYPE,
      strings.appTitle,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.sharedPanel.iconPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      'resources',
      'icon.svg'
    );
    this.sharedPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    const scriptUri = this.sharedPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.js')
    );
    const codiconsCssUri = this.sharedPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
    );
    const codiconsFontUri = this.sharedPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf')
    );
    this.sharedPanel.webview.html = getHtmlForWebview(
      this.sharedPanel.webview,
      scriptUri,
      codiconsCssUri,
      codiconsFontUri
    );

    this.sharedState = {
      uri: document.uri.toString(),
      pathFilter: '',
      showAttributes: getShowAttributesSetting(),
      parseResult: null,
    };

    const docChangeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (!this.sharedState || e.document.uri.toString() !== this.sharedState.uri) return;
      this.updateSharedPanelContent(e.document);
    });
    const configChangeSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('netconf.xml.showAttributes') && this.sharedState) {
        this.sharedState.showAttributes = getShowAttributesSetting();
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.sharedState?.uri);
        if (doc) this.updateSharedPanelContent(doc);
      }
    });
    this.sharedPanel.onDidDispose(() => {
      docChangeSub.dispose();
      configChangeSub.dispose();
      this.sharedPanel = null;
      this.sharedState = null;
    });

    this.updateSharedPanelContent(document);
    this.attachMessageHandler();
    if (this.log) this.log.info('XML Navigator launched');
  }

  /** True if the Navigator is showing this document (so we can show an error when it is closed). */
  public isShowingDocument(uri: string): boolean {
    return !!(this.sharedPanel && this.sharedState?.uri === uri);
  }

  /** Show error when the XML document that the Navigator was displaying has been closed. */
  public showDocumentClosedError(): void {
    if (this.sharedPanel?.webview) {
      this.sharedPanel.webview.postMessage({
        type: 'error',
        message: 'The XML document is no longer open.',
      });
    }
  }

  public getParseResult(uri: string): XmlParseResult | null {
    if (this.sharedState?.uri === uri) return this.sharedState.parseResult ?? null;
    return null;
  }

  public getPanelsForUri(uri: string): vscode.WebviewPanel[] {
    if (this.sharedState?.uri === uri && this.sharedPanel) return [this.sharedPanel];
    return [];
  }

  public refreshIfShowing(document: vscode.TextDocument): void {
    if (!this.sharedPanel || !this.sharedState) return;
    this.updateSharedPanelContent(document);
  }

  /** Set Navigator path and refresh (e.g. from "Reveal in Navigator" at cursor). Opens Navigator if needed. */
  public navigateToPath(document: vscode.TextDocument, path: string): void {
    this.openNavigator(document);
    if (this.sharedState && path.trim()) {
      this.sharedState.pathFilter = path.trim();
      this.updateSharedPanelContent(document);
      if (this.log) this.log.info('Reveal in XML Navigator', path.trim());
    }
  }

  private updateSharedPanelContent(document: vscode.TextDocument): void {
    if (!this.sharedPanel || !this.sharedState) return;
    const isDocumentSwitch = this.sharedState.uri !== document.uri.toString();
    this.sharedState.uri = document.uri.toString();
    this.lastActiveXmlUri = document.uri.toString();
    const label = document.uri.scheme === 'file' ? document.fileName : document.uri.toString();
    this.sendGridDataToWebview(document, this.sharedPanel.webview, this.sharedState, {
      documentLabel: label,
      isDocumentSwitch,
    });
  }

  private sendGridDataToWebview(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    state: PanelState,
    options: { documentLabel?: string; isDocumentSwitch?: boolean } = {}
  ): void {
    const text = document.getText();
    const parseResult = parseXml(text);
    state.parseResult = parseResult;
    publishParseDiagnostics(document, parseResult, this.diagnosticCollection);

    // Error scenario 1: XML is invalid → show error in Navigator (no stale data).
    const hasContent = text.trim().length > 0;
    const noValidTree = parseResult.rootId < 0 || parseResult.rowOrder.length === 0;
    const hasParseErrors = parseResult.errors.length > 0;
    const shouldShowParseError =
      !isParseUsable(parseResult) || (hasContent && noValidTree) || hasParseErrors;
    if (shouldShowParseError) {
      webview.postMessage({ type: 'parseError', message: 'Unable to parse XML. Use "Open as Text" to fix.' });
      return;
    }

    // Fresh open: always use default path (first content), not path at cursor.
    if (!state.pathFilter.trim()) {
      state.pathFilter = suggestDefaultPath(parseResult);
    }

    let pathFilter = state.pathFilter.trim();
    let nodeIds = pathFilter ? filterNodesByPath(parseResult, pathFilter) : parseResult.rowOrder;

    // On document switch, if the current path does not resolve in the new document, reset to default path
    // so the user sees valid content instead of "No elements found at this path".
    const pathResolvesToNothingOrMixed =
      nodeIds.length === 0 || !buildListView(parseResult, nodeIds, { previousColumnOrder: state.previousTableColumnOrder });
    if (options.isDocumentSwitch && pathResolvesToNothingOrMixed) {
      state.pathFilter = suggestDefaultPath(parseResult);
      pathFilter = state.pathFilter.trim();
      nodeIds = pathFilter ? filterNodesByPath(parseResult, pathFilter) : parseResult.rowOrder;
    }

    // Keep the current path even when it resolves to no matches, so invalid/manual paths stay visible (same-doc only).

    const docLabel = options.documentLabel != null ? { documentLabel: options.documentLabel } : {};

    if (nodeIds.length === 1) {
      const node = parseResult.nodesById.get(nodeIds[0]);
      if (!node) return;
      const dictEntries = dictEntriesForDisplay(buildDictEntries(node, parseResult.nodesById));
      // Keep the user's path (e.g. from "Add to path" with description=...) instead of overwriting with first-key predicate
      webview.postMessage({
        type: 'gridData',
        viewMode: 'dict',
        pathFilter: state.pathFilter,
        currentPathFull: state.pathFilter,
        dictEntries,
        showAttributes: state.showAttributes,
        attributes: state.showAttributes ? { ...node.attributes } : undefined,
        ...docLabel,
      });
      return;
    }

    const listView = buildListView(parseResult, nodeIds, {
      previousColumnOrder: state.previousTableColumnOrder,
    });
    if (listView) {
      state.previousTableColumnOrder = listView.columns.map((c) => getTableColumnKey(c));
      const tableRows = listView.rows.map((r) => ({
        listNodeId: r.listNodeId,
        path: r.path,
        startOffset: r.startOffset,
        endOffset: r.endOffset,
        cells: Object.fromEntries(
          [...r.cells.entries()].map(([k, v]) => [
            k,
            Array.isArray(v)
              ? v.map((cell) => ({ ...cell, textContent: textContentForDisplay(cell.textContent) }))
              : { ...v, textContent: textContentForDisplay(v.textContent) },
          ])
        ),
        childTablePresent: Object.fromEntries(r.childTablePresent),
      }));
      const firstNode = parseResult.nodesById.get(nodeIds[0]);
      const listParentNodeId = firstNode?.parentId ?? -1;
      const listRowTagName = firstNode?.tagName ?? '';
      const lastListNodeId =
        nodeIds.length > 0
          ? [...nodeIds].sort(
              (a, b) =>
                (parseResult.nodesById.get(a)?.startOffset ?? 0) -
                (parseResult.nodesById.get(b)?.startOffset ?? 0)
            )[nodeIds.length - 1]
          : -1;
      webview.postMessage({
        type: 'gridData',
        viewMode: 'list',
        tableMode: true,
        columns: listView.columns,
        childTables: listView.childTables,
        tableRows,
        listParentNodeId,
        listRowTagName,
        lastListNodeId,
        pathFilter: state.pathFilter,
        currentPathFull: state.pathFilter,
        matchCount: nodeIds.length,
        showAttributes: state.showAttributes,
        ...docLabel,
      });
    } else {
      // Error scenario 2: path resolves to nothing (nodeIds.length === 0) or mixed types → show error.
      webview.postMessage({
        type: 'noData',
        pathFilter: state.pathFilter,
        matchCount: nodeIds.length,
        ...docLabel,
      });
    }
  }

  /**
   * Handles all webview messages via messageHandlers.dispatchMessage.
   */
  private attachMessageHandler(): void {
    if (!this.sharedPanel || !this.sharedState) return;
    const panel = this.sharedPanel;
    const getDocument = () =>
      vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.sharedState?.uri) ?? null;
    const getParseResult = () => this.sharedState?.parseResult ?? null;
    const applyEditToWorkspace = (edit: vscode.WorkspaceEdit) =>
      vscode.workspace.applyEdit(edit).then((ok) => {
        const d = getDocument();
        if (d) this.updateSharedPanelContent(d);
        return ok;
      });
    const debouncedApply = createDebouncedApplier(getDocument, getParseResult, applyEditToWorkspace);

    const ctx: NavigatorMessageContext = {
      getDocument,
      getParseResult,
      state: this.sharedState,
      panel,
      debouncedApply,
      updatePanelContent: (doc) => this.updateSharedPanelContent(doc),
      syncSelectionToPath: (uri, pathFilter, forceUpdate) => {
        const parseResult = getParseResult();
        if (parseResult) syncSelectionToPath(uri, parseResult, pathFilter, forceUpdate);
      },
      revealInTextEditor,
      shouldUpdateTextEditorSelection,
    };

    panel.webview.onDidReceiveMessage((message: IncomingMessage) => {
      void Promise.resolve(dispatchMessage(message, ctx));
    });
  }
}

export function isXmlDocument(document: vscode.TextDocument): boolean {
  if (document.languageId === 'xml') return true;
  const text = document.getText().trim();
  return text.startsWith('<?xml') || (text.startsWith('<') && text.length > 0);
}
