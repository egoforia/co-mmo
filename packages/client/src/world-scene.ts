import Phaser from 'phaser';
import {
  ABILITIES,
  Interpolator,
  Predictor,
  TICK_SECONDS,
  TILE_PIXELS,
  Tile,
  generateRegion,
  buildingArt,
  exteriorSpan,
  nearBuilding,
  neighbourOffset,
  rand2,
  biomeLook,
  type ArtManifest,
  type Building,
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
import { TILE_MARGIN, hasExterior, lightTint, playerArt, propTexture, registerBuildingTileset, registerTileset } from './textures.ts';
import { lookArt, sceneArt } from './wished.ts';

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

/** A building drawn as its exterior art until we come close, then its inside. */
interface BuildingView {
  building: Building;
  /** The region's top-left corner, in tiles. */
  ox: number;
  oy: number;
  /** Undefined until the building's outside is painted: then its inside always shows. */
  exterior?: Phaser.GameObjects.Image;
  /** Floor, walls and furniture: hidden while the exterior shows. */
  inside: (Phaser.GameObjects.Image | Phaser.Tilemaps.TilemapLayer)[];
  open: boolean;
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
  private buildings: BuildingView[] = [];
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
  /** Art ids of the biome kits drawn now: when one is painted, the land is drawn again. */
  private kitIds = new Set<string>();
  private redrawing = false;

  constructor(private readonly options: WorldSceneOptions) {
    super('world');
    this.welcome = options.welcome;
    // Art from the manifest is loaded in preload; wishes pointing at the same file need no second load.
    for (const [id, entry] of Object.entries(options.art)) this.loadedArt.set(id, entry.file);
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
    // The server sends the region's layout: it may be one a player wished for.
    const def = welcome.region.def;
    this.map = generateRegion(def);
    this.remotes = new Map();
    this.creatures = new Map();
    this.npcs = new Map();
    this.buildings = [];
    this.accumulator = 0;
    this.redrawing = false;
    this.kitIds = new Set();

    // Our region, and every neighbour beside it, so the world reads as one.
    this.drawRegion(this.map, 0, 0);
    const bounds = { left: 0, top: 0, right: this.map.width, bottom: this.map.height };
    for (const [side, id] of Object.entries(def.exits) as [Side, string][]) {
      const next = welcome.neighbours.find((n) => n.id === id);
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
    this.me = this.makeAvatar(this.playerTexture(welcome.you.id), welcome.you.name, true);

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
    this.revealBuildings(true);
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
    this.sync(this.remotes, snapshot.players, now, (e) => this.makeAvatar(this.playerTexture(e.id), e.name, false));
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
    this.revealBuildings(false);

    const now = performance.now();
    for (const group of [this.remotes, this.creatures, this.npcs]) {
      for (const remote of group.values()) {
        const pos = remote.interp.sample(now);
        if (!pos) continue;
        const before = remote.body.x;
        this.placeAvatar(remote, pos.x, pos.y);
        if (Math.abs(remote.body.x - before) > 0.5) remote.body.setFlipX(remote.body.x < before);
        // People indoors stay out of sight until we come close enough to see in.
        if (group !== this.creatures) {
          const seen = !this.buildings.some((v) => !v.open && within(v.building, Math.floor(pos.x - v.ox), Math.floor(pos.y - v.oy)));
          for (const part of [remote.body, remote.shadow, remote.label]) part.setVisible(seen);
        }
      }
    }
  }

  /**
   * Wished things changed (granted, painted, rolled back): load their art and
   * re-dress any avatar waiting for it. Snapshots say where wished people stand.
   */
  refreshWishes(): void {
    // Not isActive(): that is still false while create() runs, and art
    // that arrived before the scene existed is loaded from there.
    if (!this.map) return;
    for (const [key, url] of sceneArt()) void this.loadArt(key, url);
    // A look described, painted or rolled back: players change clothes.
    const players: [string, Avatar][] = [[this.welcome.you.id, this.me], ...this.remotes];
    for (const [id, a] of players) {
      const art = this.playerTexture(id);
      if (!a || a.art === art) continue;
      a.art = art;
      if (this.textures.exists(art)) a.body.setTexture(art);
    }
  }

  /** A player's own painted look, or one of the two approved player looks. */
  private playerTexture(id: string): string {
    return lookArt(id) ?? playerArt(id);
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
    // A wished biome's ground, water, trees or rocks were painted: draw the land again.
    if (this.kitIds.has(key)) this.redraw();
    for (const a of [...this.creatures.values(), ...this.npcs.values(), ...this.remotes.values(), this.me]) {
      if (a?.art === key) a.body.setTexture(key);
    }
  }

  /** A strike landed: number, flash and recoil, or a defeat. */
  onHit(hit: HitMessage): void {
    if (!this.predictor) return;
    const myId = this.welcome.you.id;
    const target = hit.target === myId ? this.me : this.remotes.get(hit.target) ?? this.creatures.get(hit.target);
    const attacker = hit.by === myId ? this.me : this.remotes.get(hit.by) ?? this.creatures.get(hit.by);
    const bolt = hit.ability && ABILITIES[hit.ability]?.effect === 'bolt';
    if (attacker && target && bolt) this.bolt(attacker, target);
    else if (attacker && attacker !== this.me && target) this.lunge(attacker, target.body.x - attacker.body.x);
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
    if (!this.textures.exists('fx-slash')) return;
    // The painted slash curves like a C; mirror it so it bulges the way we face.
    const slash = this.add.image(this.me.body.x + this.facing * T * 0.45, this.me.body.y - this.me.body.displayHeight * 0.45, 'fx-slash');
    slash.setDisplaySize(T * 0.9, T * 0.9).setFlipX(this.facing > 0).setDepth(this.me.body.depth + 1);
    this.tweens.add({ targets: slash, alpha: 0, duration: 220, onComplete: () => slash.destroy() });
  }

  /** The painted Firebolt spark flies from the caster to the target. */
  private bolt(from: Avatar, to: Avatar): void {
    if (!this.textures.exists('item-firebolt')) return;
    const y = (a: Avatar) => a.body.y - a.body.displayHeight * 0.5;
    const angle = Math.atan2(y(to) - y(from), to.body.x - from.body.x);
    const spark = this.add.image(from.body.x, y(from), 'item-firebolt').setDisplaySize(T * 0.6, T * 0.6).setRotation(angle).setDepth(LABEL_DEPTH);
    this.tweens.add({
      targets: spark, x: to.body.x, y: y(to), duration: 180, ease: 'Quad.easeIn',
      onComplete: () => this.tweens.add({ targets: spark, scale: spark.scale * 1.8, alpha: 0, duration: 160, onComplete: () => spark.destroy() }),
    });
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
  /** Draws the land again where we stand, once the art that arrived together has loaded. */
  private redraw(): void {
    if (this.redrawing || !this.predictor) return;
    this.redrawing = true;
    this.time.delayedCall(500, () => {
      const at = this.predictor?.position;
      if (at) this.enterRegion({ ...this.welcome, x: at.x, y: at.y });
    });
  }

  private drawRegion(map: RegionMap, ox: number, oy: number): void {
    const look = biomeLook(map.def.biome);
    for (const id of [look.ground, look.path, look.water, ...look.trees, ...look.rocks]) this.kitIds.add(id);
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
    const layer = (tiles: number[][], depth: number, key = tilesetKey) => {
      const tilemap = this.make.tilemap({ data: tiles, tileWidth: T, tileHeight: T });
      const tileset = tilemap.addTilesetImage(key, key, T, T, TILE_MARGIN, TILE_MARGIN * 2)!;
      return tilemap.createLayer(0, tileset, ox * T, oy * T)!.setDepth(depth);
    };
    // Each building keeps its floor and walls on a layer of its own, in its
    // own painted tiles, hidden behind its outside art until we come close;
    // the ground runs on underneath.
    const views = map.buildings.map((b) => {
      const inside = data.map((row, y) => row.map((t, x) => (within(b, x, y) ? t : -1)));
      for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) if (data[y]?.[x] !== undefined) data[y]![x] = Tile.Ground;
      const exterior = hasExterior(this, b.style) ? this.exterior(b, ox, oy) : undefined;
      const view: BuildingView = { building: b, ox, oy, exterior, inside: [layer(inside, -0.5, registerBuildingTileset(this, b.style))], open: !exterior };
      return view;
    });
    layer(data, -1);
    this.buildings.push(...views);
    this.placeScenery(map, ox, oy, views);
  }

  /**
   * A building's outside art. Its door is painted at the middle of its bottom
   * edge, so it is drawn centred on the doorway, standing on the south wall.
   */
  private exterior(b: Building, ox: number, oy: number): Phaser.GameObjects.Image {
    const span = exteriorSpan(b);
    const img = this.add.image((ox + span.left) * T, (oy + span.bottom) * T, buildingArt(b.style, 'exterior')).setOrigin(0, 1);
    const w = span.width * T;
    img.setDisplaySize(w, (w * img.height) / img.width);
    return img.setDepth((oy + b.y + b.height) * T);
  }

  /** Landmarks, and the trees and rocks standing on blocking tiles. */
  private placeScenery(map: RegionMap, ox: number, oy: number, views: BuildingView[]): void {
    const biome = map.def.biome;
    for (const l of map.landmarks) {
      if (!this.textures.exists(l.asset)) continue;
      const img = this.add.image((ox + l.x) * T, (oy + l.y) * T, l.asset).setOrigin(0.5, 0.92);
      img.setDepth((oy + l.y) * T);
      views.find((v) => within(v.building, Math.floor(l.x), Math.floor(l.y - 0.01)))?.inside.push(img);
    }
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[y * map.width + x];
        if (tile !== Tile.Tree && tile !== Tile.Rock) continue;
        const variant = Math.floor(rand2(x, y, 5) * 3);
        const key = propTexture(this, biome, tile === Tile.Tree ? 'tree' : 'rock', variant);
        if (!key) continue;
        const jitter = (rand2(x, y, 6) - 0.5) * T * 0.2;
        const img = this.add.image((ox + x + 0.5) * T + jitter, (oy + y + 1) * T, key).setOrigin(0.5, 0.97);
        img.setScale(0.85 + rand2(x, y, 7) * 0.3).setFlipX(rand2(x, y, 8) > 0.5);
        img.setDepth((oy + y + 1) * T - 1);
      }
    }
  }

  /** Near a building, fade its exterior away to show the inside; farther off, fade it back. */
  private revealBuildings(instant: boolean): void {
    for (const v of this.buildings) {
      if (!v.exterior) continue;
      const open = nearBuilding(v.building, this.shown.x - v.ox, this.shown.y - v.oy);
      if (open === v.open && !instant) continue;
      v.open = open;
      const fades = [{ target: v.exterior, alpha: open ? 0 : 1 }, ...v.inside.map((target) => ({ target, alpha: open ? 1 : 0 }))];
      for (const { target, alpha } of fades) {
        this.tweens.killTweensOf(target);
        if (instant) target.setAlpha(alpha);
        else this.tweens.add({ targets: target, alpha, duration: 350, ease: 'Sine.easeInOut' });
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

/** True when tile (x, y) lies within a building's walls. */
function within(b: Building, x: number, y: number): boolean {
  return x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height;
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
