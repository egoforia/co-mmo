import { describe, expect, it } from 'vitest';
import { CALLINGS, GOLD, chooseCalling, deathXp, gainXp, goldOf, loseXp, newCharacter, rollDeathDrops, setGold, spendPoint, xpToNext } from '../src/index.ts';

/** A level-1 warden (vigor and might rise each level). */
function warden() {
  const c = newCharacter();
  chooseCalling(c, 'scorpid', 'warden');
  return c;
}

describe('losing XP', () => {
  it('costs a quarter of the way to the next level', () => {
    expect(deathXp(10)).toBe(Math.round(xpToNext(10) / 4));
  });

  it('drops a level when there is not enough, taking back the point placed last', () => {
    const c = warden();
    gainXp(c, xpToNext(1) + xpToNext(2));
    expect(c.level).toBe(3);
    const before = { ...c.stats };
    expect(spendPoint(c, 'wit')).toBeUndefined();
    expect(spendPoint(c, 'spirit')).toBeUndefined();
    expect(loseXp(c, c.xp + 1)).toBe(1);
    expect(c.level).toBe(2);
    expect(c.xp).toBe(xpToNext(2) - 1);
    const { primary, secondary } = CALLINGS.warden;
    // The level's pair comes off, and so does the point placed last (spirit), not the first (wit).
    expect(c.stats[primary]).toBe(before[primary] - 1);
    expect(c.stats[secondary]).toBe(before[secondary] - 1);
    expect(c.stats.wit).toBe(before.wit + 1);
    expect(c.stats.spirit).toBe(before.spirit);
    expect(c.placed).toEqual(['wit']);
  });

  it('takes an unplaced point first, and never goes below level 1', () => {
    const c = warden();
    gainXp(c, xpToNext(1));
    expect(c.freePoints).toBe(1);
    loseXp(c, 1);
    expect(c.level).toBe(1);
    expect(c.freePoints).toBe(0);
    loseXp(c, 10_000);
    expect(c.level).toBe(1);
    expect(c.xp).toBe(0);
  });
});

describe('death drops', () => {
  it('always take all the gold, and gear or the bag only on a low roll', () => {
    const c = newCharacter();
    setGold(c, 30);
    c.equipment.weapon = 'wooden-sword';
    c.inventory.push({ item: 'tonic', qty: 3 });
    expect(rollDeathDrops(c, () => 0.5)).toEqual([{ item: GOLD, qty: 30 }]);
    expect(goldOf(c)).toBe(0);
    setGold(c, 5);
    const drops = rollDeathDrops(c, () => 0.1);
    expect(drops).toEqual([{ item: GOLD, qty: 5 }, { item: 'wooden-sword', qty: 1 }, { item: 'tonic', qty: 3 }]);
    expect(c.equipment.weapon).toBeUndefined();
    expect(c.inventory.map((s) => s.item)).toEqual(['bible']);
  });

  it('unbind bound gear that drops', () => {
    const c = newCharacter();
    c.equipment.weapon = 'wooden-sword~b~100~wx~~~~n1';
    const [drop] = rollDeathDrops(c, () => 0.1);
    expect(drop!.item).toBe('wooden-sword~u~100~wx~~~~n1');
  });
});
