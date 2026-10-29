import { describe, expect, it } from 'vitest';
import {
  ABILITY_EFFECTS,
  MAX_STUN_MS,
  SLOW_PACE,
  STATUSES,
  STUN_IMMUNE_MS,
  WISHED_ABILITY_NUMBERS,
  abilityDamageType,
  abilityFromWish,
  absorb,
  afflict,
  canAct,
  cleanse,
  expireStatuses,
  paceOf,
  statusIds,
  statusLength,
  statusViews,
  validateDefinition,
  type Afflicted,
  type AbilityWish,
} from '../src/index.ts';

const someone = (): Afflicted => ({ statuses: [] });
const look = { hook: 'a spark', body: 'a small light', color: '#ff8800', mood: 'bright' };

describe('status rules', () => {
  it('Vigor shortens harmful statuses by 100 / (100 + 3 × Vigor), never helpful ones', () => {
    expect(statusLength('slowed', 3, 0)).toBe(3000);
    expect(statusLength('slowed', 3, 10)).toBe(Math.round(3000 * 100 / 130));
    expect(statusLength('burning', 4, 50)).toBe(1600);
    expect(statusLength('shielded', 6, 50)).toBe(6000);
  });

  it('a stun never lasts more than two seconds', () => {
    expect(statusLength('stunned', 5)).toBe(MAX_STUN_MS);
  });

  it('after a stun no new stun takes for six seconds', () => {
    const c = someone();
    expect(afflict(c, 'stunned', 1000, 0)).toBe(true);
    expect(canAct(c, 500)).toBe(false);
    expect(canAct(c, 1000)).toBe(true);
    expect(afflict(c, 'stunned', 1000, 1000 + STUN_IMMUNE_MS - 1)).toBe(false);
    expect(canAct(c, 1000 + STUN_IMMUNE_MS - 1)).toBe(true);
    expect(afflict(c, 'stunned', 1000, 1000 + STUN_IMMUNE_MS)).toBe(true);
    // Other statuses are not held back by stun immunity.
    expect(afflict(c, 'rooted', 1000, 1500)).toBe(true);
  });

  it('the same status again keeps the longer time and the stronger amount', () => {
    const c = someone();
    afflict(c, 'burning', 4000, 0, { amount: 3 });
    afflict(c, 'burning', 1000, 0, { amount: 5 });
    expect(c.statuses).toHaveLength(1);
    expect(c.statuses[0]).toMatchObject({ until: 4000, amount: 5, nextTick: 1000 });
  });

  it('Slowed, Rooted and Stunned set the pace', () => {
    const c = someone();
    expect(paceOf(c, 0)).toBe(1);
    afflict(c, 'slowed', 1000, 0);
    expect(paceOf(c, 0)).toBe(SLOW_PACE);
    afflict(c, 'rooted', 500, 0);
    expect(paceOf(c, 0)).toBe(0);
    expect(canAct(c, 0)).toBe(true);
    expect(paceOf(c, 600)).toBe(SLOW_PACE);
  });

  it('a shield takes damage before health, then breaks', () => {
    const c = someone();
    afflict(c, 'shielded', 6000, 0, { amount: 10 });
    expect(absorb(c, 6, 0)).toBe(0);
    expect(absorb(c, 6, 0)).toBe(2);
    expect(c.statuses).toHaveLength(0);
    expect(absorb(c, 6, 0)).toBe(6);
  });

  it('a cleanse takes the harmful statuses and leaves the rest', () => {
    const c = someone();
    afflict(c, 'poisoned', 6000, 0, { amount: 2 });
    afflict(c, 'slowed', 3000, 0);
    afflict(c, 'shielded', 6000, 0, { amount: 10 });
    expect(cleanse(c)).toBe(2);
    expect(statusIds(c, 0)).toEqual(['shielded']);
  });

  it('statuses wear off, and Weakened shows with the rest', () => {
    const c = someone();
    afflict(c, 'marked', 8000, 0, { by: 'a' });
    expect(statusViews(c, 1000, 30_000)).toEqual([{ id: 'marked', left: 7 }, { id: 'weakened', left: 29 }]);
    expireStatuses(c, 8000);
    expect(c.statuses).toHaveLength(0);
  });

  it('every status has a name players read', () => {
    for (const info of Object.values(STATUSES)) expect(info.name).toMatch(/^[A-Z][a-z]+$/);
  });
});

describe('the effect kit and wished abilities', () => {
  it('a wish may choose any effect of the kit; the world sets its numbers', () => {
    for (const effect of ABILITY_EFFECTS) {
      const w = validateDefinition({ kind: 'ability', name: 'Wonder', description: 'A wonder.', effect, energy: 1, cooldown: 0, look }) as AbilityWish;
      expect(w.effect).toBe(effect);
      const a = abilityFromWish(w);
      expect(a).toMatchObject({ effect, ...WISHED_ABILITY_NUMBERS[effect] });
    }
  });

  it('an unknown effect becomes a strike', () => {
    const w = validateDefinition({ kind: 'ability', name: 'Wonder', description: 'A wonder.', effect: 'meteor', look }) as AbilityWish;
    expect(w.effect).toBe('strike');
  });

  it('a wished ability carries only a status its effect may give', () => {
    const wished = (effect: string, status: string) =>
      (validateDefinition({ kind: 'ability', name: 'Wonder', description: 'A wonder.', effect, status, look }) as AbilityWish).status;
    expect(wished('bolt', 'burning')).toBe('burning');
    expect(wished('bolt', 'shielded')).toBeUndefined();
    expect(wished('bolt', 'weakened')).toBeUndefined();
    expect(wished('heal', 'stunned')).toBeUndefined();
    expect(wished('debuff', 'taunted')).toBe('marked');
    expect(wished('buff', 'stunned')).toBe('shielded');
    expect(wished('trap', 'nonsense')).toBe('rooted');
  });

  it('blows of the weapon are physical and spells arcane, unless the skill says', () => {
    expect(abilityDamageType({ effect: 'strike' })).toBe('physical');
    expect(abilityDamageType({ effect: 'bolt' })).toBe('arcane');
    expect(abilityDamageType({ effect: 'cone', damageType: 'arcane' })).toBe('arcane');
  });
});
