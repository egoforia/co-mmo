import { DEATH_DROP_CHANCE, ITEMS, SLOT_NAMES, type Character, type EquipSlot } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import { itemIcon } from '../wished.ts';

// The paper doll (inventory refactor, step 3): the player's painted standing
// picture with what they wear placed round it, where it is worn. The Bag
// slot only shows a risk: the bag is not an item, but it can drop on death
// with all it holds (shared/death.ts), so it is drawn where a bag hangs.

/** Where each worn slot sits round the figure: left column, then right, top to bottom. */
export const DOLL_LEFT: EquipSlot[] = ['head', 'body', 'weapon', 'feet'];
export const DOLL_RIGHT: EquipSlot[] = ['charm', 'cloak', 'offhand'];

/** One worn slot: the piece's picture (its card tells the rest), or the slot's name, faint. */
function wornSlot(c: Pick<Character, 'equipment'>, slot: EquipSlot): string {
  const id = c.equipment[slot];
  const def = id ? ITEMS[id] : undefined;
  if (!def) return `<div class="cell doll-slot empty" data-empty-slot="${slot}"><span>${SLOT_NAMES[slot]}</span></div>`;
  return `<button type="button" class="cell doll-slot rarity-edge-${def.rarity ?? 'common'}" data-slot="${slot}" data-card="${escapeHtml(id!)}" data-card-worn
    aria-label="${escapeHtml(`${SLOT_NAMES[slot]}: ${def.name}. Click to take it off.`)}"><img src="${escapeHtml(itemIcon(def))}" alt=""></button>`;
}

/** The Bag slot: display only, it says what falling costs the bag. */
function bagSlot(): string {
  const chance = Math.round(DEATH_DROP_CHANCE * 100);
  return `<div class="cell doll-slot bag-slot" title="If you fall, your bag has a ${chance}% chance to drop with all it holds."
    aria-label="Your bag: ${chance}% chance to drop with all it holds if you fall"><span>Bag</span><small>${chance}%</small></div>`;
}

/** The doll: worn slots down both sides of the standing picture `figure` (a URL). */
export function dollHtml(c: Pick<Character, 'equipment'>, figure: string): string {
  return `<div class="doll">
      <div class="doll-side">${DOLL_LEFT.map((s) => wornSlot(c, s)).join('')}</div>
      <div class="doll-figure"><img src="${escapeHtml(figure)}" alt="You"></div>
      <div class="doll-side">${DOLL_RIGHT.map((s) => wornSlot(c, s)).join('')}${bagSlot()}</div>
    </div>`;
}
