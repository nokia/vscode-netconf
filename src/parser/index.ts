/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

export { parseXml } from './xml-parser';
export { publishParseDiagnostics, isParseUsable } from './diagnostics';
export { filterNodesByPath, pathHasIncompleteFilter, parsePath } from './path-filter';
export type { XmlNode, XmlParseResult } from './types';
export type { PathSegment } from './path-filter';
