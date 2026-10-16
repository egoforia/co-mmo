import { ITEMS, type LootActionMessage, type LootView } from '@co-mmo/shared';
import { escapeHtml } from './ui.ts';
import { artSrc } from './wished.ts';

const $ = (id: string) => document.getElementById(id)!;

export interface LootActions {
  send(m: LootActionMessage): void;
  /** True while typing in chat, so keys go to the chat box. */
  typing(): boolean;
}

/**
 * The loot window of a fallen creature, laid out like the bag. The arrow keys
 * (or WASD) choose, Enter or Space takes the chosen thing, T takes everything
 * and Esc or E closes it; what is left stays on the body for anyone to take.
 * The server says what is on it, and shows the change when someone else takes.
 */
export class LootUi {
  private view: LootView | null = null;
  private selected = 0;

  constructor(private readonly actions: LootActions) {
    // Capturing first, so the keys it uses neither walk the player nor reach other windows.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    $('loot').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const index = target.closest<HTMLElement>('[data-index]')?.dataset.index;
      if (index !== undefined) this.take(Number(index));
      else if (target.closest('[data-all]')) this.takeAll();
      else if (target.closest('[data-close]')) this.close();
    });
  }

  /** Whether the window is open. */
  get open(): boolean {
    return this.view !== null;
  }

  /** Opens or refreshes the window with what the body holds now; null closes it. */
  show(view: LootView | null): void {
    const same = view && this.view?.id === view.id;
    this.view = view;
    if (!view) {
      $('loot').hidden = true;
      return;
    }
    if (!same) this.selected = 0;
    this.selected = Math.min(this.selected, view.items.length - 1);
    this.render();
    $('loot').hidden = false;
  }

  /** Closes the window; what is left stays on the body. */
  close(): void {
    if (this.view) this.actions.send({ t: 'loot', action: 'close', body: this.view.id });
    this.show(null);
  }

  private take(index: number): void {
    const slot = this.view?.items[index];
    if (!this.view || !slot) return;
    this.selected = index;
    this.actions.send({ t: 'loot', action: 'take', body: this.view.id, index, item: slot.item });
  }

  private takeAll(): void {
    if (this.view) this.actions.send({ t: 'loot', action: 'all', body: this.view.id });
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.view || this.actions.typing() || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const moves: Record<string, 'left' | 'right' | 'up' | 'down'> = {
      arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
    };
    if (moves[key]) this.move(moves[key]!);
    else if (key === 'enter' || key === ' ') this.take(this.selected);
    else if (key === 't') this.takeAll();
    else if (key === 'escape' || key === 'e') this.close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  /** Moves the choice through the grid, row by row as the window lays it out. */
  private move(to: 'left' | 'right' | 'up' | 'down'): void {
    const count = this.view?.items.length ?? 0;
    if (!count) return;
    const slots = [...$('loot').querySelectorAll<HTMLElement>('[data-index]')];
    const top = slots[0]?.offsetTop;
    const columns = Math.max(1, slots.filter((s) => s.offsetTop === top).length);
    const step = to === 'left' ? -1 : to === 'right' ? 1 : to === 'up' ? -columns : columns;
    const next = this.selected + step;
    if (next < 0 || next >= count) return;
    this.selected = next;
    this.render();
  }

  private render(): void {
    const view = this.view!;
    const slots = view.items.map((s, i) => {
      const def = ITEMS[s.item];
      const name = def?.name ?? s.item;
      return `<button type="button" class="slot${i === this.selected ? ' chosen' : ''}" data-index="${i}" title="${escapeHtml(def ? `${def.name}: ${def.description}` : name)}">
        <img src="${escapeHtml(artSrc(def?.art ?? 'item-goat-horn', true))}" alt="">
        ${s.qty > 1 ? `<span class="qty">${s.qty}</span>` : ''}
        <span class="name rarity-${def?.rarity ?? 'common'}">${escapeHtml(name)}</span><span class="hint">${i === this.selected ? 'Enter to take' : 'Click to take'}</span></button>`;
    }).join('');
    $('loot').innerHTML = `
      <h2><span><img class="from" src="${escapeHtml(artSrc(view.asset))}" alt="">${escapeHtml(view.name)}</span>
        <button type="button" class="close" data-close aria-label="Close">×</button></h2>
      <div class="slots">${slots}</div>
      <div class="buttons"><button type="button" data-all>Take everything</button><button type="button" class="quiet" data-close>Leave the rest</button></div>
      <p class="note"><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> take · <kbd>T</kbd> take everything · <kbd>Esc</kbd> close.
        What you leave stays on the body for anyone to take.</p>`;
    $('loot').querySelector<HTMLElement>('.chosen')?.scrollIntoView({ block: 'nearest' });
  }
}
