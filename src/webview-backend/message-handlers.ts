/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  XML Navigator webview message handlers. Each handler deals with one message type;
  the provider wires context (document, state, panel, applyEdit) and dispatches here.
*/

import * as vscode from 'vscode';
import { filterNodesByPath, pathHasIncompleteFilter } from '../parser';
import { getNextSegmentSuggestions } from './path-resolver';
import {
  applyGridEdits,
  applyPasteGrid,
  deleteNode,
  insertLeafListItem,
  insertLeafAtPath,
  insertEmptyListRow,
  type GridEdit,
  type PasteCreateItem,
} from './document-sync';
import type { XmlParseResult } from '../parser/types';

export interface PanelState {
  parseResult: XmlParseResult | null;
  pathFilter: string;
  showAttributes: boolean;
  previousTableColumnOrder?: string[];
  uri: string;
}

export interface NavigatorMessageContext {
  getDocument: () => vscode.TextDocument | null;
  getParseResult: () => XmlParseResult | null;
  state: PanelState;
  panel: vscode.WebviewPanel;
  debouncedApply: (edit: GridEdit) => void;
  updatePanelContent: (doc: vscode.TextDocument) => void;
  syncSelectionToPath: (uri: string, pathFilter: string, forceUpdate: boolean) => void;
  revealInTextEditor: (uri: string, startOffset: number, endOffset: number, forceUpdate?: boolean) => void;
  shouldUpdateTextEditorSelection: (uri: string) => boolean;
}

/** Webview → host: message payload sent from webview to extension (pathFilter, edit, deleteNode, etc.). */
export type IncomingMessage = {
  type: string;
  path?: string;
  prefix?: string;
  nodeId?: number;
  nodeIds?: number[];
  edit?: GridEdit;
  edits?: GridEdit[];
  updates?: GridEdit[];
  creates?: PasteCreateItem[];
  startOffset?: number;
  endOffset?: number;
  showAttributes?: boolean;
  parentNodeId?: number;
  tagName?: string;
  value?: string;
  pathFromListRoot?: string[];
  lastRowNodeId?: number;
  columnOrder?: string[];
  firstSegmentOrder?: string[];
};

export function handleReady(ctx: NavigatorMessageContext): void {
  const doc = ctx.getDocument();
  if (doc) {
    ctx.updatePanelContent(doc);
    const parseResult = ctx.getParseResult();
    const pathFilter = (ctx.state.pathFilter ?? '').trim();
    if (parseResult && pathFilter) {
      ctx.syncSelectionToPath(doc.uri.toString(), pathFilter, false);
    }
  }
}

export function handlePathFilter(message: IncomingMessage, ctx: NavigatorMessageContext): void {
  const doc = ctx.getDocument();
  if (!doc) return;
  const oldPath = (ctx.state.pathFilter ?? '').trim();
  const newPath = (message.path ?? '').trim().replace(/\/+/g, '/');
  ctx.state.pathFilter = newPath;
  ctx.updatePanelContent(doc);
  if (newPath !== oldPath) {
    const parseResult = ctx.getParseResult();
    if (parseResult) ctx.syncSelectionToPath(doc.uri.toString(), newPath, true);
  }
}

export function handlePathSuggest(message: IncomingMessage, ctx: NavigatorMessageContext): void {
  if (typeof message.prefix !== 'string') return;
  const parseResult = ctx.getParseResult();
  if (!parseResult) return;
  const path = (message.path ?? ctx.state.pathFilter ?? '').trim().replace(/\/+/g, '/');
  const suggestions = getNextSegmentSuggestions(parseResult, path, message.prefix);
  const prefixTrimmed = message.prefix.trim();
  const appendPathSegment = (basePath: string, segment: string): string =>
    segment.startsWith('/')
      ? segment.replace(/^\/+/, '')
      : (basePath ? `${basePath}/${segment}` : segment).replace(/\/+/g, '/');
  const fullPathFromInput = appendPathSegment(path, prefixTrimmed);
  const hasOpenBracket = fullPathFromInput.includes('[');
  const matchCount = (() => {
    if (hasOpenBracket) {
      if (pathHasIncompleteFilter(fullPathFromInput)) {
        const slashIdx = fullPathFromInput.lastIndexOf('/');
        const parentPath = slashIdx >= 0 ? fullPathFromInput.slice(0, slashIdx) : '';
        const lastSeg = slashIdx >= 0 ? fullPathFromInput.slice(slashIdx + 1) : fullPathFromInput;
        const elementName = lastSeg.split('[')[0]?.trim() ?? '';
        if (!elementName) return 0;
        return filterNodesByPath(parseResult, appendPathSegment(parentPath, elementName)).length;
      }
      return filterNodesByPath(parseResult, fullPathFromInput).length;
    }
    const suggested = suggestions[0];
    const targetSegment = suggested ?? prefixTrimmed;
    const fullPath = appendPathSegment(path, targetSegment);
    if (suggestions.length === 0 && prefixTrimmed !== '') return 0;
    return pathHasIncompleteFilter(fullPath) ? undefined : filterNodesByPath(parseResult, fullPath).length;
  })();
  ctx.panel.webview.postMessage({
    type: 'pathSuggestions',
    suggestions,
    path,
    prefix: message.prefix,
    matchCount,
  });
}

export function handleEdit(message: IncomingMessage, ctx: NavigatorMessageContext): void {
  if (!message.edit) return;
  ctx.debouncedApply(message.edit);
}

export function handleEditBatch(message: IncomingMessage, ctx: NavigatorMessageContext): void {
  const doc = ctx.getDocument();
  if (!doc) return;
  const parseResult = ctx.getParseResult();
  if (!parseResult || !message.edits?.length) return;
  const edit_ws = applyGridEdits(doc, parseResult, message.edits);
  if (edit_ws) {
    void vscode.workspace.applyEdit(edit_ws).then(() => {
      const d = ctx.getDocument();
      if (d) ctx.updatePanelContent(d);
    });
  }
}

export function handlePasteGrid(message: IncomingMessage, ctx: NavigatorMessageContext): void {
  if (!message.updates?.length && !message.creates?.length) return;
  if (Array.isArray(message.columnOrder) && message.columnOrder.length > 0) {
    ctx.state.previousTableColumnOrder = message.columnOrder;
  }
  const doc = ctx.getDocument();
  const parseResult = ctx.getParseResult();
  if (!doc || !parseResult) return;
  const insertOpts =
    Array.isArray(message.firstSegmentOrder) && message.firstSegmentOrder.length > 0
      ? { firstSegmentOrder: message.firstSegmentOrder }
      : undefined;
  const edit_ws = applyPasteGrid(
    doc,
    parseResult,
    (message.updates ?? []) as GridEdit[],
    (message.creates ?? []) as PasteCreateItem[],
    insertOpts
  );
  if (edit_ws) {
    void vscode.workspace.applyEdit(edit_ws).then(() => {
      const d = ctx.getDocument();
      if (d) ctx.updatePanelContent(d);
    });
  }
}

export function handleSelection(message: IncomingMessage, ctx: NavigatorMessageContext): void {
  const doc = ctx.getDocument();
  if (!doc || message.nodeId == null) return;
  if (!ctx.shouldUpdateTextEditorSelection(doc.uri.toString())) return;
  const parseResult = ctx.getParseResult();
  const node = parseResult?.nodesById.get(message.nodeId);
  if (!node) return;
  const start = doc.positionAt(Math.max(0, node.startOffset - 1));
  const end = doc.positionAt(node.endOffset);
  const range = new vscode.Range(start, end);
  const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === doc.uri.toString());
  if (editor) {
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(start, end);
  }
}

export function handleDeleteNode(message: IncomingMessage, ctx: NavigatorMessageContext): void {
  const doc = ctx.getDocument();
  if (!doc) return;
  const parseResult = ctx.getParseResult();
  if (!parseResult) return;
  const ids =
    Array.isArray(message.nodeIds) && message.nodeIds.length > 0
      ? [...new Set(message.nodeIds)]
      : typeof message.nodeId === 'number'
        ? [message.nodeId]
        : [];
  if (ids.length === 0) return;
  const replacements: { range: vscode.Range; newText: string }[] = [];
  for (const nodeId of ids) {
    const repl = deleteNode(doc, parseResult, nodeId);
    if (repl) replacements.push(repl);
  }
  if (replacements.length === 0) return;
  const merged = replacements
    .map((repl) => ({
      start: doc.offsetAt(repl.range.start),
      end: doc.offsetAt(repl.range.end),
      newText: repl.newText,
    }))
    .sort((a, b) => a.start - b.start)
    .reduce<Array<{ start: number; end: number; newText: string }>>((acc, cur) => {
      const last = acc[acc.length - 1];
      if (!last) {
        acc.push({ ...cur });
        return acc;
      }
      if (cur.start <= last.end) {
        last.end = Math.max(last.end, cur.end);
        // Preserve prettified layout if any merged replacement keeps one newline.
        last.newText = last.newText === '\n' || cur.newText === '\n' ? '\n' : '';
      } else {
        acc.push({ ...cur });
      }
      return acc;
    }, []);
  merged.sort((a, b) => b.start - a.start);
  const edit_ws = new vscode.WorkspaceEdit();
  for (const repl of merged) {
    edit_ws.replace(
      doc.uri,
      new vscode.Range(doc.positionAt(repl.start), doc.positionAt(repl.end)),
      repl.newText
    );
  }
  void vscode.workspace.applyEdit(edit_ws).then(() => {
    const d = ctx.getDocument();
    if (d) ctx.updatePanelContent(d);
  });
}

export function handleAddLeafListItem(message: IncomingMessage, ctx: NavigatorMessageContext): void {
  if (typeof message.parentNodeId !== 'number' || typeof message.tagName !== 'string') return;
  if (Array.isArray(message.columnOrder) && message.columnOrder.length > 0) {
    ctx.state.previousTableColumnOrder = message.columnOrder;
  }
  const doc = ctx.getDocument();
  const parseResult = ctx.getParseResult();
  if (!doc || !parseResult) return;
  const value = typeof message.value === 'string' ? message.value : '';
  const pathFromListRoot = message.pathFromListRoot;
  const insertOpts =
    Array.isArray(message.firstSegmentOrder) && message.firstSegmentOrder.length > 0
      ? { firstSegmentOrder: message.firstSegmentOrder }
      : undefined;
  const repl =
    pathFromListRoot && pathFromListRoot.length > 1
      ? insertLeafAtPath(doc, parseResult, message.parentNodeId, pathFromListRoot, value, insertOpts)
      : insertLeafListItem(doc, parseResult, message.parentNodeId, message.tagName, value, insertOpts);
  if (repl) {
    const edit_ws = new vscode.WorkspaceEdit();
    edit_ws.replace(doc.uri, repl.range, repl.newText);
    void vscode.workspace.applyEdit(edit_ws).then(() => {
      const d = ctx.getDocument();
      if (d) {
        ctx.updatePanelContent(d);
        const startOff = d.offsetAt(repl.range.start);
        ctx.revealInTextEditor(d.uri.toString(), startOff, startOff + repl.newText.length);
      }
    });
  }
}

export function handleAddListRow(message: IncomingMessage, ctx: NavigatorMessageContext): void {
  if (typeof message.parentNodeId !== 'number' || typeof message.tagName !== 'string') return;
  const doc = ctx.getDocument();
  const parseResult = ctx.getParseResult();
  if (!doc || !parseResult) return;
  const lastRowNodeId = typeof message.lastRowNodeId === 'number' ? message.lastRowNodeId : undefined;
  const repl = insertEmptyListRow(doc, parseResult, message.parentNodeId, message.tagName, lastRowNodeId);
  if (repl) {
    const edit_ws = new vscode.WorkspaceEdit();
    edit_ws.replace(doc.uri, repl.range, repl.newText);
    void vscode.workspace.applyEdit(edit_ws).then(() => {
      const d = ctx.getDocument();
      const replacement = repl;
      if (d && replacement) {
        ctx.updatePanelContent(d);
        const startOff = d.offsetAt(replacement.range.start);
        ctx.revealInTextEditor(d.uri.toString(), startOff, startOff + replacement.newText.length);
      }
    });
  }
}

function findViewColumnForUri(uri: string): vscode.ViewColumn | undefined {
  const editor = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === uri
  );
  if (editor) return editor.viewColumn;
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri) {
        return group.viewColumn;
      }
    }
  }
  return undefined;
}

export async function handleUndoRedo(message: IncomingMessage, ctx: NavigatorMessageContext): Promise<void> {
  const undoDoc = ctx.getDocument();
  if (!undoDoc) return;
  const docUri = undoDoc.uri.toString();
  const viewColumn = findViewColumnForUri(docUri);
  if (viewColumn === undefined) return;

  const previousEditor = vscode.window.activeTextEditor;
  const wasXmlFocused = previousEditor?.document.uri.toString() === docUri;

  await vscode.window.showTextDocument(undoDoc, {
    viewColumn,
    preserveFocus: false,
  });
  await vscode.commands.executeCommand(message.type === 'undo' ? 'undo' : 'redo');

  if (wasXmlFocused) return;
  if (previousEditor && previousEditor.document.uri.toString() !== docUri) {
    await vscode.window.showTextDocument(previousEditor.document, {
      viewColumn: previousEditor.viewColumn,
      preserveFocus: false,
    });
  } else {
    ctx.panel.reveal(undefined, true);
  }
}

/**
 * Dispatch an incoming webview message to the appropriate handler.
 */
export function dispatchMessage(message: IncomingMessage, ctx: NavigatorMessageContext): void | Promise<void> {
  if (message.type === 'ready') {
    handleReady(ctx);
    return;
  }
  const doc = ctx.getDocument();
  if (!doc) return;

  switch (message.type) {
    case 'pathFilter':
      handlePathFilter(message, ctx);
      break;
    case 'pathSuggest':
      handlePathSuggest(message, ctx);
      break;
    case 'edit':
      if (message.edit) handleEdit(message, ctx);
      break;
    case 'editBatch':
      if (message.edits?.length) handleEditBatch(message, ctx);
      break;
    case 'pasteGrid':
      if (message.updates?.length || message.creates?.length) handlePasteGrid(message, ctx);
      break;
    case 'selection':
      handleSelection(message, ctx);
      break;
    case 'deleteNode':
      handleDeleteNode(message, ctx);
      break;
    case 'addLeafListItem':
      handleAddLeafListItem(message, ctx);
      break;
    case 'addListRow':
      handleAddListRow(message, ctx);
      break;
    case 'undo':
    case 'redo':
      return handleUndoRedo(message, ctx);
    default:
      break;
  }
}
