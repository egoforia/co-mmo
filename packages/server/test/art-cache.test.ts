import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { account, api, app, start } from './helpers.ts';

const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const anchorDir = join(repo, 'assets/anchors');

describe('ArtStudio overview caching', () => {
  it('serves cached overview on repeat calls and invalidates on demand', async () => {
    const { base, store } = await start({ anchorDir });
    const owner = account(store, 'Ego', 'owner');

    const first = await api(base, '/api/admin/art', owner.token);
    expect(first.status).toBe(200);
    expect(first.body.items.length).toBeGreaterThan(0);

    // Second call should return identical catalog data from cache
    const second = await api(base, '/api/admin/art', owner.token);
    expect(second.status).toBe(200);
    expect(second.body.items.length).toBe(first.body.items.length);
    expect(second.body.walkers.length).toBe(first.body.walkers.length);

    // Invalidate the overview cache
    app!.art.invalidateOverview();

    // Next call recomputes and succeeds
    const third = await api(base, '/api/admin/art', owner.token);
    expect(third.status).toBe(200);
    expect(third.body.items.length).toBe(first.body.items.length);
  }, 30_000);
});
