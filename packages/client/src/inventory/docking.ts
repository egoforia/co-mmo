// Docked windows (inventory refactor, step 8), after Albion Online: when a
// loot, shop or trade window opens, the bag opens beside it, so you watch
// your bag fill as you take, and Shift-click (or T) moves a thing across.
// It watches the windows' `hidden` attribute, so the loot, shop and trade
// code needs no hooks; the bag closes again if docking opened it.

/** The windows that dock beside the bag. */
export const DOCKING = ['loot', 'shop', 'trade', 'stash'] as const;

/** Narrower than this, two windows don't fit side by side: nothing docks. */
export const DOCK_MIN_WIDTH = 900;

/** What docking needs from the bag. */
export interface DockActions {
  /** True while the bag is open. */
  bagOpen(): boolean;
  /** Opens or closes the bag. */
  setBag(open: boolean): void;
}

/** The window that docks first: the one opened last wins when several are open. */
export function partnerOf(open: readonly string[]): string | undefined {
  return open.at(-1);
}

/** Keeps the bag beside an open loot, shop or trade window. */
export class Docking {
  private opened: string[] = [];
  /** True when docking opened the bag, so it closes it again. */
  private openedBag = false;

  constructor(private readonly actions: DockActions, private readonly doc: Document = document) {
    const watch = new MutationObserver(() => this.update());
    for (const id of DOCKING) {
      const el = doc.getElementById(id);
      if (el) watch.observe(el, { attributes: true, attributeFilter: ['hidden'] });
    }
  }

  /** The window the bag sits beside now, if any. */
  get partner(): string | undefined {
    return this.doc.body.dataset.dock;
  }

  private update(): void {
    const open = DOCKING.filter((id) => this.doc.getElementById(id)?.hidden === false);
    // Keep the order windows opened in.
    this.opened = [...this.opened.filter((id) => open.includes(id as never)), ...open.filter((id) => !this.opened.includes(id))];
    const partner = partnerOf(this.opened);
    const wide = (this.doc.defaultView?.innerWidth ?? 0) >= DOCK_MIN_WIDTH;
    if (partner && wide) {
      this.doc.body.dataset.dock = partner;
      if (!this.actions.bagOpen()) {
        this.openedBag = true;
        this.actions.setBag(true);
      }
    } else {
      delete this.doc.body.dataset.dock;
      if (this.openedBag && !partner) this.actions.setBag(false);
      if (!partner) this.openedBag = false;
    }
  }
}
