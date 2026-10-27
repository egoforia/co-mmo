import { afterEach, describe, expect, it } from 'vitest';
import {
  CREATURES,
  ITEMS,
  LAND_CREATURES,
  WEAPON_FAMILIES,
  WEAPON_FAMILY_IDS,
  WishError,
  attackCooldown,
  attackPower,
  attackReach,
  blocking,
  creatureFromWish,
  critChance,
  equip,
  familyFromWords,
  itemFromWish,
  newCharacter,
  staggerChance,
  trainedIn,
  validateDefinition,
  type CallingId,
  type Character,
  type ItemWish,
  type WeaponFamily,
} from '../src/index.ts';

const look = { hook: 'a test', body: 'b', color: '#808080', mood: 'calm' };

/** A level-1 character holding a plain item of this family (no bonus of its own). */
function wielding(family: WeaponFamily, calling?: CallingId): Character {
  ITEMS[`test-${family}`] = { name: family, kind: 'equipment', art: 'x', description: '', slot: 'weapon', weapon: family };
  const c = newCharacter();
  c.equipment.weapon = `test-${family}`;
  if (calling) c.calling = calling;
  return c;
}

afterEach(() => {
  for (const f of WEAPON_FAMILY_IDS) delete ITEMS[`test-${f}`];
  delete ITEMS['test-shield'];
});

describe('weapon families', () => {
  it('every existing weapon has its family from docs/classes.md', () => {
    expect(ITEMS['wooden-sword']!.weapon).toBe('sword');
    expect(ITEMS['crab-lance']!.weapon).toBe('spear');
    expect(ITEMS['coral-spear']!.weapon).toBe('spear');
    expect(ITEMS['golem-club']!.weapon).toBe('hammer');
    expect(ITEMS['temple-lantern']!.offhand).toBe('lantern');
    for (const def of Object.values(ITEMS)) if (def.slot === 'weapon') expect(def.weapon, def.name).toBeDefined();
  });

  it('a weapon hit is the family damage plus level plus each attribute times its scale', () => {
    // Every attribute 3 at level 1: a sword is 3 + 1 + 3 × 0.6 + 3 × 0.5 = 7.3.
    expect(attackPower(wielding('sword'))).toBe(7);
    // A greatsword scales harder: 6 + 1 + 3 × 1.1 + 3 × 0.3 = 11.2.
    expect(attackPower(wielding('greatsword'))).toBe(11);
    // A staff scales with Wit: 3 + 1 + 3 × 0.8 + 3 × 0.2 = 7.
    expect(attackPower(wielding('staff'))).toBe(7);
    // The item's own damage adds on top.
    const c = wielding('sword');
    c.equipment.weapon = 'wooden-sword';
    expect(attackPower(c)).toBe(9);
  });

  it('each family has its own speed and reach, and Agility quickens any weapon by up to 30%', () => {
    expect(attackCooldown(wielding('twin-blades'))).toBeCloseTo(0.55 / 1.03, 2);
    expect(attackCooldown(wielding('greatsword'))).toBeCloseTo(1.3 / 1.03, 2);
    expect(attackReach(wielding('sword'))).toBe(1.6);
    expect(attackReach(wielding('spear'))).toBe(2.2);
    expect(attackReach(wielding('bow'))).toBe(6);
    expect(WEAPON_FAMILIES.bow.ranged).toBe(true);
    const quick = wielding('twin-blades');
    quick.stats.agility = 60;
    // 0.55 / 1.3 is 0.42; never quicker than 0.35 however nimble.
    expect(attackCooldown(quick)).toBeCloseTo(0.42, 2);
    quick.equipment.weapon = undefined;
    expect(attackReach(quick)).toBe(1.6);
  });

  it('a weapon outside the Calling\'s training deals 30% less and loses its extra; no Calling yet is trained in all', () => {
    expect(trainedIn({}, 'bow')).toBe(true);
    expect(trainedIn({ calling: 'ranger' }, 'bow')).toBe(true);
    expect(trainedIn({ calling: 'warden' }, 'bow')).toBe(false);
    expect(trainedIn({ calling: 'warden' }, 'shield')).toBe(true);
    const trained = wielding('greatsword', 'duelist');
    const untrained = wielding('greatsword', 'warden');
    expect(attackPower(untrained)).toBe(Math.round(11.2 * 0.7));
    expect(attackPower(trained)).toBe(11);
    expect(critChance(wielding('twin-blades'))).toBeCloseTo(critChance(newCharacter()) + 0.05);
    expect(critChance(wielding('twin-blades', 'ranger'))).toBeCloseTo(critChance(newCharacter()));
    expect(staggerChance(trained)).toBeCloseTo(0.03);
    expect(staggerChance(untrained)).toBe(0);
    expect(staggerChance(wielding('sword'))).toBe(0);
  });

  it('a shield blocks by its chance and amount plus half of Might; a two-handed weapon frees the off hand', () => {
    ITEMS['test-shield'] = { name: 'Shield', kind: 'equipment', art: 'x', description: '', slot: 'offhand', offhand: 'shield', block: 0.6, blockAmount: 4 };
    const c = newCharacter();
    c.inventory.push({ item: 'test-shield', qty: 1 }, { item: 'test-greatsword', qty: 1 });
    expect(blocking(c)).toEqual({ chance: 0, amount: 0 });
    equip(c, 'test-shield');
    expect(blocking(c)).toEqual({ chance: 0.4, amount: 5.5 });
    expect(blocking({ ...c, calling: 'ranger' } as Character)).toEqual({ chance: 0, amount: 0 });
    wielding('greatsword');
    equip(c, 'test-greatsword');
    expect(c.equipment.offhand).toBeUndefined();
    expect(c.inventory.some((s) => s.item === 'test-shield')).toBe(true);
    equip(c, 'test-shield');
    expect(c.equipment.weapon).toBeUndefined();
  });
});

describe('creature defence', () => {
  it('creatures wear Armor about their level and Ward about half; tough ones more armour, the undead more ward', () => {
    expect(CREATURES['walking-mushroom']).toMatchObject({ armor: 1, ward: 0 });
    expect(LAND_CREATURES['thorn-wolf']).toMatchObject({ armor: 2, ward: 1 });
    expect(LAND_CREATURES['sand-wyrm']).toMatchObject({ armor: 8, ward: 1 });
    expect(LAND_CREATURES['crypt-skeleton']).toMatchObject({ armor: 2, ward: 3 });
    const wish = { kind: 'creature', name: 'Bog Hopper', description: 'A frog.', behavior: 'wander', level: 4, count: 1, look } as const;
    expect(creatureFromWish('w1', wish)).toMatchObject({ armor: 4, ward: 2 });
    expect(creatureFromWish('w2', { ...wish, name: 'Bog Skeleton' })).toMatchObject({ armor: 2, ward: 4 });
  });
});

describe('wished weapons', () => {
  const weapon = (extra: Record<string, unknown>) => validateDefinition({ kind: 'item', name: 'Thorn Edge', description: 'Sharp.', itemKind: 'weapon', look, ...extra }) as ItemWish;

  it('a wished weapon keeps the family it names, and one that does not exist is refused', () => {
    expect(weapon({ family: 'bow' }).family).toBe('bow');
    expect(() => weapon({ family: 'laser' })).toThrow(WishError);
    expect(() => weapon({ family: 'shield' })).toThrow(/must be one of/);
  });

  it('a wished weapon that names no family gets one from its words, else it is a sword', () => {
    expect(weapon({ name: 'Moon Javelin' }).family).toBe('javelins');
    expect(weapon({ name: 'Old Oak Staff' }).family).toBe('staff');
    expect(weapon({}).family).toBe('sword');
    expect(familyFromWords('Greatsword of Dawn')).toBe('greatsword');
    expect(familyFromWords('Sword of the Hundred Bells')).toBe('sword');
    expect(familyFromWords('Silver Bell-Mace')).toBe('bell-mace');
  });

  it('granted, a wished weapon carries its family and a wished shield blocks by its rarity', () => {
    expect(itemFromWish('w-bow', weapon({ family: 'bow' })).weapon).toBe('bow');
    // Older wishes saved before families get theirs from their words.
    expect(itemFromWish('w-old', { kind: 'item', name: 'Driftwood Axe', description: '', itemKind: 'weapon', rarity: 'common', look }).weapon).toBe('axe');
    const shield = validateDefinition({ kind: 'item', name: 'Oak Buckler', description: 'Round.', itemKind: 'offhand', rarity: 'uncommon', look }) as ItemWish;
    expect(shield.family).toBe('shield');
    expect(itemFromWish('w-shield', shield)).toMatchObject({ offhand: 'shield', block: 0.2, blockAmount: 4 });
  });
});
