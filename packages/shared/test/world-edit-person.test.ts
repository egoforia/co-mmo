import { describe, expect, it } from 'vitest';
import { ARCH_TESTBED_REGION, EDIT_KINDS, PERSON_LOOKS, SHOPS, checkEdit, copyDraft, generateRegion, moveDrafts, personValues, pickAt, routineOf, shopOf, stampEdit, type FieldValue, type WorldEdit, type WorldEditDraft } from '../src/index.ts';

// People in the world editor: someone new with a name, look, greeting, shop
// and day; someone already there moved to another floor or changed.

const settings = (more: Record<string, FieldValue> = {}): Record<string, FieldValue> => ({
  name: 'Hesper', look: PERSON_LOOKS[0]!.id, greeting: 'Mind the forge.', wares: 'tools:smithing', buys: true, teaches: 'none', masters: 'smithing', day: 'tireless', ...more,
});

/** The testbed with drafts laid over it, as the editor lays them. */
function lay(drafts: WorldEditDraft[], def = ARCH_TESTBED_REGION) {
  const edits: WorldEdit[] = drafts.map((d, i) => stampEdit(d, { id: `p${i}`, by: 'Test', made: 0 }, {}));
  return generateRegion({ ...def, edits });
}

describe('people in the world editor', () => {
  it('stands someone new with their own words, shop and hours', () => {
    const draft = EDIT_KINDS.person.make({ at: [150, 120] }, settings());
    expect(checkEdit(generateRegion(ARCH_TESTBED_REGION), draft, {})).toBeUndefined();
    const map = lay([draft]);
    const n = map.npcs.find((p) => p.name === 'Hesper')!;
    expect(n).toMatchObject({ id: 'p0:person', x: 150.5, y: 120.5, asset: PERSON_LOOKS[0]!.id, greeting: 'Mind the forge.' });
    expect(shopOf(n)).toMatchObject({ buys: true, masters: ['smithing'] });
    expect(shopOf(n)!.sells.length).toBeGreaterThan(0);
    expect(routineOf(n.id, n.routine).night).toEqual({ place: 'work' });
    // Nothing to offer is no shop at all.
    const plain = lay([EDIT_KINDS.person.make({ at: [150, 120] }, settings({ wares: 'none', buys: false, masters: 'none' }))]).npcs.find((p) => p.name === 'Hesper')!;
    expect(shopOf(plain)).toBeUndefined();
  });

  it('moves someone already there to another floor, keeping who they are', () => {
    const map = generateRegion(ARCH_TESTBED_REGION);
    // A storey to stand on; someone new on the ground goes up there.
    const storey = map.storeys[0]!;
    const made = lay([EDIT_KINDS.person.make({ at: [150, 120] }, settings())]);
    const picked = pickAt(made, [150, 120], 0)!;
    expect(picked).toMatchObject({ kind: 'person', id: 'p0:person', name: 'Hesper' });
    const [move] = moveDrafts(made, picked, [storey.x + 1, storey.y + 1], storey.floor)!;
    expect(move).toEqual({ kind: 'person', at: [storey.x + 1, storey.y + 1], target: 'p0:person', level: storey.floor });
    const moved = lay([EDIT_KINDS.person.make({ at: [150, 120] }, settings()), move!]);
    expect(moved.npcs.filter((p) => p.name === 'Hesper')).toEqual([expect.objectContaining({ id: 'p0:person', floor: storey.floor, greeting: 'Mind the forge.' })]);
  });

  it('changes a land\'s own person, and loads their settings to change', () => {
    const base = generateRegion(ARCH_TESTBED_REGION);
    const marina = { id: 'marina', name: 'Marina the Trader', asset: 'shore-trader', x: 150.5, y: 120.5 };
    base.npcs.push(marina);
    const values = personValues(marina);
    expect(values).toMatchObject({ name: 'Marina the Trader', look: 'shore-trader', wares: 'marina', buys: true, masters: 'fletching', day: 'keep' });
    const change = EDIT_KINDS.person.make({ at: [151, 120], target: 'marina' }, { ...values, greeting: 'Fresh from the tide!' });
    expect(change).not.toHaveProperty('routine');
    expect(checkEdit(base, change, {})).toBeUndefined();
    const copy = copyDraft(base, pickAt(base, [150, 120], 0)!, [152, 120])!;
    expect(copy).toMatchObject({ kind: 'person', name: 'Marina the Trader', shop: SHOPS.marina });
  });

  it('says in plain words what cannot be done', () => {
    const map = generateRegion(ARCH_TESTBED_REGION);
    const good = EDIT_KINDS.person.make({ at: [150, 120] }, settings());
    expect(checkEdit(map, { ...good, name: '' }, {})).toMatch(/name/);
    expect(checkEdit(map, { ...good, look: 'a dragon' }, {})).toBe('Pick a look from the list.');
    expect(checkEdit(map, { ...good, target: 'nobody' }, {})).toBe('That person is no longer here.');
    expect(checkEdit(map, { ...good, shop: { sells: [{ item: 'moonbeam', price: 3 }], teaches: [], buys: false } }, {})).toMatch(/does not know/);
    expect(checkEdit(map, { ...good, routine: { night: { place: 'tavern' as 'work' } } }, {})).toMatch(/does not know/);
  });
});
