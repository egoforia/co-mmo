import { type Character, type OwnerEntry } from '@co-mmo/shared';
import { carriedHtml, slotCount, wornHtml } from './inventory/bag-html.ts';
import { GearHistories } from './inventory/history.ts';
import { sheetHtml } from './inventory/sheet-html.ts';

// The bag window (I): worn gear, carried things and the character sheet. A
// thin facade over inventory/*: the HTML parts, owner histories and the grid
// keys shared with the loot window.

/** The bag window's contents, built from the character as the server last sent it. */
export class InventoryWindow {
  private readonly histories = new GearHistories();

  /** `askHistory` asks the server who owned pieces of gear before. */
  constructor(private readonly askHistory?: (items: string[]) => void) {}

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
    return `
      <h2>Your bag <button type="button" class="close" data-close aria-label="Close">×</button></h2>
      <h3>Worn</h3>
      <div class="slots gear">${wornHtml(c)}</div>
      <h3>Carried <small>${slotCount(c)}</small></h3>
      <div class="slots">${carriedHtml(c)}</div>
      ${sheetHtml(c)}`;
  }
}
