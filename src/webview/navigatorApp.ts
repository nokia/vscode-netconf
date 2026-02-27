/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  Navigator app: thin orchestrator. Uses NavigationBar, TableView, ElementView and EventHub.
  Holds state and message handling; delegates rendering to components.
*/

import type {
  TableColumnDef,
  ChildTableRef,
  TableRowData,
  ViewMode,
  DictEntry,
  SelectedCell,
} from './types';
import { getTableColumnKey, getFirstSegmentOrder } from './types';
import { splitPathSegments, parsePathSegment, buildPathSegment, formatPathPredicateValue } from './pathUtils';
import { strings } from './strings';
import { setupEventHub } from './events/eventHub';
import { createNavigationBar, type NavigationBarInstance } from './components/navigationBar';
import { createTableView, type TableViewInstance } from './components/tableView';
import { createElementView, type ElementViewInstance } from './components/elementView';
import { computeOptimalColumnWidths } from './tableColumnWidths';

/** Host → webview: message payload received by webview from extension (gridData, noData, suggestions, etc.). */
export type IncomingMessage = {
  type: string;
  rows?: unknown[];
  pathFilter?: string;
  currentPathFull?: string;
  matchCount?: number;
  message?: string;
  viewMode?: 'dict' | 'list';
  tableMode?: boolean;
  columns?: unknown[];
  childTables?: unknown[];
  tableRows?: unknown[];
  dictEntries?: unknown[];
  showAttributes?: boolean;
  attributes?: Record<string, string>;
  documentLabel?: string;
  suggestions?: string[];
  path?: string;
  prefix?: string;
  nodeId?: number;
};

export function initMessageListener(handler: (msg: IncomingMessage) => void): () => void {
  const listener = (event: MessageEvent<IncomingMessage>) => handler(event.data);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export function runNavigatorApp(vscodeApi: { postMessage: (msg: unknown) => void }): {
  handleIncomingMessage: (msg: IncomingMessage) => void;
} {
  const vscode = vscodeApi;

  const pathBar = document.getElementById('path-bar') as HTMLElement | null;
  const listView = document.getElementById('list-view') as HTMLDivElement | null;
  const listViewPlaceholder = document.getElementById('list-view-placeholder') as HTMLDivElement | null;
  const statusBarEl = document.getElementById('status-bar') as HTMLDivElement | null;
  const pathInput = pathBar?.querySelector('#path-input') as HTMLInputElement | null;

  let pathFilter = '';
  let currentPathFull = '';
  let currentDocumentLabel = '';
  let viewMode: ViewMode = 'dict';
  let tableMode = false;
  let tableColumns: TableColumnDef[] = [];
  let tableChildTables: ChildTableRef[] = [];
  let tableRows: TableRowData[] = [];
  let listParentNodeId = -1;
  let listRowTagName = '';
  let lastListNodeId = -1;
  let dictEntries: DictEntry[] = [];
  let showAttributes = false;
  let attributes: Record<string, string> = {};
  let _matchCount = 0;

  let _selectedRowIndex = -1;
  let selectedRowIndices: number[] = [];
  let selectedCells: SelectedCell[] = [];
  let focusedCell: SelectedCell | null = null;
  let focusedDictNodeId: number | null = null;
  let sortKey = '';
  let sortAsc = true;
  let columnFilters: Record<string, string[]> = {};
  let columnWidths: Record<string, number> = {};

  let navBar: NavigationBarInstance | null = null;
  let tableViewInstance: TableViewInstance | null = null;
  let elementViewInstance: ElementViewInstance | null = null;
  let _teardownEventHub: (() => void) | null = null;
  let scrollTableToBottomOnNextRefresh = false;

  function deactivateNavigationInput(): void {
    if (pathInput && document.activeElement === pathInput) pathInput.blur();
  }

  function getCellDisplayValue(row: TableRowData, colKey: string): string {
    const v = row.cells[colKey];
    if (!v) return '';
    return Array.isArray(v) ? v.map((c) => c.textContent).join(', ') : v.textContent;
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

  function getDisplayedTableRows(): TableRowData[] {
    let list = tableRows;
    const hasFilter = Object.values(columnFilters).some((vals) => (vals ?? []).some((v) => v.trim() !== ''));
    if (hasFilter) {
      list = list.filter((row) => {
        for (const col of tableColumns) {
          const colKey = getTableColumnKey(col);
          const filterValues = (columnFilters[colKey] ?? []).map((v) => v.trim()).filter((v) => v !== '');
          if (filterValues.length === 0) continue;
          const val = getCellDisplayValue(row, colKey);
          const matchesColumn = filterValues.some((needle) => matchesFilterNeedle(val, needle));
          if (!matchesColumn) return false;
        }
        return true;
      });
    }
    if (sortKey) {
      const asc = sortAsc;
      list = [...list].sort((a, b) => {
        const va = getCellDisplayValue(a, sortKey);
        const vb = getCellDisplayValue(b, sortKey);
        return asc ? va.localeCompare(vb, undefined, { numeric: true }) : vb.localeCompare(va, undefined, { numeric: true });
      });
    }
    return list;
  }

  function getRowCount(): number {
    if (viewMode === 'dict') return 0;
    return tableMode ? getDisplayedTableRows().length : 0;
  }

  function getTotalRowCount(): number {
    if (viewMode === 'dict') return 0;
    return tableMode ? tableRows.length : 0;
  }

  function getDataColumnTags(): string[] {
    return tableColumns.map((c) => getTableColumnKey(c));
  }

  function getCellNodeIds(rowIndex: number, colTag: string): number[] {
    const row = getDisplayedTableRows()[rowIndex];
    const cell = row?.cells[colTag];
    if (!cell) return [];
    if (Array.isArray(cell)) return cell.map((c) => c.nodeId);
    return [cell.nodeId];
  }

  function getCellEditInfo(rowIndex: number, colTag: string): { nodeId: number; field: 'tagName' | 'textContent' } | null {
    const row = getDisplayedTableRows()[rowIndex];
    const cell = row?.cells[colTag];
    if (!cell) return null;
    const single = Array.isArray(cell) ? cell[0] : cell;
    return single ? { nodeId: single.nodeId, field: 'textContent' } : null;
  }

  function getFullySelectedRowNodeIds(): number[] {
    if (!tableMode) return [];
    const displayed = getDisplayedTableRows();
    const cols = getDataColumnTags();
    if (displayed.length === 0 || cols.length === 0 || selectedCells.length === 0) return [];
    const selectedKeys = new Set(selectedCells.map((c) => `${c.rowIndex}::${c.colTag}`));
    const rowIndices = [...new Set(selectedCells.map((c) => c.rowIndex))].sort((a, b) => a - b);
    const ids: number[] = [];
    for (const rowIndex of rowIndices) {
      if (rowIndex < 0 || rowIndex >= displayed.length) continue;
      const hasAllCols = cols.every((colTag) => selectedKeys.has(`${rowIndex}::${colTag}`));
      const row = displayed[rowIndex];
      if (hasAllCols && row) ids.push(row.listNodeId);
    }
    return [...new Set(ids)];
  }

  function getFullySelectedColumnNodeIds(): number[] {
    if (!tableMode) return [];
    const displayed = getDisplayedTableRows();
    const cols = getDataColumnTags();
    if (displayed.length === 0 || cols.length === 0 || selectedCells.length === 0) return [];
    const selectedKeys = new Set(selectedCells.map((c) => `${c.rowIndex}::${c.colTag}`));
    const fullySelectedCols = cols.filter((colTag) =>
      displayed.every((_, rowIndex) => selectedKeys.has(`${rowIndex}::${colTag}`))
    );
    if (fullySelectedCols.length === 0) return [];
    const ids: number[] = [];
    for (let rowIndex = 0; rowIndex < displayed.length; rowIndex++) {
      for (const colTag of fullySelectedCols) {
        ids.push(...getCellNodeIds(rowIndex, colTag));
      }
    }
    return [...new Set(ids)];
  }

  function getCreateNewForFocusedCell(): { parentNodeId: number; tagName: string; pathFromListRoot?: string[] } | null {
    const cell = focusedCell;
    if (!cell) return null;
    const row = getDisplayedTableRows()[cell.rowIndex];
    const col = tableColumns.find((c) => getTableColumnKey(c) === cell.colTag);
    if (!row || !col) return null;
    return {
      parentNodeId: row.listNodeId,
      tagName: col.tagName,
      pathFromListRoot: col.pathFromListRoot && col.pathFromListRoot.length > 0 ? col.pathFromListRoot : undefined,
    };
  }

  function getEditableDictNodeIds(entries: DictEntry[]): number[] {
    const ids: number[] = [];
    for (const e of entries) {
      if (e.nodeId != null) ids.push(e.nodeId);
      if (e.children?.length) ids.push(...getEditableDictNodeIds(e.children));
    }
    return ids;
  }

  function getDictEntryValue(entries: DictEntry[], nodeId: number): string | undefined {
    for (const e of entries) {
      if (e.nodeId === nodeId) return e.value ?? '';
      if (e.children?.length) {
        const v = getDictEntryValue(e.children, nodeId);
        if (v !== undefined) return v;
      }
    }
    return undefined;
  }

  function navigateToPath(path: string): void {
    pathFilter = path.trim().replace(/^\/+/, '').replace(/\/+/g, '/');
    navBar?.update({ path: pathFilter });
    vscode.postMessage({ type: 'pathFilter', path: pathFilter });
  }

  function updateStatusBar(): void {
    if (!statusBarEl) return;
    const filenameSpan = statusBarEl.querySelector('.status-filename') as HTMLSpanElement | null;
    const countSpan = statusBarEl.querySelector('.status-count') as HTMLSpanElement | null;
    if (filenameSpan) filenameSpan.textContent = currentDocumentLabel;
    if (countSpan) {
      if (viewMode === 'dict') countSpan.textContent = strings.entriesSingleEntry;
      else {
        const total = getTotalRowCount();
        const displayed = getRowCount();
        const hasFilter = Object.values(columnFilters).some((vals) => (vals ?? []).some((v) => v.trim() !== ''));
        countSpan.textContent = hasFilter && total > 0 ? strings.entriesFiltered(displayed, total) : strings.entriesMultipleEntries(total);
      }
    }
  }

  function hideContextMenu(): void {
    const menu = document.getElementById('context-menu');
    if (menu) menu.style.display = 'none';
  }

  function showContextMenu(x: number, y: number, rightClickedCell?: { rowIndex: number; colTag: string }): void {
    const menu = document.getElementById('context-menu');
    if (!menu) return;
    menu.innerHTML = '';
    const add = (label: string, fn: () => void) => {
      const d = document.createElement('div');
      d.textContent = label;
      d.style.color = 'var(--vscode-foreground)';
      d.addEventListener('click', () => { fn(); hideContextMenu(); });
      menu.appendChild(d);
    };
    if (tableMode && listRowTagName && rightClickedCell) {
      const displayed = getDisplayedTableRows();
      const row = displayed[rightClickedCell.rowIndex];
      const colTag = rightClickedCell.colTag;
      if (row && colTag) {
        const cellValue = getCellDisplayValue(row, colTag).trim();
        if (cellValue !== '') {
          const col = tableColumns.find((c) => getTableColumnKey(c) === colTag);
          const predicateKey = col?.pathFromListRoot && col.pathFromListRoot.length > 0 ? col.pathFromListRoot.join('/') : colTag;
          const base = (currentPathFull || pathFilter).replace(/^\/+/, '').trim();
          const segments = splitPathSegments(base);
          const lastSeg = segments.length > 0 ? (segments[segments.length - 1] ?? '') : '';
          const parsed = parsePathSegment(lastSeg);
          let newPath: string;
          if (parsed.name === listRowTagName) {
            const existing = parsed.predicates.filter((p) => p.key !== predicateKey);
            const newPredicates = [...existing, { key: predicateKey, value: cellValue }];
            const rebuiltSegment = buildPathSegment(listRowTagName, newPredicates);
            const prefix = segments.length > 1 ? segments.slice(0, -1).join('/') : '';
            newPath = prefix ? prefix + '/' + rebuiltSegment : rebuiltSegment;
          } else {
            const segmentWithPredicate = listRowTagName + '[' + predicateKey + '=' + formatPathPredicateValue(cellValue) + ']';
            const prefix = segments.length > 0 && segments[segments.length - 1] === listRowTagName ? segments.slice(0, -1).join('/') : base;
            newPath = prefix ? prefix + '/' + segmentWithPredicate : segmentWithPredicate;
          }
          add(strings.tooltipAddToPath, () => navigateToPath(newPath));
        }
      }
    }
    if (menu.children.length === 0) return;
    menu.style.display = 'block';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }

  function showErrorState(message: string, options?: { clearPath?: boolean }): void {
    if (!listViewPlaceholder || !listView) return;
    tableViewInstance?.destroy();
    tableViewInstance = null;
    elementViewInstance?.destroy();
    elementViewInstance = null;
    if (options?.clearPath) {
      pathFilter = '';
      currentPathFull = '';
      currentDocumentLabel = '';
      if (pathInput) pathInput.value = '';
      navBar?.update({ path: '', suggestions: [], suggestionContext: null });
    }
    listViewPlaceholder.textContent = message;
    listViewPlaceholder.style.display = 'block';
    listView.classList.add('error-state');
    updateStatusBar();
  }

  function destroyTableView(): void {
    tableViewInstance?.destroy();
    tableViewInstance = null;
  }

  function destroyElementView(): void {
    elementViewInstance?.destroy();
    elementViewInstance = null;
  }

  function refreshListContent(): void {
    if (!listView) return;
    if (listViewPlaceholder) listViewPlaceholder.style.display = 'none';
    listView.classList.remove('error-state');
    listView.innerHTML = '';
    if (listViewPlaceholder) listView.appendChild(listViewPlaceholder);

    if (viewMode === 'dict') {
      destroyTableView();
      const container = document.createElement('div');
      container.className = 'dict-view-container';
      listView.appendChild(container);
      const basePath = (currentPathFull || pathFilter).replace(/^\/+/, '').trim();
      elementViewInstance = createElementView(container, {
        entries: dictEntries,
        attributes,
        showAttributes,
        focusedNodeId: focusedDictNodeId,
        pathPrefix: basePath,
        onPathNavigate: navigateToPath,
        onSelection: (nodeId, startOffset, endOffset) => {
          deactivateNavigationInput();
          focusedDictNodeId = nodeId;
          elementViewInstance?.update({ focusedNodeId: focusedDictNodeId });
          vscode.postMessage({ type: 'selection', nodeId, startOffset, endOffset });
        },
        onEdit: (nodeId, field, value) => vscode.postMessage({ type: 'edit', edit: { nodeId, field, value } }),
        onDeleteNode: (nodeId) => vscode.postMessage({ type: 'deleteNode', nodeIds: [nodeId] }),
        onAddLeafListItem: (parentNodeId, tagName, value) =>
          vscode.postMessage({
            type: 'addLeafListItem',
            parentNodeId,
            tagName,
            value,
            columnOrder: tableColumns.map((c) => getTableColumnKey(c)),
            firstSegmentOrder: getFirstSegmentOrder(tableColumns),
          }),
      });
    } else {
      destroyElementView();
      const tableColKeys = new Set(tableColumns.map((c) => getTableColumnKey(c)));
      const hasStoredWidthsForCurrentColumns =
        tableColKeys.size > 0 && [...tableColKeys].some((k) => columnWidths[k] != null);
      if (tableColumns.length > 0 && !hasStoredWidthsForCurrentColumns) {
        columnWidths = computeOptimalColumnWidths(tableColumns, tableRows);
      }
      tableViewInstance = createTableView(listView, {
        columns: tableColumns,
        rows: tableRows,
        childTables: tableChildTables,
        sortKey,
        sortAsc,
        columnFilters,
        columnWidths,
        selectedCells,
        focusedCell,
        listParentNodeId,
        listRowTagName,
        lastListNodeId,
        currentPathFull,
        onPathNavigate: navigateToPath,
        onCellSelect: (cells, focused) => {
          deactivateNavigationInput();
          selectedCells = cells;
          focusedCell = focused;
          _selectedRowIndex = focused?.rowIndex ?? -1;
          selectedRowIndices = [...new Set(cells.map((c) => c.rowIndex))].sort((a, b) => a - b);
          tableViewInstance?.update({ selectedCells, focusedCell });
          const displayed = getDisplayedTableRows();
          const row = focused && focused.rowIndex >= 0 ? displayed[focused.rowIndex] : null;
          if (row) vscode.postMessage({ type: 'selection', nodeId: row.listNodeId, startOffset: row.startOffset, endOffset: row.endOffset });
        },
        onCellEdit: (payload) => {
          if (payload.createNew) {
            vscode.postMessage({
              type: 'addLeafListItem',
              parentNodeId: payload.createNew.parentNodeId,
              tagName: payload.createNew.tagName,
              value: payload.value,
              pathFromListRoot: payload.createNew.pathFromListRoot,
              columnOrder: tableColumns.map((c) => getTableColumnKey(c)),
              firstSegmentOrder: getFirstSegmentOrder(tableColumns),
            });
          } else if (payload.value === '') {
            scrollTableToBottomOnNextRefresh = true;
            vscode.postMessage({ type: 'deleteNode', nodeIds: [payload.nodeId] });
          } else {
            vscode.postMessage({ type: 'edit', edit: { nodeId: payload.nodeId, field: payload.field, value: payload.value } });
          }
        },
        onDelete: (nodeIds) => {
          scrollTableToBottomOnNextRefresh = true;
          vscode.postMessage({ type: 'deleteNode', nodeIds });
        },
        onAddRow: () => {
          if (listParentNodeId < 0 || !listRowTagName) return;
          scrollTableToBottomOnNextRefresh = true;
          vscode.postMessage({
            type: 'addListRow',
            parentNodeId: listParentNodeId,
            tagName: listRowTagName,
            lastRowNodeId: lastListNodeId >= 0 ? lastListNodeId : undefined,
          });
        },
        onAddLeafListItem: (p) =>
          vscode.postMessage({
            type: 'addLeafListItem',
            parentNodeId: p.parentNodeId,
            tagName: p.tagName,
            value: p.value,
            pathFromListRoot: p.pathFromListRoot,
            columnOrder: p.columnOrder,
            firstSegmentOrder: p.firstSegmentOrder,
          }),
        onSort: (colKey, asc) => {
          sortKey = colKey;
          sortAsc = asc;
          tableViewInstance?.update({ sortKey, sortAsc });
          updateStatusBar();
        },
        onFilter: (colKey, values) => {
          const cleaned = values.map((v) => v.trim()).filter((v) => v !== '');
          columnFilters = { ...columnFilters, [colKey]: cleaned };
          tableViewInstance?.update({ columnFilters });
          updateStatusBar();
        },
        onResizeColumn: (colKey, width) => {
          columnWidths = { ...columnWidths, [colKey]: width };
          tableViewInstance?.update({ columnWidths });
        },
        onContextMenu: (payload) => {
          const x = payload.clientX ?? 0;
          const y = payload.clientY ?? 0;
          if (payload.rowIndex != null && payload.colTag) showContextMenu(x, y, { rowIndex: payload.rowIndex, colTag: payload.colTag });
        },
        onSelectionReveal: (nodeId, startOffset, endOffset) => vscode.postMessage({ type: 'selection', nodeId, startOffset, endOffset }),
      });
    }
    updateStatusBar();
  }

  function setGridData(data: {
    viewMode?: ViewMode;
    pathFilter?: string;
    currentPathFull?: string;
    matchCount?: number;
    tableMode?: boolean;
    columns?: TableColumnDef[];
    childTables?: ChildTableRef[];
    tableRows?: TableRowData[];
    listParentNodeId?: number;
    listRowTagName?: string;
    lastListNodeId?: number;
    dictEntries?: DictEntry[];
    showAttributes?: boolean;
    attributes?: Record<string, string>;
    documentLabel?: string;
  }): void {
    const previousScrollTop = listView?.scrollTop ?? 0;
    const previousPath = currentPathFull || pathFilter;
    const previousWasTableList = viewMode === 'list' && tableMode;

    listView?.classList.remove('error-state');
    viewMode = data.viewMode === 'dict' || data.viewMode === 'list' ? data.viewMode : data.tableMode ? 'list' : 'dict';
    tableMode = !!data.tableMode;
    tableColumns = data.columns ?? [];
    tableChildTables = data.childTables ?? [];
    tableRows = data.tableRows ?? [];
    listParentNodeId = data.listParentNodeId ?? -1;
    listRowTagName = data.listRowTagName ?? '';
    lastListNodeId = data.lastListNodeId ?? -1;
    // Keep columnFilters and sort (sortKey/sortAsc) when refreshing table data (e.g. after edit)
    dictEntries = data.dictEntries ?? [];
    if (viewMode === 'dict') {
      focusedDictNodeId = null;
      focusedCell = null;
    }
    pathFilter = (data.pathFilter ?? '').trim();
    currentPathFull = (data.currentPathFull ?? pathFilter).trim();
    showAttributes = !!data.showAttributes;
    attributes = data.attributes ?? {};
    _matchCount = data.matchCount ?? (viewMode === 'dict' ? 1 : getRowCount());
    currentDocumentLabel = data.documentLabel ?? '';
    if (pathInput) pathInput.value = '';
    navBar?.update({ path: pathFilter });

    const nextPath = (data.currentPathFull ?? data.pathFilter ?? '').trim();
    const shouldRestoreTableScroll =
      previousWasTableList &&
      viewMode === 'list' &&
      tableMode &&
      nextPath === previousPath;

    refreshListContent();
    if (scrollTableToBottomOnNextRefresh && listView) {
      scrollTableToBottomOnNextRefresh = false;
      requestAnimationFrame(() => {
        if (listView) listView.scrollTop = listView.scrollHeight - listView.clientHeight;
      });
    } else if (shouldRestoreTableScroll && listView) {
      listView.scrollTop = previousScrollTop;
    }
  }

  function copySelectionToClipboard(): boolean {
    if (tableMode && tableViewInstance) {
      const displayed = tableViewInstance.getDisplayedRows();
      const cols = getDataColumnTags();
      if (cols.length === 0) return false;
      if (selectedCells.length > 0) {
        const rowIndices = [...new Set(selectedCells.map((c) => c.rowIndex))].sort((a, b) => a - b);
        const colOrder = cols.filter((tag) => selectedCells.some((c) => c.colTag === tag));
        const dataRows = rowIndices.map((idx) => {
          const r = displayed[idx];
          return colOrder.map((colKey) => (r ? getCellDisplayValue(r, colKey) : '')).join('\t');
        });
        const allSelected = rowIndices.length * cols.length === selectedCells.length;
        if (allSelected) {
          const headerRow = colOrder.map((colKey) => tableColumns.find((c) => getTableColumnKey(c) === colKey)?.tagName ?? colKey).join('\t');
          navigator.clipboard.writeText([headerRow, ...dataRows].join('\n')).catch(() => {});
        } else {
          navigator.clipboard.writeText(dataRows.join('\n')).catch(() => {});
        }
        return true;
      }
      if (selectedRowIndices.length > 0) {
        const headerRow = tableColumns.map((c) => c.tagName).join('\t');
        const dataRows = selectedRowIndices.map((idx) => {
          const r = displayed[idx];
          return tableColumns.map((col) => (r ? getCellDisplayValue(r, getTableColumnKey(col)) : '')).join('\t');
        });
        navigator.clipboard.writeText([headerRow, ...dataRows].join('\n')).catch(() => {});
        return true;
      }
    }
    if (viewMode === 'dict' && focusedDictNodeId != null) {
      const text = getDictEntryValue(dictEntries, focusedDictNodeId);
      if (text !== undefined) {
        navigator.clipboard.writeText(text).catch(() => {});
        return true;
      }
    }
    return false;
  }

  function applyPastedText(text: string): void {
    if (!tableMode || !text) return;
    const lines = text.split(/\r?\n/).filter((l) => l !== '');
    if (lines.length === 0) return;
    const startCell = focusedCell ?? (selectedCells.length > 0 ? (selectedCells[0] ?? null) : null);
    if (!startCell) return;
    const displayed = getDisplayedTableRows();
    const cols = getDataColumnTags();
    const startColIdx = cols.indexOf(startCell.colTag);
    if (startColIdx < 0) return;
    const updates: Array<{ nodeId: number; field: 'textContent'; value: string }> = [];
    const creates: Array<{ parentNodeId: number; tagName: string; value: string; pathFromListRoot?: string[] }> = [];
    for (let rowOffset = 0; rowOffset < lines.length; rowOffset++) {
      const rowIdx = startCell.rowIndex + rowOffset;
      if (rowIdx >= displayed.length) break;
      const row = displayed[rowIdx];
      const line = lines[rowOffset];
      if (!row || line === undefined) break;
      const cellValues = line.split('\t');
      for (let colOffset = 0; colOffset < cellValues.length; colOffset++) {
        const colIdx = startColIdx + colOffset;
        if (colIdx >= cols.length) break;
        const colKey = cols[colIdx];
        if (colKey === undefined) break;
        const value = cellValues[colOffset]?.trim() ?? '';
        if (!value) continue;
        const cell = row.cells[colKey];
        if (cell) {
          const single = Array.isArray(cell) ? cell[0] : cell;
          if (single) updates.push({ nodeId: single.nodeId, field: 'textContent', value });
        } else {
          const col = tableColumns.find((c) => getTableColumnKey(c) === colKey);
          if (col)
            creates.push({
              parentNodeId: row.listNodeId,
              tagName: col.tagName,
              value,
              pathFromListRoot: col.pathFromListRoot && col.pathFromListRoot.length > 0 ? col.pathFromListRoot : undefined,
            });
        }
      }
    }
    if (updates.length > 0 || creates.length > 0) {
      vscode.postMessage({
        type: 'pasteGrid',
        updates,
        creates,
        columnOrder: tableColumns.map((c) => getTableColumnKey(c)),
        firstSegmentOrder: getFirstSegmentOrder(tableColumns),
      });
    }
  }

  function handleDocumentKeyDown(e: KeyboardEvent): void {
    const inInput = (e.target as HTMLElement).closest('input, textarea');
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      if (inInput) return;
      const n = getRowCount();
      if (tableMode && n > 0) {
        e.preventDefault();
        const cols = getDataColumnTags();
        selectedCells = [];
        for (let r = 0; r < n; r++) for (const colTag of cols) selectedCells.push({ rowIndex: r, colTag });
        focusedCell = n > 0 ? { rowIndex: 0, colTag: cols[0] ?? '' } : null;
        tableViewInstance?.update({ selectedCells, focusedCell });
      }
      if (viewMode === 'dict' && pathFilter && pathInput) {
        pathInput.value = '/' + pathFilter.replace(/^\/+/, '');
        pathInput.focus();
        pathInput.select();
        e.preventDefault();
      }
      return;
    }
    if ((e.key === 'z' || e.key === 'y') && (e.ctrlKey || e.metaKey)) {
      if (!inInput) {
        e.preventDefault();
        e.stopPropagation();
        const isRedo = (e.key === 'z' && e.shiftKey) || (e.key === 'y' && !e.shiftKey);
        vscode.postMessage({ type: isRedo ? 'redo' : 'undo' });
      }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      let nodeIds: number[] = [];
      if (viewMode === 'dict' && focusedDictNodeId != null && !inInput) {
        nodeIds = [focusedDictNodeId];
      } else {
        const selectedRowNodeIds = getFullySelectedRowNodeIds();
        if (selectedRowNodeIds.length > 0 && !inInput) {
          nodeIds = selectedRowNodeIds;
        } else {
          const selectedColumnNodeIds = getFullySelectedColumnNodeIds();
          if (selectedColumnNodeIds.length > 0 && !inInput) {
            nodeIds = selectedColumnNodeIds;
          } else {
            const cellsToDelete = selectedCells.length > 0 ? selectedCells : focusedCell ? [focusedCell] : [];
            if (cellsToDelete.length > 0 && !inInput) {
              nodeIds = [...new Set(cellsToDelete.flatMap((c) => getCellNodeIds(c.rowIndex, c.colTag)))];
            }
          }
        }
      }
      if (nodeIds.length > 0 && !inInput) {
        e.preventDefault();
        vscode.postMessage({ type: 'deleteNode', nodeIds });
        if (viewMode === 'dict') {
          focusedDictNodeId = null;
          elementViewInstance?.update({ focusedNodeId: null });
        } else {
          tableViewInstance?.update({});
        }
      }
      return;
    }
    if (e.key === 'Tab' && !inInput && viewMode === 'dict') {
      const editable = getEditableDictNodeIds(dictEntries);
      if (editable.length > 0) {
        const idx = focusedDictNodeId != null ? editable.indexOf(focusedDictNodeId) : -1;
        const nextIdx = e.shiftKey ? (idx <= 0 ? editable.length - 1 : idx - 1) : (idx >= editable.length - 1 ? 0 : idx + 1);
        focusedDictNodeId = editable[nextIdx] ?? null;
        elementViewInstance?.update({ focusedNodeId: focusedDictNodeId });
        e.preventDefault();
      }
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !inInput) {
      if (viewMode === 'dict') {
        const editable = getEditableDictNodeIds(dictEntries);
        if (editable.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          const idx = focusedDictNodeId != null ? editable.indexOf(focusedDictNodeId) : (e.key === 'ArrowDown' ? -1 : 0);
          const nextIdx = e.key === 'ArrowDown' ? Math.min(idx + 1, editable.length - 1) : Math.max(0, idx - 1);
          focusedDictNodeId = editable[nextIdx] ?? null;
          elementViewInstance?.update({ focusedNodeId: focusedDictNodeId });
          e.preventDefault();
        }
      } else if (tableMode && tableViewInstance) {
        const cols = getDataColumnTags();
        const n = getRowCount();
        if (cols.length > 0 && n > 0) {
          const cur = focusedCell ?? selectedCells[0];
          if (cur) {
            e.preventDefault();
            let newRow = cur.rowIndex;
            let colIdx = cols.indexOf(cur.colTag);
            if (colIdx < 0) colIdx = 0;
            if (e.key === 'ArrowUp') newRow = Math.max(0, cur.rowIndex - 1);
            else if (e.key === 'ArrowDown') newRow = Math.min(n - 1, cur.rowIndex + 1);
            else if (e.key === 'ArrowLeft') colIdx = Math.max(0, colIdx - 1);
            else if (e.key === 'ArrowRight') colIdx = Math.min(cols.length - 1, colIdx + 1);
            const newColTag = cols[colIdx];
            const newCell: SelectedCell = { rowIndex: newRow, colTag: newColTag ?? cur.colTag };
            focusedCell = newCell;
            selectedCells = [newCell];
            _selectedRowIndex = newRow;
            selectedRowIndices = [newRow];
            tableViewInstance.update({ focusedCell, selectedCells });
          }
        }
      }
      return;
    }
    if (e.key === 'Enter' && !inInput) {
      if (viewMode === 'dict') {
        const editable = getEditableDictNodeIds(dictEntries);
        if (editable.length > 0) {
          const firstEditable = editable[0];
          if (firstEditable !== undefined) elementViewInstance?.startEditForNode(focusedDictNodeId ?? firstEditable);
          e.preventDefault();
        }
      } else if (focusedCell && tableViewInstance) {
        const info = getCellEditInfo(focusedCell.rowIndex, focusedCell.colTag);
        const createNew = getCreateNewForFocusedCell();
        if (info || createNew) {
          e.preventDefault();
          tableViewInstance.openCellForEdit(focusedCell.rowIndex, focusedCell.colTag);
        }
      }
      return;
    }
    if (!inInput && viewMode === 'dict' && focusedDictNodeId != null) {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== 'Enter' && e.key !== 'Escape' && e.key !== 'Tab') {
        e.preventDefault();
        elementViewInstance?.startEditForNode(focusedDictNodeId, e.key);
      }
    }
    if (!inInput && focusedCell && (getCellEditInfo(focusedCell.rowIndex, focusedCell.colTag) || getCreateNewForFocusedCell())) {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== 'Enter' && e.key !== 'Escape' && e.key !== 'Tab') {
        e.preventDefault();
        tableViewInstance?.openCellForEdit(focusedCell.rowIndex, focusedCell.colTag, e.key);
      }
    }
    if (e.key === 'c' && (e.ctrlKey || e.metaKey) && !inInput) {
      if (copySelectionToClipboard()) e.preventDefault();
    }
  }

  function handleDocumentPaste(e: ClipboardEvent): void {
    const inInput = (e.target as HTMLElement).closest('input, textarea');
    if (tableMode && !inInput) {
      e.preventDefault();
      applyPastedText(e.clipboardData?.getData('text/plain') ?? '');
      return;
    }
    if (viewMode === 'dict' && focusedDictNodeId != null) {
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const firstLine = text.split(/\r?\n/)[0]?.trim() ?? '';
      if (firstLine !== '') {
        e.preventDefault();
        vscode.postMessage({ type: 'edit', edit: { nodeId: focusedDictNodeId, field: 'textContent', value: firstLine } });
      }
    }
  }

  function handleContextMenu(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const cell = target.closest?.('[data-row-index][data-col-tag]') as HTMLElement | null;
    if (cell) {
      const ri = parseInt(cell.dataset.rowIndex ?? '', 10);
      const ct = cell.dataset.colTag ?? '';
      if (!Number.isNaN(ri) && ct) showContextMenu(e.clientX, e.clientY, { rowIndex: ri, colTag: ct });
    }
  }

  function handleSelectStart(e: Event): void {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if (viewMode === 'dict' || tableMode) e.preventDefault();
  }

  if (pathBar) {
    const chips = pathBar.querySelector('#path-chips') as HTMLElement | undefined;
    const inputWrap = pathBar.querySelector('#path-input-wrap') as HTMLElement | undefined;
    const input = pathBar.querySelector('#path-input') as HTMLInputElement | undefined;
    const ghost = pathBar.querySelector('#path-input-ghost') as HTMLSpanElement | undefined;
    const copyBtn = pathBar.querySelector('#copy-path-btn') as HTMLElement | undefined;
    navBar = createNavigationBar(pathBar, {
      path: pathFilter,
      placeholder: strings.placeholderPathInput,
      onPathChange: navigateToPath,
      onSuggestRequest: (path, prefix) => vscode.postMessage({ type: 'pathSuggest', path, prefix }),
      onCopyPath: (fullPath) => {
        navigator.clipboard.writeText(fullPath).then(() => {
          copyBtn?.classList.add('copied');
          setTimeout(() => copyBtn?.classList.remove('copied'), 1500);
        }).catch(() => {
          if (pathInput) { pathInput.value = fullPath; pathInput.focus(); pathInput.select(); }
        });
      },
      refs: { chips, inputWrap, input, ghost, copyBtn },
    });
  }
  if (pathInput) {
    pathInput.addEventListener('focus', () => {
      if (viewMode === 'dict') {
        focusedDictNodeId = null;
        elementViewInstance?.update({ focusedNodeId: null });
      } else {
        selectedCells = [];
        focusedCell = null;
        _selectedRowIndex = -1;
        selectedRowIndices = [];
        tableViewInstance?.update({ selectedCells, focusedCell });
      }
    });
    pathInput.addEventListener('keydown', (ev) => {
      if ((ev.key === 'z' || ev.key === 'y') && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        ev.stopPropagation();
        vscode.postMessage({ type: (ev.key === 'z' && ev.shiftKey) || ev.key === 'y' ? 'redo' : 'undo' });
      }
    }, true);
  }

  _teardownEventHub = setupEventHub({
    onKeyDown: handleDocumentKeyDown,
    onPaste: handleDocumentPaste,
    onClick: hideContextMenu,
    onContextMenu: handleContextMenu,
    onSelectStart: handleSelectStart,
  });

  function handleIncomingMessage(msg: IncomingMessage): void {
    if (msg.type === 'parseError') {
      showErrorState(msg.message ?? strings.errorParse);
      return;
    }
    if (msg.type === 'error') {
      showErrorState((msg as { message?: string }).message ?? strings.errorGeneric, { clearPath: true });
      return;
    }
    if (msg.type === 'gridData') {
      setGridData({
        viewMode: msg.viewMode,
        pathFilter: msg.pathFilter,
        currentPathFull: msg.currentPathFull,
        matchCount: msg.matchCount,
        tableMode: msg.tableMode,
        columns: msg.columns as TableColumnDef[] | undefined,
        childTables: msg.childTables as ChildTableRef[] | undefined,
        tableRows: msg.tableRows as TableRowData[] | undefined,
        listParentNodeId: (msg as { listParentNodeId?: number }).listParentNodeId,
        listRowTagName: (msg as { listRowTagName?: string }).listRowTagName,
        lastListNodeId: (msg as { lastListNodeId?: number }).lastListNodeId,
        dictEntries: msg.dictEntries as DictEntry[] | undefined,
        showAttributes: msg.showAttributes,
        attributes: msg.attributes,
        documentLabel: msg.documentLabel,
      });
      return;
    }
    if (msg.type === 'noData') {
      const nd = msg as { pathFilter?: string; documentLabel?: string; matchCount?: number };
      if (nd.documentLabel) currentDocumentLabel = nd.documentLabel;
      if (nd.pathFilter != null) {
        pathFilter = nd.pathFilter;
        currentPathFull = nd.pathFilter;
        navBar?.update({ path: pathFilter, suggestions: [], suggestionContext: null });
      }
      showErrorState(nd.matchCount === 0 ? strings.errorNoElementsAtPath : strings.errorMixedElementTypes);
      return;
    }
    if (msg.type === 'pathSuggestions' && Array.isArray(msg.suggestions)) {
      const ps = msg as { path?: string; prefix?: string; matchCount?: number };
      navBar?.update({
        suggestions: msg.suggestions,
        suggestionContext: ps.path != null ? { path: ps.path, prefix: ps.prefix ?? '', matchCount: ps.matchCount } : null,
      });
      return;
    }
    if (msg.type === 'revealRow') {
      const nodeId = typeof (msg as { nodeId?: number }).nodeId === 'number' ? (msg as { nodeId: number }).nodeId : -1;
      if (nodeId >= 0 && tableMode && tableViewInstance) {
        const displayed = tableViewInstance.getDisplayedRows();
        const idx = displayed.findIndex((r) => r.listNodeId === nodeId);
        if (idx >= 0) {
          _selectedRowIndex = idx;
          selectedRowIndices = [idx];
          focusedCell = displayed[idx] ? { rowIndex: idx, colTag: getDataColumnTags()[0] ?? '' } : null;
          tableViewInstance.update({ selectedCells: focusedCell ? [focusedCell] : [], focusedCell });
          tableViewInstance.scrollToRow(idx);
        }
      }
    }
  }

  return { handleIncomingMessage };
}
