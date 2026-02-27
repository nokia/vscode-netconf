/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  Shared leaf-list chip UI: value chips with delete button and optional add button.
  Used by TableView (table cells) and ElementView (dict rows). Single implementation
  for consistent DOM structure and CSS classes (leaf-list-chip, chip-delete, leaf-list-add).
*/

import { strings } from '../../strings';

export interface LeafListItem {
  value: string;
  nodeId: number;
  startOffset?: number;
  endOffset?: number;
}

export interface LeafListChipsOptions {
  items: LeafListItem[];
  /** When set, show the add (+) button and call onAdd with the new value. */
  addButton?: {
    onAdd: (value: string) => void;
    /** Override tooltip for the add button (e.g. "Add filter" in table filter row). */
    tooltip?: string;
    /** Override placeholder for the add input (e.g. filter hint "Contains or equals…"). */
    placeholder?: string;
  };
  onDelete: (nodeId: number) => void;
  /** Optional: click on value span (e.g. reveal in editor). */
  onSelect?: (nodeId: number, startOffset?: number, endOffset?: number) => void;
  /** Optional: double-click on value span opens inline edit; onEdit(nodeId, newValue). Empty string = delete. */
  onEdit?: (nodeId: number, newValue: string) => void;
}

/**
 * Render leaf-list chips into the container. Container should use flex/gap styling
 * (e.g. display: flex; flex-wrap: wrap; gap: 6px; align-items: center).
 */
export function renderLeafListChips(container: HTMLElement, options: LeafListChipsOptions): void {
  const { items, addButton, onDelete, onSelect, onEdit } = options;
  container.style.display = 'flex';
  container.style.flexWrap = 'wrap';
  container.style.gap = '6px';
  container.style.alignItems = 'center';

  for (const item of items) {
    const chipWrap = document.createElement('span');
    chipWrap.className = 'leaf-list-chip';
    const valueSpan = document.createElement('span');
    valueSpan.textContent = item.value;
    valueSpan.title = strings.tooltipClickSelectDblclickEdit;
    if (onSelect) {
      valueSpan.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onSelect(item.nodeId, item.startOffset, item.endOffset);
      });
    }
    if (onEdit) {
      valueSpan.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        startChipEditInput(chipWrap, item, valueSpan, (newVal) => {
          if (newVal === '') onDelete(item.nodeId);
          else onEdit(item.nodeId, newVal);
        });
      });
    }
    const delBtn = document.createElement('button');
    delBtn.className = 'chip-delete';
    delBtn.type = 'button';
    delBtn.textContent = '×';
    delBtn.title = strings.tooltipRemove;
    delBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onDelete(item.nodeId);
    });
    chipWrap.appendChild(valueSpan);
    chipWrap.appendChild(delBtn);
    container.appendChild(chipWrap);
  }

  if (addButton) {
    const addBtn = document.createElement('button');
    addBtn.className = 'leaf-list-add';
    addBtn.type = 'button';
    addBtn.textContent = '+';
    addBtn.title = addButton.tooltip ?? strings.tooltipAddValue;
    const addInput = document.createElement('input');
    addInput.className = 'leaf-list-add-input';
    addInput.type = 'text';
    addInput.placeholder = addButton.placeholder ?? strings.placeholderNewValue;
    addInput.style.display = 'none';
    addInput.style.width = '120px';
    addInput.style.padding = '2px 6px';
    addInput.style.marginLeft = '4px';
    addBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      addBtn.style.display = 'none';
      addInput.style.display = 'inline-block';
      addInput.focus();
    });
    addInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const value = addInput.value.trim();
        addInput.value = '';
        addInput.style.display = 'none';
        addBtn.style.display = '';
        if (value) addButton.onAdd(value);
      } else if (ev.key === 'Escape') {
        addInput.style.display = 'none';
        addBtn.style.display = '';
        addInput.value = '';
      }
    });
    addInput.addEventListener('blur', () => {
      const value = addInput.value.trim();
      addInput.value = '';
      addInput.style.display = 'none';
      addBtn.style.display = '';
      if (value) addButton.onAdd(value);
    });
    container.appendChild(addBtn);
    container.appendChild(addInput);
  }
}

/**
 * Inline edit overlay for a chip: replace value span with input; on commit call onCommit(newValue).
 * Used when user double-clicks a chip (ElementView). Empty newValue means "remove chip".
 */
export function startChipEditInput(
  chipWrap: HTMLElement,
  item: LeafListItem,
  valueSpan: HTMLElement,
  onCommit: (newValue: string) => void
): void {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = item.value;
  const minCh = 10;
  const widthCh = Math.max(minCh, item.value.length + 2);
  input.style.cssText =
    `width: ${widthCh}ch; min-width: ${minCh}ch; padding: 2px 4px; font-size: inherit; border: 1px solid var(--vscode-focusBorder); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground);`;
  const commit = () => {
    const newVal = input.value.trim();
    onCommit(newVal);
    input.remove();
    if (newVal !== '') {
      valueSpan.textContent = newVal;
      valueSpan.style.display = '';
    } else {
      chipWrap.remove();
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') {
      input.remove();
      valueSpan.textContent = item.value;
      valueSpan.style.display = '';
    }
  });
  valueSpan.textContent = '';
  valueSpan.style.display = 'none';
  chipWrap.insertBefore(input, valueSpan);
  input.focus();
  input.select();
}
