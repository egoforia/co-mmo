import { GOLD, ITEMS, SLOT_NAMES, type BagMessage, type Character, type EquipSlot } from '@co-mmo/shared';
import { useWord } from './bag-html.ts';
import { BagDrag, type DragEnd } from './drag.ts';
import { gridStep, type GridMove } from './grid.ts';
import { ItemMenu, type MenuEntry, type MenuSplit } from './item-menu.ts';

// How a player handles things in the bag (inventory refactor, step 5): drag
// and drop, the item menu (right-click, a long touch, or M), and keys: the
// arrows choose a cell, Enter uses it, M opens its menu, S splits it and
// Delete drops it on the ground.
// The server decides every change; this only asks.

/** What the bag's handling needs from the game. */
export interface BagInputActions {
  character(): Character;
  /** Uses, drinks, wears or reads a carried thing (the Bible opens its window). */
  use(item: string): void;
  unequip(slot: EquipSlot): void;
  bag(m: BagMessage): void;
  /** True while typing in chat, so letters are not shortcuts. */
  typing(): boolean;
}

/** Arrow keys as grid moves; the bag leaves WASD to walking, and S to splitting. */
const ARROWS: Record<string, GridMove> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

/** True when a piece fits a worn slot: its own slot. */
function fits(item: string, slot: EquipSlot): boolean {
  return ITEMS[item]?.slot === slot;
}

/** Drag and drop, the item menu and keys for the bag window `root`. */
export class BagInput {
  private readonly menu = new ItemMenu();

  constructor(private readonly root: HTMLElement, private readonly actions: BagInputActions) {
    new BagDrag(root, {
      accepts: (from, to) => this.accepts(from, to),
      drop: (from, to) => this.drop(from, to),
      dropOut: (index) => this.dropStack(index),
      longPress: (el) => this.openMenu(el),
    });
    root.addEventListener('contextmenu', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('button.cell');
      if (!el) return;
      e.preventDefault();
      this.openMenu(el);
    });
    // Capturing first, so the keys the bag uses don't also walk the player.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  /**
   * Redraws the window with `render`, keeping the keyboard on the same cell
   * or worn slot, since a redraw replaces every element.
   */
  keepFocus(render: () => void): void {
    const active = document.activeElement as HTMLElement | null;
    const cell = active && this.root.contains(active) ? active.closest<HTMLElement>('.cell') : null;
    const slot = cell?.dataset.slot ?? cell?.dataset.emptySlot;
    const at = cell ? [...this.root.querySelectorAll('.bag-grid > .cell')].indexOf(cell) : -1;
    render();
    if (!cell) return;
    const again = slot
      ? this.root.querySelector<HTMLElement>(`[data-slot="${slot}"], [data-empty-slot="${slot}"]`)
      : this.root.querySelectorAll<HTMLElement>('.bag-grid > .cell')[at];
    again?.focus();
  }

  /** Whether a drag from `from` may end on `to`. */
  private accepts(from: DragEnd, to: DragEnd): boolean {
    const c = this.actions.character();
    if ('index' in from) {
      if ('index' in to) return to.index !== from.index;
      const item = c.inventory[from.index]?.item;
      return !!item && fits(item, to.slot);
    }
    return 'index' in to;
  }

  private drop(from: DragEnd, to: DragEnd): void {
    if (!this.accepts(from, to)) return;
    const c = this.actions.character();
    if ('index' in from && 'index' in to) this.actions.bag({ t: 'bag', action: 'move', from: from.index, to: to.index });
    else if ('index' in from) this.actions.use(c.inventory[from.index]!.item);
    else this.actions.unequip(from.slot);
  }

  /** Opens the item menu for a cell or worn slot; `splitFirst` puts the focus on Split. */
  private openMenu(el: HTMLElement, splitFirst = false): void {
    const c = this.actions.character();
    const slot = el.dataset.slot as EquipSlot | undefined;
    if (slot) {
      const worn = c.equipment[slot];
      if (!worn) return;
      this.menu.show(el.getBoundingClientRect(), ITEMS[worn]?.name ?? SLOT_NAMES[slot], [{ label: 'Take off', run: () => this.actions.unequip(slot) }]);
      return;
    }
    const index = Number(el.dataset.index);
    const stack = c.inventory[index];
    if (!stack) return;
    const entries: MenuEntry[] = [];
    const use = useWord(stack.item);
    if (use) entries.push({ label: use, run: () => this.actions.use(stack.item) });
    if (!ITEMS[stack.item]?.bound) entries.push({ label: stack.qty > 1 ? `Drop all ${stack.qty}` : 'Drop', run: () => this.dropStack(index) });
    entries.push({ label: 'Sort the bag', run: () => this.actions.bag({ t: 'bag', action: 'sort' }) });
    const split: MenuSplit | undefined = stack.qty > 1 && stack.item !== GOLD
      ? { qty: stack.qty, run: (qty) => this.actions.bag({ t: 'bag', action: 'split', from: index, qty }) }
      : undefined;
    this.menu.show(el.getBoundingClientRect(), ITEMS[stack.item]?.name ?? stack.item, entries, split, splitFirst && !!split);
  }

  /** Drops the whole stack in a cell at the player's feet, as a pile anyone may take for ten minutes. */
  private dropStack(index: number): void {
    const stack = this.actions.character().inventory[index];
    if (stack) this.actions.bag({ t: 'bag', action: 'drop', from: index });
  }

  private onKey(e: KeyboardEvent): void {
    if (this.root.hidden || this.menu.open || this.actions.typing() || e.ctrlKey || e.metaKey || e.altKey) return;
    const cells = [...this.root.querySelectorAll<HTMLElement>('.bag-grid > .cell')];
    const chosen = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.cell');
    const inBag = !!chosen && this.root.contains(chosen);
    const move = ARROWS[e.key];
    if (move && cells.length) {
      e.preventDefault();
      e.stopPropagation();
      const at = inBag ? cells.indexOf(chosen) : -1;
      const next = at < 0 ? 0 : gridStep(cells.map((x) => x.offsetTop), at, move);
      cells[next]?.focus();
      return;
    }
    if (!inBag || chosen.tagName !== 'BUTTON') return;
    const key = e.key.toLowerCase();
    if (key === 'delete' && chosen.dataset.index !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      this.dropStack(Number(chosen.dataset.index));
    } else if (key === 'm' || key === 's') {
      e.preventDefault();
      e.stopPropagation();
      this.openMenu(chosen, key === 's');
    }
  }
}
