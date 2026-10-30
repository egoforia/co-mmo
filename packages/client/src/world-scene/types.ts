// Shared types, constants and pure spatial/floor helpers for WorldScene and
// its submodules in world-scene/.

import Phaser from 'phaser';
import {
  FLAME_LIGHT,
  ISO_WAY_STEPS,
  TILE_PIXELS,
  isWalkDirection,
  type ArtManifest,
  type ArtPointsManifest,
  type Building,
  type ClientMessage,
  type Facing,
  type Interpolator,
  type Light,
  type RegionMap,
  type Storey,
  type TileRect,
  type WalkDirection,
  type WelcomeMessage,
} from '@co-mmo/shared';
import type { HouseSource } from '../kit-house-view.ts';
import type { LitPoint } from '../lights.ts';
import { PROJECTION } from '../projection.ts';

export interface Avatar {
  body: Phaser.GameObjects.Sprite;
  /** The texture this avatar should wear, once it has loaded. */
  art: string;
  /** The way it faces, among the camera's ways. */
  facing: Facing;
  /** The way it last walked on screen, for cardinal walks and standing pictures. */
  turn: WalkDirection;
  /** The way the picture it wears now faces, for which hand is in front. */
  worn: Facing;
  /** Where it was last placed, in our region's tiles. */
  at?: { x: number; y: number };
  /** The floor it is on (floors.ts), when not the ground. */
  floor?: number;
  /** Its size on screen when it wears its own picture. */
  scale: number;
  /**
   * Walks and standing pictures are sized to the figure in its own picture
   * (creatures, whose pictures are not all one height); otherwise only
   * standing pictures are, and walks are drawn as painted.
   */
  fit?: boolean;
  /** How fast it walks, as a share of a player's speed, so its feet keep up with the ground. */
  pace?: number;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  /** Its painted status icons (status-icons.ts), and which they are. */
  icons?: { keys: string; images: Phaser.GameObjects.Image[] };
  /** Health bar, shown once hurt. */
  bar?: { bg: Phaser.GameObjects.Rectangle; fill: Phaser.GameObjects.Rectangle };
  /** Offset for lunges and recoils, in pixels; tweened. */
  nudge: { x: number; y: number };
  /** The weapon or charm shown in its right hand, drawn once its hand and the item's grip are known. */
  held?: Held;
  /** The shield or other off-hand item shown in its left hand, the same way. */
  offHeld?: Held;
}

export interface Held {
  item: string;
  image?: Phaser.GameObjects.Image;
  /** The light it casts, when it burns or glows. */
  lit?: LitPoint;
}

/** Which hand an item is held in. */
export type Hand = 'right' | 'left';

export interface Remote extends Avatar {
  interp: Interpolator;
}

/** A building drawn as its exterior art until we come close, then its inside. */
export interface BuildingView {
  building: Building;
  /** The region's top-left corner in the world, in tiles. */
  ox: number;
  oy: number;
  /** Its outside: empty until the building's outside is painted, and then its inside always shows. A kit house's comes in strips. */
  outside: (Phaser.GameObjects.Image | Phaser.Tilemaps.TilemapLayer)[];
  /** Floor, walls and furniture: hidden while the outside shows. */
  inside: (Phaser.GameObjects.Image | Phaser.GameObjects.Text | Phaser.Tilemaps.TilemapLayer)[];
  open: boolean;
  /** True once a kit house stands in place of its painted picture. */
  kit?: boolean;
}

/** A region drawn into the world: its layout and everything that pictures it. */
export interface DrawnRegion {
  /** The layout it was drawn from, to tell when it changed. */
  layout: string;
  objects: Phaser.GameObjects.GameObject[];
  tilemaps: Phaser.Tilemaps.Tilemap[];
  buildings: BuildingView[];
  /** Art ids of its biome kit: when one is painted, it is drawn again. */
  kit: Set<string>;
  map: RegionMap;
  /** The ground tiles to draw, buildings and landmarks taken out. */
  ground: number[][];
  /** Its ground and scenery near us, in chunks, by chunk index. */
  chunks: Map<number, Chunk>;
  /** Fires, lanterns, shrines and lit windows standing in it. */
  lamps: Lamp[];
  /** Its floors above and below the ground, each shown only while we are on it. */
  floors: FloorView[];
  /** Stair pictures and labels on the ground out in the open, shown while we are on the ground. */
  stairs: Phaser.GameObjects.GameObject[];
}

/** A storey drawn over its rectangle: its tiles, its furniture, and its stairs' pictures and labels. */
export interface FloorView {
  storey: Storey;
  objects: Phaser.GameObjects.GameObject[];
}

/** A light standing in the world, at a screen point; windows light up only after dark. */
export interface Lamp {
  lit: LitPoint;
  x: number;
  y: number;
  window: boolean;
  /** The floor it burns on and the tile it stands on, so it is out of sight from other floors. */
  floor: number;
  tile: { x: number; y: number };
  /** True while we are on a floor it cannot be seen from. */
  hidden?: boolean;
}

/** A square of a region's ground and its trees and rocks, drawn only while we are near. */
export interface Chunk {
  tilemap: Phaser.Tilemaps.Tilemap;
  layer: Phaser.Tilemaps.TilemapLayer;
  objects: Phaser.GameObjects.GameObject[];
}

/**
 * Lands are big (256 tiles a side), so their ground, trees and rocks are
 * drawn in chunks this many tiles across, only those near us: chunks within
 * DRAW_REACH tiles are drawn and those beyond FORGET_REACH let go.
 */
export const CHUNK = 32;
export const DRAW_REACH = 36;
export const FORGET_REACH = 60;

export interface WorldSceneOptions {
  welcome: WelcomeMessage;
  art: ArtManifest;
  /** Where hands and grips are in painted pictures, for held items. */
  points: ArtPointsManifest;
  send: (message: ClientMessage) => void;
  /** True while the player is typing, so keys go to the chat box. */
  typing: () => boolean;
  /** The kit houses of a region, for the isometric camera. */
  houses?: HouseSource;
}

export const T = TILE_PIXELS;
/** A Firebolt's flame, smaller than a torch's. */
export const BOLT_LIGHT: Light = { ...FLAME_LIGHT, radius: 2 };
export const LABEL_DEPTH = 1_000_000;
/** Depth offset between stacked upper storeys so upper floors always draw in front of lower floors. */
export const FLOOR_DEPTH = 50_000;
/** How high low-cut cutaway walls stand in the isometric camera, as a share of a ground diamond's height (~20px). */
export const WALL_RISE = 0.25;
/** Subtle cool-grey directional shade applied to east-facing walls so 90° corners read clearly. */
export const EAST_WALL_TINT = 0xd4d4dc;

/** How often the isometric camera asks for kit houses the server is still drawing, and how many times. */
export const HOUSE_RETRY_MS = 5000;
export const HOUSE_TRIES = 36;

/** Someone the mini map shows: where they stand in our region's tiles, and the picture they wear. */
export interface MapFigure {
  x: number;
  y: number;
  art: string;
  kind: 'me' | 'player' | 'creature' | 'npc';
}

/** What the mini map needs to draw our floor and look at the others. */
export interface MiniMapView {
  /** The scene whose painted pictures the map is put together from. */
  scene: Phaser.Scene;
  map: RegionMap;
  /** Grows as more art is painted and loaded, so the map is put together again (as it is when `map` is laid out anew). */
  artLoaded: number;
  /** The floor we are on. */
  floor: number;
  /** Us first, then everyone near us on our floor. */
  figures: MapFigure[];
}

/** What the world scene holds right now, for the performance overlay. */
export interface SceneCounts {
  players: number;
  creatures: number;
  npcs: number;
  bodies: number;
  /** Regions drawn (ours and those beside it), and their chunks of ground and scenery drawn near us. */
  regions: number;
  chunks: number;
  lamps: number;
  /** The tile we stand on. */
  tile?: { x: number; y: number };
}

/** An isometric way as a step on screen, one long. */
export function wayOnScreen(way: Facing): { x: number; y: number } {
  const step = isWalkDirection(way) ? { dx: 0, dy: 1 } : ISO_WAY_STEPS[way];
  const from = PROJECTION.toScreen(0, 0);
  const to = PROJECTION.toScreen(step.dx, step.dy);
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/** Where a landmark stands: its footprint's bottom row is centred under (l.x, l.y). */
export function landmarkFeet(l: { x: number; y: number; footprint: { width: number; height: number } }, ox: number, oy: number): { x: number; y: number } {
  const { width, height } = l.footprint;
  return PROJECTION.stand(ox + l.x - width / 2, oy + l.y - height, width, height);
}

/** The drawn storey of a floor over a tile. */
export function floorAt(floors: FloorView[], x: number, y: number, floor: number): FloorView | undefined {
  return floors.find(({ storey: s }) => s.floor === floor && x >= s.x && y >= s.y && x < s.x + s.width && y < s.y + s.height);
}

/** True when two tile rectangles share a tile. */
export function overlaps(a: TileRect, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Shows or hides anything drawn that can be. */
export function setShown(o: Phaser.GameObjects.GameObject, shown: boolean): void {
  (o as Partial<Phaser.GameObjects.Components.Visible>).setVisible?.(shown);
}

/** Vertical screen lift (in pixels) for an upper floor (`floor > 0`) in the isometric camera. */
export function floorLift(floor: number): number {
  const ground = PROJECTION.ground;
  if (ground.kind !== 'diamond' || floor <= 0) return 0;
  return Math.round(ground.height * 2.0) * floor;
}

/** Depth offset for an upper floor (`floor > 0`) so upper storeys sort cleanly above lower storeys. */
export function floorDepthOffset(floor: number): number {
  if (PROJECTION.ground.kind !== 'diamond' || floor <= 0) return 0;
  return floor * FLOOR_DEPTH;
}

/**
 * Dims/darkens a game object when it belongs to a floor below the player's current floor.
 * deltaFloors: player floor - object floor (e.g. 1 floor below -> 1, 2 floors below -> 2)
 */
export function setDepthShade(o: Phaser.GameObjects.GameObject, deltaFloors: number, keepAlpha = false): void {
  if (!o.scene) return;
  if (o instanceof Phaser.Tilemaps.TilemapLayer && !o.layer) return;
  const alphaObj = o as Partial<Phaser.GameObjects.Components.Alpha>;
  const tintObj = o as Partial<Phaser.GameObjects.Components.Tint>;
  const baseTint = typeof o.getData === 'function' ? (o.getData('baseTint') as number | undefined) : undefined;
  if (deltaFloors <= 0) {
    if (!keepAlpha) alphaObj.setAlpha?.(1.0);
    if (baseTint !== undefined) tintObj.setTint?.(baseTint);
    else if (typeof tintObj.clearTint === 'function') tintObj.clearTint();
    else tintObj.setTint?.(0xffffff);
    return;
  }
  // Darken and slightly cool-shift lower floors to create atmospheric aerial depth
  const factor = deltaFloors === 1 ? 0.55 : 0.35;
  const r = Math.round(255 * factor * 0.92);
  const g = Math.round(255 * factor * 0.94);
  const b = Math.round(255 * factor * 1.05);
  const tint = (r << 16) | (g << 8) | b;
  tintObj.setTint?.(tint);
  if (!keepAlpha) alphaObj.setAlpha?.(deltaFloors === 1 ? 0.75 : 0.5);
}

/** True when tile (x, y) lies within a building's walls (or a floor's rectangle). */
export function within(b: Pick<Building, 'x' | 'y' | 'width' | 'height'>, x: number, y: number): boolean {
  return x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height;
}

/** About 64 px per tile on a laptop or desktop screen, smaller on phones. */
export function cameraZoom(): number {
  if (window.innerWidth < 700) return 0.3;
  return window.innerWidth < 1280 ? 0.4 : 0.5;
}
