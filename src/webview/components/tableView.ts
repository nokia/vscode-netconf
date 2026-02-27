/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  TableView component: spreadsheet-style grid with header (sort/filter), virtualized body,
  row handles, cell edit, selection/drag. Uses table-view.css and element-view.css (chips).
  Emits pathNavigate, cellSelect, cellEdit, delete, addRow, addLeafListItem, pasteGrid, sort, filter, resizeColumn, contextMenu.
*/

import type { TableColumnDef, TableRowData, ChildTableRef, SelectedCell } from '../types';
import { getTableColumnKey, getFirstSegmentOrder } from '../types';
import { ROW_HEIGHT, HEADER_HEIGHT, FILTER_ROW_HEIGHT, DEFAULT_COL_WIDTH, MIN_COL_WIDTH, ROW_HANDLE_WIDTH } from '../constants';
import { strings } from '../strings';
import { renderLeafListChips } from './shared/leafListChips';

export interface TableViewOptions {
  columns: TableColumnDef[];
  rows: TableRowData[];
  childTables: ChildTableRef[];
  sortKey: string;
  sortAsc: boolean;
  columnFilters: Record<string, string[]>;
  columnWidths: Record<string, number>;
  selectedCells: SelectedCell[];
  focusedCell: SelectedCell | null;
  listParentNodeId: number;
  listRowTagName: string;
  lastListNodeId: number;
  currentPathFull: string;
  onPathNavigate: (path: string) => void;
  onCellSelect: (cells: SelectedCell[], focused: SelectedCell | null) => void;
  onCellEdit: (payload: {
    nodeId: number;
    field: 'tagName' | 'textContent';
    value: string;
    rowIndex: number;
    colTag: string;
    createNew?: { parentNodeId: number; tagName: string; pathFromListRoot?: string[] };
  }) => void;
  onDelete: (nodeIds: number[]) => void;
  onAddRow: () => void;
  onAddLeafListItem: (payload: {
    parentNodeId: number;
    tagName: string;
    value: string;
    pathFromListRoot?: string[];
    columnOrder?: string[];
    firstSegmentOrder?: string[];
  }) => void;
  onSort: (colKey: string, asc: boolean) => void;
  onFilter: (colKey: string, values: string[]) => void;
  onResizeColumn: (colKey: string, width: number) => void;
  onContextMenu: (payload: { rowIndex?: number; colTag?: string; clientX?: number; clientY?: number }) => void;
  onSelectionReveal?: (nodeId: number, startOffset: number, endOffset: number) => void;
  /** Optional: scroll this row into view on next render (cleared after use). */
  scrollToRowIndex?: number;
  /** Whether the filter row is visible (defaults to true). */
  filterRowVisible?: boolean;
}

export interface TableViewInstance {
  update(options: Partial<TableViewOptions>): void;
  getDisplayedRows(): TableRowData[];
  scrollToRow(index: number): void;
  focusFilterInput(colKey: string): void;
  setFilterRowVisible(visible: boolean): void;
  openCellForEdit(rowIndex: number, colTag: string, initialKey?: string): void;
  destroy(): void;
}

function getCellDisplayValue(row: TableRowData, colKey: string): string {
  const v = row.cells[colKey];
  if (!v) return '';
  return Array.isArray(v) ? v.map((c) => c.textContent).join(', ') : v.textContent;
}

function sortAscIconSVG(): string {
  return '<svg width="6" height="6" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 4l-6 8h12L8 4z"/></svg>';
}
function sortDescIconSVG(): string {
  return '<svg width="6" height="6" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 12l6-8H2l6 8z"/></svg>';
}
function filterIconSVG(): string {
  return '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 2h14l-5 6v4l-4 2v-6L1 2z"/></svg>';
}

function createTableIcon(nextPath: string, onNavigate: (path: string) => void): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'table-nav-icon';
  wrap.title = strings.tooltipOpenTable;
  wrap.setAttribute('role', 'button');
  wrap.tabIndex = 0;
  wrap.innerHTML =
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M1 2v12h14V2H1zm2 2h2v2H3V4zm4 0v2H5V4h2zm2 0h2v2H9V4zm2 0h2v2h-2V4zM3 8h2v2H3V8zm4 0v2H5V8h2zm2 0h2v2H9V8zm2 0h2v2h-2V8z"/></svg>';
  wrap.addEventListener('click', (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    onNavigate(nextPath.replace(/\/+/g, '/').trim());
  });
  wrap.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onNavigate(nextPath.replace(/\/+/g, '/').trim());
    }
  });
  return wrap;
}

/**
 * Create a TableView in the given container. The container should be the scrollable area (e.g. #list-view).
 * State is passed via options; updates via instance.update(). All mutations go through callbacks.
 */
export function createTableView(container: HTMLElement, options: TableViewOptions): TableViewInstance {
  let state: TableViewOptions = { ...options };
  let tableDiv: HTMLDivElement | null = null;
  let tableBody: HTMLDivElement | null = null;
  let viewportStart = 0;
  let viewportEnd = 50;
  let scrollListener: (() => void) | null = null;
  const filterRowWraps: Record<string, HTMLElement> = {};
  const columnHeaderWraps: Record<string, HTMLElement> = {};
  const headerIconWraps: Record<string, HTMLElement> = {};
  let dragAnchor: SelectedCell | null = null;
  let dragLastCell: SelectedCell | null = null;
  let dragSelecting = false;
  let dragMoveListener: ((ev: MouseEvent) => void) | null = null;
  let dragUpListener: ((ev: MouseEvent) => void) | null = null;
  let hoverRowIndex: number | null = null;
  let hoverColTag: string | null = null;
  let hoverCellRowIndex: number | null = null;
  let hoverCellColTag: string | null = null;
  let rowSelectionAnchor: number | null = null;
  let columnSelectionAnchor: string | null = null;
  let rowHandleDragMoveListener: ((ev: MouseEvent) => void) | null = null;
  let rowHandleDragUpListener: ((ev: MouseEvent) => void) | null = null;
  let rowHandleDragAnchor: number | null = null;
  let rowHandleDragMoved = false;
  let suppressNextRowHandleClick = false;
  let headerDragMoveListener: ((ev: MouseEvent) => void) | null = null;
  let headerDragUpListener: ((ev: MouseEvent) => void) | null = null;
  let headerDragAnchor: string | null = null;
  let headerDragMoved = false;
  let suppressNextHeaderClick = false;

  function renderHeaderIndicators(colKey: string): void {
    const icons = headerIconWraps[colKey];
    if (!icons) return;
    icons.innerHTML = '';
    if (state.sortKey === colKey) {
      const sortIcon = document.createElement('span');
      sortIcon.className = 'header-sort-indicator';
      sortIcon.innerHTML = state.sortAsc ? sortAscIconSVG() : sortDescIconSVG();
      sortIcon.setAttribute('aria-label', state.sortAsc ? strings.sortedAsc : strings.sortedDesc);
      icons.appendChild(sortIcon);
    }
    if ((state.columnFilters[colKey] ?? []).some((v) => v.trim() !== '')) {
      const filterIcon = document.createElement('span');
      filterIcon.className = 'header-filter-indicator';
      filterIcon.innerHTML = filterIconSVG();
      filterIcon.setAttribute('aria-label', strings.tooltipFilterActive);
      icons.appendChild(filterIcon);
    }
  }

  function getDisplayedRows(): TableRowData[] {
    let list = state.rows;
    const hasFilter = Object.values(state.columnFilters).some((vals) => (vals ?? []).some((v) => v.trim() !== ''));
    if (hasFilter) {
      list = list.filter((row) => {
        for (const col of state.columns) {
          const colKey = getTableColumnKey(col);
          const filterValues = (state.columnFilters[colKey] ?? []).map((v) => v.trim()).filter((v) => v !== '');
          if (filterValues.length === 0) continue;
          const val = getCellDisplayValue(row, colKey);
          const matchesColumn = filterValues.some((needle) => matchesFilterNeedle(val, needle));
          if (!matchesColumn) return false;
        }
        return true;
      });
    }
    if (state.sortKey) {
      const asc = state.sortAsc;
      list = [...list].sort((a, b) => {
        const va = getCellDisplayValue(a, state.sortKey);
        const vb = getCellDisplayValue(b, state.sortKey);
        return asc ? va.localeCompare(vb, undefined, { numeric: true }) : vb.localeCompare(va, undefined, { numeric: true });
      });
    }
    return list;
  }

  function getDataColumnTags(): string[] {
    return state.columns.map((c) => getTableColumnKey(c));
  }

  function isNumericText(value: string): boolean {
    return /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim());
  }

  function matchesFilterNeedle(cellValue: string, needle: string): boolean {
    const value = cellValue.trim();
    const token = needle.trim();
    if (!token) return true;
    if (isNumericText(token)) {
      const targetNumber = Number(token);
      if (!Number.isFinite(targetNumber)) return false;
      const candidates = value.split(',').map((part) => part.trim()).filter((part) => part !== '');
      if (candidates.length === 0) return false;
      return candidates.some((candidate) => {
        if (!isNumericText(candidate)) return false;
        return Number(candidate) === targetNumber;
      });
    }
    return value.toLowerCase().includes(token.toLowerCase());
  }

  function hasCellSelection(cells: SelectedCell[], rowIndex: number, colTag: string): boolean {
    return cells.some((c) => c.rowIndex === rowIndex && c.colTag === colTag);
  }

  function buildRowSelection(rowIndex: number, cols: string[]): SelectedCell[] {
    return cols.map((colTag) => ({ rowIndex, colTag }));
  }

  function buildColumnSelection(colTag: string, rowCount: number): SelectedCell[] {
    const selection: SelectedCell[] = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      selection.push({ rowIndex, colTag });
    }
    return selection;
  }

  function dedupeSelectedCells(cells: SelectedCell[]): SelectedCell[] {
    const out: SelectedCell[] = [];
    const seen = new Set<string>();
    for (const cell of cells) {
      const key = `${cell.rowIndex}::${cell.colTag}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cell);
    }
    return out;
  }

  function resolveFocusedCell(cells: SelectedCell[], preferred: SelectedCell): SelectedCell | null {
    if (cells.some((c) => c.rowIndex === preferred.rowIndex && c.colTag === preferred.colTag)) {
      return preferred;
    }
    return cells[0] ?? null;
  }

  function isRowFullySelected(cells: SelectedCell[], rowIndex: number, cols: string[]): boolean {
    if (cols.length === 0) return false;
    return cols.every((colTag) => hasCellSelection(cells, rowIndex, colTag));
  }

  function isColumnFullySelected(cells: SelectedCell[], colTag: string, rowCount: number): boolean {
    if (rowCount === 0) return false;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      if (!hasCellSelection(cells, rowIndex, colTag)) return false;
    }
    return true;
  }

  function selectRowRange(anchorRow: number, targetRow: number): void {
    const displayed = getDisplayedRows();
    const cols = getDataColumnTags();
    if (displayed.length === 0 || cols.length === 0) return;
    const minRow = Math.max(0, Math.min(anchorRow, targetRow));
    const maxRow = Math.min(displayed.length - 1, Math.max(anchorRow, targetRow));
    const nextSelection: SelectedCell[] = [];
    for (let rowIndex = minRow; rowIndex <= maxRow; rowIndex++) {
      nextSelection.push(...buildRowSelection(rowIndex, cols));
    }
    const focused = resolveFocusedCell(nextSelection, { rowIndex: targetRow, colTag: cols[0] ?? '' });
    state.onCellSelect(nextSelection, focused);
  }

  function selectColumnRange(anchorColTag: string, targetColTag: string): void {
    const cols = getDataColumnTags();
    const rowCount = getDisplayedRows().length;
    if (cols.length === 0 || rowCount === 0) return;
    const anchorIndex = cols.indexOf(anchorColTag);
    const targetIndex = cols.indexOf(targetColTag);
    if (anchorIndex < 0 || targetIndex < 0) return;
    const minCol = Math.min(anchorIndex, targetIndex);
    const maxCol = Math.max(anchorIndex, targetIndex);
    const nextSelection: SelectedCell[] = [];
    for (let colIndex = minCol; colIndex <= maxCol; colIndex++) {
      const colTag = cols[colIndex];
      if (colTag !== undefined) nextSelection.push(...buildColumnSelection(colTag, rowCount));
    }
    const focusRow = Math.max(0, Math.min(rowCount - 1, state.focusedCell?.rowIndex ?? 0));
    const focused = resolveFocusedCell(nextSelection, { rowIndex: focusRow, colTag: targetColTag });
    state.onCellSelect(nextSelection, focused);
  }

  type CellEditPayload = {
    nodeId: number;
    field: 'tagName' | 'textContent';
    value: string;
    rowIndex: number;
    colTag: string;
    createNew?: { parentNodeId: number; tagName: string; pathFromListRoot?: string[] };
  };

  function openCellEdit(
    cellEl: HTMLDivElement,
    payload: CellEditPayload,
    initialKey?: string
  ): void {
    if (cellEl.querySelector('input, textarea')) return;
    const currentValue = payload.value;
    const isMultiline = currentValue.includes('\n');
    const input = isMultiline ? document.createElement('textarea') : document.createElement('input');
    if (!isMultiline) (input as HTMLInputElement).type = 'text';
    input.value = initialKey !== undefined ? initialKey : currentValue;
    input.className = 'cell-edit';
    input.style.background = 'var(--vscode-input-background)';
    input.style.color = 'var(--vscode-input-foreground)';
    input.style.width = '100%';
    input.style.padding = '4px 8px';
    input.style.boxSizing = 'border-box';
    input.style.border = 'none';
    input.style.outline = 'none';
    if (isMultiline) {
      (input as HTMLTextAreaElement).style.whiteSpace = 'pre-wrap';
      (input as HTMLTextAreaElement).rows = 5;
    }
    let editDone = false;
    const focusCell = (rowIndex: number, colTag: string): void => {
      const rows = getDisplayedRows();
      const cols = getDataColumnTags();
      if (rows.length === 0 || cols.length === 0) return;
      const nextRow = Math.max(0, Math.min(rows.length - 1, rowIndex));
      const firstCol = cols[0];
      const nextCol = cols.includes(colTag) ? colTag : (firstCol ?? colTag);
      const next: SelectedCell = { rowIndex: nextRow, colTag: nextCol };
      state.onCellSelect([next], next);
    };
    const moveFocusAfterCommit = (direction: 'down' | 'left' | 'right'): void => {
      const rows = getDisplayedRows();
      const cols = getDataColumnTags();
      if (rows.length === 0 || cols.length === 0) return;
      let nextRow = payload.rowIndex;
      let nextColTag = payload.colTag;
      if (direction === 'down') {
        nextRow = Math.min(rows.length - 1, payload.rowIndex + 1);
      } else {
        const currentColIdx = cols.indexOf(payload.colTag);
        const safeColIdx = currentColIdx >= 0 ? currentColIdx : 0;
        const nextColIdx =
          direction === 'left'
            ? Math.max(0, safeColIdx - 1)
            : Math.min(cols.length - 1, safeColIdx + 1);
        nextColTag = cols[nextColIdx] ?? payload.colTag;
      }
      focusCell(nextRow, nextColTag);
    };
    const commit = (moveDirection?: 'down' | 'left' | 'right') => {
      if (editDone) return;
      editDone = true;
      const newVal = isMultiline ? (input as HTMLTextAreaElement).value : (input as HTMLInputElement).value.trim();
      cellEl.classList.remove('cell-editing', 'cell-editing-single');
      cellEl.textContent = newVal || currentValue;
      input.remove();
      state.onCellEdit({ ...payload, value: newVal });
      if (moveDirection) moveFocusAfterCommit(moveDirection);
    };
    const cancel = () => {
      if (editDone) return;
      editDone = true;
      cellEl.classList.remove('cell-editing', 'cell-editing-single');
      cellEl.textContent = currentValue;
      input.remove();
      focusCell(payload.rowIndex, payload.colTag);
    };
    input.addEventListener('blur', () => commit());
    input.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (!isMultiline && ke.key === 'Enter') {
        e.preventDefault();
        commit('down');
      } else if (ke.key === 'Tab') {
        e.preventDefault();
        commit(ke.shiftKey ? 'left' : 'right');
      }
    });
    cellEl.textContent = '';
    cellEl.classList.add('cell-editing');
    if (!isMultiline) cellEl.classList.add('cell-editing-single');
    cellEl.appendChild(input);
    input.focus();
    if (initialKey === undefined) {
      (input as HTMLInputElement).select?.();
    }
  }

  function openCellForEdit(rowIndex: number, colTag: string, initialKey?: string): void {
    if (!tableBody) return;
    const displayed = getDisplayedRows();
    const row = displayed[rowIndex];
    const col = state.columns.find((c) => getTableColumnKey(c) === colTag);
    if (!row || !col) return;
    const cellData = row.cells[colTag];
    const single = Array.isArray(cellData) ? cellData[0] ?? null : cellData;
    const payload = single
      ? { nodeId: single.nodeId, field: 'textContent' as const, value: single.textContent, rowIndex, colTag }
      : {
          nodeId: 0,
          field: 'textContent' as const,
          value: '',
          rowIndex,
          colTag,
          createNew: {
            parentNodeId: row.listNodeId,
            tagName: col.tagName,
            pathFromListRoot:
              col.pathFromListRoot && col.pathFromListRoot.length > 0 ? col.pathFromListRoot : undefined,
          },
        };
    viewportStart = Math.min(viewportStart, rowIndex);
    viewportEnd = Math.max(viewportEnd, rowIndex + 2);
    render();
    const cell = tableBody.querySelector(
      `[data-row-index="${rowIndex}"][data-col-tag="${CSS.escape(colTag)}"]`
    ) as HTMLDivElement | null;
    if (cell) openCellEdit(cell, payload, initialKey);
  }

  function render(): void {
    if (!tableDiv || !tableBody) return;
    const displayed = getDisplayedRows();
    const sourceRowNumbers = new Map<number, number>();
    for (let sourceIndex = 0; sourceIndex < state.rows.length; sourceIndex++) {
      const row = state.rows[sourceIndex];
      if (!row) continue;
      if (!sourceRowNumbers.has(row.listNodeId)) {
        sourceRowNumbers.set(row.listNodeId, sourceIndex + 1);
      }
    }
    tableBody.innerHTML = '';
    const cols = getDataColumnTags();
    const visibleStart = Math.max(0, viewportStart);
    const visibleEnd = Math.min(displayed.length + 1, viewportEnd);

    for (let i = visibleStart; i < visibleEnd; i++) {
      const isAddRow = i === displayed.length;
      const tr = document.createElement('div');
      tr.className = 'grid-row';
      tr.style.height = `${ROW_HEIGHT}px`;
      tr.style.display = 'flex';
      tr.style.alignItems = 'center';
      tr.dataset.rowIndex = String(i);

      const rowHandleCell = document.createElement('div');
      rowHandleCell.className = 'cell row-handle-cell';
      rowHandleCell.dataset.rowIndex = String(i);
      rowHandleCell.dataset.colTag = 'row-handle';
      rowHandleCell.style.flex = `0 0 ${ROW_HANDLE_WIDTH}px`;
      rowHandleCell.style.minWidth = `${ROW_HANDLE_WIDTH}px`;
      rowHandleCell.style.display = 'flex';
      rowHandleCell.style.alignItems = 'center';
      rowHandleCell.style.justifyContent = 'center';
      rowHandleCell.style.cursor = 'pointer';
      if (isAddRow) {
        rowHandleCell.title = strings.tooltipAddRow;
        rowHandleCell.textContent = '+';
        rowHandleCell.addEventListener('click', (e) => {
          e.stopPropagation();
          state.onAddRow();
        });
      } else {
        const row = displayed[i];
        if (!row) continue;
        rowHandleCell.title = strings.tooltipClickSelectRow;
        rowHandleCell.textContent = String(sourceRowNumbers.get(row.listNodeId) ?? i + 1);
        rowHandleCell.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.preventDefault();
          rowHandleDragAnchor = i;
          rowHandleDragMoved = false;
          selectRowRange(i, i);
          if (!rowHandleDragMoveListener) {
            rowHandleDragMoveListener = (moveEv: MouseEvent) => {
              if (rowHandleDragAnchor == null) return;
              const hovered = document.elementFromPoint(moveEv.clientX, moveEv.clientY) as HTMLElement | null;
              const rowEl = hovered?.closest?.('.grid-row[data-row-index]') as HTMLElement | null;
              if (!rowEl) return;
              const rowIndex = Number.parseInt(rowEl.dataset.rowIndex ?? '', 10);
              if (Number.isNaN(rowIndex)) return;
              const clampedRowIndex = Math.max(0, Math.min(displayed.length - 1, rowIndex));
              if (clampedRowIndex !== rowHandleDragAnchor) rowHandleDragMoved = true;
              selectRowRange(rowHandleDragAnchor, clampedRowIndex);
            };
          }
          if (!rowHandleDragUpListener) {
            rowHandleDragUpListener = () => {
              if (rowHandleDragMoved) suppressNextRowHandleClick = true;
              rowHandleDragAnchor = null;
              rowHandleDragMoved = false;
              if (rowHandleDragMoveListener) document.removeEventListener('mousemove', rowHandleDragMoveListener);
              if (rowHandleDragUpListener) document.removeEventListener('mouseup', rowHandleDragUpListener);
            };
          }
          document.addEventListener('mousemove', rowHandleDragMoveListener);
          document.addEventListener('mouseup', rowHandleDragUpListener);
        });
        rowHandleCell.addEventListener('click', (e) => {
          if (suppressNextRowHandleClick) {
            suppressNextRowHandleClick = false;
            return;
          }
          e.stopPropagation();
          const rowIndex = i;
          const useToggle = e.metaKey || e.ctrlKey;
          const useRange = e.shiftKey;
          let nextSelection: SelectedCell[] = [];
          if (useRange) {
            const anchor = rowSelectionAnchor ?? state.focusedCell?.rowIndex ?? rowIndex;
            const minRow = Math.max(0, Math.min(anchor, rowIndex));
            const maxRow = Math.min(displayed.length - 1, Math.max(anchor, rowIndex));
            nextSelection = useToggle ? [...state.selectedCells] : [];
            for (let r = minRow; r <= maxRow; r++) {
              nextSelection.push(...buildRowSelection(r, cols));
            }
          } else if (useToggle) {
            if (isRowFullySelected(state.selectedCells, rowIndex, cols)) {
              nextSelection = state.selectedCells.filter((c) => c.rowIndex !== rowIndex);
            } else {
              nextSelection = [...state.selectedCells, ...buildRowSelection(rowIndex, cols)];
            }
          } else {
            nextSelection = buildRowSelection(rowIndex, cols);
          }
          rowSelectionAnchor = rowIndex;
          const deduped = dedupeSelectedCells(nextSelection);
          const focused = resolveFocusedCell(deduped, { rowIndex, colTag: cols[0] ?? '' });
          state.onCellSelect(deduped, focused);
          if (state.onSelectionReveal && row) {
            state.onSelectionReveal(row.listNodeId, row.startOffset, row.endOffset);
          }
        });
      }
      tr.appendChild(rowHandleCell);

      if (isAddRow) {
        for (const col of state.columns) {
          const colKey = getTableColumnKey(col);
          const w = state.columnWidths[colKey] ?? DEFAULT_COL_WIDTH;
          const cell = document.createElement('div');
          cell.className = 'cell data-cell';
          cell.style.flex = `0 0 ${w}px`;
          cell.style.minWidth = `${MIN_COL_WIDTH}px`;
          tr.appendChild(cell);
        }
        for (let j = 0; j < state.childTables.length; j++) {
          const cell = document.createElement('div');
          cell.className = 'cell nav-cell';
          cell.style.flex = '0 0 80px';
          cell.style.minWidth = '60px';
          tr.appendChild(cell);
        }
        tableBody.appendChild(tr);
        continue;
      }

      const row = displayed[i];
      if (!row) continue;
      for (const col of state.columns) {
        const colKey = getTableColumnKey(col);
        const w = state.columnWidths[colKey] ?? DEFAULT_COL_WIDTH;
        const cellData = row.cells[colKey];
        const cell = document.createElement('div');
        const isSelected = state.selectedCells.some((c) => c.rowIndex === i && c.colTag === colKey);
        const isFocused = state.focusedCell?.rowIndex === i && state.focusedCell?.colTag === colKey;
        cell.className =
          'cell data-cell' + (isSelected ? ' cell-selected' : '') + (isFocused ? ' cell-focused' : '');
        cell.style.flex = `0 0 ${w}px`;
        cell.style.minWidth = `${MIN_COL_WIDTH}px`;
        cell.dataset.rowIndex = String(i);
        cell.dataset.colTag = colKey;
        cell.title = getTableColumnKey(col);

        if (col.isLeafList && Array.isArray(cellData)) {
          const items = cellData.map((item) => ({
            value: item.textContent,
            nodeId: item.nodeId,
          }));
          renderLeafListChips(cell, {
            items,
            onDelete: (nodeId) => state.onDelete([nodeId]),
            onSelect: state.onSelectionReveal
              ? (nodeId) => state.onSelectionReveal(nodeId, 0, 0)
              : undefined,
            addButton: {
              onAdd: (value) =>
                state.onAddLeafListItem({
                  parentNodeId: row.listNodeId,
                  tagName: col.tagName,
                  value,
                  columnOrder: state.columns.map((c) => getTableColumnKey(c)),
                  firstSegmentOrder: getFirstSegmentOrder(state.columns),
                }),
            },
          });
        } else {
          const single = Array.isArray(cellData) ? null : cellData;
          const val = single?.textContent ?? '';
          if (val.includes('\n')) {
            cell.classList.add('cell-multiline');
            cell.style.whiteSpace = 'pre-wrap';
          }
          cell.textContent = val;
          cell.addEventListener('dblclick', (ev) => {
            ev.stopPropagation();
            const payload = single
              ? { nodeId: single.nodeId, field: 'textContent' as const, value: single.textContent, rowIndex: i, colTag: colKey }
              : {
                  nodeId: 0,
                  field: 'textContent' as const,
                  value: '',
                  rowIndex: i,
                  colTag: colKey,
                  createNew: {
                    parentNodeId: row.listNodeId,
                    tagName: col.tagName,
                    pathFromListRoot:
                      col.pathFromListRoot && col.pathFromListRoot.length > 0 ? col.pathFromListRoot : undefined,
                  },
                };
            openCellEdit(cell, payload, undefined);
          });
          cell.addEventListener('mousedown', (ev) => {
            if (ev.button !== 0) return;
            const target = ev.target as HTMLElement;
            if (target.closest('button, input, textarea')) return;
            ev.stopPropagation();
            ev.preventDefault();
            dragAnchor = { rowIndex: i, colTag: colKey };
            dragLastCell = dragAnchor;
            dragSelecting = true;
            state.onCellSelect([dragAnchor], dragAnchor);
            if (!dragMoveListener) {
              dragMoveListener = (moveEv: MouseEvent) => {
                if (!dragSelecting || !dragAnchor || !tableDiv) return;
                const el = document.elementFromPoint(moveEv.clientX, moveEv.clientY) as HTMLElement | null;
                const hoveredCell = el?.closest?.('.data-cell[data-row-index][data-col-tag]') as HTMLElement | null;
                if (!hoveredCell) return;
                const rowIndex = Number.parseInt(hoveredCell.dataset.rowIndex ?? '', 10);
                const colTag = hoveredCell.dataset.colTag ?? '';
                if (Number.isNaN(rowIndex) || !colTag) return;
                if (dragLastCell && dragLastCell.rowIndex === rowIndex && dragLastCell.colTag === colTag) return;
                dragLastCell = { rowIndex, colTag };
                const colTags = getDataColumnTags();
                const anchorColIdx = colTags.indexOf(dragAnchor.colTag);
                const targetColIdx = colTags.indexOf(colTag);
                if (anchorColIdx < 0 || targetColIdx < 0) return;
                const minRow = Math.min(dragAnchor.rowIndex, rowIndex);
                const maxRow = Math.max(dragAnchor.rowIndex, rowIndex);
                const minCol = Math.min(anchorColIdx, targetColIdx);
                const maxCol = Math.max(anchorColIdx, targetColIdx);
                const selection: SelectedCell[] = [];
                for (let r = minRow; r <= maxRow; r++) {
                  for (let c = minCol; c <= maxCol; c++) {
                    const tag = colTags[c];
                    if (tag !== undefined) selection.push({ rowIndex: r, colTag: tag });
                  }
                }
                state.onCellSelect(selection, { rowIndex, colTag });
              };
            }
            if (!dragUpListener) {
              dragUpListener = () => {
                dragSelecting = false;
                dragAnchor = null;
                dragLastCell = null;
                if (dragMoveListener) {
                  document.removeEventListener('mousemove', dragMoveListener);
                }
                if (dragUpListener) {
                  document.removeEventListener('mouseup', dragUpListener);
                }
              };
            }
            document.addEventListener('mousemove', dragMoveListener);
            document.addEventListener('mouseup', dragUpListener);
          });
          cell.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            state.onContextMenu({ rowIndex: i, colTag: colKey, clientX: ev.clientX, clientY: ev.clientY });
          });
        }
        tr.appendChild(cell);
      }
      for (const child of state.childTables) {
        const navCell = document.createElement('div');
        navCell.className = 'cell nav-cell';
        navCell.style.flex = '0 0 80px';
        navCell.style.minWidth = '60px';
        const present = row.childTablePresent?.[child.tagName];
        if (present) {
          const base = (state.currentPathFull || '').replace(/^\/+/, '').trim();
          const nextPath = (base ? `${base}/${child.tagName}` : child.tagName).replace(/\/+/g, '/');
          navCell.appendChild(createTableIcon(nextPath, state.onPathNavigate));
        }
        tr.appendChild(navCell);
      }
      tableBody.appendChild(tr);
    }

    tableBody.style.paddingTop = `${visibleStart * ROW_HEIGHT}px`;
    tableBody.style.minHeight = `${(displayed.length + 1) * ROW_HEIGHT}px`;
  }

  function buildStructure(): void {
    tableDiv = document.createElement('div');
    tableDiv.className = 'list-view-table';
    const totalW =
      ROW_HANDLE_WIDTH +
      state.columns.reduce((s, c) => s + (state.columnWidths[getTableColumnKey(c)] ?? DEFAULT_COL_WIDTH), 0) +
      state.childTables.length * 80;
    tableDiv.style.minWidth = `${totalW}px`;
    const clearHoverClasses = (): void => {
      if (!tableDiv) return;
      const hoveredRows = tableDiv.querySelectorAll('.cell.hover-row');
      for (const el of hoveredRows) el.classList.remove('hover-row');
      const hoveredCols = tableDiv.querySelectorAll('.cell.hover-col');
      for (const el of hoveredCols) el.classList.remove('hover-col');
      const hoveredCells = tableDiv.querySelectorAll('.cell.hover-cell');
      for (const el of hoveredCells) el.classList.remove('hover-cell');
      hoverRowIndex = null;
      hoverColTag = null;
      hoverCellRowIndex = null;
      hoverCellColTag = null;
    };
    const applyHoverClasses = (cell: HTMLElement): void => {
      if (!tableDiv) return;
      const rowIndexRaw = cell.dataset.rowIndex ?? '';
      const colTag = cell.dataset.colTag ?? '';
      const rowIndex = Number.parseInt(rowIndexRaw, 10);
      const nextRow = Number.isNaN(rowIndex) ? null : rowIndex;
      const nextCol = colTag && colTag !== 'row-handle' ? colTag : null;
      const sameHover =
        hoverRowIndex === nextRow &&
        hoverColTag === nextCol &&
        hoverCellRowIndex === nextRow &&
        hoverCellColTag === nextCol;
      if (sameHover) return;
      clearHoverClasses();
      if (nextRow != null) {
        const rowCells = tableDiv.querySelectorAll(`.grid-row[data-row-index="${nextRow}"] .cell`);
        for (const el of rowCells) el.classList.add('hover-row');
      }
      if (nextCol) {
        const colCells = tableDiv.querySelectorAll(`.cell[data-col-tag="${CSS.escape(nextCol)}"]`);
        for (const el of colCells) el.classList.add('hover-col');
      }
      if (nextRow != null && nextCol) {
        const activeCell = tableDiv.querySelector(
          `.data-cell[data-row-index="${nextRow}"][data-col-tag="${CSS.escape(nextCol)}"]`
        ) as HTMLElement | null;
        activeCell?.classList.add('hover-cell');
        hoverCellRowIndex = nextRow;
        hoverCellColTag = nextCol;
      }
      hoverRowIndex = nextRow;
      hoverColTag = nextCol;
    };
    tableDiv.addEventListener('mouseover', (ev) => {
      const target = ev.target as HTMLElement;
      const cell = target.closest('.cell[data-row-index][data-col-tag]') as HTMLElement | null;
      if (!cell || !tableDiv?.contains(cell)) {
        clearHoverClasses();
        return;
      }
      applyHoverClasses(cell);
    });
    tableDiv.addEventListener('mouseleave', () => {
      clearHoverClasses();
    });

    const header = document.createElement('div');
    header.className = 'grid-header';
    header.style.display = 'flex';
    header.style.flexDirection = 'column';
    header.style.fontWeight = 'bold';
    header.style.borderBottom = '1px solid var(--vscode-panel-border)';
    header.style.position = 'sticky';
    header.style.top = '0';
    header.style.zIndex = '2';
    header.style.background = 'var(--vscode-editor-background)';

    const hasGroupedColumns = state.columns.some((c) => c.group);
    if (hasGroupedColumns) {
      const groupRow = document.createElement('div');
      groupRow.style.display = 'flex';
      groupRow.style.height = `${HEADER_HEIGHT}px`;
      groupRow.style.alignItems = 'stretch';
      const rowHandleGroupCell = document.createElement('div');
      rowHandleGroupCell.className = 'cell header-cell';
      rowHandleGroupCell.style.flex = `0 0 ${ROW_HANDLE_WIDTH}px`;
      rowHandleGroupCell.style.minWidth = `${ROW_HANDLE_WIDTH}px`;
      groupRow.appendChild(rowHandleGroupCell);
      let idx = 0;
      while (idx < state.columns.length) {
        const col = state.columns[idx];
        const group = col.group;
        if (group) {
          let span = 0;
          let width = 0;
          while (idx + span < state.columns.length && state.columns[idx + span].group === group) {
            width += state.columnWidths[getTableColumnKey(state.columns[idx + span])] ?? DEFAULT_COL_WIDTH;
            span++;
          }
          const groupCell = document.createElement('div');
          groupCell.className = 'cell header-cell';
          groupCell.style.flex = `0 0 ${width}px`;
          groupCell.style.minWidth = `${span * MIN_COL_WIDTH}px`;
          groupCell.style.display = 'flex';
          groupCell.style.alignItems = 'center';
          groupCell.style.paddingLeft = '8px';
          groupCell.textContent = group;
          groupRow.appendChild(groupCell);
          idx += span;
        } else {
          const w = state.columnWidths[getTableColumnKey(col)] ?? DEFAULT_COL_WIDTH;
          const groupCell = document.createElement('div');
          groupCell.className = 'cell header-cell';
          groupCell.style.flex = `0 0 ${w}px`;
          groupCell.style.minWidth = `${MIN_COL_WIDTH}px`;
          groupRow.appendChild(groupCell);
          idx++;
        }
      }
      for (let j = 0; j < state.childTables.length; j++) {
        const groupCell = document.createElement('div');
        groupCell.style.flex = '0 0 80px';
        groupCell.style.minWidth = '60px';
        groupRow.appendChild(groupCell);
      }
      header.appendChild(groupRow);
    }

    const tagRow = document.createElement('div');
    tagRow.style.display = 'flex';
    tagRow.style.height = `${HEADER_HEIGHT}px`;
    tagRow.style.alignItems = 'stretch';
    const rowHandleHeader = document.createElement('div');
    rowHandleHeader.className = 'cell header-cell row-handle-header';
    rowHandleHeader.dataset.rowIndex = 'header';
    rowHandleHeader.dataset.colTag = 'row-handle';
    rowHandleHeader.style.flex = `0 0 ${ROW_HANDLE_WIDTH}px`;
    rowHandleHeader.style.minWidth = `${ROW_HANDLE_WIDTH}px`;
    rowHandleHeader.style.cursor = 'pointer';
    rowHandleHeader.title = strings.tooltipClickClearSortDblclickSelectTable;
    rowHandleHeader.textContent = '#';
    rowHandleHeader.addEventListener('click', () => {
      state.onSort('', true);
    });
    rowHandleHeader.addEventListener('dblclick', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const n = getDisplayedRows().length;
      const cols = getDataColumnTags();
      const sel: SelectedCell[] = [];
      for (let r = 0; r < n; r++) for (const colTag of cols) sel.push({ rowIndex: r, colTag });
      state.onCellSelect(sel, n > 0 ? { rowIndex: 0, colTag: cols[0] ?? '' } : null);
    });
    tagRow.appendChild(rowHandleHeader);

    for (const col of state.columns) {
      const colKey = getTableColumnKey(col);
      const w = state.columnWidths[colKey] ?? DEFAULT_COL_WIDTH;
      const colWrap = document.createElement('div');
      colWrap.style.cssText = `flex: 0 0 ${w}px; min-width: ${MIN_COL_WIDTH}px; display: flex; align-items: stretch;`;
      columnHeaderWraps[colKey] = colWrap;
      const h = document.createElement('div');
      h.className = 'cell header-cell';
      h.dataset.rowIndex = 'header';
      h.dataset.colTag = colKey;
      h.style.flex = '1';
      h.style.display = 'flex';
      h.style.alignItems = 'center';
      h.style.gap = '4px';
      h.style.cursor = 'pointer';
      h.style.color = 'var(--vscode-foreground)';
      h.title = getTableColumnKey(col) + '\n' + strings.tooltipClickSort;
      const label = document.createElement('span');
      label.textContent = col.tagName;
      label.style.flex = '1';
      label.style.minWidth = '0';
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      h.appendChild(label);
      const icons = document.createElement('span');
      icons.className = 'header-icons';
      headerIconWraps[colKey] = icons;
      renderHeaderIndicators(colKey);
      h.appendChild(icons);
      h.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        const target = ev.target as HTMLElement;
        if (target.closest('.col-resize-handle')) return;
        ev.preventDefault();
        ev.stopPropagation();
        headerDragAnchor = colKey;
        headerDragMoved = false;
        if (!headerDragMoveListener) {
          headerDragMoveListener = (moveEv: MouseEvent) => {
            if (!headerDragAnchor) return;
            const hovered = document.elementFromPoint(moveEv.clientX, moveEv.clientY) as HTMLElement | null;
            const headerCell = hovered?.closest?.('.header-cell[data-row-index="header"][data-col-tag]') as HTMLElement | null;
            if (!headerCell) return;
            const hoveredColTag = headerCell.dataset.colTag ?? '';
            if (!hoveredColTag || hoveredColTag === 'row-handle') return;
            if (hoveredColTag !== headerDragAnchor) headerDragMoved = true;
            if (!headerDragMoved) return;
            selectColumnRange(headerDragAnchor, hoveredColTag);
          };
        }
        if (!headerDragUpListener) {
          headerDragUpListener = () => {
            if (headerDragMoved) suppressNextHeaderClick = true;
            headerDragAnchor = null;
            headerDragMoved = false;
            if (headerDragMoveListener) document.removeEventListener('mousemove', headerDragMoveListener);
            if (headerDragUpListener) document.removeEventListener('mouseup', headerDragUpListener);
          };
        }
        document.addEventListener('mousemove', headerDragMoveListener);
        document.addEventListener('mouseup', headerDragUpListener);
      });
      h.addEventListener('click', (ev) => {
        if (suppressNextHeaderClick) {
          suppressNextHeaderClick = false;
          return;
        }
        const useToggle = ev.metaKey || ev.ctrlKey;
        const useRange = ev.shiftKey;
        if (!useToggle && !useRange) {
          state.onSort(colKey, state.sortKey === colKey ? !state.sortAsc : true);
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        const rowCount = getDisplayedRows().length;
        if (rowCount === 0) return;
        const cols = getDataColumnTags();
        let nextSelection: SelectedCell[] = [];
        if (useRange) {
          const anchorTag = columnSelectionAnchor ?? state.focusedCell?.colTag ?? colKey;
          const anchorIndex = cols.indexOf(anchorTag);
          const targetIndex = cols.indexOf(colKey);
          if (targetIndex < 0) return;
          const safeAnchor = anchorIndex >= 0 ? anchorIndex : targetIndex;
          const minCol = Math.min(safeAnchor, targetIndex);
          const maxCol = Math.max(safeAnchor, targetIndex);
          nextSelection = useToggle ? [...state.selectedCells] : [];
          for (let colIndex = minCol; colIndex <= maxCol; colIndex++) {
            const colTagAt = cols[colIndex];
            if (colTagAt !== undefined) nextSelection.push(...buildColumnSelection(colTagAt, rowCount));
          }
        } else if (useToggle) {
          if (isColumnFullySelected(state.selectedCells, colKey, rowCount)) {
            nextSelection = state.selectedCells.filter((c) => c.colTag !== colKey);
          } else {
            nextSelection = [...state.selectedCells, ...buildColumnSelection(colKey, rowCount)];
          }
        }
        columnSelectionAnchor = colKey;
        const deduped = dedupeSelectedCells(nextSelection);
        const focusRow = Math.max(0, Math.min(rowCount - 1, state.focusedCell?.rowIndex ?? 0));
        const focused = resolveFocusedCell(deduped, { rowIndex: focusRow, colTag: colKey });
        state.onCellSelect(deduped, focused);
      });
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'col-resize-handle';
      resizeHandle.style.cssText = 'width: 4px; cursor: col-resize; flex-shrink: 0;';
      resizeHandle.title = strings.tooltipDragToResizeColumn;
      let startX = 0;
      let startW = 0;
      resizeHandle.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        startX = ev.clientX;
        startW = state.columnWidths[colKey] ?? DEFAULT_COL_WIDTH;
        const onMove = (e: MouseEvent) => {
          const dx = e.clientX - startX;
          const newW = Math.max(MIN_COL_WIDTH, startW + dx);
          state.onResizeColumn(colKey, newW);
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      colWrap.appendChild(h);
      colWrap.appendChild(resizeHandle);
      tagRow.appendChild(colWrap);
    }
    for (const child of state.childTables) {
      const h = document.createElement('div');
      h.className = 'cell header-cell';
      h.style.flex = '0 0 80px';
      h.style.minWidth = '60px';
      h.textContent = child.tagName;
      h.title = strings.tooltipChildTableNavigate(child.tagName);
      tagRow.appendChild(h);
    }
    header.appendChild(tagRow);
    tableDiv.appendChild(header);

    const headerRowsHeight = hasGroupedColumns ? HEADER_HEIGHT * 2 : HEADER_HEIGHT;
    const filterRow = document.createElement('div');
    filterRow.className = 'grid-filter-row';
    filterRow.style.display = 'flex';
    filterRow.style.height = `${FILTER_ROW_HEIGHT}px`;
    filterRow.style.borderBottom = '1px solid var(--vscode-panel-border)';
    filterRow.style.position = 'sticky';
    filterRow.style.top = `${headerRowsHeight}px`;
    filterRow.style.zIndex = '1';
    filterRow.style.background = 'var(--vscode-editor-background)';
    const filterRowHandle = document.createElement('div');
    filterRowHandle.className = 'cell filter-row-handle';
    filterRowHandle.style.flex = `0 0 ${ROW_HANDLE_WIDTH}px`;
    filterRowHandle.style.minWidth = `${ROW_HANDLE_WIDTH}px`;
    filterRowHandle.title = strings.tooltipFilter;
    filterRowHandle.innerHTML = filterIconSVG();
    filterRowHandle.addEventListener('click', () => {
      const firstCol = state.columns[0];
      if (!firstCol) return;
      focusFilterInput(getTableColumnKey(firstCol));
    });
    filterRow.appendChild(filterRowHandle);
    const renderColumnFilterChips = (colKey: string): void => {
      const wrap = filterRowWraps[colKey];
      if (!wrap) return;
      wrap.innerHTML = '';
      const values = (state.columnFilters[colKey] ?? []).map((v) => v.trim()).filter((v) => v !== '');
      wrap.classList.toggle('filter-active', values.length > 0);
      renderLeafListChips(wrap, {
        items: values.map((value, idx) => ({ value, nodeId: idx })),
        onDelete: (index) => {
          const nextValues = values.filter((_, i) => i !== index);
          state.onFilter(colKey, nextValues);
        },
        addButton: {
          onAdd: (value) => {
            const nextValue = value.trim();
            if (!nextValue) return;
            state.onFilter(colKey, [...values, nextValue]);
          },
          tooltip: strings.tooltipAddFilter,
          placeholder: strings.placeholderFilterValue,
        },
      });
    };
    for (const col of state.columns) {
      const colKey = getTableColumnKey(col);
      const w = state.columnWidths[colKey] ?? DEFAULT_COL_WIDTH;
      const wrap = document.createElement('div');
      wrap.className = 'filter-cell filter-chip-host';
      wrap.style.flex = `0 0 ${w}px`;
      wrap.style.minWidth = `${MIN_COL_WIDTH}px`;
      wrap.style.padding = '0 2px';
      filterRowWraps[colKey] = wrap;
      renderColumnFilterChips(colKey);
      filterRow.appendChild(wrap);
    }
    for (let j = 0; j < state.childTables.length; j++) {
      const wrap = document.createElement('div');
      wrap.style.flex = '0 0 80px';
      wrap.style.minWidth = '60px';
      filterRow.appendChild(wrap);
    }
    filterRow.style.display = (state.filterRowVisible ?? true) ? 'flex' : 'none';
    tableDiv.appendChild(filterRow);

    tableBody = document.createElement('div');
    tableBody.className = 'grid-body';
    tableDiv.appendChild(tableBody);
    container.appendChild(tableDiv);

    scrollListener = () => {
      const scrollTop = container.scrollTop;
      viewportStart = Math.floor(scrollTop / ROW_HEIGHT);
      viewportEnd = Math.ceil((scrollTop + container.clientHeight) / ROW_HEIGHT) + 2;
      render();
    };
    container.addEventListener('scroll', scrollListener);
    viewportEnd = Math.ceil((container.clientHeight || 400) / ROW_HEIGHT) + 2;
  }

  buildStructure();
  render();

  function scrollToRow(index: number): void {
    if (!tableBody || index < 0) return;
    const rowEl = tableBody.querySelector(`[data-row-index="${index}"]`);
    rowEl?.scrollIntoView({ block: 'nearest' });
  }

  function getFilterRow(): HTMLElement | null {
    return tableDiv?.querySelector('.grid-filter-row') as HTMLElement | null ?? null;
  }

  function setFilterRowVisible(visible: boolean): void {
    const fr = getFilterRow();
    if (fr) fr.style.display = visible ? 'flex' : 'none';
  }

  function focusFilterInput(colKey: string): void {
    const wrap = filterRowWraps[colKey];
    if (!wrap) return;
    setFilterRowVisible(true);
    const addButton = wrap.querySelector('.leaf-list-add') as HTMLButtonElement | null;
    const addInputBefore = wrap.querySelector('.leaf-list-add-input') as HTMLInputElement | null;
    if (addButton) addButton.click();
    const addInputAfter = wrap.querySelector('.leaf-list-add-input') as HTMLInputElement | null;
    (addInputAfter ?? addInputBefore)?.focus();
  }

  return {
    update(next: Partial<TableViewOptions>) {
      state = { ...state, ...next };
      for (const col of state.columns) {
        const colKey = getTableColumnKey(col);
        const w = state.columnWidths[colKey] ?? DEFAULT_COL_WIDTH;
        if (columnHeaderWraps[colKey]) {
          columnHeaderWraps[colKey].style.flex = `0 0 ${w}px`;
          columnHeaderWraps[colKey].style.minWidth = `${MIN_COL_WIDTH}px`;
        }
        renderHeaderIndicators(colKey);
        if (filterRowWraps[colKey]) {
          filterRowWraps[colKey].style.flex = `0 0 ${w}px`;
          filterRowWraps[colKey].style.minWidth = `${MIN_COL_WIDTH}px`;
        }
      }
      if (tableDiv) {
        const totalW =
          ROW_HANDLE_WIDTH +
          state.columns.reduce((s, c) => s + (state.columnWidths[getTableColumnKey(c)] ?? DEFAULT_COL_WIDTH), 0) +
          state.childTables.length * 80;
        tableDiv.style.minWidth = `${totalW}px`;
      }
      setFilterRowVisible(state.filterRowVisible ?? true);
      for (const col of state.columns) {
        const colKey = getTableColumnKey(col);
        const wrap = filterRowWraps[colKey];
        if (!wrap) continue;
        wrap.innerHTML = '';
        const values = (state.columnFilters[colKey] ?? []).map((v) => v.trim()).filter((v) => v !== '');
        wrap.classList.toggle('filter-active', values.length > 0);
        renderLeafListChips(wrap, {
          items: values.map((value, idx) => ({ value, nodeId: idx })),
          onDelete: (index) => {
            const nextValues = values.filter((_, i) => i !== index);
            state.onFilter(colKey, nextValues);
          },
          addButton: {
            onAdd: (value) => {
              const nextValue = value.trim();
              if (!nextValue) return;
              state.onFilter(colKey, [...values, nextValue]);
            },
            tooltip: strings.tooltipAddFilter,
            placeholder: strings.placeholderFilterValue,
          },
        });
      }
      render();
      if (typeof state.scrollToRowIndex === 'number') {
        scrollToRow(state.scrollToRowIndex);
        state = { ...state, scrollToRowIndex: undefined };
      }
    },
    getDisplayedRows,
    scrollToRow,
    focusFilterInput,
    setFilterRowVisible,
    openCellForEdit,
    destroy() {
      if (dragMoveListener) {
        document.removeEventListener('mousemove', dragMoveListener);
      }
      if (dragUpListener) {
        document.removeEventListener('mouseup', dragUpListener);
      }
      if (rowHandleDragMoveListener) {
        document.removeEventListener('mousemove', rowHandleDragMoveListener);
      }
      if (rowHandleDragUpListener) {
        document.removeEventListener('mouseup', rowHandleDragUpListener);
      }
      if (headerDragMoveListener) {
        document.removeEventListener('mousemove', headerDragMoveListener);
      }
      if (headerDragUpListener) {
        document.removeEventListener('mouseup', headerDragUpListener);
      }
      if (scrollListener && container) container.removeEventListener('scroll', scrollListener);
      tableDiv?.remove();
      tableDiv = null;
      tableBody = null;
    },
  };
}
