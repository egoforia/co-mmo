// Avatars (players, creatures, NPCs, fallen bodies), walk cycle animations,
// figure baseline/height metrics cache, and vision-mapped held items.

import Phaser from 'phaser';
import {
  CREATURES,
  heldArts,
  heldSize,
  ITEMS,
  Interpolator,
  PLAYER_SPEED,
  WALK_FRAMES,
  facingSide,
  heldBehind,
  isWalkDirection,
  walkArt,
  walkDirection,
  walkFrameRate,
  walkStandArt,
  statusTag,
  type ArtEntry,
  type ArtManifest,
  type ArtPoint,
  type ArtPointsManifest,
  type BodyState,
  type CreatureState,
  type NpcState,
} from '@co-mmo/shared';
import { dropLight, litFigure, makeLight, placeLight } from '../lights.ts';
import { PROJECTION } from '../projection.ts';
import { playerArt } from '../textures.ts';
import { figureRows, groundFrame, standingMetrics } from './figure-ground.ts';
import { artSrc, lookArt } from '../wished.ts';
import { dropStatusIcons, placeStatusIcons } from './status-icons.ts';
import {
  type Avatar,
  type Hand,
  LABEL_DEPTH,
   type Remote,
  T,
  floorDepthOffset,
  floorLift,
} from './types.ts';

/**
 * Caches opaque pixel heights and ground-contact vertical origins of figures
 * in textures, by texture key. A walk strip is measured on the frame it
 * stands on (`groundFrame`), not its first, so feet stay on the shadow.
 */
export class FigureMetricsCache {
  private readonly metrics = new Map<string, { height: number; originY: number }>();

  invalidate(key: string): void {
    this.metrics.delete(key);
  }

  info(textures: Phaser.Textures.TextureManager, key: string): { height: number; originY: number } | undefined {
    const known = this.metrics.get(key);
    if (known !== undefined) return known;
    const texture = textures.exists(key) ? textures.get(key) : undefined;
    const names = texture?.getFrameNames() ?? [];
    const frames = (names.length ? names.map((n) => texture!.get(n)) : [texture?.get()]).filter((f): f is Phaser.Textures.Frame => !!f);
    const image = frames[0]?.source.image as CanvasImageSource | undefined;
    if (!frames.length || !image) return undefined;
    const { width, height } = frames[0]!.source;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, width, height);
    const rows = frames.map((f) => figureRows(data, width, { x: f.cutX, y: f.cutY, width: f.cutWidth, height: f.cutHeight }));
    const at = groundFrame(rows);
    const entry = standingMetrics(rows[at], frames[at]!.cutHeight);
    this.metrics.set(key, entry);
    return entry;
  }

  /** How tall the figure in a texture's first frame is, in pixels, from its see-through edges. */
  height(textures: Phaser.Textures.TextureManager, key: string): number | undefined {
    return this.info(textures, key)?.height;
  }

  /** Aligns an avatar's vertical origin so its feet rest firmly on the ground shadow across all textures. */
  alignBaseline(textures: Phaser.Textures.TextureManager, a: Avatar, key: string): void {
    const entry = this.info(textures, key);
    if (entry) a.body.setOrigin(0.5, entry.originY);
  }
}

/**
 * A looping walk for every walk strip that loaded, named after its strip.
 * Players all move at the same speed, so the rate that keeps their feet in
 * step with the ground is fixed here.
 */
export function makeWalks(scene: Phaser.Scene, art: ArtManifest): void {
  for (const [id, entry] of Object.entries(art)) {
    if (entry.kind !== 'walk' || !scene.textures.exists(id) || scene.anims.exists(id)) continue;
    makeWalk(scene, id, entry);
  }
}

export function makeWalk(scene: Phaser.Scene, id: string, entry: ArtEntry): void {
  const frames = entry.frames ?? WALK_FRAMES;
  scene.anims.create({
    key: id,
    frames: scene.anims.generateFrameNumbers(id, { start: 0, end: frames - 1 }),
    frameRate: walkFrameRate(frames, PLAYER_SPEED, entry.cycleSeconds),
    repeat: -1,
  });
}

/** Puts a picture on an avatar, at the size its own picture is shown at. */
export function dress(scene: Phaser.Scene, metrics: FigureMetricsCache, a: Avatar, key: string): void {
  a.body.setTexture(key);
  fitFigure(scene, metrics, a, key, true);
  metrics.alignBaseline(scene.textures, a, key);
}

/**
 * Sizes an avatar wearing `key` so its figure stands as tall as the figure
 * in its own picture; with `fitting` false, at its usual size.
 */
export function fitFigure(scene: Phaser.Scene, metrics: FigureMetricsCache, a: Avatar, key: string, fitting: boolean): void {
  const own = fitting && key !== a.art && scene.textures.exists(a.art) ? metrics.height(scene.textures, a.art) : undefined;
  const worn = own ? metrics.height(scene.textures, key) : undefined;
  a.body.setScale(own && worn ? (a.scale * own) / worn : a.scale);
}

/**
 * Plays the walk strip `sheet` while moving; on stopping, stands in
 * `standing` when that picture is there, else the walk's first step.
 */
export function stride(
  scene: Phaser.Scene,
  metrics: FigureMetricsCache,
  a: Avatar,
  sheet: string,
  moving: boolean,
  standing: string | undefined,
): void {
  a.body.setFlipX(false);
  if (moving) {
    if (a.body.anims.currentAnim?.key !== sheet || !a.body.anims.isPlaying) {
      a.body.play(sheet, true);
      fitFigure(scene, metrics, a, sheet, !!a.fit);
      metrics.alignBaseline(scene.textures, a, sheet);
    }
    a.body.anims.timeScale = a.pace ?? 1;
    return;
  }
  if (!a.body.anims.isPlaying) return;
  a.body.stop();
  if (standing && scene.textures.exists(standing)) dress(scene, metrics, a, standing);
  else {
    a.body.setTexture(sheet, 0);
    fitFigure(scene, metrics, a, sheet, !!a.fit);
    metrics.alignBaseline(scene.textures, a, sheet);
  }
}

/**
 * Plays an avatar's walk for its step, `step` along the grid and `screen`
 * on screen, and stands it still facing that way when it stops. In the
 * isometric camera it shows the walk made for the way it faces, else the
 * standing picture painted for it, gliding; until that is painted, it
 * falls back to any cardinal walk or standing picture, turned to face
 * left or right.
 */
export function walkAvatar(
  scene: Phaser.Scene,
  metrics: FigureMetricsCache,
  a: Avatar,
  step: { dx: number; dy: number },
  screen: { dx: number; dy: number },
): void {
  a.facing = PROJECTION.face(step.dx, step.dy, a.facing);
  a.turn = walkDirection(screen.dx, screen.dy, a.turn);
  const moving = screen.dx !== 0 || screen.dy !== 0;
  if (!isWalkDirection(a.facing)) {
    const way = walkStandArt(a.art, a.facing);
    const walking = walkArt(a.art, a.facing);
    if (scene.anims.exists(walking)) {
      a.worn = a.facing;
      // Standing still since it came into view: show the way it faces, not whatever it wore before.
      if (!moving && !a.body.anims.isPlaying && scene.textures.exists(way) && a.body.texture.key !== way && a.body.texture.key !== walking) dress(scene, metrics, a, way);
      else stride(scene, metrics, a, walking, moving, way);
      return;
    }
    if (scene.textures.exists(way)) {
      if (a.body.anims.isPlaying) a.body.stop();
      a.body.setFlipX(false);
      if (a.body.texture.key !== way) dress(scene, metrics, a, way);
      a.worn = a.facing;
      return;
    }
  }
  a.worn = a.turn;
  const sheet = walkArt(a.art, a.turn);
  if (scene.anims.exists(sheet)) {
    // Facing us, the approved standing pose; any other way, the walk's first step.
    stride(scene, metrics, a, sheet, moving, a.turn === 'front' ? a.art : undefined);
    return;
  }
  // No walk painted this way: another way's walk stops.
  if (a.body.anims.isPlaying) a.body.stop();
  const stand = walkStandArt(a.art, a.turn);
  if (scene.textures.exists(stand)) {
    a.body.setFlipX(false);
    if (a.body.texture.key !== stand) dress(scene, metrics, a, stand);
    return;
  }
  if (scene.textures.exists(a.art) && a.body.texture.key !== a.art) dress(scene, metrics, a, a.art);
  if (screen.dx !== 0) a.body.setFlipX(screen.dx < 0);
}

/** A player's own painted look, or one of the two approved player looks. */
export function playerTexture(id: string): string {
  return lookArt(id) ?? playerArt(id);
}

export function makeAvatar(
  scene: Phaser.Scene,
  metrics: FigureMetricsCache,
  texture: string,
  name: string,
  self: boolean,
  fallback = 'player-mara',
): Avatar {
  const key = scene.textures.exists(texture) ? texture : fallback;
  const shadow = scene.add.ellipse(0, 0, T * 0.56, T * 0.19, 0x181425, 0.3);
  const body = litFigure(scene, scene.add.sprite(0, 0, key).setOrigin(0.5, 0.97));
  const label = scene.add
    .text(0, 0, name, {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSize: `${Math.round(T * 0.24)}px`,
      color: self ? '#feae34' : '#ffffff',
      stroke: '#181425',
      strokeThickness: Math.round(T / 24),
    })
    .setOrigin(0.5, 1);
  const a: Avatar = { body, art: texture, facing: PROJECTION.ways[0]!, turn: 'front', worn: 'front', scale: 1, shadow, label, nudge: { x: 0, y: 0 } };
  metrics.alignBaseline(scene.textures, a, key);
  return a;
}

export function makeCreature(scene: Phaser.Scene, metrics: FigureMetricsCache, c: CreatureState): Avatar {
  const a = makeAvatar(scene, metrics, c.asset, c.name, false, 'woods-mushroom');
  a.label.setColor('#f6b48a').setFontSize(Math.round(T * 0.2));
  a.scale = 0.8;
  a.fit = true;
  // Creatures walk slower than players: their walks play slower so their feet keep up.
  const speed = CREATURES[c.kind]?.speed;
  if (speed) a.pace = speed / PLAYER_SPEED;
  a.body.setScale(0.8);
  return a;
}

/** A body is the creature's own painted picture, laid on its side and faded a little. */
export function makeBody(scene: Phaser.Scene, metrics: FigureMetricsCache, b: BodyState): Avatar {
  const a = makeAvatar(scene, metrics, b.asset, bodyLabel(b), false, 'woods-mushroom');
  a.label.setColor('#c0cbdc').setFontSize(Math.round(T * 0.18));
  a.body.setScale(0.8).setOrigin(0.5, 0.5).setAngle(90).setAlpha(0.75);
  return a;
}

export function makeNpc(scene: Phaser.Scene, metrics: FigureMetricsCache, n: NpcState): Avatar {
  const a = makeAvatar(scene, metrics, n.asset, n.name, false, 'sanctum-pilgrim');
  a.label.setColor('#bfe0f2');
  return a;
}

/** A creature's name tag says when it is asleep or running away, and names statuses whose icons are not painted yet. */
export function creatureLabel(c: CreatureState, painted: (key: string) => boolean): string {
  const name = c.mood === 'asleep' ? `${c.name} (asleep)` : c.mood === 'fleeing' ? `${c.name} (running away)` : c.name;
  return statusTag(name, c.statuses, painted);
}

/** A body's name tag says when there is something on it for us. */
export function bodyLabel(b: BodyState): string {
  return b.loot ? `${b.name} (E for loot)` : b.name;
}

export function destroyAvatar(scene: Phaser.Scene, a: Avatar): void {
  dropStatusIcons(a);
  a.held?.image?.destroy();
  a.offHeld?.image?.destroy();
  dropLight(scene, a.held?.lit);
  dropLight(scene, a.offHeld?.lit);
  a.body.destroy();
  a.shadow.destroy();
  a.label.destroy();
  a.bar?.bg.destroy();
  a.bar?.fill.destroy();
}

export function setHealth(scene: Phaser.Scene, a: Avatar, health: number): void {
  if (health >= 1 && !a.bar) return;
  if (!a.bar) {
    const bg = scene.add.rectangle(0, 0, T * 0.6, T * 0.07, 0x181425, 0.8).setOrigin(0, 0.5);
    const fill = scene.add.rectangle(0, 0, T * 0.6, T * 0.05, 0xf6757a).setOrigin(0, 0.5);
    a.bar = { bg, fill };
  }
  a.bar.fill.width = T * 0.6 * Math.max(0, Math.min(1, health));
  a.bar.fill.setFillStyle(health > 0.5 ? 0x63c74d : health > 0.25 ? 0xfeae34 : 0xf6757a);
}

export function syncAvatars<E extends { id: string; x: number; y: number; health?: number; floor?: number }>(
  scene: Phaser.Scene,
  group: Map<string, Remote>,
  entities: E[],
  now: number,
  make: (e: E) => Avatar,
): void {
  const seen = new Set<string>();
  for (const entity of entities) {
    seen.add(entity.id);
    let remote = group.get(entity.id);
    if (!remote) {
      remote = { ...make(entity), interp: new Interpolator() };
      group.set(entity.id, remote);
    }
    remote.floor = entity.floor ?? 0;
    remote.interp.push(now, entity.x, entity.y);
    if (entity.health !== undefined) setHealth(scene, remote, entity.health);
  }
  for (const [id, remote] of group) {
    if (seen.has(id)) continue;
    destroyAvatar(scene, remote);
    group.delete(id);
  }
}

/** Places an avatar at (x, y) in our region, counted from its corner. */
export function placeAvatar(
  scene: Phaser.Scene,
  a: Avatar,
  isMe: boolean,
  currentFloor: number,
  origin: { x: number; y: number },
  points: ArtPointsManifest,
  darkness: number,
  x: number,
  y: number,
): void {
  const floor = isMe ? currentFloor : (a.floor ?? 0);
  const { x: px, y: py0 } = PROJECTION.toScreen(origin.x + x, origin.y + y);
  const py = py0 - floorLift(floor);
  const depth = floorDepthOffset(floor) + PROJECTION.depth(origin.x + x, origin.y + y);
  a.at = { x, y };
  a.shadow.setPosition(px, py + T / 16);
  a.body.setPosition(px + a.nudge.x, py + T / 10 + a.nudge.y);
  const top = py + T / 10 - a.body.displayHeight * a.body.originY;
  a.label.setPosition(px, top - 4);
  if (a.bar) {
    a.bar.bg.setPosition(px - T * 0.3, top - T * 0.3).setDepth(LABEL_DEPTH);
    a.bar.fill.setPosition(px - T * 0.3, top - T * 0.3).setDepth(LABEL_DEPTH);
  }
  // Lower on screen draws in front.
  a.shadow.setDepth(depth - 2);
  a.body.setDepth(depth);
  a.label.setDepth(LABEL_DEPTH);
  placeStatusIcons(a);
  // After the body's depth is set, or the item lags a step behind it and slips behind the body while walking down.
  placeHeld(scene, a, 'right', points, darkness);
  placeHeld(scene, a, 'left', points, darkness);
}

/** Puts an item in an avatar's hand, or takes it away. */
export function setHeld(
  scene: Phaser.Scene,
  a: Avatar,
  item: string | undefined,
  hand: Hand,
  loadArt: (key: string, url: string) => Promise<void>,
): void {
  const slot = hand === 'right' ? 'held' : 'offHeld';
  if (a[slot]?.item === item) return;
  a[slot]?.image?.destroy();
  dropLight(scene, a[slot]?.lit);
  const light = item ? ITEMS[item]?.light : undefined;
  a[slot] = item ? { item, lit: light ? makeLight(scene, light) : undefined } : undefined;
  // Its own picture; a family's picture ships with the game and is loaded with it.
  const key = item ? ITEMS[item]?.art : undefined;
  if (key && !scene.textures.exists(key)) void loadArt(key, artSrc(key));
}

/**
 * The picture shown in the hand: the item's own once it is loaded and its
 * grip found, else its family's (a wished bow shows a bow until its own is
 * painted), else nothing.
 */
export function heldPicture(scene: Phaser.Scene, item: string, points: ArtPointsManifest): string | undefined {
  return heldArts(item).find((key) => points[key]?.grip && scene.textures.exists(key));
}

/**
 * Draws a held item with its grip on the holder's right or left hand in
 * the frame showing now: in front of the body when that hand is nearer us
 * (facing us, or walking to the right for the right hand and to the left
 * for the left), behind it otherwise. Nothing shows until a vision model
 * has found both points: no guessing.
 */
export function placeHeld(
  scene: Phaser.Scene,
  a: Avatar,
  side: Hand,
  points: ArtPointsManifest,
  darkness: number,
): void {
  const held = side === 'right' ? a.held : a.offHeld;
  if (!held) return;
  const key = heldPicture(scene, held.item, points);
  const b = a.body;
  const hand = handOf(a, side, points);
  const grip = key ? points[key]?.grip : undefined;
  if (held.lit) {
    // The light shines from the hand, or from the holder's middle until the hand is found.
    const [hx, hy] = hand ?? [b.originX, b.originY - 0.5];
    const lx = b.x + (b.flipX ? b.originX - hx : hx - b.originX) * b.displayWidth;
    placeLight(held.lit, lx, b.y + (hy - b.originY) * b.displayHeight, scene.time.now, b.visible, darkness);
  }
  if (!key || !hand || !grip) {
    held.image?.setVisible(false);
    return;
  }
  if (!held.image || held.image.texture.key !== key) {
    held.image?.destroy();
    held.image = litFigure(scene, scene.add.image(0, 0, key));
  }
  const mirrored = b.flipX;
  const x = b.x + (mirrored ? b.originX - hand[0] : hand[0] - b.originX) * b.displayWidth;
  const y = b.y + (hand[1] - b.originY) * b.displayHeight;
  const flip = mirrored || facingSide(a.worn) === 'left';
  const image = held.image;
  image
    .setFlipX(flip)
    .setOrigin(flip ? 1 - grip[0] : grip[0], grip[1])
    .setScale((b.displayHeight * heldSize(held.item)) / Math.max(image.width, image.height))
    .setPosition(x, y)
    .setDepth(b.depth + (heldBehind(a.worn, side) ? -1 : 1))
    .setVisible(b.visible);
}

/**
 * Where the avatar's right (or left) hand is in the picture or walk frame
 * it shows now; in a frame where it was not found, the nearest frame's, so
 * the item does not blink out for a step.
 */
export function handOf(a: Avatar, side: Hand, allPoints: ArtPointsManifest): ArtPoint | undefined {
  const points = allPoints[a.body.texture.key];
  const hands = side === 'right' ? points?.hands : points?.leftHands;
  if (!hands?.length) return undefined;
  const name = Number(a.body.frame.name);
  const frame = hands.length > 1 && Number.isInteger(name) ? name : 0;
  for (let k = 0; k < hands.length; k++) {
    const hand = hands[(frame + k) % hands.length] ?? hands[(frame - k + hands.length) % hands.length];
    if (hand) return hand;
  }
  return undefined;
}
