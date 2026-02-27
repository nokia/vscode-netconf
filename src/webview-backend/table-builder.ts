/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import type { XmlNode, XmlParseResult } from '../parser/types';
import { getTableColumnKey } from '../common/table-column-helpers';

/** One column in Table View (list): leaf field with optional full path for tooltip. */
export interface TableColumn {
  /** Display label (last segment of path). */
  tagName: string;
  /** Full path from list row to this leaf, for tooltip (e.g. ['port', 'connector', 'breakout']). */
  pathFromListRoot?: string[];
  /** Leaf list: multiple same-tag siblings per row → render as chips. */
  isLeafList?: boolean;
  /** Single-entry container group for 2-level header (legacy); when pathFromListRoot is set, tooltip uses it. */
  group?: string;
}

/** One cell: value and node id for editing. */
export interface TableCell {
  textContent: string;
  nodeId: number;
}

/** One row = one list item, with path/offsets for sync and cells keyed by column tag or group.tagName. */
export interface TableRow {
  listNodeId: number;
  path: string;
  startOffset: number;
  endOffset: number;
  /** Column key (from getTableColumnKey: tagName or path/group/tagName) -> cell or array of cells (leaf list). */
  cells: Map<string, TableCell | TableCell[]>;
  /** Child table tag name -> true if this row has at least one such child (for showing nav button). */
  childTablePresent: Map<string, boolean>;
}

/** Direct child that is a container (has element children); shown as navigation button. Mirrored in webview/types; used for host→webview gridData.childTables. */
export interface ChildTableRef {
  tagName: string;
}

/** Table View data: columns (leaf fields), rows (list items), and child list refs for nested navigation. */
export interface ListTableView {
  columns: TableColumn[];
  rows: TableRow[];
  childTables: ChildTableRef[];
}

/**
 * Check if we have a uniform list: same tag name for all given nodes (rows).
 * Parent may differ (e.g. multiple <port> under different <group> → still one table).
 * Allows a single node (one row table).
 */
function isUniformList(
  nodeIds: number[],
  nodesById: Map<number, XmlNode>
): boolean {
  if (nodeIds.length < 1) return false;
  const first = nodesById.get(nodeIds[0]);
  if (!first) return false;
  const tagName = first.tagName;
  for (let i = 1; i < nodeIds.length; i++) {
    const n = nodesById.get(nodeIds[i]);
    if (!n || n.tagName !== tagName) return false;
  }
  return true;
}

/**
 * Same data as inferColumns but we need maxPerRow and tagIsLeaf for leaf lists and single-entry.
 */
function inferChildStats(
  listNodeIds: number[],
  nodesById: Map<number, XmlNode>
): { tagCountPerRow: Map<string, number>; tagIsLeaf: Map<string, boolean> } {
  const tagCountPerRow = new Map<string, number>();
  const tagIsLeaf = new Map<string, boolean>();
  for (const id of listNodeIds) {
    const node = nodesById.get(id);
    if (!node) continue;
    const childCountByTag = new Map<string, number>();
    for (const cid of node.childIds) {
      const child = nodesById.get(cid);
      if (!child) continue;
      const count = (childCountByTag.get(child.tagName) ?? 0) + 1;
      childCountByTag.set(child.tagName, count);
      const isLeaf = child.childIds.length === 0;
      if (!tagIsLeaf.has(child.tagName)) tagIsLeaf.set(child.tagName, isLeaf);
      else if (!isLeaf) tagIsLeaf.set(child.tagName, false);
    }
    for (const [tag, count] of childCountByTag) {
      const prev = tagCountPerRow.get(tag) ?? 0;
      tagCountPerRow.set(tag, Math.max(prev, count));
    }
  }
  return { tagCountPerRow, tagIsLeaf };
}

/**
 * Leaf list: same-tag direct children, all leaves, appear more than once per row → show as chips.
 */
function inferLeafListColumns(
  listNodeIds: number[],
  nodesById: Map<number, XmlNode>,
  tagCountPerRow: Map<string, number>,
  tagIsLeaf: Map<string, boolean>
): string[] {
  const tags: string[] = [];
  const firstNode = nodesById.get(listNodeIds[0]);
  if (!firstNode) return tags;
  for (const cid of firstNode.childIds) {
    const child = nodesById.get(cid);
    if (!child) continue;
    const maxPerRow = tagCountPerRow.get(child.tagName) ?? 0;
    if (maxPerRow > 1 && tagIsLeaf.get(child.tagName) === true && !tags.includes(child.tagName)) {
      tags.push(child.tagName);
    }
  }
  return tags;
}

/**
 * Single-entry container: direct child that appears exactly once per row and has element children.
 * We will flatten its leaf children as columns under a group (2-level header).
 */
function inferSingleEntryContainers(
  listNodeIds: number[],
  nodesById: Map<number, XmlNode>,
  tagCountPerRow: Map<string, number>,
  tagIsLeaf: Map<string, boolean>
): string[] {
  const tags: string[] = [];
  for (const [tag, maxPerRow] of tagCountPerRow) {
    if (maxPerRow === 1 && tagIsLeaf.get(tag) === false) tags.push(tag);
  }
  const firstNode = nodesById.get(listNodeIds[0]);
  if (!firstNode) return tags;
  const order: string[] = [];
  for (const cid of firstNode.childIds) {
    const child = nodesById.get(cid);
    if (!child || !tags.includes(child.tagName) || order.includes(child.tagName)) continue;
    order.push(child.tagName);
  }
  for (const t of tags) {
    if (!order.includes(t)) order.push(t);
  }
  return order;
}

/**
 * Direct children that are containers (have element children) → show as nav buttons.
 * Only when multiple siblings exist (children list). Excludes single-entry containers (flattened).
 */
function inferChildTables(
  listNodeIds: number[],
  nodesById: Map<number, XmlNode>,
  singleEntryContainers: Set<string>,
  tagCountPerRow: Map<string, number>
): string[] {
  const childTableTags = new Set<string>();
  for (const id of listNodeIds) {
    const node = nodesById.get(id);
    if (!node) continue;
    for (const cid of node.childIds) {
      const child = nodesById.get(cid);
      if (!child || child.childIds.length === 0) continue;
      if (singleEntryContainers.has(child.tagName)) continue;
      const count = tagCountPerRow.get(child.tagName) ?? 0;
      if (count > 1) childTableTags.add(child.tagName);
    }
  }
  const firstNode = nodesById.get(listNodeIds[0]);
  const order: string[] = [];
  if (firstNode) {
    for (const cid of firstNode.childIds) {
      const child = nodesById.get(cid);
      if (!child || child.childIds.length === 0) continue;
      if (singleEntryContainers.has(child.tagName)) continue;
      if ((tagCountPerRow.get(child.tagName) ?? 0) > 1 && !order.includes(child.tagName)) order.push(child.tagName);
    }
  }
  for (const t of childTableTags) {
    if (!order.includes(t)) order.push(t);
  }
  return order;
}

/** Recursively collect all leaf paths under a container node. pathPrefix = path from list row to this node (inclusive). */
function getLeafPathsUnder(
  nodeId: number,
  nodesById: Map<number, XmlNode>,
  pathPrefix: string[]
): Array<{ path: string[]; tagName: string; leafNode: XmlNode }> {
  const node = nodesById.get(nodeId);
  if (!node) return [];
  if (node.childIds.length === 0) {
    return [{ path: pathPrefix, tagName: node.tagName, leafNode: node }];
  }
  const out: Array<{ path: string[]; tagName: string; leafNode: XmlNode }> = [];
  for (const cid of node.childIds) {
    const child = nodesById.get(cid);
    if (!child) continue;
    const childPath = pathPrefix.concat(child.tagName);
    if (child.childIds.length === 0) {
      out.push({ path: childPath, tagName: child.tagName, leafNode: child });
    } else {
      out.push(...getLeafPathsUnder(child.id, nodesById, childPath));
    }
  }
  return out;
}

/** For one list row, collect all column paths: direct leaves, recursively flattened containers, and leaf list tags. */
function getLeafPathsFromListRow(
  listNodeId: number,
  nodesById: Map<number, XmlNode>,
  tagCountPerRow: Map<string, number>,
  tagIsLeaf: Map<string, boolean>
): Array<{ path: string[]; tagName: string; isLeafList?: boolean }> {
  const node = nodesById.get(listNodeId);
  if (!node) return [];
  const result: Array<{ path: string[]; tagName: string; isLeafList?: boolean }> = [];
  for (const cid of node.childIds) {
    const child = nodesById.get(cid);
    if (!child) continue;
    const count = tagCountPerRow.get(child.tagName) ?? 0;
    const isLeaf = tagIsLeaf.get(child.tagName) ?? child.childIds.length === 0;
    if (count > 1 && isLeaf) {
      result.push({ path: [child.tagName], tagName: child.tagName, isLeafList: true });
    } else if (count === 1 && isLeaf) {
      result.push({ path: [child.tagName], tagName: child.tagName });
    } else if (count === 1 && !isLeaf) {
      const sub = getLeafPathsUnder(child.id, nodesById, [child.tagName]);
      for (const s of sub) result.push({ path: s.path, tagName: s.tagName });
    }
  }
  return result;
}

/** Infer all table columns by merging recursive leaf paths from every list row. */
function inferAllColumns(
  listNodeIds: number[],
  nodesById: Map<number, XmlNode>,
  tagCountPerRow: Map<string, number>,
  tagIsLeaf: Map<string, boolean>,
  leafListTags: string[]
): TableColumn[] {
  const pathToCol = new Map<string, TableColumn>();
  const order: string[] = [];
  const seenOrder = new Set<string>();
  function add(col: TableColumn) {
    const key = getTableColumnKey(col);
    if (pathToCol.has(key)) return;
    pathToCol.set(key, col);
    order.push(key);
    seenOrder.add(key);
  }
  const firstNode = nodesById.get(listNodeIds[0]);
  if (firstNode) {
    const firstPaths = getLeafPathsFromListRow(listNodeIds[0], nodesById, tagCountPerRow, tagIsLeaf);
    for (const p of firstPaths) {
      if (p.isLeafList) add({ tagName: p.tagName, pathFromListRoot: p.path, isLeafList: true });
      else add({ tagName: p.tagName, pathFromListRoot: p.path });
    }
  }
  for (const tag of leafListTags) {
    const key = tag;
    if (!seenOrder.has(key)) add({ tagName: tag, pathFromListRoot: [tag], isLeafList: true });
  }
  for (let i = 1; i < listNodeIds.length; i++) {
    const paths = getLeafPathsFromListRow(listNodeIds[i], nodesById, tagCountPerRow, tagIsLeaf);
    for (const p of paths) {
      const key = p.path.join('/');
      if (pathToCol.has(key)) continue;
      if (p.isLeafList) add({ tagName: p.tagName, pathFromListRoot: p.path, isLeafList: true });
      else add({ tagName: p.tagName, pathFromListRoot: p.path });
    }
  }
  return order.map((k) => pathToCol.get(k)).filter((col): col is TableColumn => col !== undefined);
}

/** Apply previous column order: existing columns in that order, then new columns appended. */
function applyPreviousColumnOrder(
  columns: TableColumn[],
  previousOrder: string[] | undefined
): TableColumn[] {
  if (!previousOrder || previousOrder.length === 0) return columns;
  const byKey = new Map<string, TableColumn>();
  for (const col of columns) byKey.set(getTableColumnKey(col), col);
  const result: TableColumn[] = [];
  const used = new Set<string>();
  for (const key of previousOrder) {
    const col = byKey.get(key);
    if (col) {
      result.push(col);
      used.add(key);
    }
  }
  for (const col of columns) {
    const key = getTableColumnKey(col);
    if (!used.has(key)) result.push(col);
  }
  return result;
}

/** Fill cells for one list row using path-based keys (recursive flattening). */
function fillCellsForRow(
  listNodeId: number,
  nodesById: Map<number, XmlNode>,
  tagCountPerRow: Map<string, number>,
  tagIsLeaf: Map<string, boolean>,
  leafListTags: string[],
  childTables: string[]
): { cells: Map<string, TableCell | TableCell[]>; childTablePresent: Map<string, boolean> } {
  const node = nodesById.get(listNodeId);
  const cells = new Map<string, TableCell | TableCell[]>();
  const childTablePresent = new Map<string, boolean>();
  if (!node) return { cells, childTablePresent };

  const leafListAccum: Record<string, TableCell[]> = {};
  for (const tag of leafListTags) leafListAccum[tag] = [];

  for (const cid of node.childIds) {
    const child = nodesById.get(cid);
    if (!child) continue;
    const count = tagCountPerRow.get(child.tagName) ?? 0;
    const isLeaf = tagIsLeaf.get(child.tagName) ?? child.childIds.length === 0;

    if (leafListTags.includes(child.tagName)) {
      leafListAccum[child.tagName].push({ textContent: child.textContent, nodeId: child.id });
    } else if (count > 1 && child.childIds.length > 0 && childTables.includes(child.tagName)) {
      childTablePresent.set(child.tagName, true);
    } else if (count === 1 && isLeaf) {
      cells.set(child.tagName, { textContent: child.textContent, nodeId: child.id });
    } else if (count === 1 && !isLeaf) {
      const sub = getLeafPathsUnder(child.id, nodesById, [child.tagName]);
      for (const s of sub) {
        const key = s.path.join('/');
        cells.set(key, { textContent: s.leafNode.textContent, nodeId: s.leafNode.id });
      }
    }
  }
  for (const [tag, list] of Object.entries(leafListAccum)) {
    if (list.length > 0) cells.set(tag, list);
  }
  return { cells, childTablePresent };
}

/**
 * Build Table View (list) when the filtered nodes form a uniform list (same parent, same tag).
 * Columns = leaf fields (flattened from single-entry containers). Child list nav when multiple same-tag siblings exist.
 * previousColumnOrder preserves column order across refreshes.
 */
export function buildListView(
  parseResult: XmlParseResult,
  nodeIds: number[],
  options?: { previousColumnOrder?: string[] }
): ListTableView | null {
  const { nodesById } = parseResult;
  if (nodeIds.length === 0) return null;
  if (!isUniformList(nodeIds, nodesById)) return null;

  const { tagCountPerRow, tagIsLeaf } = inferChildStats(nodeIds, nodesById);
  const leafListTags = inferLeafListColumns(nodeIds, nodesById, tagCountPerRow, tagIsLeaf);
  const singleEntryContainers = inferSingleEntryContainers(nodeIds, nodesById, tagCountPerRow, tagIsLeaf);
  const singleEntrySet = new Set(singleEntryContainers);
  const childTables = inferChildTables(nodeIds, nodesById, singleEntrySet, tagCountPerRow);

  let allColumns = inferAllColumns(nodeIds, nodesById, tagCountPerRow, tagIsLeaf, leafListTags);
  allColumns = applyPreviousColumnOrder(allColumns, options?.previousColumnOrder);

  const rows: TableRow[] = [];
  for (const listNodeId of nodeIds) {
    const node = nodesById.get(listNodeId);
    if (!node) continue;
    const path = node.pathFromRoot.join('/');
    const { cells, childTablePresent } = fillCellsForRow(
      listNodeId,
      nodesById,
      tagCountPerRow,
      tagIsLeaf,
      leafListTags,
      childTables
    );
    rows.push({
      listNodeId,
      path,
      startOffset: node.startOffset,
      endOffset: node.endOffset,
      cells,
      childTablePresent,
    });
  }

  return {
    columns: allColumns,
    rows,
    childTables: childTables.map((tagName) => ({ tagName })),
  };
}
