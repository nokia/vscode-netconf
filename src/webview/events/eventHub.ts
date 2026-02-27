/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  Central registration for document-level and grid-level UI events.
  All keyboard, paste, context menu, and selection events are registered here and
  dispatched to the provided handlers. This keeps event logic in one place and
  makes it easy to update or add features.
*/

export interface EventHubHandlers {
  /** Document keydown: undo/redo, Delete/Backspace, Tab, Arrows, Enter, type-to-edit, Cmd+A, Cmd+C. */
  onKeyDown: (e: KeyboardEvent) => void;
  /** Document paste: table paste or dict cell paste. */
  onPaste: (e: ClipboardEvent) => void;
  /** Document click: e.g. hide context menu. */
  onClick?: () => void;
  /** Document contextmenu: show cell menu. */
  onContextMenu?: (e: MouseEvent) => void;
  /** Document selectstart: prevent text selection in grid/dict when not in input. */
  onSelectStart?: (e: Event) => void;
}

const noop = () => {};

/**
 * Register document-level event listeners and delegate to the given handlers.
 * Returns a teardown function to remove all listeners.
 */
export function setupEventHub(handlers: EventHubHandlers): () => void {
  const onKeyDown = handlers.onKeyDown ?? noop;
  const onPaste = handlers.onPaste ?? noop;
  const onClick = handlers.onClick ?? noop;
  const onContextMenu = handlers.onContextMenu ?? noop;
  const onSelectStart = handlers.onSelectStart ?? noop;

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('paste', onPaste);
  document.addEventListener('click', onClick);
  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('selectstart', onSelectStart);

  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('paste', onPaste);
    document.removeEventListener('click', onClick);
    document.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('selectstart', onSelectStart);
  };
}
