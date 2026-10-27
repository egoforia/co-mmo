import { describe, expect, it } from 'vitest';
import {
  CALLINGS,
  CALLING_IDS,
  RACES,
  RACE_IDS,
  callingStats,
  changeCalling,
  changePeople,
  checkDraft,
  draftCost,
  chooseCalling,
  gainXp,
  isClientMessage,
  maxHp,
  needsCalling,
  newCharacter,
  spendPoint,
  startCharacter,
  upgradeCharacter,
  validateCallingWish,
  xpToNext,
  type Stats,
} from '../src/index.ts';

const KEYS: (keyof Stats)[] = ['might', 'agility', 'wit', 'spirit', 'vigor'];
const sum = (s: Stats) => KEYS.reduce((n, k) => n + s[k], 0);
// Round the pentagon: each Calling's two attributes are neighbours.
const PENTAGON: (keyof Stats)[] = ['vigor', 'might', 'agility', 'wit', 'spirit'];
const neighbours = (a: keyof Stats, b: keyof Stats) => {
  const d = Math.abs(PENTAGON.indexOf(a) - PENTAGON.indexOf(b));
  return d === 1 || d === 4;
};

describe('peoples and Callings', () => {
  it('keep the pentagon: Callings take neighbours, peoples never do, each attribute twice', () => {
    for (const id of CALLING_IDS) expect(neighbours(CALLINGS[id].primary, CALLINGS[id].secondary)).toBe(true);
    expect(new Set(CALLING_IDS.map((id) => CALLINGS[id].primary)).size).toBe(5);
    const lifted: Record<string, number> = {};
    for (const id of RACE_IDS) {
      const [a, b] = Object.keys(RACES[id].lift) as (keyof Stats)[];
      expect(neighbours(a!, b!)).toBe(false);
      for (const k of [a!, b!]) lifted[k] = (lifted[k] ?? 0) + 1;
    }
    expect(lifted).toEqual({ might: 2, agility: 2, wit: 2, spirit: 2, vigor: 2 });
    for (const id of CALLING_IDS) {
      expect(CALLINGS[id].weapons.length).toBeGreaterThan(1);
      expect(CALLINGS[id].core.map((s) => s.level)).toEqual([1, 2, 4, 6, 8]);
      for (const path of CALLINGS[id].paths) expect(path.skills.map((s) => s.level)).toEqual([10, 15, 20]);
    }
  });

  it('starts every people with every Calling as the attribute table says', () => {
    for (const race of RACE_IDS) {
      for (const calling of CALLING_IDS) {
        const c = startCharacter(race, calling);
        const { primary, secondary } = CALLINGS[calling];
        expect(c).toMatchObject({ race, calling, level: 1, freePoints: 0 });
        expect(c.stats[primary]).toBe(6 + (RACES[race].lift[primary] ?? 0));
        expect(c.stats[secondary]).toBe(5 + (RACES[race].lift[secondary] ?? 0));
        expect(sum(c.stats)).toBe(15 + 2 + 5);
        expect(c.hp).toBe(maxHp(c));
      }
    }
  });

  it('levels raise the pair and give a free point; without a Calling all five rise', () => {
    const c = startCharacter('lutran', 'ranger');
    expect(gainXp(c, xpToNext(1))).toBe(1);
    expect(c.stats).toMatchObject({ agility: 7, wit: 7, might: 4, spirit: 3, vigor: 3 });
    expect(c.freePoints).toBe(1);

    const old = newCharacter();
    gainXp(old, xpToNext(1));
    expect(old.stats).toEqual({ might: 4, agility: 4, wit: 4, spirit: 4, vigor: 4 });
    expect(old.freePoints).toBe(0);
  });

  it('places free points only when there are some', () => {
    const c = startCharacter('ursine', 'warden');
    expect(spendPoint(c, 'spirit')).toMatch(/no free points/);
    expect(c.stats.spirit).toBe(4);
    gainXp(c, xpToNext(1));
    expect(spendPoint(c, 'spirit')).toBeUndefined();
    expect(c.stats.spirit).toBe(5);
    expect(c.freePoints).toBe(0);
    expect(spendPoint(c, 'spirit')).toMatch(/no free points/);
    expect(spendPoint(newCharacter(), 'might')).toMatch(/Calling/);
  });

  it('a new Calling gives back every free point; a new people moves only the lift', () => {
    const c = startCharacter('ursine', 'warden');
    gainXp(c, xpToNext(1) + xpToNext(2));
    spendPoint(c, 'agility');
    spendPoint(c, 'agility');
    changePeople(c, 'scorpid');
    expect(c.stats).toEqual({ ...callingStats('scorpid', 'warden', 3), agility: callingStats('scorpid', 'warden', 3).agility + 2 });
    expect(c.freePoints).toBe(0);
    c.path = 'oakheart';
    chooseCalling(c, 'scorpid', 'ranger');
    expect(c.stats).toEqual(callingStats('scorpid', 'ranger', 3));
    expect(c.freePoints).toBe(2);
    expect(c.path).toBeUndefined();
  });

  it('asks only characters saved before Callings to choose', () => {
    const old = { ...newCharacter() } as Partial<ReturnType<typeof newCharacter>>;
    delete old.freePoints;
    expect(needsCalling(old)).toBe(true);
    expect(needsCalling(undefined)).toBe(false);
    expect(needsCalling(upgradeCharacter(old))).toBe(false);
    expect(needsCalling(startCharacter('falcon', 'bellkeeper'))).toBe(false);
  });

  it('checks spendPoint messages', () => {
    expect(isClientMessage({ t: 'spendPoint', stat: 'wit' })).toBe(true);
    expect(isClientMessage({ t: 'spendPoint', stat: 'luck' })).toBe(false);
  });
});

describe('changing people or Calling', () => {
  it('checks the wish and refuses one that changes nothing', () => {
    expect(() => validateCallingWish({ kind: 'calling' })).toThrow(/Choose/);
    expect(validateCallingWish({ kind: 'calling', race: 'falcon', calling: 'nope' })).toMatchObject({ kind: 'calling', race: 'falcon', name: 'Born again as a Falcon' });
    const c = startCharacter('falcon', 'ranger');
    expect(changeCalling(c, undefined, 'ranger')).toMatch(/already a Ranger/);
    expect(changeCalling(newCharacter(), 'falcon')).toMatch(/Calling too/);
    expect(changeCalling(c, 'cervid')).toBeUndefined();
    expect(c).toMatchObject({ race: 'cervid', calling: 'ranger' });
  });

  it('is a Moderate wish in the Workshop', () => {
    const checked = checkDraft({ category: 'living', sub: 'calling', fields: { calling: 'warden' } }, 'Mara');
    expect(checked).toMatchObject({ tier: 'moderate', problems: [], definition: { kind: 'calling', calling: 'warden' } });
    expect(draftCost(checked)).toBe(6);
  });
});
