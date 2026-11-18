import { goldOf, type Character, type OwnerEntry, type RaceId } from '@co-mmo/shared';
import { bagGridHtml, slotCount } from './inventory/bag-html.ts';
import { dollHtml } from './inventory/doll.ts';
import { GearHistories } from './inventory/history.ts';
import { sheetHtml } from './inventory/sheet-html.ts';
import { escapeHtml } from './ui.ts';

// The Character window (I): a Bag tab (the paper doll and all 20 cells) and
// a Sheet tab (stats, Path, Creator level). A thin facade over inventory/*:
// the HTML parts, owner histories, the item card and the grid keys shared
// with the loot window. docs: the inventory refactor plan, step 3.

/** The window's two tabs. */
export type InventoryTab = 'bag' | 'sheet';

/** The Character window's contents, built from the character as the server last sent it. */
export class InventoryWindow {
  private readonly histories = new GearHistories();
  /** The tab showing; the Bag tab when the window first opens. */
  tab: InventoryTab = 'bag';

  /**
   * `askHistory` asks the server who owned pieces of gear before; `figure`
   * gives the URL of the player's standing picture for the doll.
   */
  constructor(private readonly askHistory?: (items: string[]) => void, private readonly figure: (race?: RaceId) => string = () => 'art/player-mara.png') {}

  /** Keeps owner histories the server sent; the caller redraws. */
  setHistories(histories: Record<string, OwnerEntry[]>): void {
    this.histories.set(histories);
  }

  /** A piece's owners in words for its item card, or ''. */
  historyWords(id: string): string {
    return this.histories.words(id);
  }

  /** The window's HTML; asks about gear whose history is not known yet. */
  html(c: Character): string {
    this.histories.askFor(c, this.askHistory);
    const tab = (id: InventoryTab, name: string) =>
      `<button type="button" role="tab" data-tab="${id}" aria-selected="${this.tab === id}"${this.tab === id ? ' class="on"' : ''}>${name}</button>`;
    const body = this.tab === 'sheet'
      ? sheetHtml(c)
      : `<div class="bag-tools"><button type="button" data-bag-action="sort">Sort</button></div>
        <div class="bag-body">${dollHtml(c, this.figure(c.race))}${bagGridHtml(c)}</div>
        <p class="keys"><kbd>Click</kbd> use or wear · <kbd>Drag</kbd> move, wear, take off, or out to drop · <kbd>Right-click</kbd>, hold or <kbd>M</kbd> more · <kbd>S</kbd> split · <kbd>Delete</kbd> drop · arrows choose</p>`;
    return `
      <h2>Your bag <small>${goldOf(c)} gold · ${escapeHtml(slotCount(c))}</small> <button type="button" class="close" data-close aria-label="Close">×</button></h2>
      <div class="tabs" role="tablist">${tab('bag', 'Bag')}${tab('sheet', 'Sheet')}</div>
      ${body}`;
  }
}
