import Phaser from 'phaser';
import {
  Interpolator,
  Predictor,
  TICK_SECONDS,
  TILE_PIXELS,
  Tile,
  generateRegion,
  neighbourOffset,
  rand2,
  regionDef,
  type ArtManifest,
  type ClientMessage,
  type CreatureState,
  type HitMessage,
  type NpcState,
  type RegionMap,
  type Side,
  type SnapshotMessage,
  type WelcomeMessage,
  wishArtKey,
} from '@co-mmo/shared';
import { TILE_MARGIN, lightTint, playerArt, propTexture, registerTileset } from './textures.ts';
import { artSrc, contentEntries } from './wished.ts';

interface Avatar {
  body: Phaser.GameObjects.Image;
  /** The texture this avatar should wear, once it has loaded. */
  art: string;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  /** Health bar, shown once hurt. */
  bar?: { bg: Phaser.GameObjects.Rectangle; fill: Phaser.GameObjects.Rectangle };
  /** Offset for lunges and recoils, in pixels; tweened. */
  nudge: { x: number; y: number };
}

interface Remote extends Avatar {
  interp: Interpolator;
}

export interface WorldSceneOptions {
  welcome: WelcomeMessage;
  art: ArtManifest;
  send: (message: ClientMessage) => void;
  /** True while the player is typing, so keys go to the chat box. */
  typing: () => boolean;
}

const T = TILE_PIXELS;
const LABEL_DEPTH = 1_000_000;

export class WorldScene extends Phaser.Scene {
  private welcome: WelcomeMessage;
  private map!: RegionMap;
  private predictor?: Predictor;
  private lastSeq = 0;
  private me!: Avatar;
  private remotes = new Map<string, Remote>();
  private creatures = new Map<string, Remote>();
  /** NPCs, the map's own and those called by wishes, strolling where the server says. */
  private npcs = new Map<string, Remote>();
  /** Wished art already turned into textures, by key: the URL it came from. */
  private loadedArt = new Map<string, string>();
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private accumulator = 0;
  /** Rendered position eases toward the predicted one to hide corrections. */
  private shown = { x: 0, y: 0 };
  private tint?: Phaser.GameObjects.Rectangle;
  /** Which way we face: 1 right, -1 left. */
  private facing = 1;
  /** True while restarting for a walk into the next region, so there is no fade. */
  private crossing = false;

  constructor(private readonly options: WorldSceneOptions) {
    super('world');
    this.welcome = options.welcome;
  }

  preload(): void {
    for (const [id, entry] of Object.entries(this.options.art)) {
      if (!this.textures.exists(id)) this.load.image(id, entry.file);
    }
  }

  /**
   * The server moved us to another region: rebuild the scene around it. The
   * neighbours are already drawn beside us, so we restart without a fade and
   * the ground carries on where it was.
   */
  enterRegion(welcome: WelcomeMessage): void {
    this.welcome = welcome;
    this.lastSeq = this.predictor?.lastSeq ?? this.lastSeq;
    this.predictor = undefined;
    this.crossing = true;
    this.scene.restart();
  }

  create(): void {
    const welcome = this.welcome;
    const def = regionDef(welcome.region.id) ?? regionDef('sanctum')!;
    this.map = generateRegion(def);
    this.remotes = new Map();
    this.creatures = new Map();
    this.npcs = new Map();
    this.accumulator = 0;

    // Our region, and every neighbour beside it, so the world reads as one.
    this.drawRegion(this.map, 0, 0);
    const bounds = { left: 0, top: 0, right: this.map.width, bottom: this.map.height };
    for (const [side, id] of Object.entries(def.exits) as [Side, string][]) {
      const next = regionDef(id);
      if (!next) continue;
      const offset = neighbourOffset(side, this.map.width);
      this.drawRegion(generateRegion(next), offset.x, offset.y);
      if (side === 'west') bounds.left = offset.x;
      if (side === 'north') bounds.top = offset.y;
      if (side === 'east') bounds.right = offset.x + this.map.width;
      if (side === 'south') bounds.bottom = offset.y + this.map.height;
    }
    this.refreshWishes();

    this.predictor = new Predictor(this.map, { x: welcome.x, y: welcome.y }, this.lastSeq);
    this.shown = { x: welcome.x, y: welcome.y };
    this.me = this.makeAvatar(playerArt(welcome.you.id), welcome.you.name, true);

    const kb = this.input.keyboard!;
    kb.disableGlobalCapture();
    this.keys = kb.addKeys({
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D',
    }, false) as typeof this.keys;

    const cam = this.cameras.main;
    cam.setBounds(bounds.left * T, bounds.top * T, (bounds.right - bounds.left) * T, (bounds.bottom - bounds.top) * T);
    cam.setZoom(cameraZoom());
    cam.setRoundPixels(true);
    this.placeAvatar(this.me, this.shown.x, this.shown.y);
    cam.startFollow(this.me.body, true, 0.2, 0.2);
    if (!this.crossing) cam.fadeIn(250, 24, 20, 37);
    this.crossing = false;

    // The biome's light grades everything under the labels.
    this.tint = this.add.rectangle(0, 0, 10, 10, lightTint(def.biome)).setOrigin(0.5).setScrollFactor(0);
    this.tint.setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(LABEL_DEPTH - 1);
    this.fitTint();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitTint, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.fitTint, this));
  }

  onSnapshot(snapshot: SnapshotMessage): void {
    if (!this.predictor || !this.sys.isActive()) return;
    this.predictor.reconcile(snapshot.ack, { x: snapshot.x, y: snapshot.y });
    const now = performance.now();
    this.sync(this.remotes, snapshot.players, now, (e) => this.makeAvatar(playerArt(e.id), e.name, false));
    this.sync(this.creatures, snapshot.creatures ?? [], now, (c) => this.makeCreature(c));
    this.sync(this.npcs, snapshot.npcs ?? [], now, (n) => this.makeNpc(n));
  }

  update(_time: number, deltaMs: number): void {
    const predictor = this.predictor;
    if (!predictor) return;
    // Fixed-rate input: one input per server tick, however fast we render.
    this.accumulator += Math.min(deltaMs, 250) / 1000;
    while (this.accumulator >= TICK_SECONDS) {
      this.accumulator -= TICK_SECONDS;
      const { dx, dy } = this.readInput();
      if (dx !== 0 || dy !== 0) {
        const input = predictor.apply(dx, dy);
        this.options.send({ t: 'input', ...input });
        if (dx !== 0) {
          this.facing = dx;
          this.me.body.setFlipX(dx < 0);
        }
      }
    }

    const target = predictor.position;
    const gap = Math.hypot(target.x - this.shown.x, target.y - this.shown.y);
    if (gap > 2) this.shown = { ...target };
    else {
      this.shown.x += (target.x - this.shown.x) * 0.5;
      this.shown.y += (target.y - this.shown.y) * 0.5;
    }
    this.placeAvatar(this.me, this.shown.x, this.shown.y);

    const now = performance.now();
    for (const group of [this.remotes, this.creatures, this.npcs]) {
      for (const remote of group.values()) {
        const pos = remote.interp.sample(now);
        if (!pos) continue;
        const before = remote.body.x;
        this.placeAvatar(remote, pos.x, pos.y);
        if (Math.abs(remote.body.x - before) > 0.5) remote.body.setFlipX(remote.body.x < before);
      }
    }
  }

  /**
   * Wished things changed (granted, painted, rolled back): load their art and
   * re-dress any avatar waiting for it. Snapshots say where wished people stand.
   */
  refreshWishes(): void {
    if (!this.sys.isActive() || !this.map) return;
    for (const entry of contentEntries()) {
      const key = wishArtKey(entry.id);
      if (entry.status === 'granted' && entry.definition) void this.loadArt(key, artSrc(key));
    }
  }

  private async loadArt(key: string, url: string): Promise<void> {
    if (this.loadedArt.get(key) === url) return;
    this.loadedArt.set(key, url);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      return;
    }
    if (this.loadedArt.get(key) !== url) return;
    if (this.textures.exists(key)) this.textures.remove(key);
    this.textures.addImage(key, img);
    for (const a of [...this.creatures.values(), ...this.npcs.values()]) {
      if (a.art === key) a.body.setTexture(key);
    }
  }

  /** A strike landed: number, flash and recoil, or a defeat. */
  onHit(hit: HitMessage): void {
    if (!this.predictor) return;
    const myId = this.welcome.you.id;
    const target = hit.target === myId ? this.me : this.remotes.get(hit.target) ?? this.creatures.get(hit.target);
    const attacker = hit.by === myId ? this.me : this.remotes.get(hit.by) ?? this.creatures.get(hit.by);
    if (attacker && attacker !== this.me && target) this.lunge(attacker, target.body.x - attacker.body.x);
    if (!target) return;
    const hurtMe = target === this.me;
    const number = this.add
      .text(target.body.x + (Math.random() - 0.5) * T * 0.3, target.body.y - target.body.displayHeight * 0.8, `${hit.amount}`, {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontStyle: 'bold',
        fontSize: `${Math.round(T * 0.46)}px`,
        color: hurtMe ? '#f6757a' : '#ffffff',
        stroke: '#181425',
        strokeThickness: Math.round(T / 20),
      })
      .setOrigin(0.5)
      .setDepth(LABEL_DEPTH + 1);
    this.tweens.add({ targets: number, y: number.y - T * 0.6, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => number.destroy() });
    target.body.setTintFill(0xffffff);
    this.time.delayedCall(80, () => target.body.active && target.body.clearTint());
    if (hurtMe) this.cameras.main.shake(120, 0.004);
    if (hit.defeated && target !== this.me) this.fadeOut(target);
  }

  /** Our own strike: a lunge and a slash, whether or not it lands. */
  swing(): void {
    if (!this.predictor) return;
    this.lunge(this.me, this.facing);
    const slash = this.add.graphics().setDepth(this.me.body.depth + 1);
    const cx = this.me.body.x + this.facing * T * 0.45;
    const cy = this.me.body.y - this.me.body.displayHeight * 0.45;
    slash.lineStyle(T / 14, 0xffffff, 0.9);
    slash.beginPath();
    const from = this.facing > 0 ? -1.2 : Math.PI - 1.2;
    slash.arc(cx, cy, T * 0.42, from, from + 2.4, false);
    slash.strokePath();
    this.tweens.add({ targets: slash, alpha: 0, duration: 220, onComplete: () => slash.destroy() });
  }

  private lunge(a: Avatar, direction: number): void {
    this.tweens.add({ targets: a.nudge, x: Math.sign(direction || 1) * T * 0.18, duration: 70, yoyo: true, ease: 'Quad.easeOut' });
  }

  /** A defeated creature sinks away; the real sprite is removed by the next snapshot. */
  private fadeOut(a: Avatar): void {
    const ghost = this.add.image(a.body.x, a.body.y, a.body.texture.key).setOrigin(0.5, 0.97);
    ghost.setScale(a.body.scaleX, a.body.scaleY).setFlipX(a.body.flipX).setDepth(a.body.depth);
    a.body.setVisible(false);
    this.tweens.add({ targets: ghost, alpha: 0, scaleY: 0.1, duration: 450, ease: 'Quad.easeIn', onComplete: () => ghost.destroy() });
  }

  /** Greys our sprite while Weakened after falling. */
  setWeakened(weakened: boolean): void {
    if (!this.me?.body.active) return;
    this.me.body.setAlpha(weakened ? 0.7 : 1);
  }

  private setHealth(a: Avatar, health: number): void {
    if (health >= 1 && !a.bar) return;
    if (!a.bar) {
      const bg = this.add.rectangle(0, 0, T * 0.6, T * 0.07, 0x181425, 0.8).setOrigin(0, 0.5);
      const fill = this.add.rectangle(0, 0, T * 0.6, T * 0.05, 0xf6757a).setOrigin(0, 0.5);
      a.bar = { bg, fill };
    }
    a.bar.fill.width = T * 0.6 * Math.max(0, Math.min(1, health));
    a.bar.fill.setFillStyle(health > 0.5 ? 0x63c74d : health > 0.25 ? 0xfeae34 : 0xf6757a);
  }

  private sync<E extends { id: string; x: number; y: number; health?: number }>(
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
      remote.interp.push(now, entity.x, entity.y);
      if (entity.health !== undefined) this.setHealth(remote, entity.health);
    }
    for (const [id, remote] of group) {
      if (seen.has(id)) continue;
      destroyAvatar(remote);
      group.delete(id);
    }
  }

  /** Paints a region's ground and scenery with its top-left corner at (ox, oy), in tiles. */
  private drawRegion(map: RegionMap, ox: number, oy: number): void {
    const tilesetKey = registerTileset(this, map.def);
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
    const tilemap = this.make.tilemap({ data, tileWidth: T, tileHeight: T });
    const tileset = tilemap.addTilesetImage(tilesetKey, tilesetKey, T, T, TILE_MARGIN, TILE_MARGIN * 2)!;
    tilemap.createLayer(0, tileset, ox * T, oy * T)!.setDepth(-1);
    this.placeScenery(map, ox, oy);
  }

  /** Landmarks, and the trees and rocks standing on blocking tiles. */
  private placeScenery(map: RegionMap, ox: number, oy: number): void {
    const biome = map.def.biome;
    for (const l of map.landmarks) {
      if (!this.textures.exists(l.asset)) continue;
      const img = this.add.image((ox + l.x) * T, (oy + l.y) * T, l.asset).setOrigin(0.5, 0.92);
      img.setDepth((oy + l.y) * T);
    }
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[y * map.width + x];
        if (tile !== Tile.Tree && tile !== Tile.Rock) continue;
        const variant = Math.floor(rand2(x, y, 5) * 3);
        const key = propTexture(this, biome, tile === Tile.Tree ? 'tree' : 'rock', variant);
        const jitter = (rand2(x, y, 6) - 0.5) * T * 0.2;
        const img = this.add.image((ox + x + 0.5) * T + jitter, (oy + y + 1) * T, key).setOrigin(0.5, 0.97);
        img.setScale(0.85 + rand2(x, y, 7) * 0.3).setFlipX(rand2(x, y, 8) > 0.5);
        img.setDepth((oy + y + 1) * T - 1);
      }
    }
  }

  private readInput(): { dx: number; dy: number } {
    if (this.options.typing()) return { dx: 0, dy: 0 };
    const k = this.keys;
    const dx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    const dy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    return { dx, dy };
  }

  private makeCreature(c: CreatureState): Avatar {
    const a = this.makeAvatar(c.asset, c.name, false, 'woods-mushroom');
    a.label.setColor('#f6b48a').setFontSize(Math.round(T * 0.2));
    a.body.setScale(0.8);
    return a;
  }

  private makeNpc(n: NpcState): Avatar {
    const a = this.makeAvatar(n.asset, n.name, false, 'sanctum-pilgrim');
    a.label.setColor('#bfe0f2');
    return a;
  }

  private makeAvatar(texture: string, name: string, self: boolean, fallback = 'player-mara'): Avatar {
    const shadow = this.add.ellipse(0, 0, T * 0.56, T * 0.19, 0x181425, 0.3);
    const body = this.add.image(0, 0, this.textures.exists(texture) ? texture : fallback).setOrigin(0.5, 0.97);
    const label = this.add
      .text(0, 0, name, {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: `${Math.round(T * 0.24)}px`,
        color: self ? '#feae34' : '#ffffff',
        stroke: '#181425',
        strokeThickness: Math.round(T / 24),
      })
      .setOrigin(0.5, 1);
    return { body, art: texture, shadow, label, nudge: { x: 0, y: 0 } };
  }

  private placeAvatar(a: Avatar, x: number, y: number): void {
    const px = x * T;
    const py = y * T;
    a.shadow.setPosition(px, py + T / 16);
    a.body.setPosition(px + a.nudge.x, py + T / 10 + a.nudge.y);
    const top = py + T / 10 - a.body.displayHeight;
    a.label.setPosition(px, top - 4);
    if (a.bar) {
      a.bar.bg.setPosition(px - T * 0.3, top - T * 0.3).setDepth(LABEL_DEPTH);
      a.bar.fill.setPosition(px - T * 0.3, top - T * 0.3).setDepth(LABEL_DEPTH);
    }
    // Lower on screen draws in front.
    a.shadow.setDepth(py - 2);
    a.body.setDepth(py);
    a.label.setDepth(LABEL_DEPTH);
  }

  private fitTint(): void {
    const cam = this.cameras.main;
    this.tint?.setPosition(cam.width / 2, cam.height / 2).setSize(cam.width / cam.zoom + 8, cam.height / cam.zoom + 8);
  }
}

function destroyAvatar(a: Avatar): void {
  a.body.destroy();
  a.shadow.destroy();
  a.label.destroy();
  a.bar?.bg.destroy();
  a.bar?.fill.destroy();
}

/** About 64 px per tile on a laptop or desktop screen, smaller on phones. */
function cameraZoom(): number {
  if (window.innerWidth < 700) return 0.3;
  return window.innerWidth < 1280 ? 0.4 : 0.5;
}
