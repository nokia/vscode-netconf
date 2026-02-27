/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import type { XmlNode } from '../parser/types';

/**
 * Dict entry for Element View: either a leaf (value), a leaf list (chips), a nested table (openTable),
 * or embedded single-child content (children).
 * Mirrored in webview/types; used for host→webview gridData.dictEntries.
 */
export interface DictEntry {
  key: string;
  value?: string;
  nodeId?: number;
  /** Multiple same-tag siblings → show single "Open table" for this key. */
  openTable?: boolean;
  /** Multiple same-tag leaf siblings → show one parameter with value chips. */
  leafList?: boolean;
  /** Parent node id (for add new entry). */
  leafListParentNodeId?: number;
  leafListValues?: Array<{ value: string; nodeId: number; startOffset: number; endOffset: number }>;
  /** Single child with nested content → show full depth inline (no nested tables). */
  children?: DictEntry[];
}

/**
 * Build dict entries for a node:
 * - Multiple same-tag direct children, all leaves → one entry with leafList (chips).
 * - Multiple same-tag direct children, any with children → one entry with openTable.
 * - Single direct child → one entry: leaf shows value; container shows embedded children (full depth).
 *   Embedded branch stops at any nested table (multiple same-tag) → openTable there.
 */
export function buildDictEntries(
  node: XmlNode,
  nodesById: Map<number, XmlNode>
): DictEntry[] {
  const entries: DictEntry[] = [];
  const byTag = new Map<string, XmlNode[]>();
  const tagOrder: string[] = [];
  for (const cid of node.childIds) {
    const child = nodesById.get(cid);
    if (!child) continue;
    const list = byTag.get(child.tagName) ?? [];
    list.push(child);
    byTag.set(child.tagName, list);
    if (!tagOrder.includes(child.tagName)) tagOrder.push(child.tagName);
  }
  for (const tagName of tagOrder) {
    const nodes = byTag.get(tagName) ?? [];
    if (nodes.length > 1) {
      const allLeaves = nodes.every((n) => n.childIds.length === 0);
      if (allLeaves) {
        const parentId = nodes[0].parentId;
        entries.push({
          key: tagName,
          leafList: true,
          leafListParentNodeId: parentId >= 0 ? parentId : undefined,
          leafListValues: nodes.map((n) => ({ value: n.textContent, nodeId: n.id, startOffset: n.startOffset, endOffset: n.endOffset })),
        });
      } else {
        entries.push({ key: tagName, openTable: true });
      }
    } else if (nodes.length === 1) {
      const child = nodes[0];
      if (child.childIds.length === 0) {
        entries.push({ key: tagName, value: child.textContent, nodeId: child.id });
      } else {
        entries.push({ key: tagName, children: buildDictEntries(child, nodesById) });
      }
    }
  }
  return entries;
}
