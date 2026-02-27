/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  UI text for the XML Navigator webview.
  Keyed for localization: use @vscode/l10n or host-supplied strings later without changing component code.

  Naming: prefix by usage (appTitle, placeholder*, tooltip*, entries*, status*, error*). Group by usage.
  Text only; avoid encoding separators like " - " so callers can compose.
*/

export const strings = {
  // App
  appTitle: 'XML Navigator',

  // Placeholders
  placeholderLoading: 'Loading…',
  placeholderPathInput: 'Enter Segment or Full Path',
  placeholderPathInputFinalNavigation: 'Enter full path',
  placeholderNewValue: 'New value…',
  /** Filter row: short hint that text uses "contains", numbers use "equals". */
  placeholderFilterValue: 'Contains or equals…',

  // Tooltips: Navigation Bar / Path
  tooltipOpenTable: 'Open list',
  tooltipCopyPath: 'Copy complete path',
  tooltipPathChip: (path: string) => `/${path}  (click to navigate)`,
  tooltipPathInput: (opts: string) => `Enter path segment.\nOptions: ${opts}`,
  tooltipAddToPath: 'Select as path filter',

  // Tooltips: Table View (mode: list)
  tooltipFilter: 'Filter list',
  tooltipFilterActive: 'Filter active',
  tooltipAddRow: 'Add new list entry',
  tooltipClickSelectRow: 'Click to select list entry',
  tooltipClickClearSortDblclickSelectTable: 'Click to clear sorting, double-click to select entire table',
  tooltipClickSort: 'Click to sort.',
  tooltipDragToResizeColumn: 'Drag to resize column',
  tooltipChildTableNavigate: (tagName: string) => `Child table: navigate to ${tagName}`,
  tooltipRemove: 'Remove',
  tooltipAddValue: 'Add value',
  tooltipAddFilter: 'Add filter',
  tooltipClickSelectDblclickEdit: 'Click to select, double-click to edit',

  // Entry counts (reused for status bar and path-input ghost)
  entriesNoMatches: 'no matches',
  entriesSingleEntry: '1 entry',
  entriesMultipleEntries: (n: number) => `${n.toLocaleString()} entries`,
  entriesFiltered: (displayed: number, total: number) =>
    `${displayed.toLocaleString()} of ${total.toLocaleString()} entries`,

  // Sorted state (aria-label)
  sortedAsc: 'Sorted A→Z',
  sortedDesc: 'Sorted Z→A',

  // Errors
  errorParse: 'Unable to parse XML.',
  errorGeneric: 'An error occurred.',
  errorNoElementsAtPath: 'No elements found at this path.',
  errorMixedElementTypes:
    'Mixed element types at this path. Navigate deeper to see Table View or Element View.',
} as const;

export type StringKey = keyof typeof strings;
