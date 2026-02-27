/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  Node in the XML tree with character offset range for text-grid sync.
*/

export interface XmlNode {
  /** Unique id (index in flat pre-order list). */
  id: number;
  /** Local tag name (no namespace prefix in Phase 1). */
  tagName: string;
  /** Attributes as record. */
  attributes: Record<string, string>;
  /** Character offset of the start of this element (opening tag) in the source. */
  startOffset: number;
  /** Character offset of the end of this element (closing tag) in the source. */
  endOffset: number;
  /** Depth from root (0 = root element). */
  depth: number;
  /** Parent node id, or -1 for root. */
  parentId: number;
  /** Child node ids in document order. */
  childIds: number[];
  /** Text content of this element (concatenated direct text nodes). */
  textContent: string;
  /** Path from root, e.g. ['root', 'child', 'leaf']. */
  pathFromRoot: string[];
}

/**
 * Result of parsing XML: tree of nodes and lookup maps.
 */
export interface XmlParseResult {
  /** Root element node id, or -1 if empty or error. */
  rootId: number;
  /** All nodes by id. */
  nodesById: Map<number, XmlNode>;
  /** Nodes that contain a given offset (for text→XML Navigator sync). Offset → node id (innermost). */
  nodeAtOffset: (offset: number) => number;
  /** Ordered list of node ids (pre-order). */
  rowOrder: number[];
  /** Parse errors (line, column, message). */
  errors: Array<{ line: number; column: number; message: string }>;
}
