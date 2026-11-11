import { describe, expect, it } from 'vitest';
import { CREATURES, EDIT_KINDS, WORLD_REGIONS, checkEdit, editShapes, editWords, generateRegion, stampEdit, type WorldEditDraft } from '../src/index.ts';

describe('the edit kinds registry', () => {
  it('describes every kind for the editors and the AI Map Architect', () => {
    for (const [id, kind] of Object.entries(EDIT_KINDS)) {
      expect(kind.kind).toBe(id);
      expect(kind.name.length).toBeGreaterThan(0);
      expect(kind.hint).toMatch(/\.$/);
      expect(kind.shape).toContain(`"kind":"${id}"`);
      for (const f of kind.fields) if (f.type === 'choice') expect(Array.isArray(f.choices({ creatures: CREATURES }))).toBe(true);
    }
    expect(editShapes()).toHaveLength(Object.keys(EDIT_KINDS).length);
  });

  it('keeps only a kind\'s own fields when stamping, and the monster\'s name and picture on a spawn', () => {
    const sent = { kind: 'spawn', creature: 'walking-mushroom', at: [3, 4], count: 2, name: 'Fake', by: 'Someone else', extra: 1 } as unknown as WorldEditDraft;
    const edit = stampEdit(sent, { id: 'a1', by: 'Ego', made: 5 }, CREATURES);
    expect(edit).toEqual({ kind: 'spawn', creature: 'walking-mushroom', at: [3, 4], count: 2, name: 'Walking Mushroom', asset: 'woods-mushroom', id: 'a1', by: 'Ego', made: 5 });
    expect(editWords(edit)).toBe('2 Walking Mushroom at 3, 4');
  });

  it('refuses a kind it does not know, in plain words', () => {
    const map = generateRegion(WORLD_REGIONS[0]!);
    expect(checkEdit(map, { kind: 'teleporter', at: [1, 1] } as unknown as WorldEditDraft, CREATURES)).toBe('The editor does not know that kind of change.');
    expect(checkEdit(map, { kind: 'toString' } as unknown as WorldEditDraft, CREATURES)).toBe('The editor does not know that kind of change.');
  });
});
