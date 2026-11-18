import {
  BAG_SLOTS,
  GOLD,
  ITEMS,
  type Character,
} from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import { contentEntries, itemIcon } from '../wished.ts';

// The Bag tab's grid (inventory refactor, step 3): one cell per stack, a
// picture and a count; the item card (data-card) tells the rest.

/** True when a scripted rule (a wish) gives this item its use. */
function ruled(item: string): boolean {
  return contentEntries().some((e) => e.definition?.kind === 'rule' && item.startsWith(`${e.id}-`));
}

/** The word for a carried thing's main use (the item menu's first line), or '' when it has none. */
export function useWord(item: string): string {
  const def = ITEMS[item];
  if (!def) return '';
  return def.kind === 'book' ? 'Read' : def.heal ? 'Drink' : def.slot ? 'Wear' : def.teaches ? 'Read and learn' : ruled(item) ? 'Use' : '';
}

/** What a click on a carried thing does, in a few words, for its item card. */
function hintFor(item: string): string {
  const use = useWord(item);
  if (use) return `Click to ${use.toLowerCase()}`;
  return item === GOLD ? 'Spend at shops, or trade' : 'For crafting and trade';
}

/** The carried stacks as a grid of all BAG_SLOTS cells, empty ones drawn, so a full bag is a full picture. */
export function bagGridHtml(c: Pick<Character, 'inventory'>): string {
  const cells = c.inventory.map((s, i) => {
    const def = ITEMS[s.item];
    if (!def) return '<div class="cell empty"></div>';
    return `<button type="button" class="cell rarity-edge-${def.rarity ?? 'common'}" data-item="${escapeHtml(s.item)}" data-index="${i}" data-card="${escapeHtml(s.item)}" data-card-qty="${s.qty}" data-card-hint="${escapeHtml(hintFor(s.item))}"
      aria-label="${escapeHtml(`${def.name}${s.qty > 1 ? `, ${s.qty}` : ''}. ${hintFor(s.item)}`)}"><img src="${escapeHtml(itemIcon(def))}" alt="">${s.qty > 1 ? `<span class="qty">${s.qty}</span>` : ''}</button>`;
  });
  for (let i = cells.length; i < BAG_SLOTS; i++) cells.push('<div class="cell empty" tabindex="-1" aria-label="Empty"></div>');
  return `<div class="bag-grid">${cells.join('')}</div>`;
}

/** The bag's heading count, as "n of 20 slots". */
export function slotCount(c: Pick<Character, 'inventory'>): string {
  return `${c.inventory.length} of ${BAG_SLOTS} slots`;
}
