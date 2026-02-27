/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  Shared types for the XML Navigator webview.
  Used by main.ts and message payloads; kept format-agnostic where possible.
*/

export interface GridRow {
  id: number;
  tagName: string;
  depth: number;
  path: string;
  attributes: Record<string, string>;
  textContent: string;
  startOffset: number;
  endOffset: number;
}

/** Table View (list mode): one column = one leaf field; rows = list items. */
export interface TableColumnDef {
  tagName: string;
  /** Full path from list row to leaf for tooltip (e.g. ['port', 'connector', 'breakout']). */
  pathFromListRoot?: string[];
  isLeafList?: boolean;
  group?: string;
}

/** Mirrored by host in editor/tableBuilder; keep in sync for host→webview gridData.childTables. */
export interface ChildTableRef {
  tagName: string;
}

export type TableCellValue =
  | { textContent: string; nodeId: number }
  | Array<{ textContent: string; nodeId: number }>;

export interface TableRowData {
  listNodeId: number;
  path: string;
  startOffset: number;
  endOffset: number;
  cells: Record<string, TableCellValue>;
  childTablePresent?: Record<string, boolean>;
}

/** dict = Element View (single node). list = Table View (multi-row list). */
export type ViewMode = 'dict' | 'list';

/** Mirrored by host in editor/dictBuilder; keep in sync for host→webview gridData.dictEntries. */
export interface DictEntry {
  key: string;
  value?: string;
  nodeId?: number;
  /** Multiple same-tag siblings → single "Open table" for this key. */
  openTable?: boolean;
  /** Multiple same-tag leaf siblings → one parameter with value chips. */
  leafList?: boolean;
  leafListParentNodeId?: number;
  leafListValues?: Array<{
    value: string;
    nodeId: number;
    startOffset?: number;
    endOffset?: number;
  }>;
  /** Single child with nested content → full depth inline. */
  children?: DictEntry[];
}

export interface SelectedCell {
  rowIndex: number;
  colTag: string;
}

export {
  getTableColumnKey,
  getFirstSegmentOrder,
} from '../common/table-column-helpers';
