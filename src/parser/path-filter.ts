/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import type { XmlNode, XmlParseResult } from './types';

/**
 * One segment of a XPATH-style path.
 */
export interface PathSegment {
  name: string;
  keys?: Record<string, string>;
}

function splitPathOnSlash(pathStr: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of pathStr.replace(/^\/+/, '')) {
    if (ch === '[') { depth++; cur += ch; }
    else if (ch === ']') { depth--; cur += ch; }
    else if (ch === '/' && depth === 0) { if (cur) parts.push(cur); cur = ''; }
    else { cur += ch; }
  }
  if (cur) parts.push(cur);
  return parts.filter(Boolean);
}

export function parsePath(pathStr: string): PathSegment[] {
  const trimmed = pathStr.trim();
  if (!trimmed) return [];
  const parts = splitPathOnSlash(trimmed);
  const segments: PathSegment[] = [];
  for (const part of parts) {
    // eslint-disable-next-line no-useless-escape -- [ must be escaped inside character class
    const match = part.match(/^([^\[]+)(.*)$/);
    if (!match) continue;
    const name = match[1].trim();
    const rest = match[2].trim();
    const keys: Record<string, string> = {};
    const keyRegex = /\[([^=]+)=([^\]]*)\]/g;
    let m: RegExpExecArray | null;
    while ((m = keyRegex.exec(rest)) !== null) {
      const rawVal = (m[2] ?? '').trim();
      const val = rawVal.replace(/^["']|["']$/g, '');
      keys[m[1].trim()] = val;
    }
    segments.push(keys && Object.keys(keys).length > 0 ? { name, keys } : { name });
  }
  return segments;
}

export function pathHasIncompleteFilter(pathStr: string): boolean {
  const path = pathStr.trim();
  if (!path.includes('[')) return false;
  const openCount = (path.match(/\[/g) ?? []).length;
  const closeCount = (path.match(/]/g) ?? []).length;
  if (openCount !== closeCount) return true;
  let i = path.indexOf('[');
  while (i >= 0) {
    const j = path.indexOf(']', i);
    if (j < 0) return true;
    const between = path.slice(i + 1, j);
    if (!between.includes('=')) return true;
    i = path.indexOf('[', j + 1);
  }
  return false;
}

function getAncestorChain(nodeId: number, nodesById: Map<number, XmlNode>): XmlNode[] {
  const chain: XmlNode[] = [];
  let n = nodesById.get(nodeId);
  while (n) {
    chain.unshift(n);
    n = n.parentId >= 0 ? nodesById.get(n.parentId) : undefined;
  }
  return chain;
}

function getValueAtPath(
  node: XmlNode,
  pathKey: string,
  nodesById: Map<number, XmlNode>
): string | undefined {
  const parts = pathKey.split(/[/.]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) {
    const k = parts[0];
    if (k === undefined) return undefined;
    if (node.attributes[k] !== undefined) return node.attributes[k];
    const child = node.childIds
      .map((cid) => nodesById.get(cid))
      .find((c) => c?.tagName === k);
    return child?.textContent;
  }
  let current: XmlNode | undefined = node;
  for (let i = 0; i < parts.length && current; i++) {
    const seg = parts[i];
    if (seg === undefined) return undefined;
    const childId = current.childIds.find((cid) => nodesById.get(cid)?.tagName === seg);
    if (childId === undefined) return undefined;
    current = nodesById.get(childId);
  }
  return current?.textContent;
}

function nodeMatchesPath(
  node: XmlNode,
  segments: PathSegment[],
  nodesById: Map<number, XmlNode>
): boolean {
  const chain = getAncestorChain(node.id, nodesById);
  if (chain.length !== segments.length) return false;
  for (let i = 0; i < segments.length; i++) {
    if (chain[i].tagName !== segments[i].name) return false;
    const segKeys = segments[i].keys;
    if (segKeys) {
      for (const [k, v] of Object.entries(segKeys)) {
        if (!k.includes('/') && !k.includes('.') && chain[i].attributes[k] === v) continue;
        const resolved = getValueAtPath(chain[i], k, nodesById);
        if (resolved === v) continue;
        if (!resolved && v === '') continue;
        return false;
      }
    }
  }
  return true;
}

export function filterNodesByPath(
  parseResult: XmlParseResult,
  pathStr: string
): number[] {
  const segments = parsePath(pathStr);
  if (segments.length === 0) return parseResult.rowOrder;
  const { nodesById, rowOrder } = parseResult;
  return rowOrder.filter((id) => {
    const node = nodesById.get(id);
    return node ? nodeMatchesPath(node, segments, nodesById) : false;
  });
}
