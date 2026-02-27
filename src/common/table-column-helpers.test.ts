/*
  @author Sven Wisotzky
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import { describe, it, expect } from 'vitest';
import { getTableColumnKey, getFirstSegmentOrder } from './table-column-helpers';
import type { TableColumnDefLike } from './table-column-helpers';

describe('table-column-helpers', () => {
  describe('getTableColumnKey', () => {
    it('uses pathFromListRoot when present', () => {
      const col: TableColumnDefLike = { tagName: 'x', pathFromListRoot: ['a', 'b', 'x'] };
      expect(getTableColumnKey(col)).toBe('a/b/x');
    });
    it('uses group/tagName when group present', () => {
      const col: TableColumnDefLike = { tagName: 'x', group: 'g' };
      expect(getTableColumnKey(col)).toBe('g/x');
    });
    it('uses tagName only otherwise', () => {
      const col: TableColumnDefLike = { tagName: 'x' };
      expect(getTableColumnKey(col)).toBe('x');
    });
  });

  describe('getFirstSegmentOrder', () => {
    it('returns first segment per column, deduped, order preserved', () => {
      const cols: TableColumnDefLike[] = [
        { tagName: 'a', pathFromListRoot: ['x', 'a'] },
        { tagName: 'b', pathFromListRoot: ['y', 'b'] },
        { tagName: 'c', pathFromListRoot: ['x', 'c'] },
      ];
      expect(getFirstSegmentOrder(cols)).toEqual(['x', 'y']);
    });
    it('uses tagName when no pathFromListRoot', () => {
      const cols: TableColumnDefLike[] = [
        { tagName: 'a' },
        { tagName: 'b', group: 'g' },
      ];
      expect(getFirstSegmentOrder(cols)).toEqual(['a', 'b']);
    });
  });
});
