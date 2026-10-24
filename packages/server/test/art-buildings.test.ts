import { describe, expect, it } from 'vitest';
import { account, api, start } from './helpers.ts';

describe("the Art tab's Buildings page", () => {
  it('lists every building with how it stands and its furniture, and changes a piece of furniture\'s footprint as a world edit', async () => {
    const { base, store } = await start();
    const steward = account(store, 'Wren', 'steward');
    expect((await api(base, '/api/admin/art/buildings', steward.token)).status).toBe(403);
    const owner = account(store, 'Ego', 'owner');
    const list = async () => (await api(base, '/api/admin/art/buildings', owner.token)).body.buildings as any[];
    const buildings = await list();
    const arcanum = buildings.find((b) => b.style === 'sanctum-arcanum');
    expect(arcanum).toMatchObject({ region: 'sanctum', stands: 'kit', look: 'Timber-framed cottage', house: { status: expect.any(String) } });
    expect(buildings.find((b) => b.style === 'bramble-cottage')).toMatchObject({ stands: 'walls', note: expect.stringContaining('no kit look') });
    const counter = arcanum.furniture.find((f: any) => f.name === 'counter');
    expect(counter).toMatchObject({ footprint: [3, 1], floor: 0, editable: true });

    const edited = await api(base, '/api/world-edits', owner.token, 'POST', { region: 'sanctum', edit: { kind: 'footprint', at: counter.at, footprint: [2, 1] } });
    expect(edited.status).toBe(200);
    const after = (await list()).find((b) => b.style === 'sanctum-arcanum').furniture.find((f: any) => f.name === 'counter');
    expect(after.footprint).toEqual([2, 1]);
  });
});
