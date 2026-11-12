import { describe, expect, it } from 'vitest';
import { ARCH_TESTBED_REGION, CREATURES, EDIT_KINDS, checkEdit, copyDraft, generateRegion, pickAt, stampEdit, tunedCreature, type FieldValue, type WorldEdit, type WorldEditDraft } from '../src/index.ts';

// Monsters in full: a spawn's level, ways and hours, chosen when it is laid
// or changed after, a patrol path drawn from a home, and a spawn taken away
// as one.

const creatures = Object.fromEntries(Object.entries(CREATURES).map(([id, c]) => [id, { name: c.name, art: c.art, level: c.level }]));
const settings = (more: Record<string, FieldValue> = {}): Record<string, FieldValue> => ({ creature: 'thorn-wolf', count: 3, monsterLevel: 0, behavior: 'own', active: 'own', ...more });

/** The testbed with drafts laid over it, as the editor lays them. */
function lay(drafts: WorldEditDraft[]) {
  const edits: WorldEdit[] = drafts.map((d, i) => stampEdit(d, { id: `m${i}`, by: 'Test', made: 0 }, creatures));
  return generateRegion({ ...ARCH_TESTBED_REGION, edits });
}

const at: [number, number] = [150, 120];
const ofSpawn = (map: ReturnType<typeof lay>, id = 'm0') => map.creatures.filter((c) => c.spawn === id);

describe('monsters in the world editor', () => {
  it('lays a spawn at another level, with other ways and hours', () => {
    const draft = EDIT_KINDS.spawn.make({ at }, settings({ monsterLevel: 6, behavior: 'guard', active: 'day' }));
    expect(draft).toMatchObject({ monsterLevel: 6, behavior: 'guard', active: 'day' });
    // Kept at its kind's, nothing extra is saved.
    expect(EDIT_KINDS.spawn.make({ at }, settings())).toEqual({ kind: 'spawn', creature: 'thorn-wolf', at, count: 3 });
    expect(checkEdit(generateRegion(ARCH_TESTBED_REGION), draft, creatures)).toBeUndefined();
    const wolves = ofSpawn(lay([draft]));
    expect(wolves).toHaveLength(3);
    expect(wolves.every((w) => w.level === 6 && w.behavior === 'guard' && w.active === 'day')).toBe(true);
    const def = tunedCreature(CREATURES['thorn-wolf']!, wolves[0]);
    expect(def).toMatchObject({ level: 6, behavior: 'guard', active: 'day', gold: [6, 18] });
    expect(def.hp).toBeGreaterThan(CREATURES['thorn-wolf']!.hp);
    expect(tunedCreature(CREATURES['thorn-wolf']!, {})).toBe(CREATURES['thorn-wolf']);
  });

  it('changes a whole spawn from one home, and puts its own ways back', () => {
    const spawn = EDIT_KINDS.spawn.make({ at }, settings({ monsterLevel: 6 }));
    const home = ofSpawn(lay([spawn]))[1]!;
    const tile: [number, number] = [Math.floor(home.x), Math.floor(home.y)];
    const change = EDIT_KINDS.monsters.make({ at: tile }, { monsterLevel: 0, behavior: 'chase', active: 'night' });
    expect(checkEdit(lay([spawn]), change, creatures)).toBeUndefined();
    const changed = ofSpawn(lay([spawn, change]));
    expect(changed.every((w) => w.level === undefined && w.behavior === 'chase' && w.active === 'night')).toBe(true);
    expect(checkEdit(lay([spawn]), { ...change, at: [10, 10] }, creatures)).toMatch(/monster’s home/);
  });

  it('gives a spawn a patrol path drawn from a home', () => {
    const spawn = EDIT_KINDS.spawn.make({ at }, settings({ count: 2 }));
    const tiles: [number, number][] = [at];
    for (let x = 1; x <= 9; x++) tiles.push([at[0] + x, at[1]]);
    const path = EDIT_KINDS.patrol.make({ at, tiles }, {});
    expect(path.route).toEqual([[151, 120], [154, 120], [157, 120], [159, 120]]);
    expect(checkEdit(lay([spawn]), path, creatures)).toBeUndefined();
    const walkers = ofSpawn(lay([spawn, path]));
    expect(walkers.every((w) => w.behavior === 'patrol' && w.route?.length === 4 && w.route[0]!.x === 151.5)).toBe(true);
    expect(checkEdit(lay([spawn]), { ...path, route: [[151, 120]] }, creatures)).toMatch(/at least/);
  });

  it('takes a spawn away as one, and copies a monster with its ways', () => {
    const spawn = EDIT_KINDS.spawn.make({ at }, settings({ monsterLevel: 6, behavior: 'guard' }));
    const map = lay([spawn]);
    const picked = pickAt(map, at, 0)!;
    expect(picked.details.join(' ')).toMatch(/spawn of 3/);
    expect(copyDraft(map, picked, [140, 120])).toMatchObject({ kind: 'spawn', creature: 'thorn-wolf', count: 1, monsterLevel: 6, behavior: 'guard' });
    const gone = lay([spawn, { kind: 'remove', at }]);
    expect(ofSpawn(gone)).toHaveLength(0);
  });
});
