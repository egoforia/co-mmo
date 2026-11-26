import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { fitOf } from '@co-mmo/shared';
import { pictureGroup, stairName, studioAssets } from '../src/art-studio/assets.ts';
import { account, api, start } from './helpers.ts';

const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const anchorDir = join(repo, 'assets/anchors');

describe('the Art Studio asset browser list', () => {
  it('lists every picture, walker, stairway and sound once, for the Owner only', async () => {
    const { base, store } = await start({ anchorDir });
    const owner = account(store, 'Ego', 'owner');
    const steward = account(store, 'Sam', 'steward');
    expect((await api(base, '/api/admin/art/assets', steward.token)).status).toBe(403);
    const { status, body } = await api(base, '/api/admin/art/assets', owner.token);
    expect(status).toBe(200);
    const assets = body.assets as { id: string; group: string; footprint?: { width: number } }[];
    const ids = assets.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(assets.map((a) => a.group));
    for (const g of ['characters', 'monsters', 'items', 'scenery', 'pieces']) expect(groups).toContain(g);
    expect(assets.find((a) => a.id === 'sanctum-shrine')).toMatchObject({ group: 'pieces', footprint: { width: 2, height: 1 } });
  }, 30_000);

  it('saves a fit from the Studio as an entry undone like a wish, and puts it back', async () => {
    const { base, store } = await start({ anchorDir });
    const owner = account(store, 'Ego', 'owner');
    const steward = account(store, 'Sam', 'steward');
    expect((await api(base, '/api/admin/art/fit', steward.token, 'POST', { asset: 'sanctum-shrine', offset: [4, -2] })).status).toBe(403);
    expect((await api(base, '/api/admin/art/fit', owner.token, 'POST', { asset: 'sanctum-shrine', offset: [999, 0] })).status).toBe(400);
    const saved = await api(base, '/api/admin/art/fit', owner.token, 'POST', { asset: 'sanctum-shrine', offset: [4, -2], scale: 0.95 });
    expect(saved.status).toBe(200);
    expect(fitOf('sanctum-shrine')).toMatchObject({ offset: [4, -2], scale: 0.95 });
    expect(store.content.find((r) => r.id === saved.body.id)?.definition).toMatchObject({ kind: 'fit' });
    const listed = (await api(base, '/api/admin/art/assets', owner.token)).body.assets as { id: string; fit?: unknown }[];
    expect(listed.find((a) => a.id === 'sanctum-shrine')?.fit).toMatchObject({ offset: [4, -2] });
    expect((await api(base, '/api/admin/art/fit', owner.token, 'DELETE', { asset: 'sanctum-shrine' })).status).toBe(200);
    expect(fitOf('sanctum-shrine')).toBeUndefined();
  }, 30_000);

  it('sorts pictures into the browser groups', () => {
    const place = { tab: 'biomes' as const, page: 'Sanctum' };
    expect(pictureGroup({ id: 'spot-sage', kind: 'prop', place })).toBe('spots');
    expect(pictureGroup({ id: 'inn-furniture-table', kind: 'building', place })).toBe('pieces');
    expect(pictureGroup({ id: 'inn-exterior', kind: 'building', place })).toBe('buildings');
    expect(pictureGroup({ id: 'sanctum-rock', kind: 'prop', place })).toBe('scenery');
    expect(pictureGroup({ id: 'fx-x', kind: 'effect', place: { tab: 'hud', page: 'x' } })).toBe('hud');
  });

  it('adds shipped stairs and ladders, standing on their tiles', () => {
    const shipped = { 'stairs-frostpeak-up': { file: 'art/stairs-frostpeak-up.png', kind: 'prop', width: 256, height: 256 }, 'ladder-down': { file: 'art/ladder-down.png', kind: 'prop', width: 256, height: 256 } };
    const list = studioAssets({ items: [], walkers: [], sounds: [] }, shipped);
    expect(list).toEqual([
      expect.objectContaining({ id: 'ladder-down', group: 'stairs', footprint: { width: 1, height: 1 }, thumb: '/art/ladder-down.png' }),
      expect.objectContaining({ id: 'stairs-frostpeak-up', name: 'Frostpeak stairs, up', footprint: { width: 2, height: 1 } }),
    ]);
  });

  it('names stairs in words', () => {
    expect(stairName('stairs-frostpeak-east-up')).toBe('Frostpeak stairs, east, up');
    expect(stairName('ladder-down')).toBe('Ladder, down');
  });
});
