/*
  @author Sven Wisotzky
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import { describe, it, expect } from 'vitest';
import { parseXml } from './xml-parser';

describe('parseXml', () => {
  it('parses simple XML and returns rootId and nodes', () => {
    const xml = '<?xml version="1.0"?><root><a/><b/></root>';
    const result = parseXml(xml);
    expect(result.rootId).toBeGreaterThanOrEqual(0);
    expect(result.errors).toHaveLength(0);
    expect(result.nodesById.size).toBeGreaterThan(0);
    expect(result.rowOrder.length).toBeGreaterThan(0);
    const root = result.nodesById.get(result.rootId);
    expect(root).toBeDefined();
    expect(root?.tagName).toBe('root');
    expect(root?.childIds.length).toBe(2);
  });

  it('reports errors for invalid XML', () => {
    const xml = '<root><unclosed>';
    const result = parseXml(xml);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('parses XML with attributes', () => {
    const xml = '<root id="1"><item key="a"/></root>';
    const result = parseXml(xml);
    expect(result.errors).toHaveLength(0);
    const root = result.nodesById.get(result.rootId);
    expect(root?.attributes?.id).toBe('1');
    const childId = root?.childIds[0];
    const child = childId !== undefined ? result.nodesById.get(childId) : undefined;
    expect(child?.attributes?.key).toBe('a');
  });
});
