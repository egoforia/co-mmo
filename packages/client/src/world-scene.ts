import Phaser from 'phaser';
import {
  Interpolator,
  Predictor,
  TICK_SECONDS,
  TILE_PIXELS,
  generateSanctum,
  type ClientMessage,
  type EntityState,
  type RegionMap,
  type SnapshotMessage,
  type WelcomeMessage,
} from '@co-mmo/shared';
import { playerTexture, registerTileset, tilesetKey } from './textures.ts';

interface Avatar {
  body: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
}

interface Remote extends Avatar {
  interp: Interpolator;
  seenAt: number;
}

export interface WorldSceneOptions {
  welcome: WelcomeMessage;
  send: (message: ClientMessage) => void;
  /** True while the player is typing, so keys go to the chat box. */
  typing: () => boolean;
}

const T = TILE_PIXELS;

export class WorldScene extends Phaser.Scene {
  private map!: RegionMap;
  private predictor!: Predictor;
  private me!: Avatar;
  private remotes = new Map<string, Remote>();
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private accumulator = 0;
  /** Rendered position eases toward the predicted one to hide corrections. */
  private shown = { x: 0, y: 0 };

  constructor(private readonly options: WorldSceneOptions) {
    super('world');
  }

  create(): void {
    const { welcome } = this.options;
    this.map = generateSanctum(welcome.region.seed, welcome.region.width);
    registerTileset(this);

    const data: number[][] = [];
    for (let y = 0; y < this.map.height; y++) {
      data.push(Array.from(this.map.tiles.subarray(y * this.map.width, (y + 1) * this.map.width)));
    }
    const tilemap = this.make.tilemap({ data, tileWidth: T, tileHeight: T });
    const tileset = tilemap.addTilesetImage(tilesetKey(), tilesetKey(), T, T, 0, 0)!;
    tilemap.createLayer(0, tileset, 0, 0);

    this.predictor = new Predictor(this.map, { x: welcome.x, y: welcome.y });
    this.shown = { x: welcome.x, y: welcome.y };
    this.me = this.makeAvatar(welcome.you.name, welcome.you.color, true);

    const kb = this.input.keyboard!;
    kb.disableGlobalCapture();
    this.keys = kb.addKeys({
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D',
    }, false) as typeof this.keys;

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.map.width * T, this.map.height * T);
    cam.setZoom(window.innerWidth < 700 ? 1 : 1.5);
    cam.setRoundPixels(true);
    cam.startFollow(this.me.body, true, 0.2, 0.2);
    this.placeAvatar(this.me, this.shown.x, this.shown.y);
  }

  onSnapshot(snapshot: SnapshotMessage): void {
    this.predictor.reconcile(snapshot.ack, { x: snapshot.x, y: snapshot.y });
    const now = performance.now();
    const seen = new Set<string>();
    for (const entity of snapshot.players) {
      seen.add(entity.id);
      this.remote(entity).interp.push(now, entity.x, entity.y);
    }
    for (const [id, remote] of this.remotes) {
      if (!seen.has(id)) {
        remote.body.destroy();
        remote.shadow.destroy();
        remote.label.destroy();
        this.remotes.delete(id);
      }
    }
  }

  update(_time: number, deltaMs: number): void {
    // Fixed-rate input: one input per server tick, however fast we render.
    this.accumulator += Math.min(deltaMs, 250) / 1000;
    while (this.accumulator >= TICK_SECONDS) {
      this.accumulator -= TICK_SECONDS;
      const { dx, dy } = this.readInput();
      if (dx !== 0 || dy !== 0) {
        const input = this.predictor.apply(dx, dy);
        this.options.send({ t: 'input', ...input });
      }
    }

    const target = this.predictor.position;
    const gap = Math.hypot(target.x - this.shown.x, target.y - this.shown.y);
    if (gap > 2) this.shown = { ...target };
    else {
      this.shown.x += (target.x - this.shown.x) * 0.5;
      this.shown.y += (target.y - this.shown.y) * 0.5;
    }
    this.placeAvatar(this.me, this.shown.x, this.shown.y);

    const now = performance.now();
    for (const remote of this.remotes.values()) {
      const pos = remote.interp.sample(now);
      if (pos) this.placeAvatar(remote, pos.x, pos.y);
    }
  }

  private readInput(): { dx: number; dy: number } {
    if (this.options.typing()) return { dx: 0, dy: 0 };
    const k = this.keys;
    const dx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    const dy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    return { dx, dy };
  }

  private remote(entity: EntityState): Remote {
    let remote = this.remotes.get(entity.id);
    if (!remote) {
      remote = { ...this.makeAvatar(entity.name, entity.color, false), interp: new Interpolator(), seenAt: 0 };
      this.remotes.set(entity.id, remote);
    }
    remote.seenAt = performance.now();
    return remote;
  }

  private makeAvatar(name: string, color: number, self: boolean): Avatar {
    const shadow = this.add.ellipse(0, 0, 18, 6, 0x181425, 0.35);
    const body = this.add.image(0, 0, playerTexture(this, color)).setOrigin(0.5, 0.95);
    const label = this.add
      .text(0, 0, name, {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '11px',
        color: self ? '#feae34' : '#ffffff',
        stroke: '#181425',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5, 1);
    return { body, shadow, label };
  }

  private placeAvatar(a: Avatar, x: number, y: number): void {
    const px = x * T;
    const py = y * T;
    a.shadow.setPosition(px, py + 1);
    a.body.setPosition(px, py + 2);
    a.label.setPosition(px, py - T + 2);
    // Lower on screen draws in front.
    a.shadow.setDepth(py - 1);
    a.body.setDepth(py);
    a.label.setDepth(100000);
  }
}
