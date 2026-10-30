import { describe, expect, it } from 'vitest';
import type { ContentEntry } from '@co-mmo/shared';
import { lookArt, updateContent } from '../src/wished.ts';

const look = { hook: 'a striped scarf', body: 'small and round', color: '#e8c66a', mood: 'cheerful' };

function entry(id: string, wisher: string, extra: Partial<ContentEntry> = {}, race?: 'ursine'): ContentEntry {
  return {
    id, wisher: { id: wisher, name: wisher }, regionId: 'sanctum', at: 1, tier: 'minor', title: 'Look', summary: '', status: 'granted', favor: 0,
    definition: { kind: 'player', name: wisher, description: 'A scarf.', look, ...(race ? { race } : {}) },
    ...extra,
  } as ContentEntry;
}

describe('player bodies', () => {
  it("wears their people's body until their own look is painted", () => {
    updateContent([entry('a', 'bear', {}, 'ursine'), entry('b', 'old')], true);
    expect(lookArt('bear')).toBe('bramble-ursine');
    // A look from before peoples keeps its own placeholder.
    expect(lookArt('old')).toBe('wished-b');
    expect(lookArt('nobody')).toBeUndefined();
  });

  it('wears their own look once it is painted', () => {
    updateContent([entry('a', 'bear', { art: '/wished-art/a.png' }, 'ursine')], true);
    expect(lookArt('bear')).toBe('wished-a');
  });
});
