import { describe, expect, it } from 'vitest';
import {
  BAG_FULL,
  BAG_SLOTS,
  GOLD,
  ITEMS,
  MAX_STACK,
  QUESTS,
  addGold,
  addItem,
  buy,
  completeQuest,
  equip,
  fitsAll,
  goldOf,
  itemCount,
  newCharacter,
  questRewardFits,
  sell,
  setGold,
  swap,
  takeGold,
  unequip,
  upgradeCharacter,
  type Character,
} from '../src/index.ts';

/** Fills the bag with one of each of these different things until every slot is taken. */
function fill(c: Character): void {
  const fillers = Object.keys(ITEMS).filter((id) => ITEMS[id]!.kind === 'material' && !c.inventory.some((s) => s.item === id));
  while (c.inventory.length < BAG_SLOTS) c.inventory.push({ item: fillers.shift()!, qty: 1 });
}

describe('the bag', () => {
  it(`holds ${BAG_SLOTS} stacks; more of what it holds still stacks, something new does not fit`, () => {
    const c = newCharacter();
    fill(c);
    const held = c.inventory[1]!.item;
    expect(addItem(c, 'tonic')).toBe(0);
    expect(c.inventory).toHaveLength(BAG_SLOTS);
    expect(addItem(c, held, 3)).toBe(3);
    expect(itemCount(c, held)).toBe(4);
    // A stack stops at MAX_STACK: only what fits goes in.
    expect(addItem(c, held, MAX_STACK)).toBe(MAX_STACK - 4);
    expect(fitsAll(c, [{ item: held, qty: 1 }])).toBe(false);
  });

  it('keeps all gold coins in one slot, however many', () => {
    const c = newCharacter();
    expect(addGold(c, 250)).toBe(true);
    expect(addGold(c, 250)).toBe(true);
    expect(c.inventory.filter((s) => s.item === GOLD)).toEqual([{ item: GOLD, qty: 500 }]);
    expect(takeGold(c, 501)).toBe(false);
    expect(takeGold(c, 500)).toBe(true);
    expect(goldOf(c)).toBe(0);
    expect(c.inventory.some((s) => s.item === GOLD)).toBe(false);
    // With no coin slot and a full bag, coins have nowhere to go.
    fill(c);
    expect(addGold(c, 5)).toBe(false);
  });

  it('turns gold saved as a number into coins once', () => {
    const c = upgradeCharacter({ ...newCharacter(), gold: 45 } as Partial<Character>);
    expect(goldOf(c)).toBe(45);
    expect('gold' in c).toBe(false);
    expect(goldOf(upgradeCharacter(c))).toBe(45);
  });
});

describe('a full bag', () => {
  it('cannot buy, unless paying frees the coin slot', () => {
    const c = newCharacter();
    setGold(c, 100);
    fill(c);
    expect(buy(c, 'marina', 'tonic')).toBe(BAG_FULL);
    expect(goldOf(c)).toBe(100);
    setGold(c, 40);
    expect(buy(c, 'marina', 'tonic')).toBeUndefined();
    expect(goldOf(c)).toBe(0);
    expect(itemCount(c, 'tonic')).toBe(1);
  });

  it('cannot sell for coins it has no slot for, unless the sale empties a slot', () => {
    const c = newCharacter();
    fill(c);
    const [, a, b] = c.inventory.map((s) => s.item);
    c.inventory.find((s) => s.item === a)!.qty = 2;
    expect(sell(c, 'marina', a!, 1)).toBe(BAG_FULL);
    expect(itemCount(c, a!)).toBe(2);
    expect(sell(c, 'marina', b!, 1)).toBeUndefined();
    expect(goldOf(c)).toBeGreaterThan(0);
    expect(itemCount(c, b!)).toBe(0);
  });

  it('cannot take off gear, but can swap it for gear from the bag', () => {
    const c = newCharacter();
    c.inventory.push({ item: 'wooden-sword', qty: 1 });
    expect(equip(c, 'wooden-sword')).toBeUndefined();
    fill(c);
    expect(unequip(c, 'weapon')).toBe(false);
    expect(c.equipment.weapon).toBe('wooden-sword');
    c.inventory[BAG_SLOTS - 1] = { item: 'coral-spear', qty: 1 };
    expect(equip(c, 'coral-spear')).toBeUndefined();
    expect(c.equipment.weapon).toBe('coral-spear');
    expect(itemCount(c, 'wooden-sword')).toBe(1);
    expect(c.inventory).toHaveLength(BAG_SLOTS);
  });

  it('must make room before a quest reward is handed over', () => {
    const id = Object.keys(QUESTS).find((q) => QUESTS[q]!.goal.kind === 'defeat' && QUESTS[q]!.reward.gold > 0)!;
    const c = newCharacter();
    fill(c);
    const state: Character['quests'][number] = { id, count: 0, done: false };
    expect(questRewardFits(c, state)).toBe(false);
    // One slot for the coins and one for each thing given.
    c.inventory.splice(-(1 + (QUESTS[id]!.reward.items?.length ?? 0)));
    expect(questRewardFits(c, state)).toBe(true);
    completeQuest(c, state);
    expect(goldOf(c)).toBe(QUESTS[id]!.reward.gold);
  });

  it('refuses a trade it has no room for, and nothing changes hands', () => {
    const a = newCharacter();
    const b = newCharacter();
    fill(a);
    b.inventory.push({ item: 'tonic', qty: 1 });
    setGold(b, 10);
    expect(swap(a, b, { items: [], gold: 0 }, { items: [{ item: 'tonic', qty: 1 }], gold: 10 })).toMatch(/does not have room/);
    expect(itemCount(b, 'tonic')).toBe(1);
    expect(goldOf(b)).toBe(10);
  });
});
