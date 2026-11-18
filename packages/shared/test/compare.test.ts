import { describe, expect, it } from 'vitest';
import { changeWords, compareGear, newCharacter, replacedBy } from '../src/index.ts';

// The item card's "If you wear it" numbers: what a piece adds against the
// pieces equip() would take off, two-handed weapons and the off hand included.

describe('comparing gear', () => {
  it('compares a weapon with the one in hand', () => {
    const c = newCharacter();
    c.equipment.weapon = 'wooden-sword';
    expect(replacedBy(c, 'golem-club')).toEqual(['wooden-sword']);
    expect(compareGear(c, 'golem-club')).toEqual([{ key: 'attack', delta: 6 }, { key: 'might', delta: 2 }]);
  });

  it('counts the off hand a two-handed weapon frees, as a loss', () => {
    const c = newCharacter();
    c.equipment.weapon = 'wooden-sword';
    c.equipment.offhand = 'temple-lantern';
    expect(replacedBy(c, 'demonhorn-bow')).toEqual(['wooden-sword', 'temple-lantern']);
    const changes = compareGear(c, 'demonhorn-bow');
    expect(changes.map(changeWords)).toEqual(['+9 damage', '+3 Agility', '−1 armour', '−1 Spirit']);
  });

  it('counts the two-handed weapon an off-hand piece takes off', () => {
    const c = newCharacter();
    c.equipment.weapon = 'demonhorn-bow';
    expect(replacedBy(c, 'temple-lantern')).toEqual(['demonhorn-bow']);
  });

  it('shows nothing for things that cannot be worn or change nothing', () => {
    const c = newCharacter();
    c.equipment.weapon = 'wooden-sword';
    expect(compareGear(c, 'wooden-sword')).toEqual([]);
    expect(compareGear(c, 'gold')).toEqual([]);
  });
});
