import { escapeHtml } from '../ui.ts';

// The item menu (inventory refactor, step 5): every action for one stack or
// worn piece, opened by right-click, a long touch, or M on the chosen cell.
// Split asks how many with a small number box, the way Baldur's Gate 3 does.

/** One line of the menu. */
export interface MenuEntry {
  label: string;
  run(): void;
}

/** A Split line: how many the stack holds, and what to do with the number chosen. */
export interface MenuSplit {
  qty: number;
  run(qty: number): void;
}

/** The menu's HTML: the entries, then the Split box when the stack can split. */
export function itemMenuHtml(title: string, entries: MenuEntry[], split?: MenuSplit): string {
  const half = split ? Math.max(1, Math.floor(split.qty / 2)) : 0;
  return `<p class="menu-title">${escapeHtml(title)}</p>
    ${entries.map((e, i) => `<button type="button" role="menuitem" data-entry="${i}">${escapeHtml(e.label)}</button>`).join('')}
    ${split ? `<form class="split" data-split><label>Split off <input type="number" name="qty" min="1" max="${split.qty - 1}" value="${half}"></label>
      <button type="submit" role="menuitem">Split</button></form>` : ''}`;
}

/** One menu for the whole page; it closes on a choice, a click elsewhere, or Esc. */
export class ItemMenu {
  private readonly el: HTMLElement;
  private entries: MenuEntry[] = [];
  private split: MenuSplit | undefined;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'item-menu';
    this.el.setAttribute('role', 'menu');
    this.el.hidden = true;
    document.body.append(this.el);
    this.el.addEventListener('click', (e) => {
      const i = (e.target as HTMLElement).closest<HTMLElement>('[data-entry]')?.dataset.entry;
      if (i === undefined) return;
      const entry = this.entries[Number(i)];
      this.close();
      entry?.run();
    });
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      const qty = Number((this.el.querySelector('input[name="qty"]') as HTMLInputElement | null)?.value);
      const split = this.split;
      this.close();
      if (split && Number.isInteger(qty)) split.run(qty);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target as Node)) this.close();
    }, true);
    window.addEventListener('keydown', (e) => {
      if (this.el.hidden) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      } else if (!(e.target instanceof HTMLInputElement)) {
        // The game's keys wait while the menu is open; arrows move between its lines.
        e.stopPropagation();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') this.step(e.key === 'ArrowDown' ? 1 : -1, e);
      } else e.stopPropagation();
    }, true);
  }

  /** Whether the menu is showing. */
  get open(): boolean {
    return !this.el.hidden;
  }

  /** Opens beside `at` (a cell's box). With `splitFirst`, the Split box takes the focus (the S key). */
  show(at: DOMRect, title: string, entries: MenuEntry[], split?: MenuSplit, splitFirst = false): void {
    this.entries = entries;
    this.split = split;
    this.el.innerHTML = itemMenuHtml(title, entries, split);
    this.el.hidden = false;
    const w = this.el.offsetWidth, h = this.el.offsetHeight, gap = 4;
    this.el.style.left = `${Math.min(at.right + gap, window.innerWidth - w - gap)}px`;
    this.el.style.top = `${Math.max(gap, Math.min(at.top, window.innerHeight - h - gap))}px`;
    const first = splitFirst ? this.el.querySelector<HTMLInputElement>('input') : this.el.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
  }

  /** Hides the menu. */
  close(): void {
    this.el.hidden = true;
    this.entries = [];
    this.split = undefined;
  }

  private step(by: number, e: KeyboardEvent): void {
    e.preventDefault();
    const items = [...this.el.querySelectorAll<HTMLElement>('[role="menuitem"], input')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + by + items.length) % items.length]?.focus();
  }
}
