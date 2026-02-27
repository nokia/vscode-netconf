/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import * as sax from 'sax';
import type { XmlNode, XmlParseResult } from './types';

/**
 * Parse XML string into a tree of nodes with offset range for each element.
 * Uses sax for position tracking; builds in-memory tree with startOffset/endOffset per node.
 */
export function parseXml(text: string): XmlParseResult {
  const nodesById = new Map<number, XmlNode>();
  const errors: Array<{ line: number; column: number; message: string }> = [];
  let nextId = 0;
  const stack: XmlNode[] = [];
  const rowOrder: number[] = [];
  let rootId = -1;

  const parser = sax.parser(true, { trim: true });
  parser.onerror = (err: Error) => {
    errors.push({
      line: parser.line,
      column: parser.column,
      message: err.message,
    });
  };

  const parserWithPos = parser as sax.SAXParser & { position: number; startTagPosition?: number };
  parser.onopentag = (tag: sax.QualifiedTag | sax.Tag) => {
    const startOffset = parserWithPos.startTagPosition ?? parserWithPos.position ?? 0;
    const attrs: Record<string, string> = {};
    if (tag.attributes) {
      for (const [k, v] of Object.entries(tag.attributes)) {
        attrs[k] = String(v);
      }
    }
    const parentId = stack.length > 0 ? stack[stack.length - 1].id : -1;
    const depth = stack.length;
    const colonIdx = tag.name.indexOf(':');
    const localName = colonIdx >= 0 ? tag.name.slice(colonIdx + 1) : tag.name;
    const pathFromRoot =
      stack.length === 0
        ? [localName]
        : [...(stack[stack.length - 1].pathFromRoot), localName];

    const node: XmlNode = {
      id: nextId,
      tagName: localName,
      attributes: attrs,
      startOffset,
      endOffset: startOffset,
      depth,
      parentId,
      childIds: [],
      textContent: '',
      pathFromRoot,
    };
    nextId++;
    nodesById.set(node.id, node);
    rowOrder.push(node.id);
    if (parentId >= 0) {
      const parent = nodesById.get(parentId);
      if (parent) parent.childIds.push(node.id);
    } else {
      rootId = node.id;
    }
    stack.push(node);
  };

  parser.onclosetag = () => {
    if (stack.length > 0) {
      const node = stack.pop();
      if (!node) return;
      const endOffset = parserWithPos.position ?? node.startOffset;
      node.endOffset = endOffset;
      nodesById.set(node.id, node);
    }
  };

  parser.ontext = (t: string) => {
    if (stack.length > 0) {
      const node = stack[stack.length - 1];
      node.textContent = (node.textContent + t).trim();
      nodesById.set(node.id, node);
    }
  };

  parser.write(text).close();

  const sortedStarts = [...nodesById.values()].sort((a, b) => a.startOffset - b.startOffset);
  const intervals: Array<{ start: number; end: number; id: number }> = sortedStarts.map(
    (n) => ({ start: n.startOffset, end: n.endOffset, id: n.id })
  );

  function nodeAtOffset(offset: number): number {
    let best = -1;
    let bestLen = Infinity;
    for (const { start, end, id } of intervals) {
      if (offset >= start && offset <= end) {
        const len = end - start;
        if (len < bestLen) {
          bestLen = len;
          best = id;
        }
      }
    }
    return best;
  }

  return {
    rootId,
    nodesById,
    nodeAtOffset,
    rowOrder,
    errors,
  };
}
