// The paint review's tile picker: how many tiles the footprint guide sent
// with a piece that stands on tiles shows (server assets/footprint-guide.ts),
// 3 × 1, 2 × 2, 1 × 4 and so on. Its own footprint unless the Owner picks
// others; the game still stands the picture on its own footprint.

import { GUIDE_TILES, guideTiles, type Footprint } from '@co-mmo/shared';
import { esc, type Review } from './state.ts';

/** The tile picker's HTML for a review, or nothing for a picture that stands on no tiles. */
export function guideTilesHtml(review: Pick<Review, 'tiles'>): string {
  if (!review.tiles) return '';
  const { shown, footprint } = review.tiles;
  const own = sameTiles(shown, footprint);
  const input = (name: 'width' | 'height', label: string, value: number) =>
    `<label>${label}<span><input type="number" name="${name}" min="${GUIDE_TILES.least}" max="${GUIDE_TILES.most}" step="0.5" value="${value}" required /></span></label>`;
  return `
    <form class="form review-tiles">
      <p class="note">The footprint guide shows the tiles it is painted standing on: ${tilesWords(shown)}${own ? ', its own footprint' : `, not its own ${tilesWords(footprint)}. The game still stands it on its own footprint`}.</p>
      <div class="tile-pick">${input('width', 'Tiles to the left', shown.width)}<span aria-hidden="true">×</span>${input('height', 'Tiles to the right', shown.height)}</div>
      <div class="card-actions"><button type="submit" class="quiet">Show with these tiles</button>${own ? '' : '<button type="button" class="quiet" data-own-tiles>Back to its own footprint</button>'}</div>
    </form>`;
}

/** The tiles picked in a review's tile picker; undefined when they are its own footprint again, or not tiles at all. */
export function pickedTiles(form: HTMLFormElement, footprint: Footprint): Footprint | undefined {
  const data = new FormData(form);
  return tilesPicked(data.get('width'), data.get('height'), footprint);
}

/** Tiles typed into the picker, made clean; undefined when they are its own footprint again, or not tiles at all. */
export function tilesPicked(width: unknown, height: unknown, footprint: Footprint): Footprint | undefined {
  const tiles = guideTiles({ width, height });
  return tiles && !sameTiles(tiles, footprint) ? tiles : undefined;
}

/** True when two footprints have the same sides. */
export function sameTiles(a: Footprint, b: Footprint): boolean {
  return a.width === b.width && a.height === b.height;
}

/** A footprint in words: "3 × 1 tiles". */
function tilesWords(t: Footprint): string {
  return esc(`${t.width} × ${t.height} tiles`);
}
