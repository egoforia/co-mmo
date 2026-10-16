import Phaser from 'phaser';
import {
  ABILITIES,
  CREATURES,
  ITEMS,
  Interpolator,
  HELD_SIZE,
  heldBehind,
  heldItem,
  offHandItem,
  Predictor,
  TICK_SECONDS,
  TILE_PIXELS,
  Tile,
  PLAYER_SPEED,
  WALK_FRAMES,
  generateRegion,
  buildingArt,
  exteriorSpan,
  nearBuilding,
  rand2,
  biomeLook,
  type ArtEntry,
  type ArtManifest,
  type ArtPoint,
  type ArtPointsManifest,
  type BodyState,
  type Building,
  type ClientMessage,
  type CreatureState,
  type HitMessage,
  type NpcState,
  type RegionMap,
  type Side,
  type SnapshotMessage,
  type WalkDirection,
  type WelcomeMessage,
  walkArt,
  walkStandArt,
  walkDirection,
  walkFrameRate,
  wishArtKey,
} from '@co-mmo/shared';
import { TILE_MARGIN, hasExterior, lightTint, playerArt, propTexture, registerBuildingTileset, registerTileset } from './textures.ts';
import { artSrc, lookArt, sceneArt } from './wished.ts';

interface Avatar {
  body: Phaser.GameObjects.Sprite;
  /** The texture this avatar should wear, once it has loaded. */
  art: string;
  /** The way it last walked, for looks with painted walk sheets. */
  facing: WalkDirection;
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
  /** Health bar, shown once hurt. */
  bar?: { bg: Phaser.GameObjects.Rectangle; fill: Phaser.GameObjects.Rectangle };
  /** Offset for lunges and recoils, in pixels; tweened. */
  nudge: { x: number; y: number };
  /** The weapon or charm shown in its right hand, drawn once its hand and the item's grip are known. */
  held?: Held;
  /** The shield or other off-hand item shown in its left hand, the same way. */
  offHeld?: Held;
}

interface Held {
  item: string;
  image?: Phaser.GameObjects.Image;
}

/** Which hand an item is held in. */
type Hand = 'right' | 'left';

interface Remote extends Avatar {
  interp: Interpolator;
}

/** A building drawn as its exterior art until we come close, then its inside. */
interface BuildingView {
  building: Building;
  /** The region's top-left corner in the world, in tiles. */
  ox: number;
  oy: number;
  /** Undefined until the building's outside is painted: then its inside always shows. */
  exterior?: Phaser.GameObjects.Image;
  /** Floor, walls and furniture: hidden while the exterior shows. */
  inside: (Phaser.GameObjects.Image | Phaser.Tilemaps.TilemapLayer)[];
  open: boolean;
}

/** A region drawn into the world: its layout and everything that pictures it. */
interface DrawnRegion {
  /** The layout it was drawn from, to tell when it changed. */
  layout: string;
  objects: Phaser.GameObjects.GameObject[];
  tilemaps: Phaser.Tilemaps.Tilemap[];
  buildings: BuildingView[];
  /** Art ids of its biome kit: when one is painted, it is drawn again. */
  kit: Set<string>;
}

export interface WorldSceneOptions {
  welcome: WelcomeMessage;
  art: ArtManifest;
  /** Where hands and grips are in painted pictures, for held items. */
  points: ArtPointsManifest;
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
  /** Bodies of defeated creatures, lying where they fell until they fade. */
  private bodies = new Map<string, Remote>();
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
  /**
   * The world is one map: every region is drawn at its square on the world
   * grid, and walking between them only moves us along it. This is the
   * current region's top-left corner in that map, in tiles; positions from
   * the server are counted from it.
   */
  private origin = { x: 0, y: 0 };
  /** The regions drawn around us, by id. */
  private drawn = new Map<string, DrawnRegion>();
  /** Kit art painted since the land was last drawn. */
  private painted = new Set<string>();

  constructor(private readonly options: WorldSceneOptions) {
    super('world');
    this.welcome = options.welcome;
    // Art from the manifest is loaded in preload; wishes pointing at the same file need no second load.
    for (const [id, entry] of Object.entries(options.art)) this.loadedArt.set(id, entry.file);
  }

  preload(): void {
    for (const [id, entry] of Object.entries(this.options.art)) {
      if (this.textures.exists(id)) continue;
      // A walk strip is one cycle's frames, side by side.
      if (entry.kind === 'walk') this.load.spritesheet(id, entry.file, { frameWidth: entry.width / (entry.frames ?? WALK_FRAMES), frameHeight: entry.height });
      else this.load.image(id, entry.file);
    }
  }

  /**
   * A looping walk for every walk strip that loaded, named after its strip.
   * Players all move at the same speed, so the rate that keeps their feet in
   * step with the ground is fixed here.
   */
  private makeWalks(): void {
    for (const [id, entry] of Object.entries(this.options.art)) {
      if (entry.kind !== 'walk' || !this.textures.exists(id) || this.anims.exists(id)) continue;
      this.makeWalk(id, entry);
    }
  }

  private makeWalk(id: string, entry: ArtEntry): void {
    const frames = entry.frames ?? WALK_FRAMES;
    this.anims.create({ key: id, frames: this.anims.generateFrameNumbers(id, { start: 0, end: frames - 1 }), frameRate: walkFrameRate(frames, PLAYER_SPEED, entry.cycleSeconds), repeat: -1 });
  }

  /**
   * Walks were painted, or painted again, after the page loaded: load the
   * changed strips and swap their walks in. Walkers standing still take the
   * new walk at their next step; those mid-stride carry on in it.
   */
  updateWalks(art: ArtManifest, ids: string[]): void {
    for (const id of ids) {
      const entry = art[id];
      if (!entry) continue;
      this.options.art[id] = entry;
      // A standing picture painted again: walkers facing that way wear it from their next step.
      if (entry.kind === 'walk') void this.loadWalk(id, entry);
      else void this.loadArt(id, entry.file);
    }
  }

  private async loadWalk(id: string, entry: ArtEntry): Promise<void> {
    if (this.loadedArt.get(id) === entry.file && this.anims.exists(id)) return;
    this.loadedArt.set(id, entry.file);
    const img = new Image();
    img.src = entry.file;
    try {
      await img.decode();
    } catch {
      return;
    }
    // A newer repaint arrived while this one loaded.
    if (this.loadedArt.get(id) !== entry.file) return;
    const avatars = [...this.creatures.values(), ...this.bodies.values(), ...this.npcs.values(), ...this.remotes.values(), this.me].filter((a) => a?.body.texture.key === id);
    const striding = new Set(avatars.filter((a) => a.body.anims.isPlaying));
    // The old walk goes first, so the new one can take its name.
    for (const a of avatars) a.body.stop();
    if (this.anims.exists(id)) this.anims.remove(id);
    if (this.textures.exists(id)) this.textures.remove(id);
    this.textures.addSpriteSheet(id, img, { frameWidth: entry.width / (entry.frames ?? WALK_FRAMES), frameHeight: entry.height });
    this.figures.delete(id);
    this.makeWalk(id, entry);
    for (const a of avatars) {
      if (striding.has(a)) a.body.play(id);
      else a.body.setTexture(id, 0);
    }
  }

  /**
   * The server placed us in a region: our own after walking over an edge, the
   * same one with new roads, or the shrine after a fall. Nothing is rebuilt:
   * the regions around us are drawn where they lie in the world, and we carry
   * on from the same spot on the same map.
   */
  enterRegion(welcome: WelcomeMessage): void {
    const before = this.welcome.region.id;
    this.welcome = welcome;
    if (!this.predictor) return;
    const was = { ...this.origin };
    this.showRegion(welcome);
    // Count what we show from the new corner: on screen it stays put.
    this.shown.x += was.x - this.origin.x;
    this.shown.y += was.y - this.origin.y;
    // Steps the server has not applied yet carry over with us and replay on its word.
    this.predictor = new Predictor(this.map, { x: welcome.x, y: welcome.y }, this.predictor.lastSeq, this.predictor.unapplied, welcome.ack);
    const far = Math.hypot(this.predictor.position.x - this.shown.x, this.predictor.position.y - this.shown.y) > 2;
    if (far) this.shown = { ...this.predictor.position };
    this.placeAvatar(this.me, this.shown.x, this.shown.y);
    if (before !== welcome.region.id) {
      // Who and what we saw were counted from the old corner, and belong to the
      // region we left; the next snapshot shows the ones here.
      for (const group of [this.remotes, this.creatures, this.bodies, this.npcs]) {
        for (const a of group.values()) destroyAvatar(a);
        group.clear();
      }
      this.easeLight(lightTint(welcome.region.def.biome));
    }
    if (far) {
      // A fall carries us back to the shrine: arrive there, not slide across the world.
      this.cameras.main.centerOn(this.me.body.x, this.me.body.y).fadeIn(250, 24, 20, 37);
    }
    this.revealBuildings(true);
    this.refreshWishes();
  }

  create(): void {
    const welcome = this.welcome;
    this.remotes = new Map();
    this.creatures = new Map();
    this.bodies = new Map();
    this.npcs = new Map();
    this.drawn = new Map();
    this.accumulator = 0;
    this.painted = new Set();
    this.showRegion(welcome);
    this.makeWalks();

    this.predictor = new Predictor(this.map, { x: welcome.x, y: welcome.y }, this.lastSeq);
    this.shown = { ...this.predictor.position };
    this.me = this.makeAvatar(this.playerTexture(welcome.you.id), welcome.you.name, true);
    this.setHeld(this.me, heldItem(welcome.character), 'right');
    this.setHeld(this.me, offHandItem(welcome.character), 'left');
    this.refreshWishes();

    const kb = this.input.keyboard!;
    kb.disableGlobalCapture();
    this.keys = kb.addKeys({
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D',
    }, false) as typeof this.keys;

    const cam = this.cameras.main;
    cam.setZoom(cameraZoom());
    cam.setRoundPixels(true);
    this.placeAvatar(this.me, this.shown.x, this.shown.y);
    this.revealBuildings(true);
    cam.startFollow(this.me.body, true, 0.2, 0.2);
    cam.fadeIn(250, 24, 20, 37);

    // The biome's light grades everything under the labels.
    this.tint = this.add.rectangle(0, 0, 10, 10, lightTint(welcome.region.def.biome)).setOrigin(0.5).setScrollFactor(0);
    this.tint.setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(LABEL_DEPTH - 1);
    this.fitTint();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitTint, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.fitTint, this));
  }

  /**
   * Draws our region and every one around it at their places in the world,
   * keeping those already drawn, and lets the camera roam over our region
   * and those we can walk into.
   */
  private showRegion(welcome: WelcomeMessage): void {
    const def = welcome.region.def;
    this.map = generateRegion(def);
    const size = this.map.width;
    this.origin = { x: def.at.x * size, y: def.at.y * size };
    const around = [def, ...welcome.neighbours.filter((n) => Math.max(Math.abs(n.at.x - def.at.x), Math.abs(n.at.y - def.at.y)) === 1)];
    const wanted = new Set(around.map((d) => d.id));
    for (const [id, region] of this.drawn) {
      if (!wanted.has(id)) this.undraw(id, region);
    }
    for (const d of around) {
      const layout = JSON.stringify(d);
      const region = this.drawn.get(d.id);
      if (region?.layout === layout) continue;
      if (region) this.undraw(d.id, region);
      this.drawn.set(d.id, this.drawRegion(d.id === def.id ? this.map : generateRegion(d, size), layout));
    }
    // Roads lead only into the regions beside us, so the camera stops at the others.
    const bounds = { left: this.origin.x, top: this.origin.y, right: this.origin.x + size, bottom: this.origin.y + size };
    for (const side of Object.keys(def.exits) as Side[]) {
      if (side === 'west') bounds.left -= size;
      if (side === 'north') bounds.top -= size;
      if (side === 'east') bounds.right += size;
      if (side === 'south') bounds.bottom += size;
    }
    this.cameras.main.setBounds(bounds.left * T, bounds.top * T, (bounds.right - bounds.left) * T, (bounds.bottom - bounds.top) * T);
  }

  /** Eases the biome's light from what it is to `to`, so no edge switches it at once. */
  private easeLight(to: number): void {
    const tint = this.tint;
    if (!tint || tint.fillColor === to) return;
    const a = Phaser.Display.Color.ValueToColor(tint.fillColor);
    const b = Phaser.Display.Color.ValueToColor(to);
    this.tweens.killTweensOf(tint);
    this.tweens.addCounter({
      from: 0, to: 100, duration: 1200,
      onUpdate: (tween) => {
        const c = Phaser.Display.Color.Interpolate.ColorWithColor(a, b, 100, tween.getValue() ?? 100);
        tint.setFillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
      },
    });
  }

  onSnapshot(snapshot: SnapshotMessage): void {
    if (!this.predictor || !this.sys.isActive()) return;
    this.predictor.reconcile(snapshot.ack, { x: snapshot.x, y: snapshot.y });
    const now = performance.now();
    this.sync(this.remotes, snapshot.players, now, (e) => this.makeAvatar(this.playerTexture(e.id), e.name, false));
    for (const p of snapshot.players) {
      const remote = this.remotes.get(p.id);
      if (!remote) continue;
      this.setHeld(remote, p.held, 'right');
      this.setHeld(remote, p.offHeld, 'left');
    }
    this.sync(this.creatures, snapshot.creatures ?? [], now, (c) => this.makeCreature(c));
    this.sync(this.npcs, snapshot.npcs ?? [], now, (n) => this.makeNpc(n));
    const bodies = snapshot.bodies ?? [];
    this.sync(this.bodies, bodies, now, (b) => this.makeBody(b));
    for (const b of bodies) this.bodies.get(b.id)?.label.setText(bodyLabel(b));
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
        if (dx !== 0) this.facing = dx;
      }
    }
    const held = this.readInput();
    this.walk(this.me, held.dx, held.dy);

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
    for (const group of [this.remotes, this.creatures, this.bodies, this.npcs]) {
      for (const remote of group.values()) {
        const pos = remote.interp.sample(now);
        if (!pos) continue;
        // Measured without the lunge nudge, so a strike is not a step.
        const before = { x: remote.body.x - remote.nudge.x, y: remote.body.y - remote.nudge.y };
        this.placeAvatar(remote, pos.x, pos.y);
        const dx = remote.body.x - remote.nudge.x - before.x;
        const dy = remote.body.y - remote.nudge.y - before.y;
        // Under half a pixel is standing still, not a step.
        this.walk(remote, Math.abs(dx) > 0.5 ? dx : 0, Math.abs(dy) > 0.5 ? dy : 0);
        // People indoors stay out of sight until we come close enough to see in.
        if (group === this.remotes || group === this.npcs) {
          const seen = !this.buildings().some((v) => !v.open && within(v.building, Math.floor(this.origin.x + pos.x - v.ox), Math.floor(this.origin.y + pos.y - v.oy)));
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
      a.body.stop();
      if (this.textures.exists(art)) a.body.setTexture(art);
    }
  }

  /**
   * Plays an avatar's walk for the way it moves by (dx, dy), and stands it
   * still facing that way when it stops. Each way on its own: its walk when
   * one is painted, else its standing picture facing that way, else its own
   * picture, turned to face left or right.
   */
  private walk(a: Avatar, dx: number, dy: number): void {
    a.facing = walkDirection(dx, dy, a.facing);
    const sheet = walkArt(a.art, a.facing);
    if (this.anims.exists(sheet)) {
      a.body.setFlipX(false);
      if (dx !== 0 || dy !== 0) {
        if (a.body.anims.currentAnim?.key !== sheet || !a.body.anims.isPlaying) {
          a.body.play(sheet, true);
          this.fit(a, sheet, !!a.fit);
        }
        a.body.anims.timeScale = a.pace ?? 1;
        return;
      }
      if (!a.body.anims.isPlaying) return;
      a.body.stop();
      // Facing us, the approved standing pose; any other way, the walk's first step.
      if (a.facing === 'front' && this.textures.exists(a.art)) this.dress(a, a.art);
      else {
        a.body.setTexture(sheet, 0);
        this.fit(a, sheet, !!a.fit);
      }
      return;
    }
    // No walk painted this way: another way's walk stops.
    if (a.body.anims.isPlaying) a.body.stop();
    const stand = walkStandArt(a.art, a.facing);
    if (this.textures.exists(stand)) {
      a.body.setFlipX(false);
      if (a.body.texture.key !== stand) this.dress(a, stand);
      return;
    }
    if (this.textures.exists(a.art) && a.body.texture.key !== a.art) this.dress(a, a.art);
    if (dx !== 0) a.body.setFlipX(dx < 0);
  }

  /** Puts a picture on an avatar, at the size its own picture is shown at. */
  private dress(a: Avatar, key: string): void {
    a.body.setTexture(key);
    this.fit(a, key, true);
  }

  /**
   * Sizes an avatar wearing `key` so its figure stands as tall as the figure
   * in its own picture; with `fitting` false, at its usual size.
   */
  private fit(a: Avatar, key: string, fitting: boolean): void {
    const own = fitting && key !== a.art && this.textures.exists(a.art) ? this.figureHeight(a.art) : undefined;
    const worn = own ? this.figureHeight(key) : undefined;
    a.body.setScale(own && worn ? (a.scale * own) / worn : a.scale);
  }

  /** Heights of the figures in textures (their first frame), see-through rows left out, by key. */
  private figures = new Map<string, number>();

  /** How tall the figure in a texture's first frame is, in pixels, from its see-through edges. */
  private figureHeight(key: string): number | undefined {
    const known = this.figures.get(key);
    if (known !== undefined) return known;
    const frame = this.textures.getFrame(key, 0) ?? this.textures.getFrame(key);
    const image = frame?.source.image as CanvasImageSource | undefined;
    if (!frame || !image) return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = frame.cutWidth;
    canvas.height = frame.cutHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(image, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, frame.cutWidth, frame.cutHeight);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const solid = (y: number) => {
      for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]! > 16) return true;
      return false;
    };
    let top = 0;
    let bottom = height - 1;
    while (top < height && !solid(top)) top++;
    while (bottom > top && !solid(bottom)) bottom--;
    const figure = top < height ? bottom - top + 1 : height;
    this.figures.set(key, figure);
    return figure;
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
    if ([...this.drawn.values()].some((r) => r.kit.has(key))) this.redraw(key);
    this.figures.delete(key);
    for (const a of [...this.creatures.values(), ...this.bodies.values(), ...this.npcs.values(), ...this.remotes.values(), this.me]) {
      if (!a) continue;
      // A walk or standing picture of this look stays on until the walker turns or stops.
      const shown = a.body.texture.key;
      if (a.art === key && (shown === key || !shown.startsWith(`${key}-`))) this.dress(a, key);
      else if (shown === key) this.dress(a, key);
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

  /** Draws again, once the art that arrived together has loaded, every region whose biome kit was painted. */
  private redraw(key: string): void {
    const waiting = this.painted.size > 0;
    this.painted.add(key);
    if (waiting || !this.predictor) return;
    this.time.delayedCall(500, () => {
      for (const [id, region] of this.drawn) {
        if ([...region.kit].some((k) => this.painted.has(k))) this.undraw(id, region);
      }
      this.painted.clear();
      this.showRegion(this.welcome);
      this.revealBuildings(true);
    });
  }

  /** Buildings of every region drawn, each knowing its region's corner. */
  private buildings(): BuildingView[] {
    return [...this.drawn.values()].flatMap((r) => r.buildings);
  }

  private undraw(id: string, region: DrawnRegion): void {
    for (const o of region.objects) {
      this.tweens.killTweensOf(o);
      o.destroy();
    }
    for (const m of region.tilemaps) m.destroy();
    this.drawn.delete(id);
  }

  /** Paints a region's ground and scenery at its square in the world. */
  private drawRegion(map: RegionMap, layout: string): DrawnRegion {
    const ox = map.def.at.x * map.width;
    const oy = map.def.at.y * map.height;
    const before = new Set(this.children.list);
    const tilemaps: Phaser.Tilemaps.Tilemap[] = [];
    const kit = new Set<string>();
    const look = biomeLook(map.def.biome);
    for (const id of [look.ground, look.path, look.water, ...look.trees, ...look.rocks]) kit.add(id);
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
      tilemaps.push(tilemap);
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
    this.placeScenery(map, ox, oy, views);
    const objects = this.children.list.filter((o) => !before.has(o));
    return { layout, objects, tilemaps, buildings: views, kit };
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
    for (const v of this.buildings()) {
      if (!v.exterior) continue;
      const open = nearBuilding(v.building, this.origin.x + this.shown.x - v.ox, this.origin.y + this.shown.y - v.oy);
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
    a.scale = 0.8;
    a.fit = true;
    // Creatures walk slower than players: their walks play slower so their feet keep up.
    const speed = CREATURES[c.kind]?.speed;
    if (speed) a.pace = speed / PLAYER_SPEED;
    a.body.setScale(0.8);
    return a;
  }

  /** A body is the creature's own painted picture, laid on its side and faded a little. */
  private makeBody(b: BodyState): Avatar {
    const a = this.makeAvatar(b.asset, bodyLabel(b), false, 'woods-mushroom');
    a.label.setColor('#c0cbdc').setFontSize(Math.round(T * 0.18));
    a.body.setScale(0.8).setOrigin(0.5, 0.5).setAngle(90).setAlpha(0.75);
    return a;
  }

  private makeNpc(n: NpcState): Avatar {
    const a = this.makeAvatar(n.asset, n.name, false, 'sanctum-pilgrim');
    a.label.setColor('#bfe0f2');
    return a;
  }

  private makeAvatar(texture: string, name: string, self: boolean, fallback = 'player-mara'): Avatar {
    const shadow = this.add.ellipse(0, 0, T * 0.56, T * 0.19, 0x181425, 0.3);
    const body = this.add.sprite(0, 0, this.textures.exists(texture) ? texture : fallback).setOrigin(0.5, 0.97);
    const label = this.add
      .text(0, 0, name, {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: `${Math.round(T * 0.24)}px`,
        color: self ? '#feae34' : '#ffffff',
        stroke: '#181425',
        strokeThickness: Math.round(T / 24),
      })
      .setOrigin(0.5, 1);
    return { body, art: texture, facing: 'front', scale: 1, shadow, label, nudge: { x: 0, y: 0 } };
  }

  /** Places an avatar at (x, y) in our region, counted from its corner. */
  private placeAvatar(a: Avatar, x: number, y: number): void {
    const px = (this.origin.x + x) * T;
    const py = (this.origin.y + y) * T;
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
    // After the body's depth is set, or the item lags a step behind it and slips behind the body while walking down.
    this.placeHeld(a, 'right');
    this.placeHeld(a, 'left');
  }

  /** Our own weapon or charm (right hand) and off-hand item (left hand). */
  setMyHeld(item: string | undefined, offHand: string | undefined): void {
    if (!this.me) return;
    this.setHeld(this.me, item, 'right');
    this.setHeld(this.me, offHand, 'left');
  }

  /** Newly found hands and grips. */
  setPoints(points: ArtPointsManifest): void {
    this.options.points = points;
  }

  /** Puts an item in an avatar's hand, or takes it away. */
  private setHeld(a: Avatar, item: string | undefined, hand: Hand): void {
    const slot = hand === 'right' ? 'held' : 'offHeld';
    if (a[slot]?.item === item) return;
    a[slot]?.image?.destroy();
    a[slot] = item ? { item } : undefined;
    const key = item ? ITEMS[item]?.art : undefined;
    if (key && !this.textures.exists(key)) void this.loadArt(key, artSrc(key));
  }

  /**
   * Draws a held item with its grip on the holder's right or left hand in
   * the frame showing now: in front of the body when that hand is nearer us
   * (facing us, or walking to the right for the right hand and to the left
   * for the left), behind it otherwise. Nothing shows until a vision model
   * has found both points: no guessing.
   */
  private placeHeld(a: Avatar, side: Hand): void {
    const held = side === 'right' ? a.held : a.offHeld;
    if (!held) return;
    const key = ITEMS[held.item]?.art;
    const b = a.body;
    const hand = this.handOf(a, side);
    const grip = key ? this.options.points[key]?.grip : undefined;
    if (!key || !hand || !grip || !this.textures.exists(key)) {
      held.image?.setVisible(false);
      return;
    }
    if (!held.image || held.image.texture.key !== key) {
      held.image?.destroy();
      held.image = this.add.image(0, 0, key);
    }
    const mirrored = b.flipX;
    const x = b.x + (mirrored ? b.originX - hand[0] : hand[0] - b.originX) * b.displayWidth;
    const y = b.y + (hand[1] - b.originY) * b.displayHeight;
    const flip = mirrored || a.facing === 'left';
    const image = held.image;
    image
      .setFlipX(flip)
      .setOrigin(flip ? 1 - grip[0] : grip[0], grip[1])
      .setScale((b.displayHeight * HELD_SIZE) / Math.max(image.width, image.height))
      .setPosition(x, y)
      .setDepth(b.depth + (heldBehind(a.facing, side) ? -1 : 1))
      .setVisible(b.visible);
  }

  /**
   * Where the avatar's right (or left) hand is in the picture or walk frame
   * it shows now; in a frame where it was not found, the nearest frame's, so
   * the item does not blink out for a step.
   */
  private handOf(a: Avatar, side: Hand): ArtPoint | undefined {
    const points = this.options.points[a.body.texture.key];
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

  private fitTint(): void {
    const cam = this.cameras.main;
    this.tint?.setPosition(cam.width / 2, cam.height / 2).setSize(cam.width / cam.zoom + 8, cam.height / cam.zoom + 8);
  }
}

/** True when tile (x, y) lies within a building's walls. */
function within(b: Building, x: number, y: number): boolean {
  return x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height;
}

/** A body's name tag says when there is something on it for us. */
function bodyLabel(b: BodyState): string {
  return b.loot ? `${b.name} (E for loot)` : b.name;
}

function destroyAvatar(a: Avatar): void {
  a.held?.image?.destroy();
  a.offHeld?.image?.destroy();
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
