import {
  BAG_SLOTS,
  GOLD,
  ITEMS,
  SLOT_NAMES,
  bonusText,
  familyText,
  type Character,
} from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import { contentEntries, itemIcon } from '../wished.ts';

// The Bag tab's grid (inventory refactor, step 3): one cell per stack, a
// picture and a count; the item card (data-card) tells the rest.

/** What a click on a carried thing does, in a few words. */
function hintFor(item: string): string {
  const def = ITEMS[item]!;
  const ruled = contentEntries().some((e) => e.definition?.kind === 'rule' && item.startsWith(`${e.id}-`));
  return def.kind === 'book' ? 'Click to read'
    : def.heal ? 'Click to drink'
      : def.slot ? `Wear: ${[familyText(def), bonusText(def.bonus)].filter(Boolean).join(' · ') || SLOT_NAMES[def.slot]}`
        : def.teaches ? 'Click to read and learn'
          : ruled ? 'Click to use' : item === GOLD ? 'Spend at shops, or trade' : 'For crafting and trade';
}

/** The carried stacks as a grid of all BAG_SLOTS cells, empty ones drawn, so a full bag is a full picture. */
export function bagGridHtml(c: Pick<Character, 'inventory'>): string {
  const cells = c.inventory.map((s, i) => {
    const def = ITEMS[s.item];
    if (!def) return '<div class="cell empty"></div>';
    return `<button type="button" class="cell rarity-edge-${def.rarity ?? 'common'}" data-item="${escapeHtml(s.item)}" data-index="${i}" data-card="${escapeHtml(s.item)}" data-card-qty="${s.qty}" data-card-hint="${escapeHtml(hintFor(s.item))}"
      aria-label="${escapeHtml(`${def.name}${s.qty > 1 ? `, ${s.qty}` : ''}. ${hintFor(s.item)}`)}"><img src="${escapeHtml(itemIcon(def))}" alt="">${s.qty > 1 ? `<span class="qty">${s.qty}</span>` : ''}</button>`;
  });
  for (let i = cells.length; i < BAG_SLOTS; i++) cells.push('<div class="cell empty"></div>');
  return `<div class="bag-grid">${cells.join('')}</div>`;
}

/** The bag's heading count, as "n of 20 slots". */
export function slotCount(c: Pick<Character, 'inventory'>): string {
  return `${c.inventory.length} of ${BAG_SLOTS} slots`;
}
