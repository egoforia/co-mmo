// The main Phaser scene as a thin facade over world-scene/:
// - world-scene/types.ts: shared interfaces, constants, and floor/depth/spatial math
// - world-scene/walls.ts: isometric cutaway walls (rockWalls), roof/half caps, diamondLayer
// - world-scene/regions.ts: region & chunk streaming, landmarks, stairs, lamps, kit houses, floor visibility
// - world-scene/avatars.ts: avatars, walk cycles, FigureMetricsCache, and vision-mapped held items
// - world-scene/combat.ts: hit numbers, slash arcs, Firebolt projectiles, thread and bell bursts, lunges, and fade-outs
// - world-scene/marks.ts and status-icons.ts: what skills leave in the world, and status icons over name tags
// Put new domain logic in the matching world-scene/* module rather than growing this facade.

import Phaser from 'phaser';
import {
  Predictor,
  SnapshotClock,
  bodiesSeen,
  TICK_SECONDS,
  floorDrawnFrom,
  WALK_FRAMES,
  generateRegion,
  heldItem,
  offHandItem,
  paceFor,
  statusTag,
  type ArtEntry,
  type ArtManifest,
  type ArtPointsManifest,
  type HitMessage,
  type RaceId,
  type RegionDef,
  type RegionMap,
  type Side,
  type SnapshotMessage,
  type Weather,
  type WelcomeMessage,
  type WorldEdit,
} from '@co-mmo/shared';
import { HouseArt } from './kit-house-view.ts';
import { lightScene, setSkyLight } from './lights.ts';
import { shadePictures } from './normal-maps.ts';
import { PROJECTION } from './projection.ts';
import { SkyClock } from './sky.ts';
import { lightTint } from './textures.ts';
import { setCoords } from './ui.ts';
import { sceneArt } from './wished.ts';
import {
  FigureMetricsCache,
  bodyLabel,
  creatureLabel,
  destroyAvatar,
  dress,
  makeAvatar,
  makeBody,
  makeCreature,
  makeNpc,
  makeWalk,
  makeWalks,
  placeAvatar,
  playerTexture,
  setHeld,
  syncAvatars,
  walkAvatar,
} from './world-scene/avatars.ts';
import { Marks } from './world-scene/marks.ts';
import { setStatusIcons } from './world-scene/status-icons.ts';
import { showHit, swingSlash } from './world-scene/combat.ts';
import { Targeting } from './world-scene/targeting.ts';
import { cullOffscreen } from './world-scene/cull.ts';
import {
  applyFloorView,
  drawNearChunks,
  drawRegion,
  lightLamps,
  raiseHouses,
  revealBuildings,
  undrawRegion,
  spotArt,
} from './world-scene/regions.ts';
import {
  type Avatar,
  type BuildingView,
  type DrawnRegion,
  LABEL_DEPTH,
  type MapFigure,
  type MiniMapView,
  type Remote,
  type SceneCounts,
  type WorldSceneOptions,
  cameraZoom,
  floorDepthOffset,
  floorLift,
  setDepthShade,
  overlaps,
  within,
} from './world-scene/types.ts';

import { FreeCamera } from './world-scene/free-camera.ts';

export type { MapFigure, MiniMapView, SceneCounts, WorldSceneOptions } from './world-scene/types.ts';

/** How faint a Fallen player shows, lying where they fell. */
const FALLEN_ALPHA = 0.45;

export class WorldScene extends Phaser.Scene {
  private readonly freeCam = new FreeCamera(this, () => this.me?.body, () => this.fitTint());
  private welcome: WelcomeMessage;
  private map!: RegionMap;
  private predictor?: Predictor;
  /** The server's clock, from snapshot ticks: others are drawn on it, not on when snapshots arrive. */
  private readonly clock = new SnapshotClock();
  private lastSeq = 0;
  private me!: Avatar;
  private remotes = new Map<string, Remote>();
  /** Gathering spots show on the mini map (the Cervid's Mycelial Sense). */
  private spotSense = false;
  /** Each player's people, as snapshots tell it, for the body they wear without a look of their own. */
  private races = new Map<string, RaceId>();
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
  /** The floor we are on and are shown (floors.ts): 0 the ground. */
  private floor = 0;
  /** The floor the world editor looks at instead of ours, while it is open on another floor. */
  private viewed?: number;
  /** A land's edits drafts and all, laid here instead of the published ones while the world editor shows drafts. */
  private preview?: { region: string; edits: WorldEdit[] };
  private tint?: Phaser.GameObjects.Rectangle;
  /** True when pictures are lit by the sky and lamps (WebGL); false when a shade is laid over them. */
  private lit = false;
  /** The hour and the weather, which grade the light and brighten lights at night. */
  private readonly sky = new SkyClock();
  /** We lie Fallen, so our steps wait until we are raised or wake at the shrine. */
  private fallen = false;
  /**
   * The world is one map: every region is drawn at its square on the world
   * grid, and walking between them only moves us along it. This is the
   * current region's top-left corner in that map, in tiles; positions from
   * the server are counted from it.
   */
  private origin = { x: 0, y: 0 };
  /** What skills left nearby: traps, Echoes, a spirit hawk, a sand double. */
  private marks?: Marks;
  /** The regions drawn around us, by id. */
  private drawn = new Map<string, DrawnRegion>();
  /** Kit art painted since the land was last drawn. */
  private painted = new Set<string>();
  /** Where we stood, roughly, when the chunks near us were last drawn. */
  private nearAt = '';
  /** Kit houses' pictures, loaded as they are drawn on the server. */
  private houseArt!: HouseArt;
  /** The creature or player we chose by clicking or Tab. */
  private readonly targeting = new Targeting();
  /** Counts pictures loaded since we started, so the mini map knows when to put its floors together again. */
  private artLoaded = 0;
  /** Cached figure heights and ground-contact vertical origins. */
  private readonly metrics = new FigureMetricsCache();

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
    this.metrics.invalidate(id);
    makeWalk(this, id, entry);
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
    this.predictor = new Predictor(this.map, { x: welcome.x, y: welcome.y, floor: welcome.floor }, this.predictor.lastSeq, this.predictor.unapplied, welcome.ack);
    const far = Math.hypot(this.predictor.position.x - this.shown.x, this.predictor.position.y - this.shown.y) > 2;
    if (far) this.shown = { ...this.predictor.position };
    this.placeAvatar(this.me, this.shown.x, this.shown.y);
    if (before !== welcome.region.id) {
      // Who and what we saw were counted from the old corner. The region we
      // walked into showed us those near the edge already (players and the
      // lands' own creatures by the same names), so they are kept, counted
      // from the new corner, and go on smoothly; the next snapshot drops the
      // ones out of sight. Bodies, people and wished creatures are named per
      // region, so they are shown afresh.
      const dx = was.x - this.origin.x;
      const dy = was.y - this.origin.y;
      // The new region counts its own ticks: what we keep moves onto them with its first snapshot.
      this.clock.restart();
      const lands = [`${before}-`, `${welcome.region.id}-`];
      const keep = (group: Map<string, Remote>, kept: (id: string) => boolean) => {
        for (const [id, r] of group) {
          if (kept(id)) r.interp.shift(dx, dy);
          else {
            destroyAvatar(this, r);
            group.delete(id);
          }
        }
      };
      keep(this.remotes, () => true);
      keep(this.creatures, (id) => lands.some((l) => id.startsWith(l)));
      keep(this.bodies, () => false);
      keep(this.npcs, () => false);
    }
    this.sky.set(welcome.sky, lightTint(welcome.region.def.biome));
    if (far) {
      // A fall carries us back to the shrine: arrive there, not slide across the world.
      this.cameras.main.centerOn(this.me.body.x, this.me.body.y).fadeIn(250, 24, 20, 37);
    }
    this.revealBuildings(true);
    this.refreshWishes();
  }

  create(): void {
    const welcome = this.welcome;
    // First, so every picture made from here on is lit.
    this.lit = lightScene(this, LABEL_DEPTH);
    if (this.lit) shadePictures(this);
    this.houseArt = new HouseArt(this);
    this.remotes = new Map();
    this.races = new Map(welcome.character.race ? [[welcome.you.id, welcome.character.race]] : []);
    this.creatures = new Map();
    this.bodies = new Map();
    this.npcs = new Map();
    this.drawn = new Map();
    this.accumulator = 0;
    this.painted = new Set();
    this.showRegion(welcome);
    makeWalks(this, this.options.art);

    this.predictor = new Predictor(this.map, { x: welcome.x, y: welcome.y, floor: welcome.floor }, this.lastSeq);
    this.floor = this.predictor.position.floor;
    this.shown = { x: welcome.x, y: welcome.y };
    this.applyFloor();
    this.me = makeAvatar(this, this.metrics, playerTexture(welcome.you.id, this.races.get(welcome.you.id)), welcome.you.name, true);
    setHeld(this, this.me, heldItem(welcome.character), 'right', (k, u) => this.loadArt(k, u));
    setHeld(this, this.me, offHandItem(welcome.character), 'left', (k, u) => this.loadArt(k, u));
    this.refreshWishes();

    const kb = this.input.keyboard!;
    kb.disableGlobalCapture();
    this.keys = kb.addKeys({
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D',
    }, false) as typeof this.keys;
    this.listenForTargets();

    const cam = this.cameras.main;
    cam.setZoom(cameraZoom());
    cam.setRoundPixels(true);
    this.placeAvatar(this.me, this.shown.x, this.shown.y);
    setCoords({ x: this.shown.x, y: this.shown.y, floor: this.floor });
    this.events.once('shutdown', () => setCoords(undefined));
    this.events.once('destroy', () => setCoords(undefined));
    this.revealBuildings(true);
    cam.startFollow(this.me.body, true, 0.2, 0.2);
    cam.fadeIn(250, 24, 20, 37);

    // The biome's light, the hour and the weather grade everything under the labels.
    this.sky.set(welcome.sky, lightTint(welcome.region.def.biome));
    // With WebGL it is the light every picture is lit by; without, a shade laid over them.
    if (this.lit) {
      const { sun, fill } = this.sky.sun(0);
      setSkyLight(this, this.sky.tint(0), sun, fill);
    } else {
      this.tint = this.add.rectangle(0, 0, 10, 10, this.sky.tint(0)).setOrigin(0.5).setScrollFactor(0);
      this.tint.setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(LABEL_DEPTH - 1);
    }
    this.fitTint();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitTint, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.fitTint, this));
    // Pictures well off screen are not drawn: each would cost a draw call.
    cullOffscreen(this);
  }

  /**
   * Draws our region and every one around it at their places in the world,
   * keeping those already drawn, and lets the camera roam over our region
   * and those we can walk into.
   */
  private showRegion(welcome: WelcomeMessage): void {
    const def = this.withPreview(welcome.region.def);
    this.map = generateRegion(def);
    const size = this.map.width;
    this.origin = { x: def.at.x * size, y: def.at.y * size };
    this.marks?.clear();
    const around = [def, ...welcome.neighbours.map((n) => this.withPreview(n)).filter((n) => Math.max(Math.abs(n.at.x - def.at.x), Math.abs(n.at.y - def.at.y)) === 1)];
    const wanted = new Set(around.map((d) => d.id));
    for (const [id, region] of this.drawn) {
      if (!wanted.has(id)) undrawRegion(this, id, region, this.drawn);
    }
    for (const d of around) {
      const layout = JSON.stringify(d);
      const region = this.drawn.get(d.id);
      if (region?.layout === layout) continue;
      if (region) undrawRegion(this, d.id, region, this.drawn);
      this.drawn.set(d.id, drawRegion(this, d.id === def.id ? this.map : generateRegion(d, size), layout, this.options.art));
      this.nearAt = '';
      void raiseHouses(this, d.id, this.drawn, this.options.houses, this.houseArt, () => {
        this.revealBuildings(true);
        this.applyFloor();
      });
    }
    // Roads lead only into the regions beside us, so the camera stops at the others.
    const bounds = { left: this.origin.x, top: this.origin.y, right: this.origin.x + size, bottom: this.origin.y + size };
    for (const side of Object.keys(def.exits) as Side[]) {
      if (side === 'west') bounds.left -= size;
      if (side === 'north') bounds.top -= size;
      if (side === 'east') bounds.right += size;
      if (side === 'south') bounds.bottom += size;
    }
    const view = PROJECTION.bounds(bounds.left, bounds.top, bounds.right, bounds.bottom);
    this.cameras.main.setBounds(view.x, view.y, view.width, view.height);
    this.applyFloor();
  }

  /** We took stairs or a ladder: stand on the landing and show the floor we came to. */
  private changeFloor(to: { x: number; y: number; floor: number }): void {
    this.floor = to.floor;
    this.shown = { x: to.x, y: to.y };
    this.revealBuildings(true);
    this.applyFloor();
    this.cameras.main.fadeIn(200, 24, 20, 37);
  }

  private applyFloor(): void {
    applyFloorView(this, this.drawn, this.welcome.region.def.id, this.map, this.shown, this.shownFloor);
  }

  /** The weather over our land turned. */
  setWeather(weather: Weather): void {
    this.sky.setWeather(weather);
  }

  /** The world editor shows another hour or weather here, on this screen only; none puts back the sky's. */
  previewSky(preview: { phase?: number; weather?: Weather }): void {
    this.sky.showAs(preview);
  }

  /** The hour and the weather in a few words. */
  skyText(): string {
    return this.sky.words();
  }

  /** What is drawn and alive on screen, for the performance overlay. */
  counts(): SceneCounts {
    const regions = [...this.drawn.values()];
    return {
      players: this.remotes.size + (this.me ? 1 : 0),
      creatures: this.creatures.size,
      npcs: this.npcs.size,
      bodies: this.bodies.size,
      regions: regions.length,
      chunks: regions.reduce((n, r) => n + r.chunks.size, 0),
      lamps: regions.reduce((n, r) => n + r.lamps.length, 0),
      drawnBehindMs: this.clock.delay,
      wobbleMs: this.clock.jitter,
      tile: this.predictor ? { x: Math.floor(this.predictor.position.x), y: Math.floor(this.predictor.position.y) } : undefined,
    };
  }

  /** Our floor and who is on it, for the mini map; undefined until we have arrived. */
  miniMapView(): MiniMapView | undefined {
    if (!this.predictor || !this.me || !this.sys.isActive()) return undefined;
    const figures: MapFigure[] = [{ x: this.shown.x, y: this.shown.y, art: this.me.art, kind: 'me' }];
    const add = (group: Map<string, Avatar>, kind: MapFigure['kind']) => {
      for (const a of group.values()) if (a.at) figures.push({ x: a.at.x, y: a.at.y, art: a.art, kind });
    };
    add(this.remotes, 'player');
    add(this.creatures, 'creature');
    add(this.npcs, 'npc');
    // The Cervid's Mycelial Sense: gathering spots show on the map, beneath everyone.
    if (this.spotSense && !this.floor) {
      const spots: MapFigure[] = [];
      for (const s of this.map.spots) {
        const art = spotArt(this, s.kind);
        if (art) spots.push({ x: s.x + 0.5, y: s.y + 1, art, kind: 'spot' });
      }
      figures.splice(1, 0, ...spots);
    }
    // While the world editor's camera is free, the map follows the camera instead of us.
    const centre = this.freeCam.active ? this.cameraLocal() : undefined;
    return { scene: this, map: this.map, artLoaded: this.artLoaded, floor: this.floor, figures, ...(centre ? { centre } : {}) };
  }

  /** Whether gathering spots show on the mini map (sensesSpots). */
  setSpotSense(on: boolean): void {
    this.spotSense = on;
  }

  onSnapshot(snapshot: SnapshotMessage): void {
    if (!this.predictor || !this.sys.isActive()) return;
    // Slowed, Rooted or Stunned: predict our steps at the pace the server allows.
    this.predictor.pace = paceFor((snapshot.statuses ?? []).map((s) => s.id));
    // Creatures stand in our way as they stand in the server's (hit-boxes.ts).
    this.predictor.bodies = bodiesSeen(snapshot.creatures);
    this.predictor.reconcile(snapshot.ack, { x: snapshot.x, y: snapshot.y, floor: snapshot.floor });
    // On the server's time: when it was sent, not when it happened to arrive.
    const shift = this.clock.arrived(snapshot.tick, performance.now());
    if (shift) for (const group of [this.remotes, this.creatures, this.bodies, this.npcs]) for (const r of group.values()) r.interp.rebase(shift);
    const at = snapshot.tick * TICK_SECONDS * 1000;
    const load = (k: string, u: string) => this.loadArt(k, u);
    const painted = (key: string) => this.textures.exists(key);
    // Far things come every other snapshot; in between they are only named, and drawn on.
    const kept = snapshot.kept?.length ? new Set(snapshot.kept) : undefined;
    for (const p of snapshot.players) if (p.race) this.races.set(p.id, p.race);
    syncAvatars(this, this.remotes, snapshot.players, at, (e) => makeAvatar(this, this.metrics, playerTexture(e.id, e.race), e.name, false), kept);
    for (const p of snapshot.players) {
      const remote = this.remotes.get(p.id);
      if (!remote) continue;
      setHeld(this, remote, p.held, 'right', load);
      setHeld(this, remote, p.offHeld, 'left', load);
      remote.label.setText(statusTag(p.fallen ? `${p.name} (Fallen)` : p.name, p.statuses, painted));
      setStatusIcons(this, remote, p.statuses);
      remote.body.setAlpha(p.fallen ? FALLEN_ALPHA : 1);
    }
    syncAvatars(this, this.creatures, snapshot.creatures ?? [], at, (c) => makeCreature(this, this.metrics, c), kept);
    for (const c of snapshot.creatures ?? []) {
      const creature = this.creatures.get(c.id);
      creature?.label.setText(creatureLabel(c, painted));
      if (creature) setStatusIcons(this, creature, c.statuses);
    }
    setStatusIcons(this, this.me, (snapshot.statuses ?? []).map((s) => s.id));
    this.marks ??= new Marks(this);
    this.marks.sync(snapshot.marks, (x, y, floor) => {
      const at = PROJECTION.toScreen(this.origin.x + x, this.origin.y + y);
      return { x: at.x, y: at.y - floorLift(floor), depth: floorDepthOffset(floor) + PROJECTION.depth(this.origin.x + x, this.origin.y + y) };
    });
    syncAvatars(this, this.npcs, snapshot.npcs ?? [], at, (n) => makeNpc(this, this.metrics, n), kept);
    for (const n of snapshot.npcs ?? []) this.npcs.get(n.id)?.label.setText(n.asleep ? `${n.name} (asleep)` : n.name);
    const bodies = snapshot.bodies ?? [];
    syncAvatars(this, this.bodies, bodies, at, (b) => makeBody(this, this.metrics, b), kept);
    for (const b of bodies) this.bodies.get(b.id)?.label.setText(bodyLabel(b));
    this.targeting.refresh((id) => this.creatures.get(id) ?? this.remotes.get(id));
  }

  /** The creature or player we chose, sent with attacks and abilities; the server checks the range. */
  get target(): string | undefined {
    return this.targeting.id ?? undefined;
  }

  /** Clicking a creature or player chooses them (clicking the ground lets go); Tab goes through the creatures near us. */
  private listenForTargets(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // The world editor's clicks are its tools', never a choice of whom to fight.
      if (this.options.editing?.()) return;
      const hit = Targeting.under(p.worldX, p.worldY, [this.creatures, this.remotes]);
      this.targeting.choose(hit?.[0] ?? null, hit?.[1]);
    });
    const tab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey || this.options.typing()) return;
      e.preventDefault();
      this.targeting.cycle(this.creatures, this.me, this.floor);
    };
    window.addEventListener('keydown', tab);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('keydown', tab));
  }

  update(_time: number, deltaMs: number): void {
    const predictor = this.predictor;
    if (!predictor) return;
    const sky = this.sky.tint(deltaMs);
    if (this.lit) {
      const { sun, fill } = this.sky.sun(deltaMs);
      setSkyLight(this, sky, sun, fill);
      lightLamps(this, this.drawn, this.sky.darkness());
    } else this.tint?.setFillStyle(sky);
    // Fixed-rate input: one input per server tick, however fast we render.
    this.accumulator += Math.min(deltaMs, 250) / 1000;
    while (this.accumulator >= TICK_SECONDS) {
      this.accumulator -= TICK_SECONDS;
      const { dx, dy } = this.readInput();
      if (dx !== 0 || dy !== 0) {
        const step = PROJECTION.inputToWorld(dx, dy);
        const input = predictor.apply(step.dx, step.dy);
        this.options.send({ t: 'input', ...input });
      }
    }
    const held = this.readInput();
    walkAvatar(this, this.metrics, this.me, PROJECTION.inputToWorld(held.dx, held.dy), held);

    const target = predictor.position;
    const gap = Math.hypot(target.x - this.shown.x, target.y - this.shown.y);
    if (target.floor !== this.floor) this.changeFloor(target);
    else if (gap > 2) this.shown = { x: target.x, y: target.y };
    else {
      // Half the way each 60th of a second, however fast the screen draws.
      const ease = 1 - 0.5 ** (Math.min(deltaMs, 250) / (1000 / 60));
      this.shown.x += (target.x - this.shown.x) * ease;
      this.shown.y += (target.y - this.shown.y) * ease;
    }
    this.placeAvatar(this.me, this.shown.x, this.shown.y);
    setCoords({ x: this.shown.x, y: this.shown.y, floor: this.floor });
    this.revealBuildings(false);
    this.drawNear();

    const drawAt = this.clock.renderAt(performance.now());
    for (const group of [this.remotes, this.creatures, this.bodies, this.npcs]) {
      for (const remote of group.values()) {
        const pos = remote.interp.sample(drawAt);
        if (!pos) continue;
        // Measured without the lunge nudge, so a strike is not a step.
        const before = { x: remote.body.x - remote.nudge.x, y: remote.body.y - remote.nudge.y };
        const was = remote.at;
        this.placeAvatar(remote, pos.x, pos.y);
        const dx = remote.body.x - remote.nudge.x - before.x;
        const dy = remote.body.y - remote.nudge.y - before.y;
        // Under half a pixel is standing still, not a step.
        const screen = { dx: Math.abs(dx) > 0.5 ? dx : 0, dy: Math.abs(dy) > 0.5 ? dy : 0 };
        const step = was && (screen.dx || screen.dy) ? { dx: pos.x - was.x, dy: pos.y - was.y } : { dx: 0, dy: 0 };
        walkAvatar(this, this.metrics, remote, step, screen);
        // People indoors stay out of sight until we come close enough to see in.
        // Upstairs on a terrace or rooftop over no building they remain visible;
        // a building's upper floors are hidden from outside, and so is whoever is on them.
        // NPCs show only on our own floor, and no player stands on a floor that is not drawn.
        if (group === this.remotes || group === this.npcs) {
          const floor = remote.floor ?? 0;
          const [wx, wy] = [this.origin.x + pos.x, this.origin.y + pos.y];
          const onDrawnFloor = group === this.npcs ? floor === this.shownFloor : floorDrawnFrom(this.map, this.floor, floor, wx, wy);
          const sameIndoor = floor !== 0 && floor === this.floor;
          const openUpper = floor > 0 && this.map.storeys.some((s) => s.floor === floor && !this.map.buildings.some((b) => overlaps(s, b)) && within(s, Math.floor(wx), Math.floor(wy)));
          const seen = onDrawnFloor && (sameIndoor || openUpper || !this.buildings().some((v) => !v.open && within(v.building, Math.floor(wx - v.ox), Math.floor(wy - v.oy))));
          for (const part of [remote.body, remote.shadow, remote.label]) part.setVisible(seen);
        }
        const delta = Math.max(0, this.floor - (remote.floor ?? 0));
        setDepthShade(remote.body, delta);
        if (remote.held?.image) setDepthShade(remote.held.image, delta);
        if (remote.offHeld?.image) setDepthShade(remote.offHeld.image, delta);
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
      const art = playerTexture(id, this.races.get(id));
      if (!a || a.art === art) continue;
      a.art = art;
      a.body.stop();
      if (this.textures.exists(art)) a.body.setTexture(art);
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
    this.artLoaded++;
    // A wished biome's ground, water, trees or rocks were painted: draw the land again.
    if ([...this.drawn.values()].some((r) => r.kit.has(key))) this.redraw(key);
    this.metrics.invalidate(key);
    for (const a of [...this.creatures.values(), ...this.bodies.values(), ...this.npcs.values(), ...this.remotes.values(), this.me]) {
      if (!a) continue;
      // A walk or standing picture of this look stays on until the walker turns or stops.
      const shown = a.body.texture.key;
      if (a.art === key && (shown === key || !shown.startsWith(`${key}-`))) dress(this, this.metrics, a, key);
      else if (shown === key) dress(this, this.metrics, a, key);
    }
  }

  /** A strike landed: number, flash and recoil, or a defeat. */
  onHit(hit: HitMessage): void {
    if (!this.predictor) return;
    showHit(this, hit, this.welcome.you.id, this.me, this.remotes, this.creatures, () => this.sky.darkness());
  }

  /** Our own strike: a lunge and a slash, whether or not it lands. */
  swing(): void {
    if (!this.predictor) return;
    swingSlash(this, this.me);
  }

  /** Greys our sprite while Weakened after falling, and more while we lie Fallen (when we cannot walk). */
  setWeakened(weakened: boolean, fallen = false): void {
    this.fallen = fallen;
    if (!this.me?.body.active) return;
    this.me.body.setAlpha(fallen ? FALLEN_ALPHA : weakened ? 0.7 : 1);
  }

  /** Draws again, once the art that arrived together has loaded, every region whose biome kit was painted. */
  private redraw(key: string): void {
    const waiting = this.painted.size > 0;
    this.painted.add(key);
    if (waiting || !this.predictor) return;
    this.time.delayedCall(500, () => {
      for (const [id, region] of this.drawn) {
        if ([...region.kit].some((k) => this.painted.has(k))) undrawRegion(this, id, region, this.drawn);
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

  /** Draws the ground and scenery near us and lets go of what is far, when we have moved a little. */
  private drawNear(force = false): void {
    const x = this.origin.x + this.shown.x;
    const y = this.origin.y + this.shown.y;
    const at = `${Math.floor(x / 8)},${Math.floor(y / 8)}`;
    if (at === this.nearAt && !force) return;
    this.nearAt = at;
    drawNearChunks(this, this.drawn, x, y, this.shownFloor);
  }

  /** Near a building, fade its exterior away to show the inside; farther off, fade it back. */
  private revealBuildings(instant: boolean): void {
    revealBuildings(this, this.buildings(), this.origin.x + this.shown.x, this.origin.y + this.shown.y, instant, this.shownFloor);
    this.applyFloor();
  }

  private readInput(): { dx: number; dy: number } {
    if (this.fallen || this.options.typing()) return { dx: 0, dy: 0 };
    const k = this.keys;
    const dx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    const dy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    return { dx, dy };
  }

  private placeAvatar(a: Avatar, x: number, y: number): void {
    placeAvatar(this, a, a === this.me, this.floor, this.origin, this.options.points, this.sky.darkness(), x, y);
  }

  /**
   * The land and tile under a point on the screen (a pointer's position
   * in the page), for the world editor; undefined over no land drawn.
   * Works through either camera: the projection is turned back from screen
   * to tiles by its own three points.
   */
  tileAt(screenX: number, screenY: number): { region: string; map: RegionMap; x: number; y: number } | undefined {
    const w = this.worldTile(screenX, screenY);
    const [wx, wy] = [Math.floor(w.x), Math.floor(w.y)];
    for (const [region, drawn] of this.drawn) {
      const { at: cell } = drawn.map.def;
      const x = wx - cell.x * drawn.map.width;
      const y = wy - cell.y * drawn.map.height;
      if (x >= 0 && y >= 0 && x < drawn.map.width && y < drawn.map.height) return { region, map: drawn.map, x, y };
    }
    return undefined;
  }

  /**
   * The world editor shows a land with its drafts (only to its editor; the
   * server still walks us on the published land), or as published again
   * when `edits` has no drafts.
   */
  previewEdits(region: string, edits?: WorldEdit[]): void {
    const next = edits?.some((e) => e.draft) ? { region, edits } : undefined;
    if (JSON.stringify(next) === JSON.stringify(this.preview)) return;
    this.preview = next;
    if (this.predictor) this.enterRegion(this.welcome);
  }

  private withPreview(def: RegionDef): RegionDef {
    return this.preview?.region === def.id ? { ...def, edits: this.preview.edits } : def;
  }

  /** A land drawn around us, as it is laid out here. */
  landMap(region: string): RegionMap | undefined {
    return this.drawn.get(region)?.map;
  }

  /** The name of a land drawn around us. */
  landName(region: string): string | undefined {
    return this.drawn.get(region)?.map.def.name;
  }

  get currentMap(): RegionMap {
    return this.map;
  }

  get currentFloor(): number {
    return this.floor;
  }

  /** The floor drawn: ours, or the one the world editor looks at. */
  get shownFloor(): number {
    return this.viewed ?? this.floor;
  }

  /** The world editor looks at another floor where we stand (undefined: ours again). */
  viewFloor(floor: number | undefined): void {
    if (floor === this.viewed || (floor === this.floor && this.viewed === undefined)) return;
    this.viewed = floor === this.floor ? undefined : floor;
    this.revealBuildings(true);
    this.applyFloor();
  }

  get playerPosition(): { x: number; y: number } {
    return { ...this.shown };
  }

  /** The world editor's camera: free of the player while the editor is open (free-camera.ts). */
  freeCamera(on: boolean): void {
    this.freeCam.set(on);
  }

  /** Moves the free camera by screen pixels. */
  panCamera(dx: number, dy: number): void {
    this.freeCam.pan(dx, dy);
  }

  /** Zooms the free camera a step in (1) or out (-1); returns its share of the usual zoom. */
  zoomCamera(direction: 1 | -1): number {
    return this.freeCam.zoom(direction);
  }

  /** The camera follows the player again. */
  followMe(): void {
    this.freeCam.follow();
  }

  /** Centres the free camera on a tile of a land drawn around us, on the floor shown. */
  lookAt(map: RegionMap, x: number, y: number): void {
    const p = PROJECTION.toScreen(map.def.at.x * map.width + x + 0.5, map.def.at.y * map.height + y + 0.5);
    this.freeCam.centreOn(p.x, p.y - floorLift(this.shownFloor));
  }

  /** The middle of the screen in the tiles of the land we are in (it may lie beyond its edge). */
  private cameraLocal(): { x: number; y: number } {
    const cam = this.cameras.main;
    const w = this.worldTile(cam.width / 2, cam.height / 2);
    return { x: w.x - this.origin.x, y: w.y - this.origin.y };
  }

  /** The world tile (not rounded) under a point on the screen, on the floor shown: the projection turned back by its own three points. */
  private worldTile(screenX: number, screenY: number): { x: number; y: number } {
    const at = this.cameras.main.getWorldPoint(screenX, screenY);
    const o = PROJECTION.toScreen(0, 0);
    const ex = PROJECTION.toScreen(1, 0);
    const ey = PROJECTION.toScreen(0, 1);
    const [ax, ay, bx, by] = [ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y];
    const det = ax * by - bx * ay;
    const [sx, sy] = [at.x - o.x, at.y + floorLift(this.shownFloor) - o.y];
    return { x: (sx * by - bx * sy) / det, y: (ax * sy - sx * ay) / det };
  }

  /** The land and tile in the middle of the screen. */
  cameraTile(): ReturnType<WorldScene['tileAt']> {
    const cam = this.cameras.main;
    return this.tileAt(cam.width / 2, cam.height / 2);
  }

  /** The screen corners of a rectangle of tiles in a land, for the world editor's outlines. */
  tileCorners(map: RegionMap, x: number, y: number, width = 1, height = 1): Phaser.Math.Vector2[] {
    const ox = map.def.at.x * map.width;
    const oy = map.def.at.y * map.height;
    const lift = floorLift(this.shownFloor);
    return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]].map(([cx, cy]) => {
      const p = PROJECTION.toScreen(ox + cx!, oy + cy!);
      return new Phaser.Math.Vector2(p.x, p.y - lift);
    });
  }

  /** Our own weapon or charm (right hand) and off-hand item (left hand). */
  setMyHeld(item: string | undefined, offHand: string | undefined): void {
    if (!this.me) return;
    const load = (k: string, u: string) => this.loadArt(k, u);
    setHeld(this, this.me, item, 'right', load);
    setHeld(this, this.me, offHand, 'left', load);
  }

  /** Newly found hands and grips. */
  setPoints(points: ArtPointsManifest): void {
    this.options.points = points;
  }

  private fitTint(): void {
    const cam = this.cameras.main;
    this.tint?.setPosition(cam.width / 2, cam.height / 2).setSize(cam.width / cam.zoom + 8, cam.height / cam.zoom + 8);
  }
}
