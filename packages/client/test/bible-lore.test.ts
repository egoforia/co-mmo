import { describe, expect, it } from 'vitest';
import { CALLINGS, CALLING_IDS, RACES, RACE_IDS } from '@co-mmo/shared';
import { LORE_CHAPTERS } from '../src/bible/lore.ts';

describe('the Bible tells the story', () => {
  const html = (id: string) => LORE_CHAPTERS.find((c) => c.id === id)!.html({} as any);

  it('has the world, peoples, attributes and Callings chapters', () => {
    expect(LORE_CHAPTERS.map((c) => c.id)).toEqual(['world', 'peoples', 'attributes', 'callings']);
    expect(html('world')).toContain('The Hush');
  });

  it('names every people and Calling the game has, with both Paths', () => {
    for (const id of RACE_IDS) expect(html('peoples')).toContain(RACES[id].traitName);
    const callings = html('callings');
    for (const id of CALLING_IDS) {
      expect(callings).toContain(CALLINGS[id].name);
      for (const p of CALLINGS[id].paths) expect(callings).toContain(p.name);
    }
  });
});
