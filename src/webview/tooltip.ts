/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  Custom tooltips: show after a short delay (quicker than native title) and more reliably.
  Listens for mouseover on elements with title and shows a floating tooltip after TOOLTIP_DELAY_MS.
*/

const TOOLTIP_DELAY_MS = 250;
const DATA_TITLE_BACKUP = 'data-title-backup';

function findElementWithTitle(el: HTMLElement | null): { el: HTMLElement; title: string } | null {
  let current: HTMLElement | null = el;
  while (current) {
    const t = current.getAttribute?.('title');
    if (t != null && t.trim() !== '') return { el: current, title: t.trim() };
    current = current.parentElement;
  }
  return null;
}

export function initTooltips(): void {
  let tooltipEl: HTMLDivElement | null = null;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let currentTarget: HTMLElement | null = null;

  function getTooltipEl(): HTMLDivElement {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'custom-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function hide(): void {
    if (showTimer != null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (tooltipEl) tooltipEl.style.display = 'none';
    if (currentTarget) {
      const backup = currentTarget.getAttribute(DATA_TITLE_BACKUP);
      if (backup !== null) {
        currentTarget.setAttribute('title', backup);
        currentTarget.removeAttribute(DATA_TITLE_BACKUP);
      }
      currentTarget = null;
    }
  }

  function show(text: string, anchor: HTMLElement): void {
    const el = getTooltipEl();
    el.textContent = text;
    el.style.whiteSpace = 'pre-wrap';
    el.style.maxWidth = 'min(320px, 90vw)';
    const rect = anchor.getBoundingClientRect();
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.bottom + 8}px`;
    el.style.display = 'block';
    const padding = 8;
    requestAnimationFrame(() => {
      const elRect = el.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - elRect.width / 2;
      let top = rect.bottom + padding;
      if (left < padding) left = padding;
      if (left + elRect.width > window.innerWidth - padding) left = window.innerWidth - elRect.width - padding;
      if (top + elRect.height > window.innerHeight - padding) top = rect.top - elRect.height - padding;
      if (top < padding) top = padding;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    });
  }

  document.body.addEventListener(
    'mouseover',
    (ev: MouseEvent) => {
      const target = ev.target as HTMLElement;
      const found = findElementWithTitle(target);
      if (!found) {
        hide();
        return;
      }
      if (found.el === currentTarget) return;
      hide();
      currentTarget = found.el;
      found.el.setAttribute(DATA_TITLE_BACKUP, found.title);
      found.el.removeAttribute('title');
      showTimer = setTimeout(() => {
        showTimer = null;
        show(found.title, found.el);
      }, TOOLTIP_DELAY_MS);
    },
    true,
  );

  document.body.addEventListener(
    'mouseout',
    (ev: MouseEvent) => {
      const related = ev.relatedTarget as Node | null;
      if (currentTarget && (!related || !currentTarget.contains(related))) hide();
    },
    true,
  );
}
