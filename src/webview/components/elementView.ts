/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  ElementView component: form-style dict rows (key/value), leaf-list chips, "Open table" icon.
  Uses element-view.css and table-view.css (table-nav-icon). Emits pathNavigate, selection, edit, deleteNode, addLeafListItem.
*/

import type { DictEntry } from '../types';
import { strings } from '../strings';
import { renderLeafListChips } from './shared/leafListChips';

export interface ElementViewOptions {
  entries: DictEntry[];
  attributes: Record<string, string>;
  showAttributes: boolean;
  focusedNodeId: number | null;
  pathPrefix?: string;
  onPathNavigate: (path: string) => void;
  onSelection: (nodeId: number, startOffset: number, endOffset: number) => void;
  onEdit: (nodeId: number, field: 'textContent', value: string) => void;
  onDeleteNode: (nodeId: number) => void;
  onAddLeafListItem: (parentNodeId: number, tagName: string, value: string) => void;
}

export interface ElementViewInstance {
  update(options: Partial<ElementViewOptions>): void;
  startEditForNode(nodeId: number, initialKey?: string): void;
  destroy(): void;
}

/**
 * If this entry is or wraps a single list (openTable), return the path to navigate to that list; else null.
 * Handles: direct openTable (groups→group), or single child with openTable (local-profiles→profile→…).
 */
function getEffectiveListPath(entry: DictEntry, pathPrefix: string): string | null {
  if (entry.openTable) {
    return pathPrefix ? `${pathPrefix}/${entry.key}` : entry.key;
  }
  if (entry.children?.length === 1 && entry.children[0].openTable) {
    const seg = entry.children[0].key;
    const base = pathPrefix ? `${pathPrefix}/${entry.key}` : entry.key;
    return `${base}/${seg}`;
  }
  return null;
}

/** True when the list key is contained in the container name (e.g. "group" in "groups", "profile" in "local-profiles"). */
function listNameContainedInContainer(listKey: string, containerName: string): boolean {
  if (!containerName || !listKey) return false;
  return containerName.toLowerCase().includes(listKey.toLowerCase());
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

function createCollapseToggle(containerKey: string, isCollapsed: boolean, onToggle: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dict-collapse-toggle';
  btn.setAttribute('aria-expanded', String(!isCollapsed));
  btn.setAttribute('aria-label', isCollapsed ? 'Expand' : 'Collapse');
  btn.innerHTML = isCollapsed
    ? '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M6 4l4 4-4 4V4z" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 6l4 4 4-4H4z" fill="currentColor"/></svg>';
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    onToggle();
  });
  return btn;
}

/**
 * Create an ElementView (dict/form) in the given container.
 */
export function createElementView(container: HTMLElement, options: ElementViewOptions): ElementViewInstance {
  let state: ElementViewOptions = { ...options };
  /** Path keys for container rows that are collapsed (e.g. "groups", "root/groups/group"). */
  const collapsedKeys = new Set<string>();
  function collectEditableNodeIds(entries: DictEntry[]): number[] {
    const ids: number[] = [];
    for (const entry of entries) {
      if (entry.nodeId != null) ids.push(entry.nodeId);
      if (entry.children?.length) ids.push(...collectEditableNodeIds(entry.children));
    }
    return ids;
  }

  function getAdjacentEditableNodeId(nodeId: number, delta: -1 | 1): number {
    const editable = collectEditableNodeIds(state.entries);
    if (editable.length === 0) return nodeId;
    const currentIdx = editable.indexOf(nodeId);
    if (currentIdx < 0) {
      const first = editable[0];
      return first !== undefined ? first : nodeId;
    }
    const nextIdx =
      delta > 0
        ? (currentIdx >= editable.length - 1 ? 0 : currentIdx + 1)
        : (currentIdx <= 0 ? editable.length - 1 : currentIdx - 1);
    const next = editable[nextIdx];
    return next !== undefined ? next : nodeId;
  }

  function openValueCellEditor(
    valueCell: HTMLElement,
    nodeId: number,
    baseValue: string,
    initialKey?: string
  ): void {
    if (valueCell.querySelector('input, textarea')) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = initialKey !== undefined ? initialKey : baseValue;
    input.className = 'cell-edit';
    input.style.background = 'var(--vscode-input-background)';
    input.style.color = 'var(--vscode-input-foreground)';
    input.style.width = '100%';
    input.style.padding = '4px 8px';
    input.style.border = 'none';
    input.style.outline = 'none';
    input.style.boxSizing = 'border-box';
    let done = false;
    const restoreCell = (valueToShow: string) => {
      valueCell.textContent = valueToShow;
      valueCell.style.display = '';
      input.remove();
    };
    const commit = (moveDelta?: -1 | 1) => {
      if (done) return;
      done = true;
      const newVal = input.value.trim();
      if (newVal !== baseValue) state.onEdit(nodeId, 'textContent', newVal);
      restoreCell(newVal || baseValue);
      const targetNodeId = moveDelta ? getAdjacentEditableNodeId(nodeId, moveDelta) : nodeId;
      state.onSelection(targetNodeId, 0, 0);
    };
    const cancel = () => {
      if (done) return;
      done = true;
      restoreCell(baseValue);
      state.onSelection(nodeId, 0, 0);
    };
    input.addEventListener('blur', () => commit());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        commit(1);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commit(e.shiftKey ? -1 : 1);
      }
    });
    valueCell.textContent = '';
    valueCell.appendChild(input);
    input.focus();
    if (initialKey === undefined) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  }

  function renderRow(
    wrap: HTMLElement,
    keyText: string,
    valueText: string,
    opts: {
      attrRow?: boolean;
      indent?: number;
      openTablePath?: string;
      children?: DictEntry[];
      pathPrefix?: string;
      entry?: DictEntry;
      leafListValues?: Array<{ value: string; nodeId: number; startOffset?: number; endOffset?: number }>;
      leafListTagName?: string;
      leafListParentNodeId?: number;
    }
  ): void {
    const row = document.createElement('div');
    row.className = 'dict-row' + (opts.attrRow ? ' dict-row-attr' : '');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.padding = '4px 8px';
    row.style.borderBottom = '1px solid var(--vscode-panel-border)';
    row.style.paddingLeft = `${8 + (opts.indent ?? 0) * 16}px`;
    row.style.minHeight = '22px';
    const keyCell = document.createElement('div');
    keyCell.className = opts.attrRow ? 'dict-key' : '';
    keyCell.style.flex = '0 0 180px';
    keyCell.style.fontWeight = opts.attrRow ? 'normal' : '500';
    keyCell.textContent = keyText;
    const valueCell = document.createElement('div');
    valueCell.className = opts.attrRow ? 'dict-val' : '';
    valueCell.style.flex = '1 1 auto';
    valueCell.style.minWidth = '0';
    valueCell.style.overflow = 'hidden';
    valueCell.style.textOverflow = 'ellipsis';

    if (opts.openTablePath) {
      valueCell.appendChild(createTableIcon(opts.openTablePath, state.onPathNavigate));
      row.appendChild(keyCell);
      row.appendChild(valueCell);
      wrap.appendChild(row);
      return;
    }
    if (opts.leafListValues && opts.leafListValues.length > 0) {
      renderLeafListChips(valueCell, {
        items: opts.leafListValues,
        onDelete: (nodeId) => state.onDeleteNode(nodeId),
        onSelect: (nodeId, start, end) => state.onSelection(nodeId, start ?? 0, end ?? 0),
        onEdit: (nodeId, newVal) => state.onEdit(nodeId, 'textContent', newVal),
        addButton:
          opts.leafListTagName != null && opts.leafListParentNodeId != null
            ? { onAdd: (value) => state.onAddLeafListItem(opts.leafListParentNodeId as number, opts.leafListTagName as string, value) }
            : undefined,
      });
      row.appendChild(keyCell);
      row.appendChild(valueCell);
      wrap.appendChild(row);
      return;
    }
    if (opts.children && opts.children.length > 0) {
      const pathPrefix = opts.pathPrefix ?? '';
      // pathPrefix is already the path to this container (e.g. root/groups)
      const containerPath = pathPrefix || keyText;
      // Flatten: single child that is a list whose name is contained in this container → show container as direct link
      if (opts.children.length === 1) {
        const singleChild = opts.children[0];
        const listPath = getEffectiveListPath(singleChild, containerPath);
        if (listPath && listNameContainedInContainer(singleChild.key, keyText)) {
          renderRow(wrap, keyText, '', { openTablePath: listPath, indent: opts.indent });
          return;
        }
      }
      const containerKey = containerPath;
      const isCollapsed = collapsedKeys.has(containerKey);
      const childrenWrap = document.createElement('div');
      childrenWrap.className = 'dict-children';
      childrenWrap.dataset.containerKey = containerKey;
      if (isCollapsed) childrenWrap.style.display = 'none';
      keyCell.style.flex = '1';
      keyCell.style.fontWeight = '600';
      keyCell.textContent = keyText;
      valueCell.style.display = 'flex';
      valueCell.style.justifyContent = 'flex-end';
      valueCell.style.alignItems = 'center';
      const toggle = createCollapseToggle(containerKey, isCollapsed, () => {
        if (collapsedKeys.has(containerKey)) {
          collapsedKeys.delete(containerKey);
          childrenWrap.style.display = '';
          toggle.setAttribute('aria-expanded', 'true');
          toggle.setAttribute('aria-label', 'Collapse');
          toggle.innerHTML =
            '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 6l4 4 4-4H4z" fill="currentColor"/></svg>';
        } else {
          collapsedKeys.add(containerKey);
          childrenWrap.style.display = 'none';
          toggle.setAttribute('aria-expanded', 'false');
          toggle.setAttribute('aria-label', 'Expand');
          toggle.innerHTML =
            '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M6 4l4 4-4 4V4z" fill="currentColor"/></svg>';
        }
      });
      valueCell.appendChild(toggle);
      row.classList.add('dict-row-container');
      row.style.cursor = 'pointer';
      row.appendChild(keyCell);
      row.appendChild(valueCell);
      wrap.appendChild(row);
      wrap.appendChild(childrenWrap);
      row.addEventListener('click', (ev) => {
        if (toggle.contains(ev.target as Node)) return;
        ev.preventDefault();
        ev.stopPropagation();
        toggle.click();
      });
      for (const child of opts.children) {
        renderEntry(childrenWrap, child, pathPrefix, (opts.indent ?? 0) + 1);
      }
      return;
    }
    const val = valueText;
    if (val.includes('\n')) {
      valueCell.classList.add('cell', 'data-cell', 'cell-multiline');
      valueCell.style.whiteSpace = 'pre-wrap';
    }
    valueCell.textContent = val;
    const entry = opts.entry;
    if (entry?.nodeId != null) {
      valueCell.dataset.nodeId = String(entry.nodeId);
      valueCell.dataset.editField = 'textContent';
      valueCell.classList.add('cell', 'data-cell');
      if (state.focusedNodeId === entry.nodeId) valueCell.classList.add('cell-focused');
      valueCell.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        openValueCellEditor(valueCell, entry.nodeId, val);
      });
      valueCell.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.onSelection(entry.nodeId, 0, 0);
      });
    }
    row.appendChild(keyCell);
    row.appendChild(valueCell);
    wrap.appendChild(row);
  }

  function renderEntry(wrap: HTMLElement, e: DictEntry, pathPrefix: string, indent: number): void {
    if (e.openTable) {
      const nextPath = pathPrefix ? `${pathPrefix}/${e.key}` : e.key;
      renderRow(wrap, e.key, '', { openTablePath: nextPath, indent });
      return;
    }
    if (e.leafList && e.leafListValues && e.leafListValues.length > 0) {
      renderRow(wrap, e.key, '', {
        indent,
        leafListValues: e.leafListValues,
        leafListTagName: e.key,
        leafListParentNodeId: e.leafListParentNodeId,
      });
      return;
    }
    if (e.children && e.children.length > 0) {
      renderRow(wrap, e.key, '', {
        indent,
        children: e.children,
        pathPrefix: pathPrefix ? `${pathPrefix}/${e.key}` : e.key,
      });
      return;
    }
    renderRow(wrap, e.key, e.value ?? '', { indent, entry: e });
  }

  function render(): void {
    container.innerHTML = '';
    container.classList.add('dict-view');
    const basePath = (state.pathPrefix ?? '').replace(/^\/+/, '').trim();
    const containerName = basePath ? basePath.split('/').pop() ?? '' : '';
    if (state.showAttributes && state.attributes && Object.keys(state.attributes).length > 0) {
      for (const [k, v] of Object.entries(state.attributes)) {
        renderRow(container, k, v, { attrRow: true });
      }
    }
    // Flatten: single entry that is a list whose name is contained in the container name → show container as direct link
    if (
      state.entries.length === 1 &&
      containerName &&
      listNameContainedInContainer(state.entries[0].key, containerName)
    ) {
      const e = state.entries[0];
      const listPath = getEffectiveListPath(e, basePath);
      if (listPath) {
        renderRow(container, containerName, '', { openTablePath: listPath });
        return;
      }
    }
    for (const e of state.entries) {
      renderEntry(container, e, basePath, 0);
    }
  }

  function startEditForNode(nodeId: number, initialKey?: string): void {
    const valueCell = container.querySelector(
      `[data-node-id="${nodeId}"][data-edit-field]`
    ) as HTMLElement | null;
    if (!valueCell) return;
    const val = valueCell.textContent ?? '';
    openValueCellEditor(valueCell, nodeId, val, initialKey);
  }

  render();

  return {
    update(next: Partial<ElementViewOptions>) {
      state = { ...state, ...next };
      render();
      if (next.focusedNodeId != null && state.focusedNodeId != null) {
        const el = container.querySelector(`[data-node-id="${state.focusedNodeId}"]`);
        (el as HTMLElement)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    },
    startEditForNode,
    destroy() {
      container.innerHTML = '';
      container.classList.remove('dict-view');
    },
  };
}
