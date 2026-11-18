import type { EquipSlot } from '@co-mmo/shared';

// Dragging in the bag (inventory refactor, step 5), with pointer events so a
// mouse, a pen and a finger all work: drag a stack to another cell (move,
// merge or swap), onto a worn slot (wear), or a worn piece onto the grid
// (take off). A touch held still opens the item menu instead. The window is
// redrawn whenever the character changes, so everything listens on the
// window's root, which stays.

/** One end of a drag: a bag cell by its place, or a worn slot. */
export type DragEnd = { index: number } | { slot: EquipSlot };

/** How far the pointer must move before a press becomes a drag, in pixels. */
const DRAG_START = 6;
/** How long a touch held still opens the item menu, in ms. */
const LONG_PRESS_MS = 500;

/** The drag end an element stands for: a cell in the grid, or a doll slot (worn or empty). */
export function dragEnd(el: Element | null): DragEnd | undefined {
  const cell = el?.closest<HTMLElement>('.bag-grid > .cell');
  if (cell) return { index: [...cell.parentElement!.children].indexOf(cell) };
  const doll = el?.closest<HTMLElement>('.doll-slot');
  const slot = doll?.dataset.slot ?? doll?.dataset.emptySlot;
  return slot ? { slot: slot as EquipSlot } : undefined;
}

/** What the bag does when a drag ends, or a touch is held. */
export interface DragActions {
  /** A drag from `from` let go over `to`. */
  drop(from: DragEnd, to: DragEnd): void;
  /** True when `from` may be let go over `to`, to light the cell up. */
  accepts(from: DragEnd, to: DragEnd): boolean;
  /** A touch held still on a cell or worn slot. */
  longPress(el: HTMLElement): void;
}

/** Drag and drop and long-press inside one window. */
export class BagDrag {
  private press: { el: HTMLElement; from: DragEnd; x: number; y: number; id: number } | null = null;
  private ghost: HTMLElement | null = null;
  private lit: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Clicks before this time (performance.now) came from a drag or long press, and are dropped. */
  private swallowUntil = 0;

  constructor(private readonly root: HTMLElement, private readonly actions: DragActions) {
    root.addEventListener('pointerdown', (e) => this.down(e));
    // The browser's own drag of a picture would take the pointer away (pointercancel).
    root.addEventListener('dragstart', (e) => e.preventDefault());
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', () => this.reset());
    // A drag or a long press is not also a click.
    root.addEventListener('click', (e) => {
      if (performance.now() < this.swallowUntil) {
        this.swallowUntil = 0;
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    }, true);
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('button.cell');
    const from = el ? dragEnd(el) : undefined;
    if (!el || !from) return;
    this.press = { el, from, x: e.clientX, y: e.clientY, id: e.pointerId };
    if (e.pointerType !== 'mouse') {
      this.timer = setTimeout(() => {
        const held = this.press?.el;
        if (!held || this.ghost) return;
        // Until the finger lifts, and the click after it.
        this.swallowUntil = Infinity;
        this.reset();
        this.actions.longPress(held);
      }, LONG_PRESS_MS);
    }
  }

  private move(e: PointerEvent): void {
    const p = this.press;
    if (!p || e.pointerId !== p.id) return;
    if (!this.ghost) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_START) return;
      clearTimeout(this.timer);
      const img = p.el.querySelector('img');
      this.ghost = document.createElement('div');
      this.ghost.className = 'drag-ghost';
      if (img) this.ghost.append(img.cloneNode());
      document.body.append(this.ghost);
      p.el.classList.add('dragging');
    }
    e.preventDefault();
    this.ghost.style.left = `${e.clientX}px`;
    this.ghost.style.top = `${e.clientY}px`;
    const over = this.target(e);
    if (over !== this.lit) {
      this.lit?.classList.remove('drop-here');
      this.lit = over;
      over?.classList.add('drop-here');
    }
  }

  private up(e: PointerEvent): void {
    if (this.swallowUntil === Infinity) this.swallowUntil = performance.now() + 300;
    const p = this.press;
    if (!p || e.pointerId !== p.id) return;
    if (this.ghost) {
      const over = this.target(e);
      const to = over ? dragEnd(over) : undefined;
      this.swallowUntil = performance.now() + 300;
      if (to) this.actions.drop(p.from, to);
    }
    this.reset();
  }

  /** The cell or doll slot under the pointer that would take the drop, if any. */
  private target(e: PointerEvent): HTMLElement | null {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.bag-grid > .cell, .doll-slot') ?? null;
    const to = el && this.root.contains(el) ? dragEnd(el) : undefined;
    return to && this.press && this.actions.accepts(this.press.from, to) ? el : null;
  }

  private reset(): void {
    clearTimeout(this.timer);
    this.press?.el.classList.remove('dragging');
    this.lit?.classList.remove('drop-here');
    this.ghost?.remove();
    this.press = null;
    this.ghost = null;
    this.lit = null;
  }
}
