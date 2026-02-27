/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  Pure helpers for table column key and tooltip.
  Used by webview/types (re-exported) and by Node tests.
*/

export interface TableColumnDefLike {
  tagName: string;
  pathFromListRoot?: string[];
  group?: string;
}

/** Single representation: path joined by '/' or "group/tagName" or "tagName". Used for column key and tooltip. */
export function getTableColumnKey(col: TableColumnDefLike): string {
  if (col.pathFromListRoot && col.pathFromListRoot.length > 0)
    return col.pathFromListRoot.join('/');
  return col.group ? `${col.group}/${col.tagName}` : col.tagName;
}

/** Ordered list of first segment per column (for insert position in document). Deduped, order preserved. */
export function getFirstSegmentOrder(cols: TableColumnDefLike[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const col of cols) {
    const seg =
      col.pathFromListRoot && col.pathFromListRoot.length > 0
        ? col.pathFromListRoot[0]
        : col.tagName;
    if (!seen.has(seg)) {
      seen.add(seg);
      order.push(seg);
    }
  }
  return order;
}
