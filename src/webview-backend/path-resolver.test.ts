/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import { describe, it, expect } from 'vitest';
import { parseXml } from '../parser';
import { getNextSegmentSuggestions, suggestDefaultPath } from './path-resolver';

describe('path-resolver', () => {
  const xml = `<?xml version="1.0"?>
<rpc-reply>
  <data>
    <ports>
      <port port-id="1/1/c1/1"><ethernet/></port>
    </ports>
  </data>
</rpc-reply>`;
  const parseResult = parseXml(xml);

  describe('suggestDefaultPath', () => {
    it('returns first content layer path', () => {
      const path = suggestDefaultPath(parseResult);
      expect(path).toBeTruthy();
      expect(path.split('/').length).toBeGreaterThanOrEqual(1);
    });
    it('returns empty for empty parse result', () => {
      const empty = parseXml('  ');
      expect(suggestDefaultPath(empty)).toBe('');
    });
  });

  describe('getNextSegmentSuggestions', () => {
    it('returns child segment names at root', () => {
      const suggestions = getNextSegmentSuggestions(parseResult, '', '');
      expect(suggestions).toContain('data');
    });
    it('returns suggestions for path prefix', () => {
      const suggestions = getNextSegmentSuggestions(parseResult, 'rpc-reply/data', 'port');
      expect(suggestions).toContain('ports');
    });
    it('filters by prefix when given', () => {
      const suggestions = getNextSegmentSuggestions(parseResult, 'rpc-reply', 'd');
      expect(suggestions.every((s) => s.toLowerCase().startsWith('d'))).toBe(true);
    });
  });
});
