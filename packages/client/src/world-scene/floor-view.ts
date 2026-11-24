// The floor view: what can be seen from the floor we are on (upper storeys
// that would hide us, floors below shut in their walls, lamps of other floors),
// and a key of everything it depends on, so a frame where none of that
// changed costs nothing.

import Phaser from 'phaser';
import { seenFromGround, storeyAt, type RegionMap } from '@co-mmo/shared';
import { PROJECTION } from '../projection.ts';
import { type DrawnRegion, floorLift, overlaps, setDepthShade, setShown, within } from './types.ts';
import { closedWallsIn, showFloorsBelow } from './below.ts';

/** True when an upper storey (`s.floor > mine`) would draw over and compromise the view of the player at `shown`. */
function compromisesPlayerView(
  s: RegionMap['storeys'][number],
  region: DrawnRegion,
  shown: { x: number; y: number },
  mine: number,
): boolean {
  // From the ground, kit houses stand their own multi-storey sprite when closed and cut to floor 0 when open.
  if (mine === 0 && region.buildings.some((v) => v.kit && overlaps(s, v.building))) {
    return !seenFromGround(region.map, s);
  }
  // Directly inside or entering the footprint of this upper storey on our floor.
  if (shown.x >= s.x - 0.5 && shown.x <= s.x + s.width + 0.5 && shown.y >= s.y - 0.5 && shown.y <= s.y + s.height + 0.5) {
    return true;
  }
  // Inside an open ground-floor building that this upper storey covers.
  if (
    mine === 0 &&
    region.buildings.some((v) => v.open && overlaps(s, v.building) && within(v.building, Math.floor(shown.x), Math.floor(shown.y)))
  ) {
    return true;
  }
  // Screen-space check: if the player is behind (north-west of) the upper storey's front edges and its lifted walls cover the avatar.
  if (shown.x < s.x + s.width + 0.8 && shown.y < s.y + s.height + 0.8) {
    const ox = region.map.def.at.x * region.map.width;
    const oy = region.map.def.at.y * region.map.height;
    const pScreen = PROJECTION.toScreen(ox + shown.x, oy + shown.y);
    const pY = pScreen.y - floorLift(mine);
    const sTopY = PROJECTION.toScreen(ox + s.x, oy + s.y).y - floorLift(s.floor + 1);
    const sBottomY = PROJECTION.toScreen(ox + s.x + s.width, oy + s.y + s.height).y - floorLift(s.floor);
    const sLeftX = PROJECTION.toScreen(ox + s.x, oy + s.y + s.height).x;
    const sRightX = PROJECTION.toScreen(ox + s.x + s.width, oy + s.y).x;
    if (pScreen.x + 24 >= sLeftX && pScreen.x - 24 <= sRightX && pY + 12 >= sTopY && pY - 88 <= sBottomY) {
      return true;
    }
  }
  return false;
}

/**
 * Shows what can be seen from the floor we are on. On the ground and on upper
 * terraces, lower floors and their cliff walls remain visible underneath us,
 * while upper floors stay visible whenever they do not occlude the player.
 * Underground, only our floor shows.
 */
export function applyFloorView(
  scene: Phaser.Scene,
  drawn: Map<string, DrawnRegion>,
  currentRegionId: string,
  map: RegionMap,
  shown: { x: number; y: number },
  mine: number,
): void {
  const under = mine < 0;
  const here = mine ? storeyAt(map, Math.floor(shown.x), Math.floor(shown.y), mine) : undefined;
  for (const [id, region] of drawn) {
    const current = id === currentRegionId;
    const groundDelta = Math.max(0, mine);
    const managed = new Set<Phaser.GameObjects.GameObject>();
    for (const v of region.buildings) {
      for (const o of v.outside) managed.add(o);
      for (const o of v.inside) managed.add(o);
    }
    for (const f of region.floors) for (const o of f.objects) managed.add(o);
    for (const o of region.stairs) managed.add(o);
    for (const o of closedWallsIn(region)) managed.add(o);
    for (const o of region.objects) {
      if (managed.has(o)) continue;
      setShown(o, !under);
      setDepthShade(o, groundDelta);
    }
    for (const chunk of region.chunks.values()) {
      chunk.layer.setVisible(!under);
      setDepthShade(chunk.layer, groundDelta);
      for (const o of chunk.objects) {
        setShown(o, !under);
        setDepthShade(o, groundDelta);
      }
    }
    for (const v of region.buildings) {
      const covered = Boolean(current && here && overlaps(here, v.building));
      for (const o of v.outside) {
        o.setVisible(!under && !covered);
        setDepthShade(o, groundDelta, true);
        if (!scene.tweens.isTweening(o)) o.setAlpha(mine === 0 && v.open ? 0 : 1);
      }
      for (const o of v.inside) {
        const showInside = mine === 0 && v.open;
        o.setVisible(!under && showInside);
        setDepthShade(o, groundDelta, false);
        if (!scene.tweens.isTweening(o)) o.setAlpha(showInside ? 1 : 0);
      }
    }
    for (const o of region.stairs) {
      setShown(o, mine === 0);
      setDepthShade(o, groundDelta);
    }
    // Lamps burn on their own floor, and outdoor/ground lamps show from other above-ground floors unless covered.
    for (const lamp of region.lamps) {
      const covered = Boolean(current && here && within(here, lamp.tile.x, lamp.tile.y));
      lamp.hidden = lamp.floor === mine ? false : !(mine >= 0 && lamp.floor >= 0 && !covered);
    }
    for (const f of region.floors) {
      const s = f.storey;
      const delta = mine - s.floor;
      const isUpper = !under && s.floor > mine && s.floor > 0;
      const isLower = !under && s.floor > 0 && s.floor < mine;
      const visible =
        current &&
        (s.floor === mine ||
          isLower ||
          (isUpper && !compromisesPlayerView(s, region, shown, mine)));
      f.visible = visible;
      for (const o of f.objects) {
        const isUpperShell = Boolean(o.getData('upperShell'));
        const isCutWall = Boolean(o.getData('wall')) && !isUpperShell;
        const isSkirt = Boolean(o.getData('skirt'));
        const isLayer = o instanceof Phaser.Tilemaps.TilemapLayer && !o.getData('shell');
        let showObj = visible;
        if (visible) {
          if (isUpper && !s.open) {
            // Closed upper storeys seen from below show their floor/roof cap, outer full-height walls, and cliff skirts.
            showObj = isUpperShell || isSkirt || isLayer;
          } else {
            // Active floor, lower floors, and open upper terraces show their cutaway walls, skirts, floor, and furniture.
            showObj = !isUpperShell && (isCutWall || isSkirt || isLayer || true);
          }
        }
        setShown(o, showObj);
        setDepthShade(o, Math.max(0, delta));
      }
    }
    // Upstairs, the floors beneath stand on closed full-height walls instead of their cutaways.
    showFloorsBelow(scene, region, current, mine, here);
  }
}

/** A number for each drawn region, chunk and storey, so one drawn again (or a different storey underfoot) reads as a change. */
const ids = new WeakMap<object, number>();
let nextId = 0;

function idOf(o: object | undefined): number {
  if (!o) return -1;
  let id = ids.get(o);
  if (id === undefined) {
    id = nextId++;
    ids.set(o, id);
  }
  return id;
}

/**
 * Everything applyFloorView reads, as one string: the floor we see, the storey
 * underfoot, each drawn region's things and open buildings, and which upper
 * storeys would hide us. When it matches the last one, the floor view would set
 * every object just as it already is.
 */
export function floorViewKey(
  drawn: Map<string, DrawnRegion>,
  currentRegionId: string,
  map: RegionMap,
  shown: { x: number; y: number },
  mine: number,
): string {
  const here = mine ? storeyAt(map, Math.floor(shown.x), Math.floor(shown.y), mine) : undefined;
  const parts: (string | number)[] = [currentRegionId, mine, idOf(here)];
  for (const [id, region] of drawn) {
    parts.push(id, idOf(region), region.objects.length, region.floors.length, region.stairs.length, region.lamps.length);
    for (const chunk of region.chunks.values()) parts.push(idOf(chunk));
    for (const v of region.buildings) parts.push(v.open ? 'o' : 'c', v.outside.length, v.inside.length, v.kitOutside?.texture ?? '');
    if (id !== currentRegionId) continue;
    // Whether each upper storey would hide us changes with where we stand, within a tile.
    for (const f of region.floors) {
      const s = f.storey;
      if (mine >= 0 && s.floor > mine && s.floor > 0) parts.push(compromisesPlayerView(s, region, shown, mine) ? 'h' : 's');
    }
  }
  return parts.join('|');
}
