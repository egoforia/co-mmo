import { describe, expect, it } from 'vitest';
import {
  CRAFT_IDS,
  ITEMS,
  RECIPES,
  STARTING_RECIPES,
  UNIQUE_ITEMS,
  addItem,
  bindOnWear,
  copyId,
  craft,
  crafted,
  equip,
  newCharacter,
  recipeCraft,
  recipeTier,
  sellPrice,
  takeItem,
  toolId,
  unequip,
} from '../src/index.ts';

describe('recipe tiers', () => {
  it('are worked out from where the materials come from', () => {
    const tier = (...items: string[]) => recipeTier({ materials: items.map((item) => ({ item, qty: 1 })) });
    expect(tier('copper-ore', 'oak-branch')).toBe('common');
    // The Sanctum's materials count for any land.
    expect(tier('temple-sage', 'amber')).toBe('common');
    expect(tier('driftwood', 'iron-ore')).toBe('rare');
    expect(tier('tonic')).toBe('common');
    expect(tier('roc-plume', 'mountain-wool')).toBe('unique');
  });

  it('cover about forty starting recipes, every craft, and five unique pieces', () => {
    const all = Object.entries(RECIPES);
    expect(all.length).toBeGreaterThanOrEqual(40);
    for (const [id, r] of all) {
      expect(ITEMS[r.result.item], id).toBeDefined();
      for (const m of r.materials) expect(ITEMS[m.item], `${id}: ${m.item}`).toBeDefined();
      expect(recipeCraft(r), id).toBeDefined();
      // Past level 10 needs a mastery, and a common recipe never does.
      if (recipeTier(r) === 'common') expect(r.level, id).toBeLessThanOrEqual(10);
    }
    for (const k of CRAFT_IDS) expect(all.some(([, r]) => recipeCraft(r) === k), k).toBe(true);
    for (const tier of [1, 2, 3] as const) for (const k of CRAFT_IDS) expect(STARTING_RECIPES[toolId(k, tier)]?.result.item).toBe(toolId(k, tier));
    const uniques = all.filter(([, r]) => recipeTier(r) === 'unique');
    expect(uniques.map(([id]) => id).sort()).toEqual(Object.keys(UNIQUE_ITEMS).sort());
    for (const id of Object.keys(UNIQUE_ITEMS)) expect(ITEMS[id]).toMatchObject({ unique: true, standIn: expect.any(String) });
  });
});

describe('unique pieces', () => {
  it('need a master, and bind to whoever first wears them', () => {
    const c = newCharacter();
    c.crafts = { tailoring: { level: 15, xp: 0 } };
    addItem(c, toolId('tailoring', 1));
    addItem(c, 'roc-plume');
    addItem(c, 'mountain-wool', 4);
    addItem(c, 'gull-feather', 2);
    expect(craft(c, 'roc-plume-mantle')).toMatch(/Only a master of Tailoring/);
    c.masteries = ['tailoring'];
    expect(craft(c, 'roc-plume-mantle', crafted(c, 'Mara', 'roc-plume-mantle', () => 0.5))).toBeUndefined();
    const made = c.inventory.find((s) => s.item.startsWith('roc-plume-mantle~'))!.item;
    expect(ITEMS[made]).toMatchObject({ unique: true, slot: 'cloak' });
    expect(ITEMS[made]!.bound).toBeUndefined();
    // Not bound yet: it can be traded or sold.
    expect(sellPrice(made)).toBeGreaterThan(0);

    expect(equip(c, made, (id) => bindOnWear(c, id))).toBeUndefined();
    const worn = c.equipment.cloak!;
    expect(worn).not.toBe(made);
    expect(ITEMS[worn]).toMatchObject({ bound: true, copy: { bound: true } });
    expect(c.inventory.some((s) => s.item === made || s.item === worn)).toBe(false);
    // Taken off, it stays bound: never sold or given away, but worn again.
    expect(unequip(c, 'cloak')).toBe(true);
    expect(sellPrice(worn)).toBe(0);
    expect(takeItem(c, worn)).toBe(false);
    expect(equip(c, worn, (id) => bindOnWear(c, id))).toBeUndefined();
    expect(c.equipment.cloak).toBe(worn);
  });
});

describe('quality and rarity', () => {
  it('makes a fine copy one rarity finer than its base', () => {
    const at = (quality: number) => ITEMS[copyId({ of: 'shell-mail', quality, maker: { kind: 'player', name: 'Mara' } }, 'n')]!.rarity;
    expect(at(100)).toBe('uncommon');
    expect(at(115)).toBe('rare');
    expect(ITEMS[copyId({ of: 'demonhorn-bow', quality: 130, maker: { kind: 'player', name: 'Mara' } }, 'n')]!.rarity).toBe('legendary');
  });
});
