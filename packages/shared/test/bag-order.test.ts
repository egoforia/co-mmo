import { describe, expect, it } from 'vitest';
import {
  BAG_FULL,
  BAG_SLOTS,
  COINS_ONE_SLOT,
  MAX_STACK,
  SPLIT_HOW,
  addItem,
  bagRoom,
  itemCount,
  moveSlot,
  newCharacter,
  putItem,
  setGold,
  sortBag,
  splitStack,
  takeItem,
} from '../src/index.ts';

// Arranging the bag: move, merge, split and sort, and how a split stack
// counts, fills and empties.

const items = (c: { inventory: { item: string; qty: number }[] }) => c.inventory.map((s) => `${s.item}:${s.qty}`);

describe('arranging the bag', () => {
  it('swaps two stacks, and moves one to the end on an empty cell', () => {
    const c = newCharacter();
    c.inventory = [];
    putItem(c, 'crab-shell', 3);
    putItem(c, 'wolf-pelt', 2);
    expect(moveSlot(c, 0, 1)).toBeUndefined();
    expect(items(c)).toEqual(['wolf-pelt:2', 'crab-shell:3']);
    expect(moveSlot(c, 0, 10)).toBeUndefined();
    expect(items(c)).toEqual(['crab-shell:3', 'wolf-pelt:2']);
    expect(moveSlot(c, 5, 0)).toBeTruthy();
  });

  it('splits a stack beside itself, and merges it back', () => {
    const c = newCharacter();
    c.inventory = [];
    putItem(c, 'crab-shell', 10);
    expect(splitStack(c, 0, 4)).toBeUndefined();
    expect(items(c)).toEqual(['crab-shell:6', 'crab-shell:4']);
    expect(itemCount(c, 'crab-shell')).toBe(10);
    // Taking comes off the last stack first, so the first keeps its place.
    expect(takeItem(c, 'crab-shell', 5)).toBe(true);
    expect(items(c)).toEqual(['crab-shell:5']);
    splitStack(c, 0, 2);
    expect(moveSlot(c, 1, 0)).toBeUndefined();
    expect(items(c)).toEqual(['crab-shell:5']);
  });

  it('refuses a split with nothing left on one side, of coins, or in a full bag', () => {
    const c = newCharacter();
    c.inventory = [];
    putItem(c, 'crab-shell', 3);
    expect(splitStack(c, 0, 3)).toBe(SPLIT_HOW);
    expect(splitStack(c, 0, 0)).toBe(SPLIT_HOW);
    setGold(c, 50);
    expect(splitStack(c, 1, 10)).toBe(COINS_ONE_SLOT);
    for (let i = c.inventory.length; i < BAG_SLOTS; i++) c.inventory.push({ item: 'moth-dust', qty: 1 });
    expect(splitStack(c, 0, 1)).toBe(BAG_FULL);
  });

  it('stops merging at a full stack', () => {
    const c = newCharacter();
    c.inventory = [{ item: 'crab-shell', qty: MAX_STACK }, { item: 'crab-shell', qty: 5 }];
    expect(moveSlot(c, 1, 0)).toBe('That stack is already full.');
    expect(moveSlot(c, 0, 1)).toBeUndefined();
    expect(items(c)).toEqual([`crab-shell:${MAX_STACK - (MAX_STACK - 5)}`, `crab-shell:${MAX_STACK}`]);
  });

  it('fills a full stack over into a free slot', () => {
    const c = newCharacter();
    c.inventory = [{ item: 'crab-shell', qty: MAX_STACK }];
    expect(bagRoom(c, 'crab-shell')).toBe((BAG_SLOTS - 1) * MAX_STACK);
    expect(addItem(c, 'crab-shell', 3)).toBe(3);
    expect(items(c)).toEqual([`crab-shell:${MAX_STACK}`, 'crab-shell:3']);
  });

  it('sorts coins and books first, gear by rarity, materials last, merging split stacks', () => {
    const c = newCharacter();
    c.inventory = [
      { item: 'crab-shell', qty: 2 },
      { item: 'wooden-sword', qty: 1 },
      { item: 'crab-shell', qty: 3 },
      { item: 'golem-club', qty: 1 },
      { item: 'gold', qty: 7 },
      { item: 'bible', qty: 1 },
    ];
    sortBag(c);
    expect(items(c)).toEqual(['gold:7', 'bible:1', 'golem-club:1', 'wooden-sword:1', 'crab-shell:5']);
  });
});
