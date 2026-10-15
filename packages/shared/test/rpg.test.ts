import { describe, expect, it } from 'vitest';
import { CREATURES, addItem, gainXp, maxHp, newCharacter, questOffered, rollDrops, takeItem, upgradeCharacter, xpToNext } from '../src/index.ts';

describe('drops', () => {
  it('roll each item on a creature’s list against its own chance', () => {
    const drops = CREATURES['sun-scarab']!.drops;
    expect(rollDrops(drops, () => 0.99)).toEqual([]);
    expect(rollDrops(drops, () => 0)).toEqual([{ item: 'scarab-shell', qty: 1 }, { item: 'goat-horn', qty: 1 }, { item: 'tonic', qty: 1 }]);
    expect(rollDrops(drops, () => 0.3)).toEqual([{ item: 'scarab-shell', qty: 1 }]);
    expect(rollDrops([{ item: 'gone', chance: 1 }, { item: 'tonic', chance: 1, qty: 2 }], () => 0)).toEqual([{ item: 'tonic', qty: 2 }]);
  });
});

describe('characters', () => {
  it('start at level 1 with full health and the Bible', () => {
    const c = newCharacter();
    expect(c.level).toBe(1);
    expect(c.hp).toBe(maxHp(c));
    expect(c.inventory).toEqual([{ item: 'bible', qty: 1 }]);
  });

  it('level up, possibly several times, raising every stat and restoring health', () => {
    const c = newCharacter();
    c.hp = 1;
    const levels = gainXp(c, xpToNext(1) + xpToNext(2) + 1);
    expect(levels).toBe(2);
    expect(c.level).toBe(3);
    expect(c.xp).toBe(1);
    expect(c.stats.might).toBe(5);
    expect(c.hp).toBe(maxHp(c));
  });

  it('never lose the Bible', () => {
    const c = newCharacter();
    expect(takeItem(c, 'bible')).toBe(false);
    expect(upgradeCharacter({ ...c, inventory: [] }).inventory[0]).toEqual({ item: 'bible', qty: 1 });
  });

  it('stack items', () => {
    const c = newCharacter();
    addItem(c, 'tonic', 2);
    addItem(c, 'tonic');
    expect(c.inventory[1]).toEqual({ item: 'tonic', qty: 3 });
    expect(takeItem(c, 'tonic', 3)).toBe(true);
    expect(c.inventory).toHaveLength(1);
  });

  it('are offered quests in order', () => {
    const c = newCharacter();
    expect(questOffered(c, 'old-bramble')).toBeUndefined();
    expect(questOffered(c, 'sister-amala')).toBe('meet-bramble');
    c.quests.push({ id: 'meet-bramble', count: 0, done: true });
    expect(questOffered(c, 'old-bramble')).toBe('mushroom-trouble');
    expect(questOffered(c, 'marina')).toBe('crab-tolls');
  });
});
