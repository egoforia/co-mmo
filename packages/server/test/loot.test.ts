import { afterEach, describe, expect, it } from 'vitest';
import { lootTable } from '@co-mmo/shared';
import { account, api, joined, start, stop, wish } from './helpers.ts';

afterEach(stop);

describe('loot', () => {
  it("is wished by players, changed and undone in God's View, and says who did each", async () => {
    const { store, ws, base } = await start();
    const owner = account(store, 'Mara', 'owner');
    const c = await joined(ws, owner.token);
    const card = await wish(c, 'I wish walking mushrooms would drop goat horns');
    expect(card).toMatchObject({ tier: 'moderate', cost: 6, where: 'On every Walking Mushroom that is defeated' });
    await c.waitFor((m) => m.t === 'god' && m.say.includes('press E beside its body'));
    expect(store.content[0]).toMatchObject({ status: 'granted', definition: { kind: 'loot', creature: 'walking-mushroom', mode: 'add' } });
    expect(lootTable('walking-mushroom').map((l) => l.item)).toEqual(['mushroom-cap', 'tonic', 'goat-horn']);

    const mushroom = async () => (await api(base, '/api/admin/loot', owner.token)).body.creatures.find((x: any) => x.id === 'walking-mushroom');
    let m = await mushroom();
    expect(m.lines.map((l: any) => [l.item, l.source.kind, l.source.by])).toEqual([
      ['mushroom-cap', 'built-in', undefined], ['tonic', 'built-in', undefined], ['goat-horn', 'wish', 'Mara'],
    ]);

    // Stewards may change it too; players may not.
    const steward = account(store, 'Ilya', 'steward');
    const player = account(store, 'Pell');
    expect((await api(base, '/api/admin/loot/walking-mushroom', player.token, 'PUT', { drops: [] })).status).toBe(403);
    const set = await api(base, '/api/admin/loot/walking-mushroom', steward.token, 'PUT', { drops: [{ item: 'tonic', chance: 1, qty: 2 }] });
    expect(set.status).toBe(200);
    m = await mushroom();
    expect(m.lines).toEqual([{ item: 'tonic', name: 'Tonic', chance: 1, qty: 2, source: expect.objectContaining({ kind: 'gods-view', by: 'Ilya', entry: set.body.id }) }]);
    expect(m.changes.map((h: any) => [h.by, h.godsView])).toEqual([['Ilya', true], ['Mara', false]]);
    expect(store.contentById(set.body.id)).toMatchObject({ godsView: true, wisher: { name: 'Ilya' }, favor: 0 });
    expect((await api(base, '/api/admin/loot/nobody', owner.token, 'PUT', { drops: [] })).body.message).toMatch(/creature that lives/);

    // Undoing the change brings back what it dropped before.
    expect((await api(base, `/api/admin/content/${set.body.id}/rollback`, owner.token, 'POST')).status).toBe(200);
    m = await mushroom();
    expect(m.lines.map((l: any) => l.item)).toEqual(['mushroom-cap', 'tonic', 'goat-horn']);
    expect(m.changes[0]).toMatchObject({ status: 'rolled-back' });
  });
});
