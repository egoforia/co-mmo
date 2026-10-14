import { afterEach, describe, expect, it } from 'vitest';
import {
  ABILITIES,
  CREATOR_LEVEL_FAVOR,
  ITEMS,
  RECIPES,
  WishError,
  applyContent,
  attackPower,
  buy,
  craft,
  equip,
  gainCreatorXp,
  itemCount,
  learnAbility,
  maxHp,
  newCharacter,
  readScroll,
  removeContent,
  sell,
  swap,
  totalStats,
  train,
  unequip,
  upgradeCharacter,
  validateDefinition,
  wisherOf,
  type ContentEntry,
  type WishDefinition,
} from '../src/index.ts';

const look = { hook: 'a glint', body: 'small', color: '#b13e53', mood: 'bold' };

function entry(id: string, definition: WishDefinition): ContentEntry {
  return { id, wisher: { id: 'p-wisher', name: 'Ilya' }, regionId: 'sanctum', at: 0, tier: 'minor', title: definition.name, summary: '', status: 'granted', favor: 2, definition };
}

afterEach(() => {
  for (const id of ['wsword', 'wrecipe', 'wbolt']) removeContent(entry(id, { kind: 'recipe', name: '', description: '', materials: [], result: { item: 'tonic', qty: 1 } }));
});

describe('equipment', () => {
  it('wears gear from the bag, adds its bonus, and swaps what was in the slot back', () => {
    const c = newCharacter();
    c.inventory.push({ item: 'wooden-sword', qty: 1 }, { item: 'crab-lance', qty: 1 });
    const bare = attackPower(c);
    expect(equip(c, 'wooden-sword')).toBeUndefined();
    expect(c.equipment.weapon).toBe('wooden-sword');
    expect(itemCount(c, 'wooden-sword')).toBe(0);
    expect(attackPower(c)).toBe(bare + 2);
    expect(equip(c, 'crab-lance')).toBeUndefined();
    expect(itemCount(c, 'wooden-sword')).toBe(1);
    expect(totalStats(c).agility).toBe(c.stats.agility + 1);
    expect(unequip(c, 'weapon')).toBe(true);
    expect(c.equipment.weapon).toBeUndefined();
    expect(equip(c, 'tonic')).toMatch(/not something you can wear/);
  });

  it('gear that adds Might raises maximum health, and taking it off lowers health to fit', () => {
    const c = newCharacter();
    c.inventory.push({ item: 'shell-mail', qty: 1 });
    equip(c, 'shell-mail');
    c.hp = maxHp(c);
    unequip(c, 'body');
    expect(c.hp).toBe(maxHp(c));
  });

  it('an old saved character gains the new fields, and loses gear a rolled-back wish made', () => {
    const old = { ...newCharacter(), equipment: { head: 'w-gone' }, abilities: ['firebolt', 'w-gone'] } as Record<string, unknown>;
    delete old.energy;
    delete old.creatorXp;
    const c = upgradeCharacter(old as never);
    expect(c.equipment.head).toBeUndefined();
    expect(c.abilities).toEqual(['firebolt']);
    expect(c.creatorLevel).toBe(1);
    expect(c.energy).toBeGreaterThan(0);
  });
});

describe('crafting', () => {
  it('turns materials into a thing, and says what is missing', () => {
    const c = newCharacter();
    expect(craft(c, 'tonic')).toMatch(/more Mushroom Cap/);
    c.inventory.push({ item: 'mushroom-cap', qty: 3 });
    expect(craft(c, 'tonic')).toBeUndefined();
    expect(itemCount(c, 'mushroom-cap')).toBe(1);
    expect(itemCount(c, 'tonic')).toBe(1);
  });

  it('finer recipes need Wit, and a charm counts', () => {
    const c = newCharacter();
    c.inventory.push({ item: 'crab-shell', qty: 5 });
    expect(craft(c, 'shell-mail')).toMatch(/need 5 Wit/);
    c.stats.wit = 5;
    expect(craft(c, 'shell-mail')).toBeUndefined();
    expect(itemCount(c, 'shell-mail')).toBe(1);
  });
});

describe('shops, trainers and scrolls', () => {
  it('buys and sells at the shop prices', () => {
    const c = newCharacter();
    expect(buy(c, 'marina', 'wooden-sword')).toMatch(/costs 15 gold/);
    c.gold = 20;
    expect(buy(c, 'marina', 'wooden-sword')).toBeUndefined();
    expect(c.gold).toBe(5);
    expect(sell(c, 'marina', 'wooden-sword')).toBeUndefined();
    expect(c.gold).toBe(5 + Math.floor(ITEMS['wooden-sword']!.value! / 2));
    expect(sell(c, 'marina', 'bible')).toMatch(/cannot be sold/);
    expect(buy(c, 'marina', 'scarab-charm')).toMatch(/not for sale/);
  });

  it('trainers teach for gold, scrolls teach once and are used up', () => {
    const c = newCharacter();
    c.gold = 15;
    expect(train(c, 'sister-amala', 'mend')).toBeUndefined();
    expect(c.abilities).toEqual(['mend']);
    expect(train(c, 'sister-amala', 'mend')).toMatch(/know that already/);
    c.inventory.push({ item: 'scroll-firebolt', qty: 2 });
    expect(readScroll(c, 'scroll-firebolt')).toBeUndefined();
    expect(c.abilities).toContain('firebolt');
    expect(readScroll(c, 'scroll-firebolt')).toMatch(/already/);
    expect(itemCount(c, 'scroll-firebolt')).toBe(1);
  });
});

describe('trading', () => {
  it('swaps both offers, or nothing when one side no longer has theirs', () => {
    const a = newCharacter();
    const b = newCharacter();
    a.inventory.push({ item: 'crab-shell', qty: 3 });
    b.gold = 10;
    expect(swap(a, b, { items: [{ item: 'crab-shell', qty: 2 }], gold: 0 }, { items: [], gold: 10 })).toBeUndefined();
    expect(itemCount(a, 'crab-shell')).toBe(1);
    expect(itemCount(b, 'crab-shell')).toBe(2);
    expect([a.gold, b.gold]).toEqual([10, 0]);
    expect(swap(a, b, { items: [{ item: 'crab-shell', qty: 5 }], gold: 0 }, { items: [], gold: 0 })).toMatch(/no longer has/);
    expect(itemCount(a, 'crab-shell')).toBe(1);
  });
});

describe('Creator XP', () => {
  it('pays Favor at each Creator level', () => {
    const c = newCharacter();
    const favor = c.favor;
    expect(gainCreatorXp(c, 9)).toBe(0);
    expect(gainCreatorXp(c, 1)).toBe(1);
    expect(c.creatorLevel).toBe(2);
    expect(c.favor).toBe(favor + CREATOR_LEVEL_FAVOR);
  });
});

describe('wished kit', () => {
  it('wished gear gets its numbers from slot and rarity, never above Rare', () => {
    const d = validateDefinition({ kind: 'item', name: 'Sky Blade', itemKind: 'weapon', rarity: 'legendary', focus: 'agility', look });
    expect(d).toMatchObject({ itemKind: 'weapon', rarity: 'common', focus: 'agility' });
    const rare = validateDefinition({ kind: 'item', name: 'Sky Blade', itemKind: 'weapon', rarity: 'rare', look });
    applyContent(entry('wsword', rare));
    expect(ITEMS.wsword).toMatchObject({ kind: 'equipment', slot: 'weapon', rarity: 'rare', bonus: { attack: 4, might: 2 } });
    expect(wisherOf('wsword')).toBe('p-wisher');
  });

  it('a wished recipe must use real things and not make more than it takes', () => {
    expect(() => validateDefinition({ kind: 'recipe', name: 'Gold', materials: [{ item: 'gold-mountain', qty: 1 }], result: { item: 'tonic' } })).toThrow(WishError);
    expect(() => validateDefinition({ kind: 'recipe', name: 'Loop', materials: [{ item: 'tonic', qty: 1 }], result: { item: 'tonic' } })).toThrow(/cannot use what it makes/);
    const d = validateDefinition({ kind: 'recipe', name: 'Horn Brew', materials: [{ item: 'goat-horn', qty: 1 }], result: { item: 'tonic', qty: 9 } });
    expect(d).toMatchObject({ result: { item: 'tonic', qty: 1 } });
    applyContent(entry('wrecipe', d));
    expect(RECIPES.wrecipe).toMatchObject({ name: 'Horn Brew', wit: 0 });
    removeContent(entry('wrecipe', d));
    expect(RECIPES.wrecipe).toBeUndefined();
  });

  it('a wished ability comes on a scroll that teaches it', () => {
    const d = validateDefinition({ kind: 'ability', name: 'Ice Shard', effect: 'bolt', look });
    applyContent(entry('wbolt', d));
    expect(ABILITIES.wbolt).toMatchObject({ effect: 'bolt', range: 5 });
    expect(ITEMS.wbolt).toMatchObject({ kind: 'scroll', teaches: 'wbolt' });
    const c = newCharacter();
    c.inventory.push({ item: 'wbolt', qty: 1 });
    expect(readScroll(c, 'wbolt')).toBeUndefined();
    expect(learnAbility(c, 'wbolt')).toBe(false);
    expect(c.abilities).toEqual(['wbolt']);
  });
});
