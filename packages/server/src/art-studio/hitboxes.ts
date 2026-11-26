// Hitboxes chosen in the Art Studio (asset-fit.ts) change which tiles block,
// and tiles are laid out with a land. So when one changes, every land with
// that picture standing in it is laid out again (World.reshape), everyone in
// it put back where they stood, and their browsers sent the new map. The
// lands are laid out when the server starts, before the saved fits are
// restored, so the ones with hitboxes are laid out again once at the start.

import { fitOf, hitboxAssets, onFitChange } from '@co-mmo/shared';
import type { World } from '../world.ts';

/** The lands with a picture standing in them, on any floor. */
export function landsWith(world: Pick<World, 'regions'>, assets: ReadonlySet<string>): string[] {
  return [...world.regions.values()].filter((r) => r.map.landmarks.some((l) => assets.has(l.asset))).map((r) => r.def.id);
}

/** Lays out the lands whose hitboxes stand now, and again each time one changes; returns how to stop. */
export function watchHitboxes(world: Pick<World, 'regions' | 'reshape'>): () => void {
  const key = (asset: string) => JSON.stringify(fitOf(asset)?.blocks ?? []);
  const known = new Map<string, string>();
  const lay = (assets: string[]) => {
    for (const id of landsWith(world, new Set(assets))) void world.reshape(id).catch(() => undefined);
  };
  const now = hitboxAssets();
  for (const a of now) known.set(a, key(a));
  lay(now);
  return onFitChange((asset) => {
    const next = key(asset);
    if ((known.get(asset) ?? '[]') === next) return;
    known.set(asset, next);
    lay([asset]);
  });
}
