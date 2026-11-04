import { describe, expect, it } from 'vitest';
import {
  CRAFT_IDS,
  ITEMS,
  MASTERY_CHANGE_GOLD,
  QUALITY_MAX,
  RECIPES,
  SHOPS,
  UNMASTERED_QUALITY_MAX,
  addItem,
  bestTool,
  buy,
  chooseMastery,
  craft,
  craftLevel,
  craftOfFamily,
  craftQuality,
  craftXpToNext,
  gainCraftXp,
  giveHomeTools,
  heldArts,
  itemCount,
  master,
  newCharacter,
  practise,
  recipeCraft,
  toolId,
  toolWords,
  upgradeCharacter,
} from '../src/index.ts';

describe('crafts', () => {
  it('each have a tool in three tiers and a master who sells the first two', () => {
    for (const k of CRAFT_IDS) {
      for (const tier of [1, 2, 3] as const) expect(ITEMS[toolId(k, tier)]).toMatchObject({ kind: 'tool', tool: { craft: k, tier } });
      const masters = Object.entries(SHOPS).filter(([, s]) => s.masters?.includes(k));
      expect(masters, k).toHaveLength(1);
      const sells = masters[0]![1].sells.map((s) => s.item);
      expect(sells).toEqual(expect.arrayContaining([toolId(k, 1), toolId(k, 2)]));
      expect(sells).not.toContain(toolId(k, 3));
    }
    expect(toolWords(ITEMS['tool-smithing-2'])).toBe('Smithing tool, tier 2.');
    // Until a tool's own picture is painted, it shows a shipped one like it, in the bag and in the hand.
    expect(heldArts('tool-woodcarving-1')).toEqual(['item-tool-woodcarving', 'held-axe']);
  });

  it('work the families of materials, and every shipped recipe belongs to one', () => {
    expect(craftOfFamily('ore')).toBe('smithing');
    expect(craftOfFamily('bone')).toBe('woodcarving');
    expect(craftOfFamily('wishstuff')).toBeUndefined();
    for (const r of Object.values(RECIPES)) expect(recipeCraft(r)).toBeDefined();
    // A wished recipe with no craft of its own takes its main material's.
    expect(recipeCraft({ materials: [{ item: 'wolf-pelt', qty: 2 }], result: { item: 'tonic', qty: 1 }, level: 1 })).toBe('leatherwork');
  });

  it('start a people ahead in their home crafts, with their first tools free once', () => {
    const c = newCharacter();
    expect(giveHomeTools(c)).toEqual([]);
    c.race = 'cervid';
    expect(craftLevel(c, 'herbalism')).toBe(3);
    expect(craftLevel(c, 'woodcarving')).toBe(3);
    expect(craftLevel(c, 'smithing')).toBe(1);
    expect(giveHomeTools(c).sort()).toEqual(['tool-herbalism-1', 'tool-woodcarving-1']);
    expect(giveHomeTools(c)).toEqual([]);
    // It is remembered when the character is saved and loaded.
    expect(giveHomeTools(upgradeCharacter(JSON.parse(JSON.stringify(c))))).toEqual([]);
  });

  it('grow by practice, and stop at 10 without a mastery', () => {
    const c = newCharacter();
    expect(gainCraftXp(c, 'smithing', craftXpToNext(1) - 1)).toBeUndefined();
    expect(gainCraftXp(c, 'smithing', 1)).toBe(2);
    gainCraftXp(c, 'smithing', 100_000);
    expect(craftLevel(c, 'smithing')).toBe(10);
    expect(c.crafts!.smithing!.xp).toBe(0);
    expect(chooseMastery(c, 'smithing')).toBeUndefined();
    gainCraftXp(c, 'smithing', 100_000);
    expect(craftLevel(c, 'smithing')).toBe(20);
  });

  it('take two masteries; changing one costs gold and drops the old craft to 10', () => {
    const c = newCharacter();
    expect(master(c, 'marina', 'smithing')).toMatch(/cannot make you a master/);
    expect(master(c, 'marina', 'fletching')).toBeUndefined();
    expect(chooseMastery(c, 'fletching')).toMatch(/already a master/);
    expect(chooseMastery(c, 'smithing')).toBeUndefined();
    expect(chooseMastery(c, 'tailoring')).toMatch(/Give one up/);
    c.crafts = { smithing: { level: 17, xp: 40 } };
    expect(chooseMastery(c, 'tailoring', 'smithing')).toMatch(new RegExp(`costs ${MASTERY_CHANGE_GOLD} gold`));
    c.gold = MASTERY_CHANGE_GOLD + 5;
    expect(chooseMastery(c, 'tailoring', 'smithing')).toBeUndefined();
    expect(c.masteries).toEqual(['fletching', 'tailoring']);
    expect(c.crafts.smithing).toEqual({ level: 10, xp: 0 });
    expect(c.gold).toBe(5);
  });

  it('need the tool, raise the craft, and wear the tool out now and then', () => {
    const c = newCharacter();
    addItem(c, 'mushroom-cap', 4);
    expect(craft(c, 'tonic')).toMatch(/sickle/);
    c.gold = 25;
    expect(buy(c, 'old-bramble', 'tool-herbalism-1')).toBeUndefined();
    expect(bestTool(c, 'herbalism')).toEqual({ id: 'tool-herbalism-1', tier: 1 });
    expect(craft(c, 'tonic')).toBeUndefined();
    expect(practise(c, 'tonic', () => 0.5)).toEqual({ craft: 'herbalism' });
    expect(c.crafts!.herbalism!.xp).toBeGreaterThan(0);
    expect(craft(c, 'tonic')).toBeUndefined();
    expect(practise(c, 'tonic', () => 0)).toMatchObject({ broke: 'Sickle' });
    expect(itemCount(c, 'tool-herbalism-1')).toBe(0);
  });

  it('only a master works tier 3 materials or reaches the best quality', () => {
    const c = newCharacter();
    c.crafts = { smithing: { level: 20, xp: 0 } };
    addItem(c, toolId('smithing', 3));
    const r = RECIPES['shell-mail']!;
    expect(craftQuality(c, r, () => 0.99)).toBe(UNMASTERED_QUALITY_MAX);
    c.masteries = ['smithing'];
    expect(craftQuality(c, r, () => 0.99)).toBe(QUALITY_MAX);
    // A common-tier recipe at its own level with a plain tool and no luck either way comes out standard.
    const d = newCharacter();
    d.crafts = { smithing: { level: r.level, xp: 0 } };
    addItem(d, toolId('smithing', 1));
    expect(craftQuality(d, r, () => 0.5)).toBe(100);

    RECIPES['test-roc'] = { materials: [{ item: 'roc-plume', qty: 1 }], result: { item: 'tonic', qty: 1 }, level: 1 };
    const e = newCharacter();
    addItem(e, 'roc-plume');
    addItem(e, toolId('fletching', 1));
    expect(craft(e, 'test-roc')).toMatch(/Only a master of Fletching/);
    e.masteries = ['fletching'];
    expect(craft(e, 'test-roc')).toBeUndefined();
    delete RECIPES['test-roc'];
  });
});
