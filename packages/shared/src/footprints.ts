import { BUILDING_STYLES, furnitureArt } from './buildings.ts';
import { SEA_CAVE_PIECES } from './sea-cave-kit.ts';
import { WORLD_REGIONS, generateRegion } from './world.ts';

// The tiles a picture stands on. A thing painted for the isometric camera is
// painted standing on exactly these tiles and sized to their diamond, so the
// painter needs them before anything is placed in the world.

/** A footprint in tiles: across (west to east) and deep (north to south). */
export interface Footprint {
  width: number;
  height: number;
}

let laid: Map<string, Footprint> | undefined;

/**
 * The tiles a set piece, prop or piece of furniture stands on, from where the
 * world lays it (the first place, if it stands in several), or undefined for
 * a picture that stands on no footprint (a character, an item, a tree).
 */
export function artFootprint(id: string): Footprint | undefined {
  laid ??= layFootprints();
  return laid.get(id) ?? furnitureFootprint(id);
}

function layFootprints(): Map<string, Footprint> {
  const out = new Map<string, Footprint>();
  for (const def of WORLD_REGIONS) {
    for (const l of generateRegion(def).landmarks) if (!out.has(l.asset)) out.set(l.asset, { ...l.footprint });
  }
  for (const piece of SEA_CAVE_PIECES) if (!out.has(piece.id)) out.set(piece.id, { ...piece.footprint });
  return out;
}

/** A wished building's furniture, laid nowhere yet: as wide as its style draws it, and as deep. */
function furnitureFootprint(id: string): Footprint | undefined {
  for (const style of Object.values(BUILDING_STYLES)) {
    for (const [key, piece] of Object.entries(style.furniture)) {
      if (furnitureArt(style.id, key) === id) return { width: piece.width, height: piece.depth ?? 1 };
    }
  }
  return undefined;
}
