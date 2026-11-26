import { ITEMS, STASH_CHEST, STASH_REACH, type Landmark, type StashMessage, type StashViewMessage } from '@co-mmo/shared';
import { escapeHtml } from './ui.ts';
import { artSrc, itemIcon } from './wished.ts';

// The shared stash window (docs/stash.md): what every character on the
// account keeps in the stash chest, laid out like the loot window and docked
// beside the bag. Click a stash stack to take it; Shift-click (or T) a bag
// stack to put it in. The server says what the stash holds after each change.

const $ = (id: string) => document.getElementById(id)!;

export interface StashActions {
  send(m: StashMessage): void;
}

/** The stash window. */
export class StashUi {
  private view: StashViewMessage | null = null;

  constructor(private readonly actions: StashActions) {
    window.addEventListener('keydown', (e) => {
      if (this.view && (e.key === 'Escape') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.close();
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    $('stash').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const index = target.closest<HTMLElement>('[data-index]')?.dataset.index;
      if (index !== undefined) this.actions.send({ t: 'stash', action: 'out', index: Number(index) });
      else if (target.closest('[data-close]')) this.close();
    });
  }

  /** Whether the window is open. */
  get open(): boolean {
    return this.view !== null;
  }

  /** Asks the server to open the stash; it answers with what it holds. */
  ask(): void {
    this.actions.send({ t: 'stash', action: 'open' });
  }

  /** Shows the stash as the server says it is; closed when `open` is false. */
  show(view: StashViewMessage): void {
    if (!view.open) return this.close();
    this.view = view;
    this.render();
    $('stash').hidden = false;
  }

  /** Puts the bag stack in cell `index` in the stash; false while the stash is closed. */
  fromBag(index: number | undefined): boolean {
    if (!this.view || index === undefined) return false;
    this.actions.send({ t: 'stash', action: 'in', index });
    return true;
  }

  /** Closes the window when the player walks away from every stash chest. */
  follow(landmarks: readonly Landmark[], x: number, y: number, floor: number): void {
    if (this.view && !nearChest(landmarks, x, y, floor)) this.close();
  }

  /** Closes the window. */
  close(): void {
    if (!this.view) return;
    this.view = null;
    $('stash').hidden = true;
    this.actions.send({ t: 'stash', action: 'close' });
  }

  private render(): void {
    const view = this.view!;
    const slots = view.slots.map((s, i) => {
      const def = ITEMS[s.item];
      return `<button type="button" class="slot" data-index="${i}"${def ? ` data-card="${escapeHtml(s.item)}" data-card-qty="${s.qty}"` : ''}>
        <img src="${escapeHtml(def ? itemIcon(def) : artSrc('item-goat-horn', true))}" alt="">
        ${s.qty > 1 ? `<span class="qty">${s.qty}</span>` : ''}
        <span class="name rarity-${def?.rarity ?? 'common'}">${escapeHtml(def?.name ?? s.item)}</span><span class="hint">Click to take</span></button>`;
    }).join('');
    $('stash').innerHTML = `
      <h2><span>Shared stash</span><small>${view.slots.length} of ${view.size} slots</small>
        <button type="button" class="close" data-close aria-label="Close">×</button></h2>
      ${slots ? `<div class="slots">${slots}</div>` : '<p>The stash is empty.</p>'}
      <p class="note">Every character on your account opens this same stash. Shift-click a thing in your bag (or choose it and press <kbd>T</kbd>) to put it in; click a thing here to take it. <kbd>Esc</kbd> closes.</p>`;
  }
}

/** True when a stash chest stands within reach (the server checks again). */
export function nearChest(landmarks: readonly Landmark[], x: number, y: number, floor: number): boolean {
  return landmarks.some((l) => l.asset === STASH_CHEST && (l.floor ?? 0) === floor && Math.hypot(x - l.x, y - (l.y - l.footprint.height / 2)) <= STASH_REACH + 0.5);
}
