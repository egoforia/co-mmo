// Drawing regions, distance-streamed ground chunks, landmarks, stairs, lamps,
// kit houses, and multi-storey cutaway visibility.

import Phaser from 'phaser';
import {
  Tile,
  ITEMS,
  SPOTS,
  WINDOW_LIGHT,
  biomeLook,
  buildingKit,
  glowOf,
  nearBuilding,
  rand2,
  seenFromGround,
  stairsLabel,
  storeyAt,
  type ArtManifest,
  type Light,
  type RegionMap,
} from '@co-mmo/shared';
import { type HouseArt, type HouseSource, standHouse, standOnTiles } from '../kit-house-view.ts';
import { dropLight, makeLight, placeLight } from '../lights.ts';
import { PROJECTION } from '../projection.ts';
import {
  propTexture,
  registerKitTileset,
  registerStoreyTileset,
  registerTileset,
  stairTexture,
} from '../textures.ts';
import {
  type BuildingView,
  CHUNK,
  type Chunk,
  DRAW_REACH,
  type DrawnRegion,
  FORGET_REACH,
  type FloorView,
  GROUND_DEPTH,
  roomFloorDepth,
  HOUSE_RETRY_MS,
  HOUSE_TRIES,
  LABEL_DEPTH,
  type Lamp,
  T,
  floorAt,
  floorDepthOffset,
  floorLift,
  landmarkFeet,
  overlaps,
  setDepthShade,
  setShown,
  within,
} from './types.ts';
import { groundLayer, rockWalls, wallFaceKey } from './walls.ts';
import { closedWallsIn, showFloorsBelow } from './below.ts';

export function dropChunk(chunk: Chunk): void {
  for (const o of chunk.objects) o.destroy();
  chunk.tilemap.destroy();
}

export function undrawRegion(scene: Phaser.Scene, id: string, region: DrawnRegion, drawn: Map<string, DrawnRegion>): void {
  for (const o of region.objects) {
    scene.tweens.killTweensOf(o);
    o.destroy();
  }
  for (const m of region.tilemaps) m.destroy();
  for (const lamp of region.lamps) dropLight(scene, lamp.lit);
  for (const chunk of region.chunks.values()) dropChunk(chunk);
  drawn.delete(id);
}

/** One chunk of a region's ground, with the trees and rocks standing on it. */
export function drawChunk(scene: Phaser.Scene, region: DrawnRegion, x0: number, y0: number, currentFloor: number): Chunk {
  const { map } = region;
  const ox = map.def.at.x * map.width;
  const oy = map.def.at.y * map.height;
  const rows = region.ground.slice(y0, y0 + CHUNK).map((row) => row.slice(x0, x0 + CHUNK));
  const groundDelta = Math.max(0, currentFloor);
  const layer = groundLayer(scene, rows, ox + x0, oy + y0, GROUND_DEPTH, registerTileset(scene, map.def)).setVisible(currentFloor >= 0);
  setDepthShade(layer, groundDelta);
  const tilemap = layer.tilemap;
  const objects: Phaser.GameObjects.GameObject[] = [];
  const biome = map.def.biome;
  for (let y = y0; y < Math.min(y0 + CHUNK, map.height); y++) {
    for (let x = x0; x < Math.min(x0 + CHUNK, map.width); x++) {
      const tile = map.tiles[y * map.width + x];
      if (tile !== Tile.Tree && tile !== Tile.Rock) continue;
      const variant = Math.floor(rand2(x, y, 5) * 3);
      const key = propTexture(scene, biome, tile === Tile.Tree ? 'tree' : 'rock', variant);
      if (!key) continue;
      const jitter = (rand2(x, y, 6) - 0.5) * T * 0.2;
      const feet = PROJECTION.stand(ox + x, oy + y, 1, 1);
      const at = PROJECTION.toScreen(feet.x, feet.y);
      const img = scene.add.image(at.x + jitter, at.y, key).setOrigin(0.5, 0.97);
      img.setScale(0.85 + rand2(x, y, 7) * 0.3).setFlipX(rand2(x, y, 8) > 0.5);
      img.setDepth(PROJECTION.depth(feet.x, feet.y) - 1);
      setDepthShade(img, groundDelta);
      objects.push(img.setVisible(currentFloor >= 0));
    }
  }
  return { tilemap, layer, objects };
}

/** Draws the ground and scenery near us and lets go of what is far, when we have moved a little. */
export function drawNearChunks(
  scene: Phaser.Scene,
  drawn: Map<string, DrawnRegion>,
  x: number,
  y: number,
  currentFloor: number,
): void {
  for (const region of drawn.values()) {
    const { map } = region;
    const ox = map.def.at.x * map.width;
    const oy = map.def.at.y * map.height;
    const across = Math.ceil(map.width / CHUNK);
    for (let cy = 0; cy < Math.ceil(map.height / CHUNK); cy++) {
      for (let cx = 0; cx < across; cx++) {
        const left = ox + cx * CHUNK;
        const top = oy + cy * CHUNK;
        const dx = Math.max(left - x, 0, x - (left + CHUNK));
        const dy = Math.max(top - y, 0, y - (top + CHUNK));
        const far = Math.hypot(dx, dy);
        const index = cy * across + cx;
        const chunk = region.chunks.get(index);
        if (!chunk && far <= DRAW_REACH) region.chunks.set(index, drawChunk(scene, region, cx * CHUNK, cy * CHUNK, currentFloor));
        else if (chunk && far > FORGET_REACH) {
          dropChunk(chunk);
          region.chunks.delete(index);
        }
      }
    }
  }
}

/**
 * Draws a region at its square in the world: its buildings and landmarks
 * now, its ground, trees and rocks in chunks as we come near (drawNearChunks).
 */
export function drawRegion(scene: Phaser.Scene, map: RegionMap, layout: string, art: ArtManifest): DrawnRegion {
  const ox = map.def.at.x * map.width;
  const oy = map.def.at.y * map.height;
  const before = new Set(scene.children.list);
  const tilemaps: Phaser.Tilemaps.Tilemap[] = [];
  const kit = new Set<string>();
  const look = biomeLook(map.def.biome);
  for (const id of [look.ground, look.path, look.water, ...look.trees, ...look.rocks]) kit.add(id);
  const data: number[][] = [];
  for (let y = 0; y < map.height; y++) {
    data.push(Array.from(map.tiles.subarray(y * map.width, (y + 1) * map.width)));
  }
  // Under landmarks, paint whatever ground surrounds them (indoors, the floor).
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (data[y]![x] !== Tile.Blocked) continue;
      const around = [data[y - 1]?.[x], data[y + 1]?.[x], data[y]![x - 1], data[y]![x + 1]];
      data[y]![x] = around.includes(Tile.Floor) ? Tile.Floor : around.filter((t) => t === Tile.Path).length >= 2 ? Tile.Path : Tile.Ground;
    }
  }
  // Each building keeps its floor and walls on a layer of its own, just its
  // size, in its own painted tiles, hidden behind its outside art until we
  // come close; the ground runs on underneath.
  const views = map.buildings.map((b) => {
    const inside = data.slice(b.y, b.y + b.height).map((row) => row.slice(b.x, b.x + b.width));
    for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) if (data[y]?.[x] !== undefined) data[y]![x] = Tile.Ground;
    const hasWall = Boolean(wallFaceKey(scene, b.style, b.art));
    // With 0.5-tile walls, the inner half of each wall tile exposes the room's floor seamlessly.
    const floorRows = hasWall ? inside.map((row) => row.map((t) => (t === Tile.Wall ? Tile.Floor : t))) : inside;
    const floor = groundLayer(scene, floorRows, ox + b.x, oy + b.y, roomFloorDepth(ox + b.x, oy + b.y, 0), registerKitTileset(scene, b.style, b.art)).setData('shell', true);
    tilemaps.push(floor.tilemap);
  const neighbourTile = (wx: number, wy: number, floor: number): Tile | undefined => {
    const s = storeyAt(map, wx, wy, floor);
    if (!s) return undefined;
    return s.tiles[(wy - s.y) * s.width + (wx - s.x)] as Tile;
  };

  // Modular buildings stand as a full-height closed shell from afar and cut low on South/East walls when approached.
  const closedUpper = map.storeys.filter((s) => s.floor > 0 && !s.open && overlaps(s, b)).sort((a, s) => a.floor - s.floor);
  const outside: (Phaser.GameObjects.Image | Phaser.Tilemaps.TilemapLayer)[] = hasWall
    ? rockWalls(scene, inside, ox + b.x, oy + b.y, b.style, b.art, tilemaps, true, false, closedUpper.length === 0, 0)
    : [];
  const view: BuildingView = {
    building: b,
    ox,
    oy,
    outside,
    inside: [floor, ...rockWalls(scene, inside, ox + b.x, oy + b.y, b.style, b.art, tilemaps, true, true, false, 0)],
    open: !outside.length,
  };
  return view;
});
// Each floor off the ground on a layer of its own over its rectangle, furniture drawn as floor beneath it.
const floors: FloorView[] = map.storeys.map((storey) => {
  const rows: number[][] = [];
  for (let y = 0; y < storey.height; y++) {
    rows.push(Array.from(storey.tiles.subarray(y * storey.width, (y + 1) * storey.width), (t) => (t === Tile.Blocked ? Tile.Floor : t)));
  }
  const hasWall = Boolean(wallFaceKey(scene, storey.style, storey.art));
  const floorRows = hasWall ? rows.map((row) => row.map((t) => (t === Tile.Wall ? Tile.Floor : t))) : rows;
  const lift = floorLift(storey.floor);
  const layer = groundLayer(scene, floorRows, ox + storey.x, oy + storey.y, roomFloorDepth(ox + storey.x, oy + storey.y, storey.floor), registerStoreyTileset(scene, storey));
  layer.y -= lift;
  tilemaps.push(layer.tilemap);
  const neighbourTile = (wx: number, wy: number): Tile | undefined => {
    const s = storeyAt(map, wx, wy, storey.floor);
    if (!s) return undefined;
    return s.tiles[(wy - s.y) * s.width + (wx - s.x)] as Tile;
  };
  const cliffDrops = (wx: number, wy: number): number => {
    const [mx, my] = [wx - ox, wy - oy];
    if (map.tiles[my * map.width + mx] === Tile.Water || map.tiles[(my + 1) * map.width + mx] === Tile.Water) return 1;
    let drops = 1;
    for (let f = storey.floor - 1; f >= 1; f--) {
      if (storeyAt(map, mx, my, f)) break;
      drops++;
    }
    return drops;
  };
  const hasUpperAbove = map.storeys.some((s) => s.floor === storey.floor + 1 && overlaps(s, storey));
  const cutawayWalls = rockWalls(
    scene,
    rows,
    ox + storey.x,
    oy + storey.y,
    storey.style,
    storey.art,
    tilemaps,
    storey.floor > 0 || Boolean(storey.open),
    true,
    false,
    storey.floor,
    Boolean(storey.open),
    (wx, wy) => neighbourTile(wx - ox, wy - oy),
    cliffDrops,
    (wx, wy) => Boolean(storeyAt(map, wx - ox, wy - oy, storey.floor + 1)),
  );
  const upperShellWalls =
    storey.floor > 0 && !storey.open
      ? rockWalls(
          scene,
          rows,
          ox + storey.x,
          oy + storey.y,
          storey.style,
          storey.art,
          tilemaps,
          true,
          false,
          !hasUpperAbove,
          storey.floor,
          false,
          (wx, wy) => neighbourTile(wx - ox, wy - oy),
          () => 0,
        ).map((o) => o.setData('upperShell', true))
      : [];
  return {
    storey,
    objects: [layer, ...cutawayWalls, ...upperShellWalls],
  };
});
  placeLandmarks(scene, map, ox, oy, views, floors, art);
  placeSpots(scene, map, ox, oy, art, kit);
  const stairs = placeStairs(scene, map, ox, oy, views, floors);
  const objects = scene.children.list.filter((o) => !before.has(o));
  const lamps = placeLamps(scene, map, ox, oy, views);
  return { layout, objects, tilemaps, buildings: views, kit, map, ground: data, chunks: new Map(), lamps, floors, stairs };
}

/** Landmarks: set pieces out in the land, furniture inside buildings, and furniture on the floors above and below. */
export function placeLandmarks(scene: Phaser.Scene, map: RegionMap, ox: number, oy: number, views: BuildingView[], floors: FloorView[], art: ArtManifest): void {
  for (const l of map.landmarks) {
    if (!scene.textures.exists(l.asset)) continue;
    const { width, height } = l.footprint;
    const left = ox + l.x - width / 2;
    const top = oy + l.y - height;
    const tiles = { left, top, right: left + width, bottom: top + height };
    const floor = l.floor ?? 0;
    const lift = floorLift(floor);
    const depthOff = floorDepthOffset(floor);
    const parts = standOnTiles(scene, l.asset, tiles, art[l.asset]?.view === 'isometric');
    for (const part of parts) {
      part.y -= lift;
      part.setDepth(part.depth + depthOff);
    }
    const [tx, ty] = [Math.floor(l.x), Math.floor(l.y - 0.01)];
    if (l.floor) floorAt(floors, tx, ty, l.floor)?.objects.push(...parts);
    else views.find((v) => within(v.building, tx, ty))?.inside.push(...parts);
  }
}

/** The picture a gathering spot shows: its own once painted, else its material's icon. */
export function spotArt(scene: Phaser.Scene, kind: string): string | undefined {
  const def = SPOTS[kind];
  if (!def) return undefined;
  if (scene.textures.exists(def.art)) return def.art;
  const m = ITEMS[def.material];
  return [m?.art, m?.standIn].find((key) => key && scene.textures.exists(key));
}

/** Gathering spots (gathering.ts), each standing on its tile; a spot painted later draws the land again (`kit`). */
export function placeSpots(scene: Phaser.Scene, map: RegionMap, ox: number, oy: number, art: ArtManifest, kit: Set<string>): void {
  for (const s of map.spots) {
    const def = SPOTS[s.kind];
    if (def) kit.add(def.art);
    const key = spotArt(scene, s.kind);
    if (!key) continue;
    const tiles = { left: ox + s.x, top: oy + s.y, right: ox + s.x + 1, bottom: oy + s.y + 1 };
    standOnTiles(scene, key, tiles, art[key]?.view === 'isometric');
  }
}

/**
 * Each flight of stairs and ladder, on both floors it joins: its painted
 * picture going up or down once there is one, and always a label saying
 * where it goes, since nothing about it is drawn in code.
 */
export function placeStairs(scene: Phaser.Scene, map: RegionMap, ox: number, oy: number, views: BuildingView[], floors: FloorView[]): Phaser.GameObjects.GameObject[] {
  const open: Phaser.GameObjects.GameObject[] = [];
  for (const s of map.stairways) {
    for (const floor of [s.lower, s.upper]) {
      const parts: Phaser.GameObjects.GameObject[] = [];
      const isUp = floor === s.lower;
      const art = stairTexture(scene, map.def.biome, s, isUp);
      const feet = PROJECTION.stand(ox + s.x, oy + s.y, s.width, s.height);
      const at = PROJECTION.toScreen(feet.x, feet.y);
      const lift = floorLift(floor);
      const depthOff = floorDepthOffset(floor);
      if (art && scene.textures.exists(art)) {
        const img = scene.add.image(at.x, at.y - lift, art).setOrigin(0.5, 0.92);
        img.setDepth(depthOff + PROJECTION.depth(feet.x, feet.y) - 1);
        img.setInteractive({ useHandCursor: true });
        img.on('pointerover', () => img.setTint(0xfff8d0));
        img.on('pointerout', () => img.clearTint());
        parts.push(img);
      }
      const arrow = isUp ? '▲' : '▼';
      const label = scene.add.text(at.x, at.y - lift - T * 0.75, `${arrow} ${stairsLabel(s, floor)}`, {
        fontFamily: 'sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: isUp ? '#ffd359' : '#8ee8f5',
        stroke: isUp ? '#2e1e04' : '#062533',
        strokeThickness: 4,
        backgroundColor: isUp ? '#1e1505ee' : '#041620ee',
        padding: { x: 8, y: 4 },
      });
      parts.push(label.setOrigin(0.5, 1).setDepth(LABEL_DEPTH - 2));
      const [tx, ty] = [s.x, s.y];
      if (floor) floorAt(floors, tx, ty, floor)?.objects.push(...parts);
      else {
        const inside = views.find((v) => within(v.building, tx, ty));
        if (inside) inside.inside.push(...(parts as Phaser.GameObjects.Image[]));
        else open.push(...parts);
      }
    }
  }
  return open;
}

/** Lights for a region's fires, lanterns and shrines, the lights the editor stood on their own, and its buildings' windows. */
export function placeLamps(scene: Phaser.Scene, map: RegionMap, ox: number, oy: number, views: BuildingView[]): Lamp[] {
  const lamps: Lamp[] = [];
  const add = (light: Light, x: number, y: number, window: boolean, floor: number, tile: { x: number; y: number }) => {
    const lit = makeLight(scene, light);
    if (lit) lamps.push({ lit, x, y, window, floor, tile });
  };
  for (const l of map.landmarks) {
    const light = glowOf(l.asset);
    // The flame sits a little above where the piece stands.
    const feet = landmarkFeet(l, ox, oy);
    const at = PROJECTION.toScreen(feet.x, feet.y);
    const floor = l.floor ?? 0;
    if (light) add(light, at.x, at.y - floorLift(floor) - T * 0.6, false, floor, { x: Math.floor(l.x), y: Math.floor(l.y - 0.01) });
  }
  // Lights the world editor stood on their own.
  for (const l of map.lights ?? []) {
    const at = PROJECTION.toScreen(ox + l.x, oy + l.y);
    add(l.light, at.x, at.y - floorLift(l.floor) - T * 0.6, false, l.floor, { x: Math.floor(l.x), y: Math.floor(l.y) });
  }
  for (const v of views) {
    if (!v.outside.length) continue;
    const b = v.building;
    const at = PROJECTION.toScreen(ox + b.x + b.width / 2, oy + b.y + b.height);
    add(WINDOW_LIGHT, at.x, at.y - T * 0.8, true, 0, { x: b.door.x, y: b.door.y });
  }
  return lamps;
}

/** Burns the world's lamps for this frame: brighter after dark, windows only then. */
export function lightLamps(scene: Phaser.Scene, drawn: Map<string, DrawnRegion>, dark: number): void {
  for (const region of drawn.values()) {
    for (const lamp of region.lamps) {
      placeLight(lamp.lit, lamp.x, lamp.y, scene.time.now, !lamp.hidden && (!lamp.window || dark > 0), dark);
      if (lamp.window) lamp.lit.point.intensity *= dark;
    }
  }
}

/** Stands a kit house on a building's floor: its outside from afar, its cutaway close by, with the furniture inside. */
export function standKitHouse(
  scene: Phaser.Scene,
  region: DrawnRegion,
  v: BuildingView,
  frame: NonNullable<buildingKit.KitHouseInfo['frame']>,
  outside: string,
  inside: string,
  onPlaced: () => void,
): void {
  const house = buildingKit.kitHouse(v.building);
  if (!house) return;
  const floor = { left: v.ox + house.floor.left, top: v.oy + house.floor.top, right: v.ox + house.floor.right, bottom: v.oy + house.floor.bottom };
  const dropped = new Set<Phaser.GameObjects.GameObject>(v.outside);
  for (const o of v.outside) {
    scene.tweens.killTweensOf(o);
    o.destroy();
  }
  // The house brings its own floor and cutaway walls; hide and drop the fallback shell.
  const furniture = v.inside.filter((o) => {
    const isShell = o instanceof Phaser.Tilemaps.TilemapLayer || Boolean(o.getData('shell'));
    if (isShell) {
      dropped.add(o);
      scene.tweens.killTweensOf(o);
      o.destroy();
    }
    return !isShell;
  });
  region.objects = region.objects.filter((o) => !dropped.has(o));
  const cutaway = standHouse(scene, inside, frame, floor, false);
  v.outside = standHouse(scene, outside, frame, floor, true);
  v.inside = [...cutaway, ...furniture];
  v.kit = true;
  v.kitOutside = { texture: outside, frame, floor, storeys: house.spec.storeys.length };
  region.objects.push(...v.outside, ...cutaway);
  onPlaced();
}

/**
 * The isometric camera shows a kit house in place of a building's painted
 * picture once the server has drawn it, which it does the first time it is
 * asked; meanwhile the painted picture stays and the server is asked again
 * now and then.
 */
export async function raiseHouses(
  scene: Phaser.Scene,
  id: string,
  drawn: Map<string, DrawnRegion>,
  source: HouseSource | undefined,
  houseArt: HouseArt,
  onPlaced: () => void,
  tries = 0,
): Promise<void> {
  const region = drawn.get(id);
  if (!source || !region || PROJECTION.ground.kind !== 'diamond') return;
  if (!region.map.buildings.some((b) => buildingKit.kitHouse(b))) return;
  const houses = await source(id).catch(() => []);
  for (const info of houses) {
    const view = region.buildings[info.building];
    if (info.status !== 'ready' || !info.frame || !view || view.kit) continue;
    const [outside, inside] = await Promise.all([houseArt.view(info, 'outside'), houseArt.view(info, 'storey-1')]);
    // Drawn again, let go, or already stood by another try while the pictures loaded.
    if (!outside || !inside || drawn.get(id) !== region || view.kit) continue;
    standKitHouse(scene, region, view, info.frame, outside, inside, onPlaced);
  }
  // By the wall clock: the server's drawing does not wait for our frames.
  if (houses.some((h) => h.status === 'building') && tries < HOUSE_TRIES) {
    setTimeout(() => void (scene.sys.isActive() && raiseHouses(scene, id, drawn, source, houseArt, onPlaced, tries + 1)), HOUSE_RETRY_MS);
  }
}

/** Near a building, fade its exterior away to show the inside; farther off, fade it back. */
export function revealBuildings(
  scene: Phaser.Scene,
  buildings: BuildingView[],
  worldX: number,
  worldY: number,
  instant: boolean,
  floor = 0,
): boolean {
  let changed = false;
  for (const v of buildings) {
    if (!v.outside.length) continue;
    const rx = worldX - v.ox;
    const ry = worldY - v.oy;
    const open = floor === 0 && nearBuilding(v.building, rx, ry, v.kit ? undefined : 1.2);
    if (open === v.open && !instant) continue;
    if (open !== v.open) changed = true;
    v.open = open;
    const fades = [...v.outside.map((target) => ({ target, alpha: open ? 0 : 1 })), ...v.inside.map((target) => ({ target, alpha: open ? 1 : 0 }))];
    for (const { target, alpha } of fades) {
      scene.tweens.killTweensOf(target);
      if (instant) target.setAlpha(alpha);
      else scene.tweens.add({ targets: target, alpha, duration: 350, ease: 'Sine.easeInOut' });
    }
  }
  return changed;
}

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
