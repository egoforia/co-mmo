import Phaser from 'phaser';
import {
  Interpolator,
  Predictor,
  TICK_SECONDS,
  TILE_PIXELS,
  Tile,
  generateRegion,
  rand2,
  regionDef,
  type ArtManifest,
  type ClientMessage,
  type CreatureState,
  type RegionMap,
  type SnapshotMessage,
  type WelcomeMessage,
} from '@co-mmo/shared';
import { TILE_MARGIN, lightTint, playerArt, propTexture, registerTileset } from './textures.ts';

interface Avatar {
  body: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
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
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private accumulator = 0;
  /** Rendered position eases toward the predicted one to hide corrections. */
  private shown = { x: 0, y: 0 };
  private tint?: Phaser.GameObjects.Rectangle;

  constructor(private readonly options: WorldSceneOptions) {
    super('world');
    this.welcome = options.welcome;
  }

  preload(): void {
    for (const [id, entry] of Object.entries(this.options.art)) {
      if (!this.textures.exists(id)) this.load.image(id, entry.file);
    }
  }

  /** The server moved us to another region: rebuild the scene around it. */
  enterRegion(welcome: WelcomeMessage): void {
    this.welcome = welcome;
    // Stop moving on the old map while the new one loads.
    this.lastSeq = this.predictor?.lastSeq ?? this.lastSeq;
    this.predictor = undefined;
    this.cameras.main.fadeOut(150, 24, 20, 37);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart());
  }

  create(): void {
    const welcome = this.welcome;
    const def = regionDef(welcome.region.id) ?? regionDef('sanctum')!;
    this.map = generateRegion(def);
    this.remotes = new Map();
    this.creatures = new Map();
    this.accumulator = 0;

    const tilesetKey = registerTileset(this, def);
    const data: number[][] = [];
    for (let y = 0; y < this.map.height; y++) {
      data.push(Array.from(this.map.tiles.subarray(y * this.map.width, (y + 1) * this.map.width)));
    }
    // Under landmarks and NPCs, paint whatever ground surrounds them.
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        if (data[y]![x] !== Tile.Blocked) continue;
        const around = [data[y - 1]?.[x], data[y + 1]?.[x], data[y]![x - 1], data[y]![x + 1]];
        data[y]![x] = around.filter((t) => t === Tile.Path).length >= 2 ? Tile.Path : Tile.Ground;
      }
    }
    const tilemap = this.make.tilemap({ data, tileWidth: T, tileHeight: T });
    const tileset = tilemap.addTilesetImage(tilesetKey, tilesetKey, T, T, TILE_MARGIN, TILE_MARGIN * 2)!;
    tilemap.createLayer(0, tileset, 0, 0)!.setDepth(-1);

    this.placeScenery(def.biome);

    this.predictor = new Predictor(this.map, { x: welcome.x, y: welcome.y }, this.lastSeq);
    this.shown = { x: welcome.x, y: welcome.y };
    this.me = this.makeAvatar(playerArt(welcome.you.id), welcome.you.name, true);

    const kb = this.input.keyboard!;
    kb.disableGlobalCapture();
    this.keys = kb.addKeys({
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D',
    }, false) as typeof this.keys;

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.map.width * T, this.map.height * T);
    cam.setZoom(cameraZoom());
    cam.setRoundPixels(true);
    this.placeAvatar(this.me, this.shown.x, this.shown.y);
    cam.startFollow(this.me.body, true, 0.2, 0.2);
    cam.fadeIn(250, 24, 20, 37);

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
        if (dx !== 0) this.me.body.setFlipX(dx < 0);
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
    for (const group of [this.remotes, this.creatures]) {
      for (const remote of group.values()) {
        const pos = remote.interp.sample(now);
        if (!pos) continue;
        const before = remote.body.x;
        this.placeAvatar(remote, pos.x, pos.y);
        if (Math.abs(remote.body.x - before) > 0.5) remote.body.setFlipX(remote.body.x < before);
      }
    }
  }

  private sync<E extends { id: string; x: number; y: number }>(
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
    }
    for (const [id, remote] of group) {
      if (seen.has(id)) continue;
      remote.body.destroy();
      remote.shadow.destroy();
      remote.label.destroy();
      group.delete(id);
    }
  }

  /** Landmarks, NPCs, and the trees and rocks standing on blocking tiles. */
  private placeScenery(biome: string): void {
    const { map } = this;
    for (const l of map.landmarks) {
      if (!this.textures.exists(l.asset)) continue;
      const img = this.add.image(l.x * T, l.y * T, l.asset).setOrigin(0.5, 0.92);
      img.setDepth(l.y * T);
    }
    for (const n of map.npcs) {
      const a = this.makeAvatar(n.asset, n.name, false);
      a.label.setColor('#bfe0f2');
      this.placeAvatar(a, n.x, n.y);
    }
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[y * map.width + x];
        if (tile !== Tile.Tree && tile !== Tile.Rock) continue;
        const variant = Math.floor(rand2(x, y, 5) * 3);
        const key = propTexture(this, biome, tile === Tile.Tree ? 'tree' : 'rock', variant);
        const jitter = (rand2(x, y, 6) - 0.5) * T * 0.2;
        const img = this.add.image((x + 0.5) * T + jitter, (y + 1) * T, key).setOrigin(0.5, 0.97);
        img.setScale(0.85 + rand2(x, y, 7) * 0.3).setFlipX(rand2(x, y, 8) > 0.5);
        img.setDepth((y + 1) * T - 1);
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
    const a = this.makeAvatar(c.asset, c.name, false);
    a.label.setColor('#f6b48a').setFontSize(Math.round(T * 0.2));
    a.body.setScale(0.8);
    return a;
  }

  private makeAvatar(texture: string, name: string, self: boolean): Avatar {
    const shadow = this.add.ellipse(0, 0, T * 0.56, T * 0.19, 0x181425, 0.3);
    const body = this.add.image(0, 0, texture).setOrigin(0.5, 0.97);
    const label = this.add
      .text(0, 0, name, {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: `${Math.round(T * 0.24)}px`,
        color: self ? '#feae34' : '#ffffff',
        stroke: '#181425',
        strokeThickness: Math.round(T / 24),
      })
      .setOrigin(0.5, 1);
    return { body, shadow, label };
  }

  private placeAvatar(a: Avatar, x: number, y: number): void {
    const px = x * T;
    const py = y * T;
    a.shadow.setPosition(px, py + T / 16);
    a.body.setPosition(px, py + T / 10);
    a.label.setPosition(px, py + T / 10 - a.body.displayHeight - 4);
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

/** About 64 px per tile on a laptop or desktop screen, smaller on phones. */
function cameraZoom(): number {
  if (window.innerWidth < 700) return 0.3;
  return window.innerWidth < 1280 ? 0.4 : 0.5;
}
