/*
  @author Sven Wisotzky
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import { describe, it, expect } from 'vitest';
import {
  splitPathSegments,
  formatPathPredicateValue,
  parsePathSegment,
  buildPathSegment,
} from './path-utils';

describe('path-utils', () => {
  describe('splitPathSegments', () => {
    it('splits path by / outside brackets', () => {
      expect(splitPathSegments('a/b/c')).toEqual(['a', 'b', 'c']);
    });
    it('does not split on / inside predicates', () => {
      expect(splitPathSegments('rpc-reply/data/port[port-id="1/1/c1/1"]/ethernet')).toEqual([
        'rpc-reply',
        'data',
        'port[port-id="1/1/c1/1"]',
        'ethernet',
      ]);
    });
    it('strips leading slashes', () => {
      expect(splitPathSegments('/a/b')).toEqual(['a', 'b']);
    });
  });

  describe('formatPathPredicateValue', () => {
    it('returns value as-is when no ] or "', () => {
      expect(formatPathPredicateValue('hello')).toBe('hello');
    });
    it('quotes and escapes when value contains ]', () => {
      expect(formatPathPredicateValue('a]b')).toBe('"a]b"');
    });
  });

  describe('parsePathSegment', () => {
    it('parses name only', () => {
      expect(parsePathSegment('port')).toEqual({ name: 'port', predicates: [] });
    });
    it('parses name and predicates', () => {
      const r = parsePathSegment('port[port-id="1/1/c1/1"][mtu=1500]');
      expect(r.name).toBe('port');
      expect(r.predicates).toHaveLength(2);
      expect(r.predicates[0]).toEqual({ key: 'port-id', value: '1/1/c1/1' });
      expect(r.predicates[1]).toEqual({ key: 'mtu', value: '1500' });
    });
  });

  describe('buildPathSegment', () => {
    it('returns name when no predicates', () => {
      expect(buildPathSegment('port', [])).toBe('port');
    });
    it('appends predicates', () => {
      // formatPathPredicateValue only quotes when value contains ] or "; 1/1/c1/1 and 1500 are unquoted
      expect(
        buildPathSegment('port', [
          { key: 'port-id', value: '1/1/c1/1' },
          { key: 'mtu', value: '1500' },
        ])
      ).toBe('port[port-id=1/1/c1/1][mtu=1500]');
    });
  });
});
