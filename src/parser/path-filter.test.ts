/*
  @author Sven Wisotzky
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import { describe, it, expect } from 'vitest';
import { parseXml } from './xml-parser';
import { filterNodesByPath, pathHasIncompleteFilter, parsePath } from './path-filter';

describe('path-filter', () => {
  const xml = `<?xml version="1.0"?>
<rpc-reply>
  <data>
    <ports>
      <port port-id="1/1/c1/1"><ethernet/></port>
      <port port-id="1/1/c1/2"><ethernet/></port>
    </ports>
  </data>
</rpc-reply>`;
  const parseResult = parseXml(xml);

  describe('filterNodesByPath', () => {
    it('returns rowOrder for empty path', () => {
      const ids = filterNodesByPath(parseResult, '');
      expect(ids.length).toBe(parseResult.rowOrder.length);
      if (parseResult.rootId >= 0) expect(ids).toContain(parseResult.rootId);
    });

    it('finds nodes by single segment path', () => {
      const ids = filterNodesByPath(parseResult, 'rpc-reply');
      expect(ids.length).toBe(1);
      expect(parseResult.nodesById.get(ids[0])?.tagName).toBe('rpc-reply');
    });

    it('finds nodes by multi-segment path', () => {
      const ids = filterNodesByPath(parseResult, 'rpc-reply/data/ports/port');
      expect(ids.length).toBe(2);
    });

    it('finds node by path with predicate', () => {
      const ids = filterNodesByPath(parseResult, 'rpc-reply/data/ports/port[port-id="1/1/c1/1"]');
      expect(ids.length).toBe(1);
      expect(parseResult.nodesById.get(ids[0])?.attributes?.['port-id']).toBe('1/1/c1/1');
    });
  });

  describe('pathHasIncompleteFilter', () => {
    it('returns false for path without brackets', () => {
      expect(pathHasIncompleteFilter('a/b/c')).toBe(false);
    });
    it('returns true when brackets are unbalanced', () => {
      expect(pathHasIncompleteFilter('a[b=1')).toBe(true);
      expect(pathHasIncompleteFilter('a[b=1]c[d=2')).toBe(true);
    });
    it('returns true when bracket content has no =', () => {
      expect(pathHasIncompleteFilter('a[foo]')).toBe(true);
    });
    it('returns false for complete key=value predicates', () => {
      expect(pathHasIncompleteFilter('a[b=1]')).toBe(false);
      expect(pathHasIncompleteFilter('a[b=1][c=2]')).toBe(false);
    });
  });

  describe('parsePath', () => {
    it('splits path into segments', () => {
      const segs = parsePath('rpc-reply/data/port');
      expect(segs).toHaveLength(3);
      expect(segs[0].name).toBe('rpc-reply');
      expect(segs[1].name).toBe('data');
      expect(segs[2].name).toBe('port');
    });
    it('parses segment with keys', () => {
      const segs = parsePath('port[port-id="1/1/c1/1"]');
      expect(segs).toHaveLength(1);
      expect(segs[0].name).toBe('port');
      expect(segs[0].keys).toEqual({ 'port-id': '1/1/c1/1' });
    });
    it('returns empty array for empty or whitespace', () => {
      expect(parsePath('')).toEqual([]);
      expect(parsePath('   ')).toEqual([]);
    });
  });
});
