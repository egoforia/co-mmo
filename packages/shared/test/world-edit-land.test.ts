import { describe, expect, it } from 'vitest';
import { ARCH_TESTBED_REGION, CREATURES, EDIT_KINDS, QUESTS, Tile, checkEdit, generateRegion, newCharacter, questOffered, stampEdit, type FieldValue, type WorldEdit, type WorldEditDraft } from '../src/index.ts';

// Quests on the land's people, the land's own settings, and its scenery.

const creatures = Object.fromEntries(Object.entries(CREATURES).map(([id, c]) => [id, { name: c.name, art: c.art, level: c.level }]));

/** The testbed with drafts laid over it, as the editor lays them. */
function lay(drafts: WorldEditDraft[]) {
  const edits: WorldEdit[] = drafts.map((d, i) => stampEdit(d, { id: `q${i}`, by: 'Test', made: 0 }, creatures));
  return generateRegion({ ...ARCH_TESTBED_REGION, edits });
}

const plain = generateRegion(ARCH_TESTBED_REGION);
const person = EDIT_KINDS.person.make({ at: [150, 120] }, { name: 'Hesper', look: 'shore-trader', greeting: 'Hello.', wares: 'none', buys: false, teaches: 'none', masters: 'none', day: 'keep' });
const quest = (more: Record<string, FieldValue> = {}) => EDIT_KINDS.quest.make({ at: [150, 120], target: 'q0:person' }, {
  title: 'Wolves at the Gate', offer: 'The wolves keep me up at night.', thanks: 'I can sleep again.', goal: 'defeat', creature: 'thorn-wolf', item: 'tonic', count: 4, xp: 40, gold: 15, ...more,
});

describe('quests, land settings and scenery in the world editor', () => {
  it('gives a person a quest, offered only while the land lays it', () => {
    const withPerson = lay([person]);
    expect(checkEdit(withPerson, quest(), creatures)).toBeUndefined();
    const map = lay([person, quest()]);
    expect(map.quests).toEqual(['q1:quest']);
    expect(QUESTS['q1:quest']).toMatchObject({ title: 'Wolves at the Gate', giver: 'q0:person', goal: { kind: 'defeat', creature: 'thorn-wolf', count: 4 }, reward: { xp: 40, gold: 15 }, edit: true });
    const c = newCharacter();
    expect(questOffered(c, 'q0:person', map)).toBe('q1:quest');
    // A land that no longer lays it (a draft, or taken back) does not offer it.
    expect(questOffered(c, 'q0:person', withPerson)).toBeUndefined();
    expect(quest({ goal: 'gather', item: 'tonic', count: 3 }).goal).toEqual({ kind: 'gather', items: [{ item: 'tonic', qty: 3 }] });
    expect(checkEdit(withPerson, { ...quest(), target: 'nobody' }, creatures)).toBe('Click the person who gives the quest.');
    expect(checkEdit(withPerson, quest({ title: '' }), creatures)).toMatch(/title/);
  });

  it('sets the land\'s weather and where players arrive', () => {
    const draft = EDIT_KINDS.land.make({ at: [140, 110] }, { weather: 'snow', arrive: true });
    expect(checkEdit(plain, draft, creatures)).toBeUndefined();
    const map = lay([draft]);
    expect(map.weather).toBe('snow');
    expect(map.spawn).toEqual({ x: 140.5, y: 110.5 });
    expect(lay([draft, EDIT_KINDS.land.make({ at: [0, 0] }, { weather: 'sky', arrive: false })]).weather).toBeUndefined();
  });

  it('grows trees and rocks over a patch, and clears them again', () => {
    const grow = EDIT_KINDS.scenery.make({ at: [150, 120] }, { trees: '3', rocks: '2', radius: 6 });
    expect(checkEdit(plain, grow, creatures)).toBeUndefined();
    const grown = lay([grow]);
    const count = (map: typeof grown, t: Tile) => { let n = 0; for (let y = 114; y <= 126; y++) for (let x = 144; x <= 156; x++) if (map.tiles[y * map.width + x] === t) n++; return n; };
    expect(count(grown, Tile.Tree)).toBeGreaterThan(10);
    const cleared = lay([grow, EDIT_KINDS.scenery.make({ at: [150, 120] }, { trees: '0', rocks: '0', radius: 6 })]);
    expect(count(cleared, Tile.Tree) + count(cleared, Tile.Rock)).toBe(0);
    expect(checkEdit(plain, EDIT_KINDS.scenery.make({ at: [Math.floor(plain.spawn.x), Math.floor(plain.spawn.y)] }, { trees: '2', rocks: '1', radius: 3 }), creatures)).toMatch(/arrive/);
  });
});
