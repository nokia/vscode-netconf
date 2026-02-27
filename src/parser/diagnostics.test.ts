/*
  @author Sven Wisotzky
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import { describe, it, expect } from 'vitest';
import { parseXml } from './xml-parser';
import { isParseUsable } from './diagnostics';

describe('isParseUsable', () => {
  it('returns true for valid XML with root', () => {
    const result = parseXml('<?xml version="1.0"?><root><a/></root>');
    expect(isParseUsable(result)).toBe(true);
  });

  it('returns false when there are parse errors', () => {
    const result = parseXml('<root><unclosed>');
    expect(isParseUsable(result)).toBe(false);
  });

  it('returns false when rootId is -1', () => {
    const result = parseXml('  ');
    expect(result.rootId).toBe(-1);
    expect(isParseUsable(result)).toBe(false);
  });
});
