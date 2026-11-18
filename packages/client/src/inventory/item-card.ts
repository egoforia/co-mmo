import {
  DEATH_DROP_CHANCE,
  EQUIP_SLOTS,
  GOLD,
  ITEMS,
  SLOT_NAMES,
  bonusText,
  changeWords,
  compareGear,
  copyWords,
  familyText,
  materialWords,
  regionDef,
  styleWords,
  toolWords,
  type Character,
} from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import { itemIcon } from '../wished.ts';

// The item card (inventory refactor, step 2): what a thing is, what it adds,
// and what wearing it would change against what is worn, shown beside any
// element that names an item with data-card. Built in the page, not the
// browser's title tooltip, so it shows at once, in colour, and on focus.

/** A piece's owner history in words, or ''. */
export type HistoryWords = (id: string) => string;

/** A region's name for a style's line. */
function regionName(id: string): string {
  return regionDef(id)?.name ?? id;
}

/** What kind of thing an item is, in a few words. */
function kindWords(item: string): string {
  const def = ITEMS[item]!;
  if (item === GOLD) return 'Coins';
  if (def.slot) return [SLOT_NAMES[def.slot], familyText(def)].filter(Boolean).join(' · ');
  if (def.kind === 'book') return 'Book';
  if (def.heal) return 'Drink';
  if (def.teaches) return 'Scroll';
  if (def.material) return 'Material';
  return 'Goods';
}

/**
 * The card's HTML for `item`. `worn` marks a piece the character wears now:
 * it shows its drop chance instead of a comparison. `qty` is the stack size,
 * `hint` what a click on it does.
 */
export function itemCardHtml(c: Pick<Character, 'equipment'>, item: string, opts: { worn?: boolean; qty?: number; hint?: string; history?: HistoryWords } = {}): string {
  const def = ITEMS[item];
  if (!def) return '';
  const lines = [
    def.material ? materialWords(def) : '',
    def.style ? styleWords(def, regionName) : '',
    def.tool ? toolWords(def) : '',
    copyWords(def),
    opts.history?.(item).trim() ?? '',
  ].filter(Boolean);
  const changes = def.slot && !opts.worn ? compareGear(c, item) : [];
  const compare = def.slot && !opts.worn
    ? `<div class="compare"><span class="label">If you wear it</span>${changes.length
      ? changes.map((ch) => `<span class="${ch.delta > 0 ? 'gain' : 'loss'}">${escapeHtml(changeWords(ch))}</span>`).join('')
      : '<span>No change</span>'}</div>`
    : '';
  const hint = opts.worn ? 'Click to take it off.' : opts.hint;
  const risk = opts.worn ? `<p class="risk">If you fall: ${Math.round(DEATH_DROP_CHANCE * 100)}% chance it drops.</p>` : '';
  return `<div class="card-head"><img src="${escapeHtml(itemIcon(def))}" alt=""><div>
      <b class="rarity-${def.rarity ?? 'common'}">${escapeHtml(def.name)}${opts.qty && opts.qty > 1 ? ` × ${opts.qty}` : ''}</b>
      <span class="kind">${escapeHtml(kindWords(item))}${def.rarity && def.rarity !== 'common' ? ` · ${def.rarity}` : ''}</span></div></div>
    ${def.bonus && bonusText(def.bonus) ? `<p class="bonus">${escapeHtml(bonusText(def.bonus))}</p>` : ''}
    <p>${escapeHtml(def.description)}</p>
    ${compare}
    ${lines.map((l) => `<p class="more">${escapeHtml(l)}</p>`).join('')}
    ${hint ? `<p class="hint">${escapeHtml(hint)}</p>` : ''}
    ${risk}`;
}

/** True when `item` is worn by the character in any slot. */
function isWorn(c: Pick<Character, 'equipment'>, item: string): boolean {
  return EQUIP_SLOTS.some((s) => c.equipment[s] === item);
}

/**
 * Shows the card beside whatever the pointer or keyboard focus is on, when
 * it (or a parent) has data-card="<item id>"; data-card-worn marks worn
 * pieces and data-card-qty a stack's size. One card serves every window.
 */
export class ItemCard {
  private readonly el: HTMLElement;
  private showing: HTMLElement | null = null;

  constructor(private readonly character: () => Character, private readonly history: HistoryWords = () => '') {
    this.el = document.createElement('div');
    this.el.id = 'item-card';
    this.el.hidden = true;
    this.el.setAttribute('role', 'tooltip');
    document.body.append(this.el);
    const show = (e: Event) => this.show((e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-card]') ?? null);
    document.addEventListener('mouseover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('mouseout', (e) => {
      const to = (e as MouseEvent).relatedTarget as HTMLElement | null;
      if (!to?.closest?.('[data-card]')) this.show(null);
    });
    document.addEventListener('focusout', () => this.show(null));
  }

  /** Shows the card for `target`, or hides it for null. */
  show(target: HTMLElement | null): void {
    if (target === this.showing && target) return;
    this.showing = target;
    // Not over a drag on its way, or over the item menu.
    const busy = document.querySelector('.drag-ghost, #item-menu:not([hidden])');
    if (!target || !target.isConnected || busy) {
      this.el.hidden = true;
      return;
    }
    const item = target.dataset.card!;
    const c = this.character();
    const worn = target.dataset.cardWorn !== undefined && isWorn(c, item);
    const html = itemCardHtml(c, item, { worn, qty: Number(target.dataset.cardQty) || undefined, hint: target.dataset.cardHint, history: this.history });
    if (!html) {
      this.el.hidden = true;
      return;
    }
    this.el.innerHTML = html;
    this.el.hidden = false;
    this.place(target.getBoundingClientRect());
  }

  /** Keeps the card's words current after the character changes. */
  refresh(): void {
    if (!this.showing) return;
    // A redraw replaces the slot under the pointer: find the one there now.
    const t = this.showing.isConnected ? this.showing
      : document.querySelector<HTMLElement>('[data-card]:hover') ?? document.activeElement?.closest<HTMLElement>('[data-card]') ?? null;
    this.showing = null;
    this.show(t);
  }

  /** Beside the slot, on the side with room, inside the screen. */
  private place(r: DOMRect): void {
    const w = this.el.offsetWidth, h = this.el.offsetHeight, gap = 8;
    const right = r.right + gap + w <= window.innerWidth;
    const x = right ? r.right + gap : Math.max(gap, r.left - gap - w);
    const y = Math.min(Math.max(gap, r.top), window.innerHeight - h - gap);
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }
}
