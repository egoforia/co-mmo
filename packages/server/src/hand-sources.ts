import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { HELD_FAMILIES, ISO_WAYS, ITEMS, familyArt, WALKING_LOOKS, WALK_FRAMES, ruleItemId, wishArtKey, type ArtManifest } from '@co-mmo/shared';
import type { PointSource } from './hand-finder.ts';
import type { Store } from './store.ts';

// What the hand finder looks at: every picture someone can hold something in
// (walk strips, walking looks, wished looks, the isometric ways' standing
// pictures) and every item that can be held
// (weapons, off-hand items, charms), read from where the client is served them.

/** Reads a picture the client is served: painted here (/wished-art/), or shipped with the game. */
export function artFileReader(artDir: string, shippedManifest: string | undefined): (file: string) => Promise<Buffer> {
  return (file) => {
    const path = file.split('?')[0]!.replace(/^\//, '');
    if (path.startsWith('wished-art/')) return readFile(resolve(artDir, path.slice('wished-art/'.length)));
    if (!shippedManifest) return Promise.reject(new Error('no shipped art'));
    return readFile(resolve(dirname(dirname(shippedManifest)), path));
  };
}

/** A standing picture in one of the isometric ways. */
const ISO_STAND = new RegExp(`-stand-(${ISO_WAYS.join('|')})$`);

/** Every walk strip, walking look and wished look (their hands), the isometric ways' standing pictures, and every weapon, off-hand item and charm (their grips). */
export function pointSources(store: Store, shipped: ArtManifest, painted: ArtManifest, read: (file: string) => Promise<Buffer>): PointSource[] {
  // As the client merges them: shipped art wins, except what the Owner had painted again.
  const art: ArtManifest = { ...painted, ...shipped, ...Object.fromEntries(Object.entries(painted).filter(([, e]) => e.redone)) };
  const wished = new Map<string, string>();
  for (const record of store.content) {
    const def = record.definition;
    if (record.status !== 'granted' || !def) continue;
    if (record.art) wished.set(wishArtKey(record.id), record.art);
    if (def.kind === 'rule') for (const key of Object.keys(def.items)) if (record.itemArt?.[ruleItemId(record.id, key)]) wished.set(wishArtKey(ruleItemId(record.id, key)), record.itemArt[ruleItemId(record.id, key)]!);
  }
  const source = (id: string, kind: PointSource['kind'], file: string | undefined, frames = 1): PointSource[] => {
    const facing = /-(?:walk|stand)-((?:front|back)-(?:left|right)|front|back|left|right)$/.exec(id)?.[1] as PointSource['facing'];
    return file ? [{ id, kind, file, frames, ...(facing ? { facing } : {}), read: () => read(file) }] : [];
  };
  const looks = store.content.filter((r) => r.status === 'granted' && r.definition?.kind === 'player').map((r) => wishArtKey(r.id));
  return [
    ...Object.entries(art).flatMap(([id, e]) => (e.kind === 'walk' ? source(id, 'hands', e.file, e.frames ?? WALK_FRAMES) : [])),
    // Walkers stand in the isometric ways' pictures (and glide in them until those ways have walks), so their hands are found there.
    ...Object.entries(art).flatMap(([id, e]) => (e.kind === 'stand' && ISO_STAND.test(id) ? source(id, 'hands', e.file) : [])),
    ...WALKING_LOOKS.flatMap((id) => source(id, 'hands', art[id]?.file)),
    ...looks.flatMap((id) => source(id, 'hands', wished.get(id))),
    ...Object.values(ITEMS).filter((item) => item.slot === 'weapon' || item.slot === 'offhand' || item.slot === 'charm')
      .flatMap((item) => source(item.art, 'grip', item.art.startsWith('wished-') ? wished.get(item.art) : art[item.art]?.file)),
    // Each family's own picture, which a weapon shows until its own is painted.
    ...HELD_FAMILIES.flatMap((family) => source(familyArt(family), 'grip', art[familyArt(family)]?.file)),
  ];
}
