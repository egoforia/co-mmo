import { describe, expect, it } from 'vitest';
import {
  ITEMS,
  addItem,
  attackCooldown,
  buy,
  copyId,
  copyWords,
  craftQuality,
  dodgeChance,
  energyPerSecond,
  isClientMessage,
  newCharacter,
  parseCopy,
  peopleLean,
  prefersMaterial,
  RECIPES,
  regenPerSecond,
  shopMade,
  traitBonus,
  type CopyInfo,
} from '../src/index.ts';

const coat = (over: Partial<CopyInfo> = {}): CopyInfo => ({ of: 'shell-mail', quality: 110, maker: { kind: 'player', name: 'Bruna' }, ...over });

describe('garment attributes', () => {
  it('lean toward the maker people’s lifted attributes, more as rarity rises', () => {
    expect(peopleLean('ursine', 'common')).toEqual({ might: 1 });
    expect(peopleLean('ursine', 'rare')).toEqual({ might: 2, spirit: 1 });
    expect(peopleLean('ursine', 'rare', 'spirit')).toEqual({ spirit: 2, might: 1 });
    expect(peopleLean('scorpid', 'legendary')).toEqual({ agility: 3, vigor: 3 });
  });

  it('get a side effect from the main material, sized by rarity', () => {
    expect(traitBonus('warm', 'uncommon')).toEqual({ regen: 5 });
    expect(traitBonus('light', 'epic')).toEqual({ dodge: 2 });
    expect(traitBonus('sturdy', 'legendary')).toEqual({ armor: 3 });
  });

  it('add quality, people lean and trait on the copy, and say where each comes from', () => {
    const id = copyId(coat({ people: 'ursine', trait: 'warm', material: 'wolf-pelt' }), 'n');
    const def = ITEMS[id]!;
    // Shell Mail is uncommon: 5 armour and 1 Might, at 110%.
    expect(def.bonus).toEqual({ armor: 6, might: 2, spirit: 1, regen: 5 });
    expect(copyWords(def)).toBe('Tailored by Bruna. Quality 110%. Quality 110%: +6 armour, +1 Might. Ursine maker: +1 Might, +1 Spirit. Warm (Thorn Wolf Pelt): +5% health regeneration.');
    // The same piece by a Scorpid leans to Agility and Vigor instead.
    expect(ITEMS[copyId(coat({ people: 'scorpid' }), 'n')]!.bonus).toEqual({ armor: 6, might: 1, agility: 1, vigor: 1 });
  });

  it('keep the maker’s chosen lean in the id', () => {
    const chosen = coat({ people: 'ursine', lean: 'spirit' });
    expect(parseCopy(copyId(chosen, 'n'))).toEqual(chosen);
    // The default lean is not written, so older ids read the same.
    expect(copyId(coat({ people: 'ursine', lean: 'might' }), 'n')).toBe(copyId(coat({ people: 'ursine' }), 'n'));
    // A lean the people does not lift is dropped.
    expect(parseCopy(copyId(coat({ people: 'ursine', lean: 'wit' }), 'n'))).toEqual(coat({ people: 'ursine' }));
    expect(isClientMessage({ t: 'craft', recipe: 'flax-coat', lean: 'spirit' })).toBe(true);
    expect(isClientMessage({ t: 'craft', recipe: 'flax-coat', lean: 'luck' })).toBe(false);
  });

  it('make a tailor better with the materials their people prefers', () => {
    expect(prefersMaterial('falcon', ITEMS['mountain-wool'])).toBe(true);
    expect(prefersMaterial('ursine', ITEMS['wolf-pelt'])).toBe(true);
    expect(prefersMaterial('lutran', ITEMS['crab-shell'])).toBe(true);
    expect(prefersMaterial('lutran', ITEMS['mountain-wool'])).toBe(false);
    const c = newCharacter();
    c.race = 'scorpid';
    c.masteries = ['tailoring'];
    const plain = craftQuality(c, RECIPES['wool-coat']!, () => 0.5);
    c.race = 'falcon';
    // Scorpids and Falcons both call Tailoring home; only Falcons prefer wool.
    expect(craftQuality(c, RECIPES['wool-coat']!, () => 0.5)).toBe(plain + 10);
  });

  it('come from shopkeepers with their people, at standard quality', () => {
    const c = newCharacter();
    c.gold = 100;
    buy(c, 'marina', 'traveller-coat', shopMade('Marina', () => 0.5, 'marina'));
    const made = ITEMS[c.inventory.find((s) => s.item.startsWith('traveller-coat~'))!.item]!;
    expect(made.copy).toMatchObject({ quality: 100, people: 'lutran' });
    expect(made.bonus).toEqual({ armor: 2, might: 1 });
  });

  it('turn percentages into dodge, attack speed and regeneration', () => {
    const c = newCharacter();
    const before = { dodge: dodgeChance(c), cd: attackCooldown(c), regen: regenPerSecond(c), energy: energyPerSecond(c) };
    const piece = copyId({ of: 'traveller-coat', quality: 100, maker: { kind: 'player', name: 'X' }, trait: 'light' }, 'a');
    const boots = copyId({ of: 'traveller-coat', quality: 100, maker: { kind: 'player', name: 'X' }, trait: 'warm' }, 'b');
    addItem(c, piece);
    c.equipment = { body: piece, cloak: boots };
    expect(dodgeChance(c)).toBeCloseTo(before.dodge + 0.01);
    expect(regenPerSecond(c)).toBeCloseTo(before.regen * 1.05);
    expect(energyPerSecond(c)).toBe(before.energy);
    expect(attackCooldown(c)).toBe(before.cd);
  });
});
