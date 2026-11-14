import { afterEach, describe, expect, it } from 'vitest';
import { CREATURES, creatureSize } from '@co-mmo/shared';
import { creatureView } from '../src/region-views.ts';
import { account, api, start, stop } from './helpers.ts';

afterEach(stop);

describe("a monster's size", () => {
  it("is chosen in God's View for every monster of a kind, shown to browsers, and undone", async () => {
    const { store, base } = await start();
    const owner = account(store, 'Mara', 'owner');
    const player = account(store, 'Pell');
    const wolf = () => creatureView({ id: 'w1', kind: 'thorn-wolf', def: CREATURES['thorn-wolf']!, x: 1, y: 1, hp: 10 });
    const overview = async () => (await api(base, '/api/admin/loot', owner.token)).body.creatures.find((x: any) => x.id === 'thorn-wolf');

    expect(creatureSize('thorn-wolf')).toBe('medium');
    expect(wolf().size).toBeUndefined();
    expect(await overview()).toMatchObject({ size: 'medium', ownSize: 'medium' });

    expect((await api(base, '/api/admin/creature-size/thorn-wolf', player.token, 'PUT', { size: 'colossal' })).status).toBe(403);
    expect((await api(base, '/api/admin/creature-size/thorn-wolf', owner.token, 'PUT', { size: 'huge' })).body.message).toMatch(/Choose one of the sizes/);
    expect((await api(base, '/api/admin/creature-size/nobody', owner.token, 'PUT', { size: 'tiny' })).body.message).toMatch(/no longer lives/);

    const set = await api(base, '/api/admin/creature-size/thorn-wolf', owner.token, 'PUT', { size: 'colossal' });
    expect(set.status).toBe(200);
    expect(store.contentById(set.body.id)).toMatchObject({ godsView: true, status: 'granted', definition: { kind: 'size', creature: 'thorn-wolf', size: 'colossal' } });
    expect(creatureSize('thorn-wolf')).toBe('colossal');
    expect(wolf().size).toBe('colossal');
    const after = await overview();
    expect(after).toMatchObject({ size: 'colossal', ownSize: 'medium' });
    expect(after.changes[0]).toMatchObject({ by: 'Mara', godsView: true, status: 'granted' });
    // Other kinds keep their own size.
    expect(creatureSize('bark-golem')).toBe('high');

    expect((await api(base, `/api/admin/content/${set.body.id}/rollback`, owner.token, 'POST')).status).toBe(200);
    expect(creatureSize('thorn-wolf')).toBe('medium');
    expect(wolf().size).toBeUndefined();
  });
});
