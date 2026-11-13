import type { ArtManifest } from '@co-mmo/shared';

// The pictures the editor shows in its asset picker and ghosts: the art
// manifests the game loads (shipped art, and art painted since), read once
// per page. Shipped art wins, except what the Owner had painted again, as
// in the game (main.ts).

let art: ArtManifest | undefined;
let loading: Promise<ArtManifest> | undefined;

const read = (url: string): Promise<ArtManifest> =>
  fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<ArtManifest>) : {}))
    .catch(() => ({}));

/** Loads the art manifests once; resolves with them (empty when they cannot be read). */
export function loadArt(): Promise<ArtManifest> {
  loading ??= Promise.all([read('/api/art'), read('/art/manifest.json')]).then(([painted, shipped]) => {
    art = { ...painted, ...shipped, ...Object.fromEntries(Object.entries(painted).filter(([, e]) => e.redone)) };
    return art;
  });
  return loading;
}

/** The file a picture is drawn from, or undefined while the manifests load or when it is not painted yet. */
export function pictureFile(id: string | undefined): string | undefined {
  return id ? art?.[id]?.file : undefined;
}

/** True once the manifests are read, so "not painted yet" can be said. */
export function artKnown(): boolean {
  return !!art;
}
