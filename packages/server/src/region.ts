import {
  CREATURES,
  energyPerSecond,
  maxEnergy,
  TICK_RATE,
  TICK_SECONDS,
  VIEW_RADIUS,
  collides,
  gainXp,
  generateRegion,
  maxHp,
  outsideSide,
  regenPerSecond,
  climbWords,
  canSeeAcrossFloors,
  storeyAt,
  walkOn,
  wayTaken,
  Tile,
  type BodyState,
  type Character,
  type CreatorCredit,
  type ClientMessage,
  type ChatMessage,
  type CreatureState,
  type EntityState,
  type InventorySlot,
  type NpcPlacement,
  type NpcState,
  type PlayerInfo,
  type RegionDef,
  type RegionInfo,
  type RegionMap,
  type ServerMessage,
  type Side,
  type SkyConfig,
  type Weather,
  DEFAULT_SKY,
  floorName,
  WEATHER_NEWS,
  dayPhase,
  weatherAt,
  skyWords,
} from '@co-mmo/shared';
import { TradeDesk } from './trades.ts';
import { applyOp, type CharacterOp, type OpResult } from './character-ops.ts';
import { bodyView, creatureView, npcView, playerView } from './region-views.ts';
import { giveUp, makeCreature, mood, type Creature } from './creature-brain.ts';
import { makeTownsperson } from './townsfolk.ts';
import { findSpots } from './walkers.ts';
import { Bodies } from './region/bodies.ts';
import { Chat } from './region/chat.ts';
import { Combat } from './region/combat.ts';
import { Fallen } from './region/fallen.ts';
import { Kit } from './region/kit.ts';
import { Minds } from './region/minds.ts';
import { Quests } from './region/quests.ts';
import { RegionState, type PlayerState } from './region/state.ts';

export { findSpots, nearestTile } from './walkers.ts';

/** Inputs a player may queue; extra inputs are dropped (anti speed-hack). */
const MAX_QUEUED_INPUTS = 10;
/** Inputs applied per player per tick; lets a lagging client catch up a little. */
const MAX_INPUTS_PER_TICK = 2;
/** Health starts coming back this long after the last hit taken. */
const REGEN_DELAY_MS = 5000;
/** Snapshots come every tick until this many people and creatures are in view, then less often (see snapshotEvery). */
const CROWD_STEPS = [40, 80, 150];
/** The slowest snapshots: every this many ticks. */
const MAX_SNAPSHOT_EVERY = 4;

/**
 * How many ticks apart a player's snapshots go out (design doc, Scaling
 * without a cap: update rates drop gracefully rather than refusing logins).
 * A crowd in view makes each snapshot big; a busy process (strain 1 or 2)
 * has less time to make them. Players' own steps are predicted on their
 * screen and others are smoothed, so fewer snapshots look smoother, just a
 * little less precise.
 */
export function snapshotEvery(crowd: number, strain = 0): number {
  const forCrowd = 1 + CROWD_STEPS.filter((n) => crowd > n).length;
  return Math.min(MAX_SNAPSHOT_EVERY, forCrowd + strain);
}

export interface Connection {
  send(message: ServerMessage): void;
  close(reason: string): void;
}

/** What a region needs from the world around it. */
export interface RegionHooks {
  /** Delivers a World-channel message to every region. */
  worldChat(message: ServerMessage): void;
  /** Players online across the whole world. */
  online(): number;
  /** Someone enjoyed a wished thing (fought, used, wore, crafted, learned or talked to it): its wisher earns Creator XP. */
  creator?(thingId: string, playerId: string, credit: CreatorCredit): void;
  /** Something a scripted rule may answer happened (an item used, E pressed, a creature defeated). */
  event?(type: 'use' | 'interact' | 'defeat', playerId: string, data: Record<string, string | number>): void;
  /** Delivers party and whisper chat, which can cross regions; returns why it could not. */
  route?(message: ChatMessage, to?: string): string | void;
  /** Everyone in a player's party, themself included. */
  party?(playerId: string): string[];
  /** Something worth a line in the "While you were away" feed. */
  journal?(text: string, playerId: string): void;
  /** The regions beyond this one's open edges, for players to see beside it. */
  neighbours?(): RegionDef[];
  /** Delivers a Region-channel line to every cell of a region that was split (see Cell). */
  regionChat?(message: ServerMessage): void;
  /** How the sky turns (the same on every server); the usual day and weather when missing. */
  sky?(): SkyConfig;
}

/**
 * One cell of a crowded region split into strips side by side (design doc,
 * Scaling without a cap). A cell runs the whole land but only the people,
 * creatures and NPCs within its strip; players walk from cell to cell, and
 * each sees across the border what the next cell shows it (see Ghosts).
 */
export interface Cell {
  /** The cell's name between servers: the region's id, ~ and its index. */
  key: string;
  index: number;
  count: number;
  /** The strip it runs: x0 <= x < x1, in tiles. */
  x0: number;
  x1: number;
}

/** What a cell shows of itself near a border, for players in the cell beside it to see. */
export interface Ghosts {
  players: EntityState[];
  creatures: CreatureState[];
  bodies: BodyState[];
  npcs: NpcState[];
}

/** How far past its border a player walks before the next cell takes them, so nobody flickers between two. */
const CELL_MARGIN = 1;

/** Tile kinds scripted rules can ask about, by name. */
export const TILE_NAMES: Record<string, Tile> = { ground: Tile.Ground, path: Tile.Path, water: Tile.Water, tree: Tile.Tree, rock: Tile.Rock, floor: Tile.Floor, wall: Tile.Wall, door: Tile.Door, bridge: Tile.Bridge };

export type Departure =
  | { id: string; side: Side; died?: undefined; cell?: undefined }
  | { id: string; died: true; side?: undefined; cell?: undefined }
  /** Walked over a border into the next cell of a split region. */
  | { id: string; cell: number; side?: undefined; died?: undefined };

export interface Leaving {
  info: PlayerInfo;
  conn: Connection;
  character: Character;
  x: number;
  y: number;
  /** What carries over into the next region, so walking on feels like one more step. */
  carry: Carry;
}

/**
 * A player's movement and timers as they cross into the next region: the
 * last input applied and those still waiting carry over, so no step the
 * player took is lost or replayed and their own prediction stays in step.
 */
export interface Carry {
  ack: number;
  inputs: { seq: number; dx: number; dy: number }[];
  lastAttack: number;
  lastHurt: number;
  readyAt: Map<string, number>;
  /** The floor they were on (floors.ts), so moving the region elsewhere keeps them upstairs. */
  floor?: number;
  /** While Fallen: when they wake at the shrine, so moving the region keeps their time. */
  fallenUntil?: number;
}

/**
 * One region of the world, simulated authoritatively. A region knows nothing
 * about sockets or storage: it talks to players through `Connection`, so it
 * can run in tests, and later in its own process per region.
 */
export class Region {
  readonly map: RegionMap;
  /** Where it runs, as the world sees it (a Region object always runs in the process that holds it). */
  readonly host = 'gateway';
  /** Who and what is here; every system below shares it. */
  private readonly s: RegionState;
  private readonly combat: Combat;
  private readonly minds: Minds;
  private readonly kit: Kit;
  private readonly quests: Quests;
  private readonly looting: Bodies;
  private readonly talk: Chat;
  private readonly fallen: Fallen;
  /** The weather over this land as players last heard it. */
  private weather: Weather | undefined;
  /** What the cells beside this one show near the border, by their index. */
  private readonly ghosts = new Map<number, Ghosts>();
  /** How pressed the process running this region is (0 to 2, see LoadMeter.strain); snapshots slow down to match. */
  strain = 0;

  private readonly hooks: RegionHooks;
  private readonly trades: TradeDesk;

  constructor(
    readonly def: RegionDef,
    hooks?: RegionHooks,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
    /** Set when this is one cell of a split region. */
    readonly cell?: Cell,
  ) {
    // A region on its own is a world of one.
    this.hooks = hooks ?? { worldChat: (m) => this.broadcast(m), online: () => this.s.players.size };
    this.map = generateRegion(def);
    this.s = new RegionState(this.map, this.hooks, this.now, this.random);
    this.looting = new Bodies(this.s);
    this.quests = new Quests(this.s, this.looting, () => this.sky().phase);
    this.combat = new Combat(this.s, this.quests);
    this.minds = new Minds(this.s);
    this.kit = new Kit(this.s);
    this.talk = new Chat(this.s);
    this.fallen = new Fallen(this.s);
    this.s.creatures = this.map.creatures.flatMap((c, i) => (this.inCell(c.x) ? this.makeCreature(`${def.id}-${c.kind}-${i}`, c.kind, c.x, c.y, c.floor) : []));
    this.s.townsfolk = this.map.npcs.filter((n) => this.inCell(n.x)).map((n) => makeTownsperson(n, this.map, this.random));
    this.trades = new TradeDesk({
      character: (id) => this.s.players.get(id)?.character,
      nameOf: (id) => this.s.players.get(id)?.info.name,
      findByName: (name) => [...this.s.players.values()].find((p) => p.info.name.toLowerCase() === name.toLowerCase())?.info.id,
      distance: (a, b) => {
        const pa = this.s.players.get(a);
        const pb = this.s.players.get(b);
        return pa && pb && pa.floor === pb.floor ? Math.hypot(pa.x - pb.x, pa.y - pb.y) : Infinity;
      },
      send: (id, m) => this.send(id, m),
      changed: (id) => {
        const p = this.s.players.get(id);
        if (p) p.dirty = true;
      },
      now: this.now,
    });
  }

  /** Its name between servers: the region's id, or its cell's key. */
  get key(): string {
    return this.cell?.key ?? this.def.id;
  }

  /** True when x lies in this cell's strip (always, for a region that is not split). */
  inCell(x: number): boolean {
    return !this.cell || (x >= this.cell.x0 && x < this.cell.x1);
  }

  private makeCreature(id: string, kind: string, x: number, y: number, floor = 0): Creature[] {
    const cdef = CREATURES[kind];
    return cdef ? [makeCreature(id, kind, cdef, x, y, this.random, floor)] : [];
  }

  /** How the sky turns over this land. */
  get skyConfig(): SkyConfig {
    return this.hooks.sky?.() ?? DEFAULT_SKY;
  }

  /** Where the day is and the weather here now. */
  sky(now = this.now()): { phase: number; weather: Weather } {
    const config = this.skyConfig;
    return { phase: dayPhase(now, config), weather: weatherAt(this.def.id, this.def.biome, now, config) };
  }

  // --- Wished content ----------------------------------------------------------

  /** Places a wished creature kind at these spots; `n` keeps a spot's number when a cell gets only some of them. */
  addCreatures(kind: string, spots: { x: number; y: number; n?: number }[]): void {
    spots.forEach((s, i) => this.s.creatures.push(...this.makeCreature(`${kind}-${s.n ?? i}`, kind, s.x, s.y)));
  }

  /** Places a wished NPC, who strolls about that spot. */
  addNpc(npc: NpcPlacement): void {
    this.s.townsfolk = this.s.townsfolk.filter((n) => n.id !== npc.id);
    this.s.townsfolk.push(makeTownsperson({ ...npc }, this.map, this.random));
  }

  /** Takes away everything a wish placed here. */
  removeWish(id: string): void {
    for (const p of this.s.players.values()) {
      if (this.s.creatures.some((c) => c.kind === id && c.aggro === p.info.id)) p.lastHurt = this.now();
    }
    this.s.creatures = this.s.creatures.filter((c) => c.kind !== id);
    this.s.bodies = this.s.bodies.filter((b) => b.kind !== id);
    this.s.townsfolk = this.s.townsfolk.filter((n) => n.id !== id);
  }

  /** Walkable spots around a point, for placing wished things (see findSpots). */
  findSpots(x: number, y: number, count: number, min = 1.5, max = 4): { x: number; y: number }[] {
    return findSpots(this.map, x, y, count, min, max);
  }

  /** Short lines about what is near a player, for the God's context. */
  nearby(id: string): string[] {
    const p = this.s.players.get(id);
    if (!p) return [];
    const lines: string[] = [];
    const near = (o: { x: number; y: number; floor: number }, r: number) => canSeeAcrossFloors(this.map, p, o) && Math.hypot(o.x - p.x, o.y - p.y) <= r;
    if (p.floor) lines.push(`They are on ${floorName(p.floor)}.`);
    for (const other of this.s.players.values()) if (other !== p && near(other, 10)) lines.push(`${other.info.name} (player)`);
    for (const n of this.s.townsfolk) if (near(n, 10)) lines.push(`${n.name} (NPC${n.asleep ? ', asleep' : ''})`);
    const kinds = new Map<string, number>();
    for (const c of this.s.creatures) if (c.respawnAt === null && near(c, 10)) kinds.set(c.def.name, (kinds.get(c.def.name) ?? 0) + 1);
    for (const [name, n] of kinds) lines.push(`${n} ${name}${n > 1 ? 's' : ''}`);
    const { phase, weather } = this.sky();
    lines.push(`The sky: ${skyWords(phase, weather)}`);
    return lines;
  }

  /** Changes a player's character outside the tick (Favor spent on a wish, a wished item given). */
  updateCharacter(id: string, change: (c: Character) => void): void {
    const p = this.s.players.get(id);
    if (!p) return;
    change(p.character);
    p.dirty = true;
    this.s.flush(p);
  }

  /** A change from outside the simulation, as data (see character-ops.ts); XP comes with its level-up messages. */
  change(id: string, op: CharacterOp): OpResult {
    const p = this.s.players.get(id);
    if (!p) return { ok: false };
    const result = applyOp(p.character, op);
    if (op.op === 'xp') this.s.levelUps(p, result.levels ?? 0);
    if (result.ok) {
      p.dirty = true;
      this.s.flush(p);
    }
    return result;
  }

  /** True when a tile of this kind lies within `radius` tiles of the player. */
  nearTile(id: string, tile: Tile, radius: number): boolean {
    const p = this.s.players.get(id);
    return Boolean(p && this.s.nearestTile(p.x, p.y, [tile], radius, p.floor));
  }

  /** XP from a scripted rule, with the usual level-up messages. */
  grantXp(id: string, amount: number): void {
    const p = this.s.players.get(id);
    if (!p) return;
    this.s.levelUps(p, gainXp(p.character, amount));
    p.dirty = true;
    this.s.flush(p);
  }

  /**
   * Raises a Fallen player where they lie with `share` of their health and
   * no Weakened (Peal of Waking, Great Bell of Waking); `by` is who rang
   * them back. Returns false when they were not Fallen.
   */
  raise(id: string, share: number, by?: string): boolean {
    const p = this.s.players.get(id);
    if (!p) return false;
    const raised = this.fallen.raise(p, share, by ? this.s.players.get(by) : undefined);
    this.s.flush(p);
    return raised;
  }

  /** True while a player lies Fallen, for tests and tools. */
  isFallen(id: string): boolean {
    const p = this.s.players.get(id);
    return !!p && this.fallen.is(p);
  }

  /** A line in one player's log. */
  tell(id: string, text: string): void {
    const p = this.s.players.get(id);
    if (p) this.s.notice(p, text);
  }

  /** A system line for everyone in the region. */
  announce(text: string): void {
    this.s.broadcastSystem(text);
  }

  /** Sends one player a message. */
  send(id: string, message: ServerMessage): void {
    this.s.players.get(id)?.conn.send(message);
  }

  get info(): RegionInfo {
    return { id: this.def.id, name: this.def.name, def: this.def };
  }

  /**
   * The world grew or shrank beside this region: re-lay its roads to the new
   * exits (the rest of the land stays as it was, being generated from the
   * same seed), and show everyone here the new neighbours.
   */
  setExits(exits: RegionDef['exits']): void {
    this.def.exits = exits;
    const fresh = generateRegion(this.def);
    this.map.tiles.set(fresh.tiles);
    this.map.entries = fresh.entries;
    for (const p of this.s.players.values()) {
      // A road may now run where someone stood; the new land never traps anyone.
      if (collides(this.map, p.x, p.y, p.floor)) Object.assign(p, this.map.spawn, { floor: 0 });
      this.welcome(p);
    }
  }

  /** Sends everyone here a fresh welcome: the land around changed. */
  welcomeAll(): void {
    for (const p of this.s.players.values()) this.welcome(p);
  }

  private welcome(p: PlayerState): void {
    const now = this.now();
    const sky = { config: this.skyConfig, now, weather: this.sky(now).weather };
    p.conn.send({ t: 'welcome', you: p.info, region: this.info, neighbours: this.hooks.neighbours?.() ?? [], x: p.x, y: p.y, ...(p.floor ? { floor: p.floor } : {}), ack: p.ack, tickRate: TICK_RATE, character: p.character, sky });
  }

  get online(): number {
    return this.s.players.size;
  }

  playerIds(): string[] {
    return [...this.s.players.keys()];
  }

  has(id: string): boolean {
    return this.s.players.has(id);
  }

  nameOf(id: string): string | undefined {
    return this.s.players.get(id)?.info.name;
  }

  position(id: string): { x: number; y: number; floor?: number } | undefined {
    const p = this.s.players.get(id);
    return p && { x: p.x, y: p.y, ...(p.floor ? { floor: p.floor } : {}) };
  }

  character(id: string): Character | undefined {
    return this.s.players.get(id)?.character;
  }

  /** Live creature ids, for tests and tools. */
  creatureIds(): string[] {
    return this.s.creatures.filter((c) => c.respawnAt === null).map((c) => c.id);
  }

  /** Bodies lying here now, for tests and tools. */
  bodyList(): { id: string; kind: string; x: number; y: number; finders: string[]; loot: InventorySlot[] }[] {
    return this.s.bodies.map((b) => ({ id: b.id, kind: b.kind, x: b.x, y: b.y, finders: [...b.finders], loot: b.loot.map((s) => ({ ...s })) }));
  }

  /** Where an NPC stands now, for tests and tools. */
  npc(id: string): { x: number; y: number; home: { x: number; y: number }; asleep: boolean } | undefined {
    const n = this.s.townsfolk.find((t) => t.id === id);
    return n && { x: n.x, y: n.y, home: { ...n.home }, asleep: n.asleep };
  }

  creature(id: string): { kind: string; x: number; y: number; hp: number; alive: boolean } | undefined {
    const c = this.s.creatures.find((k) => k.id === id);
    return c && { kind: c.kind, x: c.x, y: c.y, hp: c.hp, alive: c.respawnAt === null };
  }

  /** What a creature is up to, for tests and tools. */
  creatureMood(id: string): { mood?: string; aggro: string | null } | undefined {
    const c = this.s.creatures.find((k) => k.id === id);
    return c && { mood: mood(c), aggro: c.aggro };
  }

  /** Moves a player, for tests and tools. */
  placePlayer(id: string, x: number, y: number, floor = 0): void {
    const p = this.s.players.get(id);
    if (p) Object.assign(p, { x, y, floor });
  }

  /** Moves a creature, for tests and (later) wishes. */
  placeCreature(id: string, x: number, y: number, floor = 0): void {
    const c = this.s.creatures.find((k) => k.id === id);
    if (c) Object.assign(c, { x, y, floor, home: { x, y, floor }, target: null, route: undefined });
  }

  /** The floor a creature or NPC is on, for tests and tools. */
  floorOf(id: string): number | undefined {
    return (this.s.creatures.find((k) => k.id === id) ?? this.s.townsfolk.find((n) => n.id === id) ?? this.s.players.get(id))?.floor;
  }

  /**
   * Adds a player at the given position, or at the spawn point when it is
   * missing or no longer walkable (a wish may have changed the map).
   */
  join(info: PlayerInfo, conn: Connection, at: { x: number | null; y: number | null; floor?: number }, character: Character, announce?: string, carry?: Carry, handoff = false): void {
    const existing = this.s.players.get(info.id);
    if (existing) {
      existing.conn.close('Signed in from another window.');
      this.s.players.delete(info.id);
    }
    let { x, y } = this.map.spawn;
    let floor = 0;
    if (at.x !== null && at.y !== null && !outsideSide(this.map, at.x, at.y)) {
      // The floor they were on, while it is still there; else the ground below.
      const wanted = at.floor !== undefined ? at.floor : (carry?.floor ?? 0);
      floor = wanted && storeyAt(this.map, Math.floor(at.x), Math.floor(at.y), wanted) ? wanted : 0;
      // Something may have been built or planted where they stood (the world editor): the nearest open spot, then.
      const free = collides(this.map, at.x, at.y, floor) ? nearestOpen(this.map, at.x, at.y, floor) : { x: at.x, y: at.y };
      if (free) ({ x, y } = free);
      else floor = 0;
    }
    const p: PlayerState = {
      info, conn, character, x, y, inputs: [], ack: 0, chatTimes: [], lastAttack: 0, lastHurt: 0, readyAt: new Map(), dirty: false, crowd: 0, phase: Math.floor(this.random() * MAX_SNAPSHOT_EVERY), ...carry, floor,
    };
    this.s.players.set(info.id, p);
    // Walking into the next cell of the same land: nothing changes on the player's screen.
    if (handoff) return;
    this.welcome(p);
    // Every wished region carries a credit line (design doc, World structure).
    const wild = this.def.wild;
    if (wild) this.s.notice(p, `✦ ${this.def.name} was wished into being by ${wild.wisher}. Danger ${wild.danger} of 6.`);
    // An empty announcement is a quiet arrival (the region moved to another server).
    if (announce !== '') this.s.broadcastSystem(announce ?? `${info.name} entered ${this.def.name}.`);
  }

  /** Removes a player, announcing why; returns what the world needs to move them on. */
  remove(id: string, announce?: string): Leaving | undefined {
    const p = this.s.players.get(id);
    if (!p) return undefined;
    this.trades.leave(id);
    this.s.players.delete(id);
    for (const c of this.s.creatures) if (c.aggro === id || c.fleeing === id) giveUp(c);
    if (announce !== '') this.s.broadcastSystem(announce ?? `${p.info.name} left.`);
    const carry: Carry = { ack: p.ack, inputs: p.inputs, lastAttack: p.lastAttack, lastHurt: p.lastHurt, readyAt: p.readyAt, ...(p.floor ? { floor: p.floor } : {}), ...(p.fallenUntil !== undefined ? { fallenUntil: p.fallenUntil } : {}) };
    return { info: p.info, conn: p.conn, character: p.character, x: p.x, y: p.y, carry };
  }

  handle(id: string, message: ClientMessage): void {
    const p = this.s.players.get(id);
    if (!p) return;
    switch (message.t) {
      case 'input':
        if (message.seq <= p.ack) return;
        if (p.inputs.length >= MAX_QUEUED_INPUTS) return;
        p.inputs.push({ seq: message.seq, dx: message.dx, dy: message.dy });
        break;
      case 'chat':
        this.talk.chat(p, message.channel, message.text, message.to);
        break;
      case 'attack':
        this.combat.attack(p);
        break;
      case 'interact':
        this.quests.interact(p);
        break;
      case 'loot':
        this.looting.take(p, message);
        break;
      case 'accept':
        this.quests.accept(p, message.quest);
        break;
      case 'use':
        this.kit.useItem(p, message.item);
        break;
      case 'equip':
        this.kit.wear(p, message.item, message.slot);
        break;
      case 'ability':
        this.combat.useAbility(p, message.ability, message.target);
        break;
      case 'craft':
        this.kit.craft(p, message.recipe);
        break;
      case 'shop':
        this.kit.shop(p, message);
        break;
      case 'trade':
        this.trades.handle(id, message);
        break;
      case 'wake':
        this.fallen.wake(p);
        break;
    }
    this.s.flush(p);
  }

  /** Delivers a message to everyone in this region. */
  broadcast(message: ServerMessage): void {
    this.s.broadcast(message);
  }

  /**
   * Advances the simulation one tick and sends each player a snapshot.
   * Returns players who walked off an open edge or fell, for the world to move.
   */
  tick(): Departure[] {
    this.s.tickCount++;
    const now = this.now();
    const departures: Departure[] = [];
    for (const p of this.s.players.values()) {
      const batch = p.inputs.splice(0, MAX_INPUTS_PER_TICK);
      for (const input of batch) {
        // The Fallen lie still where they fell; their steps are counted but not taken.
        if (this.fallen.is(p)) {
          p.ack = input.seq;
          continue;
        }
        const next = walkOn(this.map, p, input.dx, input.dy);
        const way = wayTaken(this.map, p.floor, next);
        if (way) this.s.notice(p, climbWords(way, p.floor));
        p.x = next.x;
        p.y = next.y;
        p.floor = next.floor;
        p.ack = input.seq;
      }
      const side = outsideSide(this.map, p.x, p.y);
      const cell = this.cell;
      if (side) departures.push({ id: p.info.id, side });
      else if (cell && cell.index > 0 && p.x < cell.x0 - CELL_MARGIN) departures.push({ id: p.info.id, cell: cell.index - 1 });
      else if (cell && cell.index < cell.count - 1 && p.x >= cell.x1 + CELL_MARGIN) departures.push({ id: p.info.id, cell: cell.index + 1 });
      const max = maxHp(p.character);
      if (p.character.hp > 0 && p.character.hp < max && now - p.lastHurt >= REGEN_DELAY_MS) {
        p.character.hp = Math.min(max, p.character.hp + regenPerSecond(p.character) * TICK_SECONDS);
      }
      const maxE = maxEnergy(p.character);
      if (p.character.hp > 0 && p.character.energy < maxE) {
        p.character.energy = Math.min(maxE, p.character.energy + energyPerSecond(p.character) * TICK_SECONDS);
      }
    }
    const { phase, weather } = this.sky(now);
    this.weatherTurns(weather);
    this.minds.think(now, phase, weather);
    this.s.bodies = this.s.bodies.filter((b) => now < b.until);
    // A loot window closes when its body fades or its looter walks away.
    for (const p of this.s.players.values()) if (p.looting && !this.looting.lootable(p, p.looting)) this.looting.closeLoot(p);
    this.minds.live(phase);
    // The Fallen lie where they fell until a friend raises them or they wake at the shrine.
    for (const id of this.fallen.tick(now)) {
      const i = departures.findIndex((d) => d.id === id);
      if (i >= 0) departures.splice(i, 1);
      departures.push({ id, died: true });
    }

    const all = [...this.s.players.values()];
    const online = this.hooks.online();
    for (const p of all) {
      const every = snapshotEvery(p.crowd, this.strain);
      if (every > 1 && (this.s.tickCount + p.phase) % every !== 0) {
        this.s.flush(p);
        continue;
      }
      // What is on their own floor, or across open outdoor balconies/terraces.
      const near = (o: { x: number; y: number; floor?: number }) => canSeeAcrossFloors(this.map, p, o) && Math.abs(o.x - p.x) <= VIEW_RADIUS && Math.abs(o.y - p.y) <= VIEW_RADIUS;
      const players: EntityState[] = [];
      for (const other of all) {
        if (other === p || !near(other)) continue;
        players.push(playerView(other));
      }
      const creatures: CreatureState[] = [];
      for (const c of this.s.creatures) {
        if (c.respawnAt !== null || !near(c)) continue;
        creatures.push(creatureView(c, mood(c)));
      }
      const bodies: BodyState[] = [];
      for (const b of this.s.bodies) {
        if (!near(b)) continue;
        bodies.push(bodyView(b, b.loot.length > 0));
      }
      const npcs: NpcState[] = [];
      for (const n of this.s.townsfolk) {
        if (near(n)) npcs.push(npcView(n));
      }
      // What the cells beside this one show across the border.
      for (const g of this.ghosts.values()) {
        for (const e of g.players) if (e.id !== p.info.id && near(e)) players.push(e);
        for (const e of g.creatures) if (near(e)) creatures.push(e);
        for (const e of g.bodies) if (near(e)) bodies.push(e);
        for (const e of g.npcs) if (near(e)) npcs.push(e);
      }
      p.crowd = players.length + creatures.length;
      p.conn.send({
        t: 'snapshot', tick: this.s.tickCount, ack: p.ack, x: p.x, y: p.y, ...(p.floor ? { floor: p.floor } : {}), hp: Math.ceil(p.character.hp), energy: Math.floor(p.character.energy), ...fallenFor(this.fallen.secondsLeft(p, now)), players, creatures, bodies, npcs, online,
      });
      this.s.flush(p);
    }
    return departures;
  }

  /** What players in the cells beside this one may see of it: everything within view of a border. */
  edge(): Ghosts {
    const cell = this.cell;
    const g: Ghosts = { players: [], creatures: [], bodies: [], npcs: [] };
    if (!cell) return g;
    const seen = (x: number) => (cell.index > 0 && x < cell.x0 + VIEW_RADIUS) || (cell.index < cell.count - 1 && x >= cell.x1 - VIEW_RADIUS);
    for (const p of this.s.players.values()) {
      if (!seen(p.x)) continue;
      g.players.push(playerView(p));
    }
    for (const c of this.s.creatures) {
      if (c.respawnAt === null && seen(c.x)) g.creatures.push(creatureView(c, mood(c)));
    }
    // Bodies are searched in their own cell; across the border they are only seen.
    for (const b of this.s.bodies) if (seen(b.x)) g.bodies.push(bodyView(b, false));
    for (const n of this.s.townsfolk) if (seen(n.x)) g.npcs.push(npcView(n));
    return g;
  }

  /** What the cell at `from` shows near the border, until it next says. */
  seeAcross(from: number, ghosts: Ghosts): void {
    this.ghosts.set(from, ghosts);
  }

  /** Tells everyone here when the weather turns (not when it is first worked out). */
  private weatherTurns(weather: Weather): void {
    const was = this.weather;
    this.weather = weather;
    if (!was || was === weather) return;
    this.broadcast({ t: 'sky', weather });
    for (const p of this.s.players.values()) this.s.notice(p, WEATHER_NEWS[weather]);
  }

}

/** The snapshot's Fallen countdown, sent only while it runs. */
function fallenFor(seconds: number | undefined): { fallen?: number } {
  return seconds === undefined ? {} : { fallen: seconds };
}

/** The open spot nearest (x, y), within a few tiles, at the middle of a tile. */
function nearestOpen(map: RegionMap, x: number, y: number, floor = 0): { x: number; y: number } | undefined {
  for (let r = 1; r <= 4; r++) {
    let best: { x: number; y: number; d: number } | undefined;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const spot = { x: Math.floor(x) + dx + 0.5, y: Math.floor(y) + dy + 0.5 };
        const d = Math.hypot(spot.x - x, spot.y - y);
        if (d > r || outsideSide(map, spot.x, spot.y) || collides(map, spot.x, spot.y, floor)) continue;
        if (!best || d < best.d) best = { ...spot, d };
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  return undefined;
}
