import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { GATHER_SPOT_ANCHORS, readyOfState } from '../src/assets/gather-spot-anchors.ts';
import { account, api, start } from './helpers.ts';

const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const anchorDir = join(repo, 'assets/anchors');

type Item = { id: string; repaintable: boolean; why?: string; source: string };

describe('spot state pictures', () => {
  it('describes a Picked and a Growing picture for every spot, painted from its Ready picture', () => {
    const picked = GATHER_SPOT_ANCHORS.find((a) => a.id === 'spot-sanctum-sage-picked')!;
    expect(picked).toMatchObject({ name: 'Sage Bush, picked', references: ['spot-sanctum-sage'], kind: 'prop' });
    expect(picked.silhouetteHook).toMatch(/^the very same .* as in the reference picture, just gathered/);
    expect(GATHER_SPOT_ANCHORS.find((a) => a.id === 'spot-sanctum-sage-growing')?.silhouetteHook).toMatch(/growing back/);
    expect(readyOfState('spot-sanctum-sage-growing')).toBe('spot-sanctum-sage');
    expect(readyOfState('spot-sanctum-sage')).toBeUndefined();
  });

  it('waits for the Ready picture before its states can be painted', async () => {
    const { base, store } = await start({ anchorDir });
    const owner = account(store, 'Ego', 'owner');
    const items = (await api(base, '/api/admin/art', owner.token)).body.items as Item[];
    expect(items.find((i) => i.id === 'spot-sanctum-sage-picked')).toMatchObject({ repaintable: false, why: expect.stringMatching(/Ready picture first/) });
    expect((await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'paint-group', group: 'spot-states:sanctum-sage' })).status).toBe(409);
  }, 30_000);

  it('paints a spot\'s missing states, or a land\'s, in one review', async () => {
    // The Ready picture painted, as a repaint leaves it.
    const artDir = await mkdtemp(join(tmpdir(), 'co-mmo-art-'));
    await mkdir(join(artDir, 'redone'), { recursive: true });
    await writeFile(join(artDir, 'redone', 'manifest.json'), JSON.stringify({ 'spot-sanctum-sage': { file: 'wished-art/redone/spot-sanctum-sage.png', kind: 'prop', width: 128, height: 128, redone: 1 } }));
    const { base, store } = await start({ anchorDir, artDir });
    const owner = account(store, 'Ego', 'owner');
    const items = (await api(base, '/api/admin/art', owner.token)).body.items as Item[];
    expect(items.find((i) => i.id === 'spot-sanctum-sage-picked')).toMatchObject({ repaintable: true, source: 'missing' });
    const one = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'paint-group', group: 'spot-states:sanctum-sage' });
    expect(one.status).toBe(200);
    expect(one.body.title).toBe('Paint 2 spot state pictures: Sage Bush');
    expect(one.body.parts.map((p: { name: string }) => p.name)).toEqual(['Sage Bush, picked', 'Sage Bush, growing back']);
    // The land's other spots have no Ready picture yet, so only the sage's states are offered for it.
    const land = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'paint-group', group: 'spot-states:sanctum' });
    expect(land.body.parts).toHaveLength(2);
  }, 30_000);
});
