import { describe, expect, it } from 'vitest';
import { CREATURES, CREATURE_HEIGHTS, applyContent, creatureHeight, creatureSize, validateSize, type ContentEntry } from '@co-mmo/shared';

const entry = (id: string, at: number, size: string, status: ContentEntry['status'] = 'granted'): ContentEntry => {
  const def = validateSize({ creature: 'walking-mushroom', size });
  if (typeof def === 'string') throw new Error(def);
  return { id, at, status, wisher: { id: 'o', name: 'Owner' }, tier: 'minor', title: def.name, summary: def.description, definition: def } as ContentEntry;
};

describe('creature sizes', () => {
  it('every launch monster has a size', () => {
    for (const [id, def] of Object.entries(CREATURES)) expect(def.size, id).toBeDefined();
  });

  it('the newest standing choice wins, and undoing it goes back', () => {
    expect(creatureSize('walking-mushroom')).toBe('small');
    applyContent(entry('a', 1, 'high'));
    applyContent(entry('b', 2, 'tiny'));
    expect(creatureSize('walking-mushroom')).toBe('tiny');
    expect(creatureHeight('walking-mushroom')).toBe(CREATURE_HEIGHTS.tiny);
    applyContent(entry('b', 2, 'tiny', 'rolled-back'));
    expect(creatureSize('walking-mushroom')).toBe('high');
    applyContent(entry('a', 1, 'high', 'rolled-back'));
    expect(creatureSize('walking-mushroom')).toBe('small');
  });

  it('says what is wrong in words', () => {
    expect(validateSize({ creature: 'nobody', size: 'tiny' })).toMatch(/no longer lives/);
    expect(validateSize({ creature: 'walking-mushroom', size: 'giant' })).toMatch(/tiny, small/);
    expect(validateSize({ creature: 'walking-mushroom', size: 'high' })).toMatchObject({ kind: 'size', description: 'Every Walking Mushroom stands tall.' });
  });
});

describe('picking a monster in the editor', () => {
  it("finds a live monster's home from its id, and names its kind", async () => {
    const { monsterHome, pickAt } = await import('@co-mmo/shared');
    const map = { creatures: [{ kind: 'walking-mushroom', name: 'Walking Mushroom', asset: 'woods-mushroom', x: 4.5, y: 7.5 }, { kind: 'thorn-wolf', name: 'Thorn Wolf', asset: 'woods-thorn-wolf', x: 9.2, y: 3.1, floor: 1 }], npcs: [], spots: [], landmarks: [], stairways: [], buildings: [] } as never;
    expect(monsterHome(map, 'woods', 'woods-thorn-wolf-1')).toEqual({ at: [9, 3], level: 1 });
    expect(monsterHome(map, 'woods', 'woods-walking-mushroom-1')).toBeUndefined();
    expect(monsterHome(map, 'shore', 'woods-thorn-wolf-1')).toBeUndefined();
    expect(monsterHome(map, 'woods', 'walking-mushroom-3')).toBeUndefined();
    expect(pickAt(map, [4, 7], 0)).toMatchObject({ kind: 'monster', creature: 'walking-mushroom' });
  });
});
