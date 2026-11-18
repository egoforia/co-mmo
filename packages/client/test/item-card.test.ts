import { DEATH_DROP_CHANCE, newCharacter } from '@co-mmo/shared';
import { describe, expect, it } from 'vitest';
import { itemCardHtml } from '../src/inventory/item-card.ts';

// The item card: what a thing is, what wearing it changes, and what falling costs.

describe('the item card', () => {
  it('compares a carried weapon with the one in hand', () => {
    const c = newCharacter();
    c.equipment.weapon = 'wooden-sword';
    const html = itemCardHtml(c, 'golem-club');
    expect(html).toContain('Golem Club');
    expect(html).toContain('If you wear it');
    expect(html).toContain('<span class="gain">+6 damage</span>');
  });

  it('shows a worn piece its chance to drop instead of a comparison', () => {
    const c = newCharacter();
    c.equipment.weapon = 'wooden-sword';
    const html = itemCardHtml(c, 'wooden-sword', { worn: true });
    expect(html).not.toContain('If you wear it');
    expect(html).toContain(`${Math.round(DEATH_DROP_CHANCE * 100)}% chance it drops`);
  });

  it('shows a stack size and the owners it was given', () => {
    const html = itemCardHtml(newCharacter(), 'wooden-sword', { qty: 3, history: () => ' Owners: made by Mara.' });
    expect(html).toContain('× 3');
    expect(html).toContain('made by Mara');
  });
});
