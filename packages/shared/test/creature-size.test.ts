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
