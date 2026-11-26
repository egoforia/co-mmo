// The Hitbox tool: which tiles a set piece blocks. A piece blocks every tile
// of its footprint unless its fit (asset-fit.ts) names some; an arch or a lamp
// post on a wide base can leave the tiles in front open, and a picture painted
// wider than its footprint (a fountain's basin) can block up to
// FIT_BLOCKS_REACH tiles around it. B
// turns it on; clicking a tile on the canvas blocks or opens it. Nothing
// reaches the game until the fit is saved, and its lands are then laid out
// again (server art-studio/hitboxes.ts).

import { FIT_BLOCKS_REACH } from '@co-mmo/shared';
import type { StudioAsset } from './browser.ts';
import { canvasFloor } from './canvas.ts';
import type { FitDraft, FitState } from './fit-tool.ts';

/** Groups whose tiles can be chosen: set pieces. Spots, stairs and scenery keep their own rules. */
export const HITBOX_GROUPS = ['pieces'];

type TileXY = [number, number];

/** Every tile of a footprint `w` by `h`, from its top-left. */
export function allTiles(w: number, h: number): TileXY[] {
  const all: TileXY[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) all.push([x, y]);
  return all;
}

/** True when a tile can be chosen for a footprint `w` by `h`: on it, or at most FIT_BLOCKS_REACH tiles around it. */
export function inReach([x, y]: TileXY, w: number, h: number): boolean {
  const R = FIT_BLOCKS_REACH;
  return x >= -R && y >= -R && x < w + R && y < h + R;
}

/** The tiles a fit blocks in a footprint `w` by `h`: its own, or all of the footprint's. */
export function blockedOf(state: Pick<FitState, 'blocks'>, w: number, h: number): TileXY[] {
  const kept = state.blocks?.filter((t) => inReach(t, w, h));
  return kept?.length ? kept : allTiles(w, h);
}

/** True when the tiles are exactly the footprint's, which needs no hitbox of its own. */
function justFootprint(tiles: readonly TileXY[], w: number, h: number): boolean {
  return tiles.length === w * h && tiles.every(([x, y]) => x >= 0 && y >= 0 && x < w && y < h);
}

/**
 * The fit with one tile blocked or opened. Blocking every tile again leaves
 * the hitbox out (the footprint's own), and the last blocked tile stays: a
 * piece that blocks nothing is a picture laid on the ground, which is a
 * different thing (God's View furniture "walk through").
 */
export function toggleTile(state: FitState, tile: TileXY, w: number, h: number): FitState {
  const [tx, ty] = tile;
  if (!inReach(tile, w, h)) return state;
  const now = blockedOf(state, w, h);
  const on = now.some(([x, y]) => x === tx && y === ty);
  const next = on ? now.filter(([x, y]) => x !== tx || y !== ty) : [...now, tile];
  if (!next.length) return state;
  next.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const { blocks: _, ...rest } = state;
  return justFootprint(next, w, h) ? rest : { ...rest, blocks: next };
}

/** The tile under a ground point in canvas world pixels (PROJECTION.toScreen undone), or none off the ground. */
export function tileUnder(p: { x: number; y: number }): TileXY {
  const across = p.x / 80;
  const down = p.y / 40;
  return [Math.floor((across + down) / 2), Math.floor((down - across) / 2)];
}

/** The Inspector's Hitbox section. */
export function hitboxPanelHtml(a: StudioAsset, draft: FitDraft, editing: boolean, alike: number): string {
  const floor = canvasFloor(a);
  const [w, h] = [floor.right, floor.bottom];
  const blocked = blockedOf(draft.state, w, h);
  const n = blocked.length;
  const all = justFootprint(blocked, w, h);
  const same = alike > 0
    ? `<button type="button" class="quiet" data-hitbox-alike title="Give the ${alike} other set pieces shown with a ${w} by ${h} footprint these tiles, keeping their own offsets">Same tiles for ${alike} alike</button>`
    : '';
  return `
    <h2 class="dock-title">Hitbox</h2>
    <p class="note">${editing ? `Click a tile on the canvas to block or open it. Red tiles block walking. You can also pick tiles up to ${FIT_BLOCKS_REACH} around its footprint, for a picture wider than its tiles.` : 'Which tiles block walking. Press B, or edit here, to choose.'}</p>
    <p class="note hitbox-words">${all ? `Blocks its whole footprint (${n} ${n === 1 ? 'tile' : 'tiles'}).` : `Blocks ${n} ${n === 1 ? 'tile' : 'tiles'}; its footprint is ${w} by ${h}.`}</p>
    <p class="inspector-links">
      <button type="button" data-hitbox-edit aria-pressed="${editing}">${editing ? 'Done choosing' : 'Choose tiles (B)'}</button>
      <button type="button" class="quiet" data-hitbox-all${all ? ' disabled' : ''}>Just its footprint</button>
      ${same}
    </p>
    <p class="note">Saved with the fit. Lands with this piece are laid out again, and players in them stay where they stand.</p>`;
}

/** The other assets shown with the same footprint, which "Same tiles for … alike" gives this hitbox. */
export function alikeAssets(a: StudioAsset, shown: readonly StudioAsset[]): StudioAsset[] {
  const size = (x: StudioAsset) => {
    const f = canvasFloor(x);
    return `${f.right}x${f.bottom}`;
  };
  return shown.filter((x) => x.id !== a.id && HITBOX_GROUPS.includes(x.group) && size(x) === size(a));
}

/** Gives each asset these blocked tiles, keeping its own offset and size; says how it went. */
export async function saveTiles(
  assets: readonly StudioAsset[],
  blocks: FitState['blocks'],
  api: (path: string, method: string, body: unknown) => Promise<unknown>,
  toast: (text: string) => void,
): Promise<void> {
  let saved = 0;
  for (const x of assets) {
    try {
      await api('art/fit', 'POST', { asset: x.id, offset: x.fit?.offset ?? [0, 0], scale: x.fit?.scale, blocks, light: x.fit?.light });
      saved++;
    } catch (err) {
      toast(`${x.name}: ${(err as Error).message}`);
    }
  }
  toast(`Gave ${saved} of ${assets.length} the same tiles. Their lands are laid out again.`);
}
