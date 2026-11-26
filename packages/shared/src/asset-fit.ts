// How a picture sits on its tiles, chosen in the Art Studio: moved by some
// pixels (Godot's Texture Offset), trimmed a little in size, and which of
// its tiles it blocks (its hitbox), and where its glow sits, in what colour
// and how bright (a fire, a lantern, a shrine). The picture's own pixels never change; the fit is
// kept beside it. Every choice is a content entry like a monster's size
// (creature-size.ts): saved, shared with every region server and browser,
// and undone like any wish. The newest choice that stands wins. "Back to the
// painter's place" is a newer choice with no offset.

/** The most a picture moves, in its own pixels, either way. */
export const FIT_OFFSET_MOST = 256;
/** How far a picture's size may be trimmed: pieces, spots and stairs only, so similar things stay similar sizes. */
export const FIT_SCALE = { least: 0.85, most: 1.15 } as const;
/** Ids of pictures a fit may be for: the game's own, or a wish's (`<wish>:<id>`). */
const ASSET_ID = /^[\w-]+(?::[\w-]+)?$/;

/** How one picture sits on its tiles. */
export interface AssetFit {
  asset: string;
  /** Picture pixels at its painted size: +x right, +y down. */
  offset: [number, number];
  /** Its size trimmed, FIT_SCALE.least to FIT_SCALE.most; 1 when left out. */
  scale?: number;
  /** The tiles it blocks, from its footprint's top-left (world.ts blockedTiles); every tile when left out. */
  blocks?: [number, number][];
  /** Its own light, changed from the one its kind gives (lighting.ts glowFor). */
  light?: FitLight;
}

/**
 * A picture's light as chosen in the Studio. Each part left out keeps what
 * its kind gives; a piece that gives no light of its own gets a lantern's.
 */
export interface FitLight {
  /** Game pixels from where its kind's glow sits (a little above where it stands): +x right, +y down. */
  at?: [number, number];
  /** Its colour as #rrggbb. */
  color?: string;
  /** How bright, 0 (no light at all) to FIT_LIGHT.strength.most; 1 when left out. */
  strength?: number;
  /** How far it reaches, in tiles (light.ts MIN_LIGHT_RADIUS to MAX_LIGHT_RADIUS). */
  radius?: number;
  /** True to flicker like a flame, false to shine steadily; its kind's way when left out. */
  flicker?: boolean;
}

/** How far a light may move and how bright it may burn. Reach keeps light.ts's limits, so no light floods a land. */
export const FIT_LIGHT = { most: 256, strength: { least: 0, most: 2 }, radius: { least: 1, most: 4 } } as const;

/** The Art Studio choosing how a picture sits on its tiles. */
export interface FitWish {
  kind: 'fit';
  name: string;
  description: string;
  fit: AssetFit;
}

/** A fit from the Art Studio made clean, or what is wrong with it in words. */
export function validateFit(raw: unknown): FitWish | string {
  const d = (raw ?? {}) as Record<string, unknown>;
  const asset = typeof d.asset === 'string' ? d.asset : '';
  if (!asset || asset.length > 120 || !ASSET_ID.test(asset)) return 'Choose a picture to fit.';
  const offset = Array.isArray(d.offset) ? d.offset : [0, 0];
  if (offset.length !== 2 || !offset.every((n) => Number.isInteger(n) && Math.abs(n as number) <= FIT_OFFSET_MOST)) {
    return `Move it by whole pixels, at most ${FIT_OFFSET_MOST} either way.`;
  }
  const scale = d.scale === undefined || d.scale === 1 ? undefined : Number(d.scale);
  if (scale !== undefined && !(scale >= FIT_SCALE.least && scale <= FIT_SCALE.most)) {
    return `Its size can be trimmed between ${FIT_SCALE.least * 100} % and ${FIT_SCALE.most * 100} %.`;
  }
  const blocks = d.blocks === undefined ? undefined : blocksOf(d.blocks);
  if (typeof blocks === 'string') return blocks;
  const light = d.light === undefined || d.light === null ? undefined : lightOf(d.light);
  if (typeof light === 'string') return light;
  const fit: AssetFit = {
    asset,
    offset: [offset[0] as number, offset[1] as number],
    ...(scale !== undefined ? { scale: Math.round(scale * 1000) / 1000 } : {}),
    ...(blocks?.length ? { blocks } : {}),
    ...(light ? { light } : {}),
  };
  const moved = changes(fit);
  return {
    kind: 'fit',
    name: `${asset} fit`,
    description: moved ? `${asset} fitted on its tiles: ${fitWords(fit)}.` : `${asset} back where it was painted.`,
    fit,
  };
}

/** The most tiles a footprint has a side, so a hitbox's tiles are 0 to FIT_BLOCKS_SIDE - 1 from its top-left. */
export const FIT_BLOCKS_SIDE = 8;

/** A hitbox's tiles made clean (sorted, each once), or what is wrong with them. */
function blocksOf(raw: unknown): [number, number][] | string {
  const wrong = `Choose hitbox tiles inside its footprint, at most ${FIT_BLOCKS_SIDE} a side.`;
  if (!Array.isArray(raw) || raw.length > FIT_BLOCKS_SIDE * FIT_BLOCKS_SIDE) return wrong;
  const seen = new Set<number>();
  for (const t of raw) {
    if (!Array.isArray(t) || t.length !== 2 || !t.every((n) => Number.isInteger(n) && n >= 0 && n < FIT_BLOCKS_SIDE)) return wrong;
    seen.add(t[1] * FIT_BLOCKS_SIDE + t[0]);
  }
  return [...seen].sort((a, b) => a - b).map((n) => [n % FIT_BLOCKS_SIDE, Math.floor(n / FIT_BLOCKS_SIDE)]);
}

/** True when a fit changes anything from how the picture was painted. */
function changes(fit: AssetFit): boolean {
  return !!(fit.offset[0] || fit.offset[1] || fit.scale || fit.blocks || fit.light);
}

/** A light made clean (whole pixels, a colour, bounds kept), nothing when it changes nothing, or what is wrong with it. */
function lightOf(raw: unknown): FitLight | undefined | string {
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'Choose its light again.';
  const l = raw as Record<string, unknown>;
  const at = l.at === undefined ? [0, 0] : l.at;
  if (!Array.isArray(at) || at.length !== 2 || !at.every((n) => Number.isInteger(n) && Math.abs(n as number) <= FIT_LIGHT.most)) {
    return `Move its light by whole pixels, at most ${FIT_LIGHT.most} either way.`;
  }
  if (l.color !== undefined && (typeof l.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(l.color))) return 'Choose its light\'s colour again.';
  const { strength: S, radius: R } = FIT_LIGHT;
  const strength = l.strength === undefined ? 1 : Number(l.strength);
  if (!(strength >= S.least && strength <= S.most)) return `Its light can be from ${S.least * 100} % to ${S.most * 100} % bright.`;
  const radius = l.radius === undefined ? undefined : Number(l.radius);
  if (radius !== undefined && !(radius >= R.least && radius <= R.most)) return `Its light can reach from ${R.least} to ${R.most} tiles.`;
  if (l.flicker !== undefined && typeof l.flicker !== 'boolean') return 'Choose whether its light flickers again.';
  const light: FitLight = {
    ...(at[0] || at[1] ? { at: [at[0] as number, at[1] as number] } : {}),
    ...(l.color ? { color: (l.color as string).toLowerCase() } : {}),
    ...(strength !== 1 ? { strength: Math.round(strength * 100) / 100 } : {}),
    ...(radius !== undefined ? { radius: Math.round(radius * 2) / 2 } : {}),
    ...(typeof l.flicker === 'boolean' ? { flicker: l.flicker } : {}),
  };
  return Object.keys(light).length ? light : undefined;
}

/** A light's changes in words: "its light 4 px up, #ff8800, at 150 %, reaching 3 tiles", or "no light". */
export function lightWords(light: FitLight): string {
  if (light.strength === 0) return 'no light';
  const [x, y] = light.at ?? [0, 0];
  const parts = [
    ...(x ? [`${Math.abs(x)} px ${x < 0 ? 'left' : 'right'}`] : []),
    ...(y ? [`${Math.abs(y)} px ${y < 0 ? 'up' : 'down'}`] : []),
    ...(light.color ? [light.color] : []),
    ...(light.strength !== undefined && light.strength !== 1 ? [`at ${Math.round(light.strength * 100)} %`] : []),
    ...(light.radius !== undefined ? [`reaching ${light.radius} ${light.radius === 1 ? 'tile' : 'tiles'}`] : []),
    ...(light.flicker !== undefined ? [light.flicker ? 'flickering' : 'steady'] : []),
  ];
  return parts.length ? `its light ${parts.join(', ')}` : 'its own light';
}

/** A fit in words: "6 px left, 3 px down, at 95 %". */
export function fitWords(fit: Pick<AssetFit, 'offset' | 'scale' | 'blocks' | 'light'>): string {
  const [x, y] = fit.offset;
  const parts = [
    ...(x ? [`${Math.abs(x)} px ${x < 0 ? 'left' : 'right'}`] : []),
    ...(y ? [`${Math.abs(y)} px ${y < 0 ? 'up' : 'down'}`] : []),
    ...(fit.scale && fit.scale !== 1 ? [`at ${Math.round(fit.scale * 100)} %`] : []),
    ...(fit.blocks?.length ? [`blocking ${fit.blocks.length} ${fit.blocks.length === 1 ? 'tile' : 'tiles'}`] : []),
    ...(fit.light ? [lightWords(fit.light)] : []),
  ];
  return parts.join(', ') || 'where it was painted';
}

interface FitChange {
  at: number;
  fit: AssetFit;
}

const CHANGES = new Map<string, FitChange>();
/** Told when a fit changes: the browser stands the pictures again, the game server lays out the lands a hitbox changed. */
const LISTENERS = new Set<(asset: string) => void>();
const changed = (asset: string) => {
  for (const run of LISTENERS) run(asset);
};

/** Notes a granted fit, replacing an earlier copy of the same entry. */
export function applyFit(id: string, change: FitChange): void {
  CHANGES.set(id, change);
  changed(change.fit.asset);
}

/** Forgets a fit that was undone or switched off. */
export function removeFit(id: string): void {
  const was = CHANGES.get(id);
  CHANGES.delete(id);
  if (was) changed(was.fit.asset);
}

/** Tells `run` each time a picture's fit changes, until the returned function is called. */
export function onFitChange(run: (asset: string) => void): () => void {
  LISTENERS.add(run);
  return () => LISTENERS.delete(run);
}

/** Every picture whose fit names hitbox tiles now. */
export function hitboxAssets(): string[] {
  const assets = new Set<string>();
  for (const c of CHANGES.values()) if (fitOf(c.fit.asset)?.blocks?.length) assets.add(c.fit.asset);
  return [...assets];
}

/**
 * How a picture sits now: the newest choice that stands, else none. A spot's
 * state picture (`spot-x-picked`, `spot-x-growing`) has the fit of its Ready
 * picture (`spot-x`) until it is given its own, since all three are painted
 * from it.
 */
export function fitOf(asset: string): AssetFit | undefined {
  let newest: FitChange | undefined;
  for (const c of CHANGES.values()) if (c.fit.asset === asset && (!newest || c.at >= newest.at)) newest = c;
  if (newest) return changes(newest.fit) ? newest.fit : undefined;
  const ready = /^(spot-.+)-(?:picked|growing)$/.exec(asset)?.[1];
  return ready ? fitOf(ready) : undefined;
}
