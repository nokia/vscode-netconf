/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  Compute default column widths from table content so the table view fits content by default.
*/

import type { TableColumnDef, TableRowData } from './types';
import { getTableColumnKey } from './types';
import { MIN_COL_WIDTH } from './constants';

const APPROX_CHAR_WIDTH_PX = 8;
const CELL_PADDING_PX = 16;
const MAX_COL_WIDTH_PX = 400;
const SAMPLE_ROWS = 100;

function getCellDisplayLength(row: TableRowData, colKey: string): number {
  const v = row.cells[colKey];
  if (!v) return 0;
  const text = Array.isArray(v) ? v.map((c) => c.textContent).join(', ') : v.textContent;
  return text.length;
}

/**
 * Returns optimal column widths from header and cell content (sampled).
 * Used when no user-defined column widths exist yet.
 */
export function computeOptimalColumnWidths(
  columns: TableColumnDef[],
  rows: TableRowData[],
): Record<string, number> {
  const out: Record<string, number> = {};
  const sampleRows = rows.slice(0, SAMPLE_ROWS);
  for (const col of columns) {
    const colKey = getTableColumnKey(col);
    const headerLen = col.tagName.length;
    let maxLen = headerLen;
    for (const row of sampleRows) {
      const len = getCellDisplayLength(row, colKey);
      if (len > maxLen) maxLen = len;
    }
    const w = Math.min(MAX_COL_WIDTH_PX, Math.max(MIN_COL_WIDTH, maxLen * APPROX_CHAR_WIDTH_PX + CELL_PADDING_PX));
    out[colKey] = w;
  }
  return out;
}
