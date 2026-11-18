import { BAG_SLOTS, newCharacter, putItem } from '@co-mmo/shared';
import { describe, expect, it } from 'vitest';
import { InventoryWindow } from '../src/inventory-ui.ts';
import { gridStep } from '../src/inventory/grid.ts';

// The bag window's contents, and the grid keys it shares with the loot window.

describe('the bag window', () => {
  it('shows what is worn, what is carried and the count of slots', () => {
    const c = newCharacter();
    putItem(c, 'wooden-sword');
    c.equipment.weapon = 'crab-lance';
    const html = new InventoryWindow().html(c);
    expect(html).toContain('Wooden Sword');
    expect(html).toContain('data-slot="weapon"');
    expect(html).toContain(`${c.inventory.length} of ${BAG_SLOTS} slots`);
    expect(html).toContain('Nothing worn');
  });

  it('asks about each piece of gear once while it is held, and shows its owners', () => {
    const c = newCharacter();
    putItem(c, 'wooden-sword');
    const asked: string[][] = [];
    const bag = new InventoryWindow((items) => asked.push(items));
    bag.html(c);
    bag.html(c);
    expect(asked).toEqual([['wooden-sword']]);
    bag.setHistories({ 'wooden-sword': [{ name: 'Mara', how: 'crafted', at: Date.UTC(2026, 10, 18) }] });
    expect(bag.html(c)).toContain('made by Mara');
    c.inventory = c.inventory.filter((s) => s.item !== 'wooden-sword');
    bag.html(c);
    putItem(c, 'wooden-sword');
    bag.html(c);
    expect(asked).toHaveLength(2);
  });
});

describe('choosing in a grid', () => {
  // Two rows of three: tops 0,0,0,50,50 (five slots).
  const tops = [0, 0, 0, 50, 50];
  it('moves along a row and between rows', () => {
    expect(gridStep(tops, 0, 'right')).toBe(1);
    expect(gridStep(tops, 1, 'down')).toBe(4);
    expect(gridStep(tops, 4, 'up')).toBe(1);
  });
  it('stays put at the edges', () => {
    expect(gridStep(tops, 0, 'left')).toBe(0);
    expect(gridStep(tops, 2, 'down')).toBe(2);
    expect(gridStep([], 0, 'right')).toBe(0);
  });
});
