/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import type { XmlNode, XmlParseResult } from '../parser/types';
import { filterNodesByPath } from '../parser';

/**
 * Suggest the next path segment (direct children of current path).
 */
export function getNextSegmentSuggestions(
  parseResult: XmlParseResult,
  currentPath: string,
  prefix: string
): string[] {
  const { nodesById, rootId } = parseResult;
  const normalizedPath = currentPath.replace(/^\/+/, '').trim();
  const prefixLower = prefix.trim().toLowerCase();
  const byLower = new Map<string, string>();

  const nodeIds =
    normalizedPath === ''
      ? rootId >= 0
        ? [rootId]
        : []
      : filterNodesByPath(parseResult, normalizedPath);

  for (const id of nodeIds) {
    const node = nodesById.get(id);
    if (!node) continue;
    const siblingStats = new Map<string, { count: number; hasContainer: boolean }>();
    for (const cid of node.childIds) {
      const child = nodesById.get(cid);
      if (!child) continue;
      const stat = siblingStats.get(child.tagName);
      if (stat) {
        stat.count += 1;
        if (child.childIds.length > 0) stat.hasContainer = true;
      } else {
        siblingStats.set(child.tagName, {
          count: 1,
          hasContainer: child.childIds.length > 0,
        });
      }
    }
    for (const cid of node.childIds) {
      const child = nodesById.get(cid);
      if (!child) continue;
      const name = child.tagName;
      if (prefixLower !== '' && !name.toLowerCase().startsWith(prefixLower)) continue;
      const stats = siblingStats.get(name);
      const isContainer = child.childIds.length > 0;
      const isListOfContainers = !!stats && stats.count > 1 && stats.hasContainer;
      if (!isContainer && !isListOfContainers) continue;
      const key = name.toLowerCase();
      if (!byLower.has(key)) byLower.set(key, name);
    }
  }

  return [...byLower.values()].sort();
}

/**
 * Find the first "content" layer for initial XML view.
 */
function walkToDefaultPath(nodesById: Map<number, XmlNode>, nodeId: number): string {
  const node = nodesById.get(nodeId);
  if (!node || node.childIds.length === 0) {
    return node ? node.pathFromRoot.join('/') : '';
  }
  if (node.childIds.length > 1) {
    const firstChild = nodesById.get(node.childIds[0]);
    if (!firstChild) return node.pathFromRoot.join('/');
    const allSameTag = node.childIds.every((cid) => nodesById.get(cid)?.tagName === firstChild.tagName);
    if (allSameTag) {
      return [...node.pathFromRoot, firstChild.tagName].join('/');
    }
    if (node.pathFromRoot.length === 1) {
      return [...node.pathFromRoot, firstChild.tagName].join('/');
    }
    return node.pathFromRoot.join('/');
  }
  return walkToDefaultPath(nodesById, node.childIds[0]);
}

export function suggestDefaultPath(parseResult: XmlParseResult): string {
  const { rootId, nodesById } = parseResult;
  if (rootId < 0) return '';
  return walkToDefaultPath(nodesById, rootId);
}
