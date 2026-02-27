/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import * as vscode from 'vscode';
import type { XmlParseResult } from '../parser/types';

export interface GridEdit {
  nodeId: number;
  field: 'tagName' | 'textContent' | 'attributes';
  value: string | Record<string, string>;
}

export interface GridEditReplacement {
  range: vscode.Range;
  newText: string;
}

/**
 * Compute a single cell edit replacement (range + new text). Caller can merge into WorkspaceEdit.
 */
export function applyGridEdit(
  document: vscode.TextDocument,
  parseResult: XmlParseResult,
  edit: GridEdit
): GridEditReplacement | null {
  const node = parseResult.nodesById.get(edit.nodeId);
  if (!node) return null;

  const fullText = document.getText();

  if (edit.field === 'textContent') {
    const startTagEnd = findClosingBracket(fullText, node.startOffset);
    if (startTagEnd < 0) return null;
    const valueForXml = String(edit.value).replace(/\r?\n/g, '\\n');
    const escapedValue = escapeXmlText(valueForXml);

    // Self-closing tag (<tag/> or <tag attr="v"/>): expand to open+close with new value
    if (fullText[startTagEnd - 1] === '/') {
      const openTagRaw = fullText.substring(node.startOffset, startTagEnd - 1);
      const newText = `${openTagRaw}>${escapedValue}</${node.tagName}>`;
      const range = new vscode.Range(document.positionAt(node.startOffset), document.positionAt(node.endOffset));
      return { range, newText };
    }

    const segment = fullText.substring(node.startOffset, node.endOffset);
    const endTagStart = segment.lastIndexOf('</');
    const endTagStartAbs = endTagStart >= 0 ? node.startOffset + endTagStart : -1;
    if (endTagStartAbs < 0) return null;
    const contentStart = startTagEnd + 1;
    const contentEnd = endTagStartAbs;
    const rawContent = fullText.substring(contentStart, contentEnd);
    // Preserve leading/trailing whitespace (indent/newlines) so prettified XML stays prettified
    const leadingMatch = rawContent.match(/^(\s*)/);
    const trailingMatch = rawContent.match(/(\s*)$/);
    const leadingWs = leadingMatch ? leadingMatch[1] : '';
    const trailingWs = trailingMatch ? trailingMatch[1] : '';
    const newContent = leadingWs + escapedValue + trailingWs;
    const range = new vscode.Range(
      document.positionAt(contentStart),
      document.positionAt(contentEnd)
    );
    return { range, newText: newContent };
  }

  if (edit.field === 'tagName') {
    // Parser may report startOffset as first char of tag name; find the opening '<' of this element.
    const tagStart = fullText.lastIndexOf('<', node.startOffset);
    const afterOpen = fullText.indexOf('>', node.startOffset);
    const firstSpace = fullText.indexOf(' ', tagStart);
    const endOfTagName = firstSpace > 0 && firstSpace < afterOpen ? firstSpace : afterOpen;
    const range = new vscode.Range(
      document.positionAt(tagStart + 1),
      document.positionAt(endOfTagName)
    );
    return { range, newText: String(edit.value) };
  }

  if (edit.field === 'attributes') {
    const afterOpen = fullText.indexOf('>', node.startOffset);
    const tagStart = fullText.indexOf('<', node.startOffset);
    const newAttrs = edit.value as Record<string, string>;
    const newAttrStr = Object.entries(newAttrs)
      .map(([k, v]) => `${k}="${escapeXmlAttr(String(v))}"`)
      .join(' ');
    const attrRange = new vscode.Range(
      document.positionAt(tagStart + 1 + node.tagName.length),
      document.positionAt(afterOpen)
    );
    const replacement = (newAttrStr ? ' ' : '') + newAttrStr;
    return { range: attrRange, newText: replacement };
  }

  return null;
}

function findClosingBracket(text: string, after: number): number {
  return text.indexOf('>', after);
}

/** True if the segment between openTagEnd and nextOffset contains a newline (prettified layout). */
function isPrettifiedBetween(fullText: string, openTagEnd: number, nextOffset: number): boolean {
  const segment = fullText.substring(openTagEnd + 1, Math.min(nextOffset, fullText.length));
  return segment.includes('\n');
}

/** Whether the parent element's children are laid out with newlines (prettified). */
function isParentPrettified(
  fullText: string,
  parent: { startOffset: number },
  parentOpenEnd: number,
  childIds: number[],
  nodesById: Map<number, { startOffset: number }>
): boolean {
  const firstChildStart =
    childIds.length > 0
      ? (nodesById.get(childIds[0])?.startOffset ?? parentOpenEnd + 1)
      : parentOpenEnd + 1;
  return isPrettifiedBetween(fullText, parentOpenEnd, firstChildStart);
}

function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** True if character is whitespace (space, tab, CR, LF, etc.). */
function isWhitespaceChar(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\r' || c === '\n' || (c.length === 1 && /\s/.test(c));
}

/**
 * Delete an entire element. Behavior depends on whether the document is prettified or minified:
 * - Prettified: delete the entire line(s) containing the element, replace with a single newline.
 * - Minified: remove the element and any leading/trailing whitespace (\s*<element>...</element>\s*).
 */
export function deleteNode(
  document: vscode.TextDocument,
  parseResult: XmlParseResult,
  nodeId: number
): GridEditReplacement | null {
  const node = parseResult.nodesById.get(nodeId);
  if (!node) return null;
  const fullText = document.getText();
  const openTagEnd = findClosingBracket(fullText, node.startOffset);
  if (openTagEnd < 0) return null;

  let elementEndOffset: number;
  if (fullText[openTagEnd - 1] === '/') {
    elementEndOffset = node.endOffset;
  } else {
    const closingTag = '</' + node.tagName + '>';
    const closeStart = fullText.indexOf(closingTag, openTagEnd + 1);
    if (closeStart < 0) return null;
    elementEndOffset = closeStart + closingTag.length;
  }

  const parent = node.parentId >= 0 ? parseResult.nodesById.get(node.parentId) : undefined;
  const parentOpenEnd = parent ? findClosingBracket(fullText, parent.startOffset) : -1;
  const prettified =
    parent &&
    parentOpenEnd >= 0 &&
    isParentPrettified(fullText, parent, parentOpenEnd, parent.childIds, parseResult.nodesById);

  if (prettified) {
    // Case 1: Prettified — delete entire line(s) containing the element, replace with a single \n (no blank line)
    const firstLineStart = fullText.lastIndexOf('\n', node.startOffset - 1) + 1;
    const firstNewlineAfter = fullText.indexOf('\n', elementEndOffset);
    let delStart: number;
    if (firstLineStart > 0) {
      // Include the newline that precedes this line so we don't leave a blank line
      delStart = fullText[firstLineStart - 1] === '\n' && firstLineStart >= 2 && fullText[firstLineStart - 2] === '\r'
        ? firstLineStart - 2
        : firstLineStart - 1;
    } else {
      delStart = 0;
    }
    let delEnd: number;
    let newText: string;
    if (firstNewlineAfter >= 0) {
      delEnd = fullText[firstNewlineAfter] === '\r' && fullText[firstNewlineAfter + 1] === '\n'
        ? firstNewlineAfter + 2
        : firstNewlineAfter + 1;
      newText = '\n';
    } else {
      delEnd = fullText.length;
      newText = '';
    }
    const range = new vscode.Range(document.positionAt(delStart), document.positionAt(delEnd));
    return { range, newText };
  }

  // Case 2: Minified — remove \s*<element>...</element>\s*
  // Start from the opening '<' of this element so we include all preceding whitespace.
  const openBracket = fullText.lastIndexOf('<', node.startOffset);
  let delStart = openBracket;
  while (delStart > 0 && isWhitespaceChar(fullText[delStart - 1])) {
    delStart--;
  }
  let delEnd = elementEndOffset;
  while (delEnd < fullText.length && isWhitespaceChar(fullText[delEnd])) {
    delEnd++;
  }
  // Do not include the next tag's opening '<' in the range.
  const nextTag = fullText.indexOf('<', elementEndOffset);
  if (nextTag >= 0 && nextTag < delEnd) {
    delEnd = nextTag;
  }
  const range = new vscode.Range(document.positionAt(delStart), document.positionAt(delEnd));
  return { range, newText: '' };
}

/** Options for insert position when table column order is known. */
export interface InsertOptions {
  /** Ordered list of direct child tag names (first segment per column). New element is inserted after the last sibling that appears before this tag in this order. */
  firstSegmentOrder?: string[];
}

/**
 * Find the last sibling of parent that appears before tagName in column order (for document-order insert).
 * Returns that node's id, or undefined to insert after parent open.
 */
function findLastSiblingBeforeInOrder(
  parent: { childIds: number[] },
  tagName: string,
  firstSegmentOrder: string[],
  nodesById: Map<number, { id: number; tagName: string; endOffset: number }>
): number | undefined {
  const ourIdx = firstSegmentOrder.indexOf(tagName);
  if (ourIdx < 0) return undefined;
  if (ourIdx === 0) return undefined; // insert at start
  const allowedTags = new Set(firstSegmentOrder.slice(0, ourIdx));
  let lastId: number | undefined;
  for (const cid of parent.childIds) {
    const child = nodesById.get(cid);
    if (!child || !allowedTags.has(child.tagName)) continue;
    if (lastId === undefined) lastId = child.id;
    else {
      const last = nodesById.get(lastId);
      if (last && child.endOffset > last.endOffset) lastId = child.id;
    }
  }
  return lastId;
}

/**
 * Insert a new leaf list item as child of parent. When firstSegmentOrder is provided, inserts in document order
 * (after the last sibling that appears before this tag in column order). Otherwise: after last same-tag sibling or at start.
 */
export function insertLeafListItem(
  document: vscode.TextDocument,
  parseResult: XmlParseResult,
  parentNodeId: number,
  tagName: string,
  value: string,
  options?: InsertOptions
): GridEditReplacement | null {
  const parent = parseResult.nodesById.get(parentNodeId);
  if (!parent) return null;
  const fullText = document.getText();
  const { nodesById } = parseResult;

  const parentOpenEnd = findClosingBracket(fullText, parent.startOffset);
  if (parentOpenEnd < 0) return null;
  const firstChildStart =
    parent.childIds.length > 0
      ? (nodesById.get(parent.childIds[0])?.startOffset ?? parentOpenEnd + 1)
      : parentOpenEnd + 1;
  const prettified = isPrettifiedBetween(fullText, parentOpenEnd, firstChildStart);

  let insertOffset: number;
  let prefix: string;

  const orderBasedAfter = options?.firstSegmentOrder
    ? findLastSiblingBeforeInOrder(parent, tagName, options.firstSegmentOrder, nodesById)
    : undefined;

  if (orderBasedAfter !== undefined) {
    const afterNode = nodesById.get(orderBasedAfter) as { endOffset: number; startOffset: number } | undefined;
    if (!afterNode) return null;
    insertOffset = afterNode.endOffset;
    if (prettified) {
      const lineStart = fullText.lastIndexOf('\n', Math.max(0, afterNode.startOffset - 1)) + 1;
      const lineEnd = fullText.indexOf('\n', lineStart);
      const lineContent = fullText.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
      const indent = (lineContent.match(/^\s*/)?.[0] ?? '');
      prefix = '\n' + indent;
    } else {
      prefix = '';
    }
  } else {
    let lastSiblingWithTag: { id: number; tagName: string; startOffset: number; endOffset: number } | null = null;
    for (const cid of parent.childIds) {
      const child = nodesById.get(cid);
      if (!child) continue;
      if (child.tagName === tagName) {
        if (!lastSiblingWithTag || child.startOffset > lastSiblingWithTag.startOffset) {
          lastSiblingWithTag = { id: child.id, tagName: child.tagName, startOffset: child.startOffset, endOffset: child.endOffset };
        }
      }
    }
    if (lastSiblingWithTag) {
      insertOffset = lastSiblingWithTag.endOffset;
      if (prettified) {
        const lineStart = fullText.lastIndexOf('\n', Math.max(0, lastSiblingWithTag.startOffset - 1)) + 1;
        const lineEnd = fullText.indexOf('\n', lineStart);
        const lineContent = fullText.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
        const indent = (lineContent.match(/^\s*/)?.[0] ?? '');
        prefix = '\n' + indent;
      } else {
        prefix = '';
      }
    } else {
      insertOffset = parentOpenEnd + 1;
      if (prettified) {
        const lineStart = fullText.lastIndexOf('\n', Math.max(0, parent.startOffset - 1)) + 1;
        const lineEnd = fullText.indexOf('\n', lineStart);
        const lineContent = fullText.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
        const baseIndent = (lineContent.match(/^\s*/)?.[0] ?? '');
        prefix = '\n' + baseIndent + '  ';
      } else {
        prefix = '';
      }
    }
  }

  const valueEscaped = String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  const newText = prefix + `<${tagName}>${valueEscaped}</${tagName}>`;
  const range = new vscode.Range(document.positionAt(insertOffset), document.positionAt(insertOffset));
  return { range, newText };
}

/**
 * Insert a leaf at a path under a list row (e.g. pathFromListRoot = ['port', 'ethernet', 'admin-state']).
 * If containers are missing, builds one replacement that inserts the full chain (e.g. <ethernet><admin-state>value</admin-state></ethernet>).
 * When firstSegmentOrder is provided, the first segment is inserted in document order (after the last sibling before it in column order).
 */
export function insertLeafAtPath(
  document: vscode.TextDocument,
  parseResult: XmlParseResult,
  listRowNodeId: number,
  pathFromListRoot: string[],
  value: string,
  options?: InsertOptions
): GridEditReplacement | null {
  if (pathFromListRoot.length === 0) return null;
  if (pathFromListRoot.length === 1) {
    return insertLeafListItem(document, parseResult, listRowNodeId, pathFromListRoot[0], value, options);
  }
  const listRow = parseResult.nodesById.get(listRowNodeId);
  if (!listRow) return null;
  const fullText = document.getText();
  const valueEscaped = String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  const leafTag = pathFromListRoot[pathFromListRoot.length - 1];
  const { nodesById } = parseResult;
  let currentId = listRowNodeId;
  let insertOffset = 0;
  let baseIndent = '';

  for (let i = 0; i < pathFromListRoot.length; i++) {
    const seg = pathFromListRoot[i];
    const parent = nodesById.get(currentId);
    if (!parent) return null;
    const child = parent.childIds.map((cid) => nodesById.get(cid)).find((n) => n?.tagName === seg);
    if (child) {
      currentId = child.id;
      continue;
    }
    const parentOpenEnd = findClosingBracket(fullText, parent.startOffset);
    if (parentOpenEnd < 0) return null;
    const prettified = isParentPrettified(
      fullText,
      parent,
      parentOpenEnd,
      parent.childIds,
      nodesById as Map<number, { startOffset: number }>
    );
    const useOrder = currentId === listRowNodeId && options?.firstSegmentOrder;
    const firstSegmentOrder = options?.firstSegmentOrder;
    const orderBasedAfter = useOrder && firstSegmentOrder ? findLastSiblingBeforeInOrder(parent, seg, firstSegmentOrder, nodesById) : undefined;
    let insertOffsetSet = false;
    if (orderBasedAfter !== undefined) {
      const afterNode = nodesById.get(orderBasedAfter);
      if (afterNode) {
        insertOffset = afterNode.endOffset;
        const lineStart = fullText.lastIndexOf('\n', Math.max(0, afterNode.startOffset - 1)) + 1;
        const lineEnd = fullText.indexOf('\n', lineStart);
        const lineContent = fullText.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
        baseIndent = (lineContent.match(/^\s*/)?.[0] ?? '');
        insertOffsetSet = true;
      }
    }
    if (!insertOffsetSet) {
      const lastChildId = parent.childIds[parent.childIds.length - 1];
      if (lastChildId != null) {
        const lastChild = nodesById.get(lastChildId);
        if (!lastChild) return null;
        insertOffset = lastChild.endOffset;
        const lineStart = fullText.lastIndexOf('\n', Math.max(0, lastChild.startOffset - 1)) + 1;
        const lineEnd = fullText.indexOf('\n', lineStart);
        const lineContent = fullText.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
        baseIndent = (lineContent.match(/^\s*/)?.[0] ?? '');
      } else {
        insertOffset = parentOpenEnd + 1;
        const lineStart = fullText.lastIndexOf('\n', Math.max(0, parent.startOffset - 1)) + 1;
        const lineEnd = fullText.indexOf('\n', lineStart);
        const lineContent = fullText.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
        baseIndent = (lineContent.match(/^\s*/)?.[0] ?? '') + '  ';
      }
    }
    const restPath = pathFromListRoot.slice(i);
    const indent = baseIndent;
    const isLeaf = restPath.length === 1;
    const prefix = prettified ? '\n' + indent : '';
    if (isLeaf) {
      const newText = prefix + `<${leafTag}>${valueEscaped}</${leafTag}>`;
      return { range: new vscode.Range(document.positionAt(insertOffset), document.positionAt(insertOffset)), newText };
    }
    const sb: string[] = [];
    for (let r = 0; r < restPath.length; r++) {
      const tag = restPath[r];
      const rIndent = indent + '  '.repeat(r);
      if (r === restPath.length - 1) {
        sb.push((prettified ? '\n' + rIndent : '') + `<${tag}>${valueEscaped}</${tag}>`);
      } else {
        sb.push((prettified ? '\n' + rIndent : '') + `<${tag}>`);
      }
    }
    for (let r = restPath.length - 2; r >= 0; r--) {
      sb.push((prettified ? '\n' + (indent + '  '.repeat(r)) : '') + `</${restPath[r]}>`);
    }
    const newText = sb.join('');
    return { range: new vscode.Range(document.positionAt(insertOffset), document.positionAt(insertOffset)), newText };
  }

  const parent = nodesById.get(currentId);
  if (!parent) return null;
  const parentOpenEnd = findClosingBracket(fullText, parent.startOffset);
  if (parentOpenEnd < 0) return null;
  const prettified = isParentPrettified(
    fullText,
    parent,
    parentOpenEnd,
    parent.childIds,
    nodesById as Map<number, { startOffset: number }>
  );
  const lastChildId = parent.childIds[parent.childIds.length - 1];
  if (lastChildId != null) {
    const lastChild = nodesById.get(lastChildId);
    if (!lastChild) return null;
    insertOffset = lastChild.endOffset;
    const lineStart = fullText.lastIndexOf('\n', Math.max(0, lastChild.startOffset - 1)) + 1;
    const lineEnd = fullText.indexOf('\n', lineStart);
    const lineContent = fullText.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    baseIndent = (lineContent.match(/^\s*/)?.[0] ?? '');
  } else {
    insertOffset = parentOpenEnd + 1;
    const lineStart = fullText.lastIndexOf('\n', Math.max(0, parent.startOffset - 1)) + 1;
    const lineEnd = fullText.indexOf('\n', lineStart);
    const lineContent = fullText.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    baseIndent = (lineContent.match(/^\s*/)?.[0] ?? '') + '  ';
  }
  const prefix = prettified ? '\n' + baseIndent : '';
  const newText = prefix + `<${leafTag}>${valueEscaped}</${leafTag}>`;
  return { range: new vscode.Range(document.positionAt(insertOffset), document.positionAt(insertOffset)), newText };
}

/**
 * Insert an empty element as a new table row.
 * When lastRowNodeId is given, insert after that row (so the new row follows the last visible row).
 * Otherwise insert after the parent's last child (legacy; can be wrong when parent has other children after the list).
 */
export function insertEmptyListRow(
  document: vscode.TextDocument,
  parseResult: XmlParseResult,
  parentNodeId: number,
  tagName: string,
  lastRowNodeId?: number
): GridEditReplacement | null {
  const parent = parseResult.nodesById.get(parentNodeId);
  if (!parent) return null;
  const fullText = document.getText();
  const parentOpenEnd = findClosingBracket(fullText, parent.startOffset);
  if (parentOpenEnd < 0) return null;
  const prettified = isParentPrettified(
    fullText,
    parent,
    parentOpenEnd,
    parent.childIds,
    parseResult.nodesById as Map<number, { startOffset: number }>
  );
  let insertOffset: number;
  if (lastRowNodeId != null) {
    const lastRow = parseResult.nodesById.get(lastRowNodeId);
    if (!lastRow || lastRow.parentId !== parentNodeId) return null;
    insertOffset = lastRow.endOffset;
  } else if (parent.childIds.length === 0) {
    insertOffset = parentOpenEnd + 1;
  } else {
    const lastChildId = parent.childIds[parent.childIds.length - 1];
    const lastChild = parseResult.nodesById.get(lastChildId);
    if (!lastChild) return null;
    insertOffset = lastChild.endOffset;
  }
  let newText: string;
  if (prettified) {
    const prevLineStart = fullText.lastIndexOf('\n', Math.max(0, insertOffset - 1)) + 1;
    const prevLine = fullText.slice(prevLineStart, insertOffset);
    const indent = prevLine.match(/^\s*/)?.[0] ?? '';
    newText = `\n${indent}<${tagName}>\n${indent}</${tagName}>`;
  } else {
    newText = `<${tagName}></${tagName}>`;
  }
  const range = new vscode.Range(document.positionAt(insertOffset), document.positionAt(insertOffset));
  return { range, newText };
}

/**
 * Apply multiple edits in one WorkspaceEdit (replacements in reverse offset order to preserve positions).
 */
export function applyGridEdits(
  document: vscode.TextDocument,
  parseResult: XmlParseResult,
  edits: GridEdit[]
): vscode.WorkspaceEdit | null {
  const replacements: GridEditReplacement[] = [];
  for (const edit of edits) {
    const single = applyGridEdit(document, parseResult, edit);
    if (single) replacements.push(single);
  }
  if (replacements.length === 0) return null;
  replacements.sort(
    (a, b) =>
      document.offsetAt(b.range.start) - document.offsetAt(a.range.start)
  );
  const edit_ws = new vscode.WorkspaceEdit();
  for (const { range, newText } of replacements) {
    edit_ws.replace(document.uri, range, newText);
  }
  return edit_ws;
}

export interface PasteCreateItem {
  parentNodeId: number;
  tagName: string;
  value: string;
  pathFromListRoot?: string[];
}

/**
 * Apply a paste operation atomically: update existing cells (GridEdit) and create new
 * XML elements for empty cells (PasteCreateItem), all in one WorkspaceEdit.
 */
export function applyPasteGrid(
  document: vscode.TextDocument,
  parseResult: XmlParseResult,
  updates: GridEdit[],
  creates: PasteCreateItem[],
  insertOptions?: InsertOptions
): vscode.WorkspaceEdit | null {
  const replacements: GridEditReplacement[] = [];

  for (const edit of updates) {
    const r = applyGridEdit(document, parseResult, edit);
    if (r) replacements.push(r);
  }

  for (const create of creates) {
    const r =
      create.pathFromListRoot && create.pathFromListRoot.length > 1
        ? insertLeafAtPath(document, parseResult, create.parentNodeId, create.pathFromListRoot, create.value, insertOptions)
        : insertLeafListItem(document, parseResult, create.parentNodeId, create.tagName, create.value, insertOptions);
    if (r) replacements.push(r);
  }

  if (replacements.length === 0) return null;
  replacements.sort((a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start));
  const edit_ws = new vscode.WorkspaceEdit();
  for (const { range, newText } of replacements) {
    edit_ws.replace(document.uri, range, newText);
  }
  return edit_ws;
}

/** Debounced batch: collect edits and apply after a short delay. documentOrGetter can be a document or a getter (for shared view). */
export function createDebouncedApplier(
  documentOrGetter: vscode.TextDocument | (() => vscode.TextDocument | null),
  getParseResult: () => XmlParseResult | null,
  applyFn: (edit: vscode.WorkspaceEdit) => Thenable<boolean>
): (edit: GridEdit) => void {
  let pending: GridEdit[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const getDocument = (): vscode.TextDocument | null =>
    typeof documentOrGetter === 'function' ? documentOrGetter() : documentOrGetter;

  const flush = () => {
    if (pending.length === 0) return;
    const document = getDocument();
    if (!document) return;
    const parseResult = getParseResult();
    if (!parseResult) return;
    const toApply = pending;
    pending = [];
    const edit_ws =
      toApply.length === 1
        ? (() => {
            const r = applyGridEdit(document, parseResult, toApply[0]);
            if (!r) return null;
            const e = new vscode.WorkspaceEdit();
            e.replace(document.uri, r.range, r.newText);
            return e;
          })()
        : applyGridEdits(document, parseResult, toApply);
    if (edit_ws) applyFn(edit_ws);
  };

  return (edit: GridEdit) => {
    pending.push(edit);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 300);
  };
}
