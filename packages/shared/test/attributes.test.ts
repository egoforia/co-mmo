import { describe, expect, it } from 'vitest';
import {
  armor,
  cooldownFactor,
  critChance,
  dodgeChance,
  energyPerSecond,
  gainXp,
  maxEnergy,
  maxHp,
  newCharacter,
  regenPerSecond,
  upgradeCharacter,
  ward,
  xpToNext,
  type Stats,
} from '../src/index.ts';

// The worked numbers in docs/attributes.md: every free point in the primary,
// no people lift, no gear.
const CALLINGS: Record<string, [keyof Stats, keyof Stats]> = {
  Warden: ['vigor', 'might'],
  Duelist: ['might', 'agility'],
  Ranger: ['agility', 'wit'],
  Wishweaver: ['wit', 'spirit'],
  Bellkeeper: ['spirit', 'vigor'],
};
const SPREAD: Record<number, [number, number]> = { 1: [6, 5], 10: [24, 14], 20: [44, 24] };

function hero(calling: string, level: number) {
  const [primary, secondary] = CALLINGS[calling]!;
  const stats: Stats = { might: 3, agility: 3, wit: 3, spirit: 3, vigor: 3 };
  [stats[primary], stats[secondary]] = SPREAD[level]!;
  return { level, stats };
}

// [Max HP, Energy, Armor, Ward, Crit %] from the tables.
const TABLES: Record<number, Record<string, [number, number, number, number, number]>> = {
  1: { Warden: [55, 31, 3, 1.5, 6], Duelist: [44, 31, 1.5, 1.5, 7], Ranger: [41, 37, 1.5, 1.5, 7], Wishweaver: [41, 40, 1.5, 2.5, 6], Bellkeeper: [49, 31, 2.5, 3, 6] },
  10: { Warden: [190, 49, 12, 1.5, 6], Duelist: [116, 49, 1.5, 1.5, 11], Ranger: [95, 82, 1.5, 1.5, 15], Wishweaver: [95, 112, 1.5, 7, 6], Bellkeeper: [139, 49, 7, 12, 6] },
  20: { Warden: [340, 69, 22, 1.5, 6], Duelist: [196, 69, 1.5, 1.5, 15], Ranger: [155, 132, 1.5, 1.5, 23], Wishweaver: [155, 192, 1.5, 12, 6], Bellkeeper: [239, 69, 12, 22, 6] },
};

describe('the five attributes', () => {
  for (const level of [1, 10, 20]) {
    for (const [calling, [hp, energy, arm, wrd, crit]] of Object.entries(TABLES[level]!)) {
      it(`give a level-${level} ${calling} the health, Energy, defence and crits in the tables`, () => {
        const c = hero(calling, level);
        expect(maxHp(c)).toBe(hp);
        expect(maxEnergy(c)).toBe(energy);
        expect(armor(c)).toBe(arm);
        expect(ward(c)).toBe(wrd);
        expect(Math.round(critChance(c) * 100)).toBe(crit);
      });
    }
  }

  it('let Spirit bring health and Energy back faster', () => {
    const c = hero('Bellkeeper', 10);
    expect(regenPerSecond(c)).toBeCloseTo(1 + 0.3 * 24);
    expect(energyPerSecond(c)).toBeCloseTo(1.5 + 0.12 * 24);
  });

  it('cap crits, dodging and shorter cooldowns', () => {
    const quick = { level: 20, stats: { might: 3, agility: 200, wit: 200, spirit: 3, vigor: 3 } };
    expect(critChance(quick)).toBe(0.35);
    expect(dodgeChance(quick)).toBe(0.2);
    expect(cooldownFactor(quick)).toBeCloseTo(0.8);
    const c = hero('Ranger', 10);
    expect(dodgeChance(c)).toBeCloseTo(0.06);
    expect(cooldownFactor(c)).toBeCloseTo(1 - 0.004 * 14);
  });

  it('add worn armour to the Armor Vigor gives', () => {
    const c = { ...hero('Warden', 1), equipment: { body: 'traveller-coat' } };
    expect(armor(c)).toBe(5);
  });

  it('grow Vigor with every level until Callings choose', () => {
    const c = newCharacter();
    gainXp(c, xpToNext(1));
    expect(c.stats.vigor).toBe(4);
  });

  it('give a character saved before Vigor as much Vigor as Might', () => {
    const c = upgradeCharacter({ level: 5, stats: { might: 7, agility: 7, wit: 7, spirit: 7 } as Stats, hp: 999 });
    expect(c.stats.vigor).toBe(7);
    expect(c.hp).toBe(maxHp(c));
  });
});
