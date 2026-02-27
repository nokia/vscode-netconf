/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  NavigationBar component: path chips, path input with ghost/suggestions, copy button.
  Uses CSS classes from path-bar.css. Emits pathChange and suggestRequest; no direct postMessage.
*/

import { splitPathSegments } from '../pathUtils';
import { strings } from '../strings';

export interface NavigationBarOptions {
  /** Current path (segment string, e.g. "a/b/c"). */
  path: string;
  /** Placeholder for the path input. */
  placeholder?: string;
  /** Called when the user navigates (chip click, Enter, Tab/Space autocomplete-and-commit; leading / = replace path). */
  onPathChange: (path: string) => void;
  /** Called when the host should provide suggestions for the next segment (path + prefix). */
  onSuggestRequest: (path: string, prefix: string) => void;
  /** Called when the user clicks copy path; host can copy path to clipboard. */
  onCopyPath?: (path: string) => void;
  /** Optional: use these elements instead of creating new ones (e.g. from existing HTML). */
  refs?: {
    chips?: HTMLElement;
    inputWrap?: HTMLElement;
    input?: HTMLInputElement;
    ghost?: HTMLSpanElement;
    copyBtn?: HTMLElement;
  };
}

export interface NavigationBarUpdate {
  path?: string;
  suggestions?: string[];
  suggestionContext?: { path: string; prefix: string; matchCount?: number } | null;
  placeholder?: string;
}

export interface NavigationBarInstance {
  update(props: NavigationBarUpdate): void;
  getPath(): string;
  focusInput(): void;
  destroy(): void;
}

const MEASURE_STYLE = 'position:absolute;visibility:hidden;white-space:pre;font:inherit;padding:0;';

function measureTextWidth(input: HTMLInputElement, measureEl: HTMLSpanElement): number {
  measureEl.textContent = input.value;
  return measureEl.getBoundingClientRect().width;
}

/**
 * Create a NavigationBar in the given container. If refs are provided, uses existing elements;
 * otherwise creates chips div, input wrap (ghost + input), and copy button and appends to container.
 */
export function createNavigationBar(container: HTMLElement, options: NavigationBarOptions): NavigationBarInstance {
  const refs = options.refs ?? {};
  let path = (options.path ?? '').trim().replace(/^\/+/, '').replace(/\/+/g, '/');
  let defaultPlaceholder = options.placeholder ?? strings.placeholderPathInput;
  let suggestions: string[] = [];
  let suggestionContext: { path: string; prefix: string; matchCount?: number } | null = null;
  let suggestionCycleIdx = -1;
  let suggestDebounce: ReturnType<typeof setTimeout> | undefined;
  let pendingAccept: { path: string; prefix: string; requireSingle: boolean } | null = null;
  let pendingCycle: { path: string; prefix: string } | null = null;
  const debounceMs = 150;

  const chipsEl = refs.chips ?? document.createElement('div');
  chipsEl.id = 'path-chips';
  if (!refs.chips) {
    chipsEl.className = 'path-chips';
    container.appendChild(chipsEl);
  }

  const inputWrap = refs.inputWrap ?? document.createElement('div');
  inputWrap.id = 'path-input-wrap';
  if (!refs.inputWrap) container.appendChild(inputWrap);

  const ghost = refs.ghost ?? document.createElement('span');
  ghost.id = 'path-input-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  if (!refs.ghost) inputWrap.appendChild(ghost);

  const input = refs.input ?? document.createElement('input');
  input.id = 'path-input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = defaultPlaceholder;
  if (!refs.input) inputWrap.appendChild(input);

  let measureSpan: HTMLSpanElement | null = null;
  function getMeasureEl(): HTMLSpanElement {
    if (!measureSpan) {
      measureSpan = document.createElement('span');
      measureSpan.className = 'path-input-measure';
      measureSpan.style.cssText = MEASURE_STYLE;
      inputWrap.appendChild(measureSpan);
    }
    return measureSpan;
  }

  const copyBtn = refs.copyBtn ?? document.createElement('span');
  copyBtn.id = 'copy-path-btn';
  copyBtn.setAttribute('role', 'button');
  copyBtn.tabIndex = 0;
  copyBtn.title = strings.tooltipCopyPath;
  copyBtn.setAttribute('aria-label', strings.tooltipCopyPath);
  if (!refs.copyBtn) {
    copyBtn.innerHTML = `
      <svg class="copy-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M3 5V12.73C2.4 12.38 2 11.74 2 11V5C2 2.79 3.79 1 6 1H9C9.74 1 10.38 1.4 10.73 2H6C4.35 2 3 3.35 3 5ZM11 15H6C4.897 15 4 14.103 4 13V5C4 3.897 4.897 3 6 3H11C12.103 3 13 3.897 13 5V13C13 14.103 12.103 15 11 15ZM12 5C12 4.448 11.552 4 11 4H6C5.448 4 5 4.448 5 5V13C5 13.552 5.448 14 6 14H11C11.552 14 12 13.552 12 13V5Z"/></svg>
      <svg class="check-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M13.6572 3.13573C13.8583 2.9465 14.175 2.95614 14.3643 3.15722C14.5535 3.35831 14.5438 3.675 14.3428 3.86425L5.84277 11.8642C5.64597 12.0494 5.33756 12.0446 5.14648 11.8535L1.64648 8.35351C1.45121 8.15824 1.45121 7.84174 1.64648 7.64647C1.84174 7.45121 2.15825 7.45121 2.35351 7.64647L5.50976 10.8027L13.6572 3.13573Z"/></svg>
    `;
    container.appendChild(copyBtn);
  }

  function renderChips(): void {
    chipsEl.innerHTML = '';
    const segments = splitPathSegments(path);
    segments.forEach((seg, i) => {
      const pathUpToHere = segments.slice(0, i + 1).join('/');
      const chip = document.createElement('span');
      chip.className = 'path-chip';
      chip.textContent = seg;
      chip.title = strings.tooltipPathChip(pathUpToHere);
      chip.addEventListener('click', () => navigate(pathUpToHere));
      chipsEl.appendChild(chip);
    });
  }

  function navigate(newPath: string): void {
    path = newPath.trim().replace(/^\/+/, '').replace(/\/+/g, '/');
    input.value = '';
    suggestions = [];
    suggestionContext = null;
    pendingAccept = null;
    pendingCycle = null;
    clearSuggestion();
    renderChips();
    updateGhost();
    options.onPathChange(path);
  }

  function suggestionsValid(): boolean {
    if (!suggestionContext) return false;
    const prefix = (input.value ?? '').trim();
    return suggestionContext.path === path && suggestionContext.prefix === prefix;
  }

  function hasTypedInput(): boolean {
    return (input.value ?? '').trim() !== '';
  }

  function isFullPathInput(): boolean {
    return (input.value ?? '').trim().startsWith('/');
  }

  function isFinalNavigationPoint(): boolean {
    return (
      !!suggestionContext &&
      suggestionContext.path === path &&
      suggestionContext.prefix === '' &&
      suggestions.length === 0 &&
      typeof suggestionContext.matchCount === 'number' &&
      suggestionContext.matchCount > 0
    );
  }

  function getFirstMatch(): string | null {
    if (!suggestionsValid() || !suggestions.length) return null;
    const prefix = (input.value ?? '').trim();
    if (prefix === '') return suggestions[0] ?? null;
    const lower = prefix.toLowerCase();
    const match = suggestions.find((s) => s.toLowerCase().startsWith(lower));
    return match ?? null;
  }

  /** Current proposal for commit: cycled option (?) or first prefix match. */
  function getProposedOption(): string | null {
    if (!suggestionsValid() || !suggestions.length) return null;
    if (suggestionCycleIdx >= 0) return suggestions[suggestionCycleIdx] ?? null;
    return getFirstMatch();
  }

  /** Ghost shows: cycled option (after ?), or first prefix match when suggestions are valid (no ambiguity). */
  function getProposalForDisplay(): string | null {
    if (suggestionCycleIdx >= 0 && suggestions.length) return suggestions[suggestionCycleIdx] ?? null;
    if (!hasTypedInput()) return null;
    if (suggestionsValid() && suggestions.length) return getFirstMatch();
    return null;
  }

  function clearSuggestion(): void {
    suggestionCycleIdx = -1;
    pendingCycle = null;
    inputWrap.classList.remove('has-suggestions');
    updateGhost();
  }

  function updateGhost(): void {
    ghost.textContent = '';
    ghost.classList.remove('no-match');
    ghost.style.display = 'none';
    ghost.style.left = '';
    input.placeholder = defaultPlaceholder;
    const prefix = (input.value ?? '').trim();
    if (prefix.startsWith('/')) {
      inputWrap.classList.remove('has-suggestions');
      return;
    }
    const proposed = getProposalForDisplay();
    if (prefix === '') {
      if (proposed !== null && suggestionsValid()) {
        inputWrap.classList.add('has-suggestions');
        ghost.textContent = proposed;
        ghost.style.display = 'inline';
        ghost.style.left = `${8 + measureTextWidth(input, getMeasureEl())}px`;
        return;
      }
      if (isFinalNavigationPoint()) {
        input.placeholder = strings.placeholderPathInputFinalNavigation;
      }
      inputWrap.classList.remove('has-suggestions');
      return;
    }
    const showAsSuggestions = suggestionCycleIdx >= 0 || (suggestionsValid() && getFirstMatch() !== null);
    inputWrap.classList.toggle('has-suggestions', showAsSuggestions);
    if (proposed !== null) {
      const lowerPrefix = prefix.toLowerCase();
      const suffix = proposed.toLowerCase().startsWith(lowerPrefix)
        ? (proposed.length > prefix.length ? proposed.slice(prefix.length) : '')
        : proposed;
      const n = suggestionsValid() && suggestionContext && typeof suggestionContext.matchCount === 'number' ? suggestionContext.matchCount : undefined;
      ghost.textContent = suffix + (n !== undefined && n !== null ? (n === 1 ? ' — ' + strings.entriesSingleEntry : ' — ' + strings.entriesMultipleEntries(n)) : '');
      ghost.style.display = 'inline';
      ghost.style.left = `${8 + measureTextWidth(input, getMeasureEl())}px`;
      return;
    }
    // Only show "no matches" / "N entries" when we have a valid response for current path+prefix.
    if (suggestionContext && path === suggestionContext.path && prefix === suggestionContext.prefix && typeof suggestionContext.matchCount === 'number') {
      const n = suggestionContext.matchCount;
      ghost.textContent = n === 0 ? strings.entriesNoMatches : n === 1 ? strings.entriesSingleEntry : strings.entriesMultipleEntries(n);
      if (n === 0) ghost.classList.add('no-match');
      ghost.style.display = 'inline';
      ghost.style.left = `${8 + measureTextWidth(input, getMeasureEl())}px`;
    }
  }

  function acceptFirstMatch(): boolean {
    const option = getProposedOption();
    if (!option) return false;
    const nextPath = path ? `${path}/${option}` : option;
    navigate(nextPath);
    return true;
  }

  function acceptCurrentInput(): boolean {
    const typed = (input.value ?? '').trim();
    if (!typed) return false;
    if (typed.startsWith('/')) {
      navigate(typed.replace(/^\/+/, ''));
      return true;
    }
    const nextPath = path ? `${path}/${typed}` : typed;
    navigate(nextPath);
    return true;
  }

  function removeLastSegment(): boolean {
    const segments = splitPathSegments(path);
    if (segments.length === 0) return false;
    segments.pop();
    navigate(segments.join('/'));
    return true;
  }

  /** Rotate the proposed option without changing the input; ghost shows current proposal. */
  function cycleSuggestion(): void {
    if (isFullPathInput()) return;
    const prefix = (input.value ?? '').trim();
    if (!suggestions.length) {
      pendingCycle = { path, prefix };
      options.onSuggestRequest(path, prefix);
      return;
    }
    if (suggestionCycleIdx < 0) {
      if (!prefix) {
        suggestionCycleIdx = 0;
      } else {
        const lower = prefix.toLowerCase();
        const firstMatchIdx = suggestions.findIndex((s) => s.toLowerCase().startsWith(lower));
        if (firstMatchIdx >= 0 && suggestions.length > 1) suggestionCycleIdx = (firstMatchIdx + 1) % suggestions.length;
        else if (firstMatchIdx >= 0) suggestionCycleIdx = firstMatchIdx;
        else suggestionCycleIdx = 0;
      }
    } else {
      suggestionCycleIdx = (suggestionCycleIdx + 1) % suggestions.length;
    }
    updateGhost();
  }

  input.addEventListener('input', () => {
    suggestionCycleIdx = -1;
    suggestionContext = null;
    pendingAccept = null;
    pendingCycle = null;
    updateGhost();
    if (suggestDebounce) clearTimeout(suggestDebounce);
    if (isFullPathInput()) return;
    suggestDebounce = setTimeout(() => {
      suggestDebounce = undefined;
      options.onSuggestRequest(path, (input.value ?? '').trim());
    }, debounceMs);
  });

  input.addEventListener('keydown', (e) => {
    // Tab: commit current proposal (cycled option or first match), or queue to run when suggestions arrive
    if (e.key === 'Tab') {
      if (isFullPathInput()) return;
      e.preventDefault();
      const prefix = (input.value ?? '').trim();
      const canAcceptEmpty = prefix === '' && suggestionsValid() && (suggestionCycleIdx >= 0 || suggestions.length === 1);
      if (canAcceptEmpty) {
        acceptFirstMatch();
      } else if (prefix !== '' && suggestionsValid() && getProposedOption() !== null) {
        acceptFirstMatch();
      } else {
        pendingAccept = { path, prefix, requireSingle: prefix === '' };
        options.onSuggestRequest(path, prefix);
      }
      return;
    }
    // Space: same as Tab — commit current proposal or queue
    if (e.key === ' ') {
      if (isFullPathInput()) return;
      e.preventDefault();
      const prefix = (input.value ?? '').trim();
      const canAcceptEmpty = prefix === '' && suggestionsValid() && (suggestionCycleIdx >= 0 || suggestions.length === 1);
      if (canAcceptEmpty) {
        acceptFirstMatch();
      } else if (prefix !== '' && suggestionsValid() && getProposedOption() !== null) {
        acceptFirstMatch();
      } else {
        pendingAccept = { path, prefix, requireSingle: prefix === '' };
        options.onSuggestRequest(path, prefix);
      }
      return;
    }
    // ?: rotate proposal only (ghost updates; input unchanged so all options stay available)
    if (e.key === '?') {
      if (isFullPathInput()) return;
      e.preventDefault();
      pendingCycle = { path, prefix: (input.value ?? '').trim() };
      pendingAccept = null;
      if (suggestionsValid() && suggestions.length > 0) cycleSuggestion();
      else cycleSuggestion();
      return;
    }
    // Enter: always commit typed input as-is; ignore active suggestion/ghost.
    if (e.key === 'Enter') {
      if (acceptCurrentInput()) e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      pendingCycle = null;
      clearSuggestion();
      e.preventDefault();
      return;
    }
    // "/" has no special meaning; user can type it. Leading / on commit = replace current path.
    if (e.key === 'Backspace' && (input.value ?? '').trim() === '') {
      if (removeLastSegment()) e.preventDefault();
    }
  });

  input.addEventListener('focus', () => {
    const prefix = (input.value ?? '').trim();
    if (prefix.startsWith('/')) return;
    options.onSuggestRequest(path, prefix);
  });

  function handleClickOutside(e: MouseEvent): void {
    if (!container.contains(e.target as Node)) clearSuggestion();
  }
  document.addEventListener('mousedown', handleClickOutside);

  copyBtn.addEventListener('click', () => {
    const fullPath = path ? '/' + path : '/';
    if (options.onCopyPath) options.onCopyPath(fullPath);
  });
  copyBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const fullPath = path ? '/' + path : '/';
      if (options.onCopyPath) options.onCopyPath(fullPath);
    }
  });

  renderChips();

  return {
    update(props: NavigationBarUpdate) {
      if (props.path !== undefined) {
        path = (props.path ?? '').trim().replace(/^\/+/, '').replace(/\/+/g, '/');
        pendingCycle = null;
        renderChips();
        if ((input.value ?? '').trim() === '' && !isFullPathInput()) {
          options.onSuggestRequest(path, '');
        }
      }
      if (props.suggestions !== undefined) suggestions = props.suggestions;
      if (props.suggestionContext !== undefined) suggestionContext = props.suggestionContext;
      if (props.placeholder !== undefined) {
        defaultPlaceholder = props.placeholder;
        input.placeholder = props.placeholder;
      }
      suggestionCycleIdx = -1;
      updateGhost();
      if (suggestions.length && input.value !== undefined) {
        const opts = suggestions.join(', ');
        input.title = strings.tooltipPathInput(opts);
      }
      if (pendingCycle && suggestionContext && pendingCycle.path === suggestionContext.path && pendingCycle.prefix === suggestionContext.prefix) {
        const queuedCycle = pendingCycle;
        pendingCycle = null;
        const stillSameRequest = path === queuedCycle.path && (input.value ?? '').trim() === queuedCycle.prefix;
        if (stillSameRequest) cycleSuggestion();
      }
      // Run queued Tab/Space: when suggestions arrived for the same path+prefix, accept and continue
      if (pendingAccept && suggestionContext && pendingAccept.path === suggestionContext.path && pendingAccept.prefix === suggestionContext.prefix) {
        const queued = pendingAccept;
        pendingAccept = null;
        if (queued.requireSingle) {
          const stillSameRequest = path === queued.path && (input.value ?? '').trim() === queued.prefix;
          if (stillSameRequest && suggestions.length === 1) acceptFirstMatch();
        } else if (getProposedOption() != null) {
          acceptFirstMatch();
        }
      }
    },
    getPath() {
      return path;
    },
    focusInput() {
      input.focus();
    },
    destroy() {
      document.removeEventListener('mousedown', handleClickOutside);
      if (suggestDebounce) clearTimeout(suggestDebounce);
      pendingAccept = null;
      pendingCycle = null;
      chipsEl.innerHTML = '';
      input.value = '';
      ghost.textContent = '';
      if (!refs.chips && chipsEl.parentNode) chipsEl.remove();
      if (!refs.inputWrap && inputWrap.parentNode) inputWrap.remove();
      if (!refs.copyBtn && copyBtn.parentNode) copyBtn.remove();
    },
  };
}
