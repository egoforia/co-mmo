import {
  BAG_SLOTS,
  EQUIP_SLOTS,
  GOLD,
  ITEMS,
  SLOT_NAMES,
  bonusText,
  familyText,
  type Character,
} from '@co-mmo/shared';
import { itemLabel } from '../kit-ui.ts';
import { escapeHtml } from '../ui.ts';
import { contentEntries, itemIcon } from '../wished.ts';


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

/** The carried stacks as slot buttons; the item card (data-card) tells the rest. */
export function carriedHtml(c: Pick<Character, 'inventory'>): string {
  return c.inventory
    .map((s) => {
      const def = ITEMS[s.item];
      if (!def) return '';
      return `<button type="button" class="slot" data-item="${escapeHtml(s.item)}" data-card="${escapeHtml(s.item)}" data-card-qty="${s.qty}">
          <img src="${escapeHtml(itemIcon(def))}" alt="">
          ${s.qty > 1 ? `<span class="qty">${s.qty}</span>` : ''}
          <span class="name rarity-${def.rarity ?? 'common'}">${escapeHtml(def.name)}</span><span class="hint">${escapeHtml(hintFor(s.item))}</span></button>`;
    })
    .join('');
}

/** The worn slots, filled or empty. */
export function wornHtml(c: Pick<Character, 'equipment'>): string {
  return EQUIP_SLOTS.map((slot) => {
    const id = c.equipment[slot];
    const def = id ? ITEMS[id] : undefined;
    return def
      ? `<button type="button" class="slot worn" data-slot="${slot}" data-card="${escapeHtml(id!)}" data-card-worn aria-label="${escapeHtml(`${def.name}, click to take it off`)}">${itemLabel(id!)}<span class="hint">${escapeHtml([familyText(def), bonusText(def.bonus)].filter(Boolean).join(' · '))}</span></button>`
      : `<div class="slot empty"><span class="name">${SLOT_NAMES[slot]}</span><span class="hint">Nothing worn</span></div>`;
  }).join('');
}

/** The bag's heading count, as "n of 20 slots". */
export function slotCount(c: Pick<Character, 'inventory'>): string {
  return `${c.inventory.length} of ${BAG_SLOTS} slots`;
}
