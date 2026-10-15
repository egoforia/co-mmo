import {
  ABILITIES,
  ATTACK_RANGE,
  BODY_SECONDS,
  CREATURES,
  ITEMS,
  RECIPES,
  SHOPS,
  abilityAmount,
  afterArmor,
  buy,
  craft,
  energyPerSecond,
  equip,
  gearBonus,
  maxEnergy,
  readScroll,
  rollDrops,
  SEARCH_RANGE,
  sell,
  train,
  unequip,
  wisherOf,
  MAX_CHAT_LENGTH,
  NPC_GREETINGS,
  QUESTS,
  SAY_RADIUS,
  TALK_RANGE,
  TICK_RATE,
  TICK_SECONDS,
  VIEW_RADIUS,
  addItem,
  attackCooldown,
  attackPower,
  collides,
  completeQuest,
  discover,
  gainXp,
  generateRegion,
  itemCount,
  maxHp,
  npcName,
  outsideSide,
  partyXp,
  questComplete,
  questOffered,
  regenPerSecond,
  rewardText,
  step,
  takeItem,
  tileAt,
  Tile,
  type BodyState,
  type Character,
  type CreatorCredit,
  type EquipSlot,
  type ChatChannel,
  type ClientMessage,
  type CreatureDef,
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
  type ShopMessage,
  type Side,
} from '@co-mmo/shared';
import { TradeDesk } from './trades.ts';

/** Inputs a player may queue; extra inputs are dropped (anti speed-hack). */
const MAX_QUEUED_INPUTS = 10;
/** Inputs applied per player per tick; lets a lagging client catch up a little. */
const MAX_INPUTS_PER_TICK = 2;
/** Chat flood limit: at most this many messages per window. */
const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 5000;
/** Creatures stroll at this speed (tiles per second) within this many tiles of home. */
const WANDER_SPEED = 1.5;
const WANDER_RADIUS = 4;
/** NPCs stroll more slowly, and stay closer to their spot so players can find them. */
const STROLL_SPEED = 1;
const STROLL_RADIUS = 2.5;
/** A chasing creature gives up this far from home and walks back. */
const LEASH = 8;
/** Creatures strike from this close. */
const CREATURE_REACH = 1.2;
/** Health starts coming back this long after the last hit taken. */
const REGEN_DELAY_MS = 5000;

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
}

/** Tile kinds scripted rules can ask about, by name. */
export const TILE_NAMES: Record<string, Tile> = { ground: Tile.Ground, path: Tile.Path, water: Tile.Water, tree: Tile.Tree, rock: Tile.Rock, floor: Tile.Floor, wall: Tile.Wall, door: Tile.Door };

interface PlayerState {
  info: PlayerInfo;
  conn: Connection;
  character: Character;
  x: number;
  y: number;
  inputs: { seq: number; dx: number; dy: number }[];
  ack: number;
  chatTimes: number[];
  lastAttack: number;
  lastHurt: number;
  /** When each ability can be used again, epoch ms. */
  readyAt: Map<string, number>;
  /** Character changed this tick; send it once the tick ends. */
  dirty: boolean;
}

/** Anything that strolls about a home spot: creatures and NPCs. */
interface Walker {
  x: number;
  y: number;
  home: { x: number; y: number };
  /** Where it is strolling to. */
  target: { x: number; y: number } | null;
  /** Ticks to rest before choosing the next spot. */
  rest: number;
}

/** A defeated creature's body: what it dropped waits there for those who won it. */
interface Body {
  id: string;
  kind: string;
  def: CreatureDef;
  x: number;
  y: number;
  /** Epoch ms when it fades away. */
  until: number;
  /** Who may search it: the one who struck the last blow and party members who shared the fight. */
  finders: string[];
  loot: InventorySlot[];
}

/** An NPC, where they stand now. */
type Townsperson = NpcPlacement & Walker;

interface Creature extends Walker {
  id: string;
  kind: string;
  def: CreatureDef;
  hp: number;
  /** The player it is fighting. */
  aggro: string | null;
  returning: boolean;
  lastAttack: number;
  /** Epoch ms when a defeated creature comes back; null while alive. */
  respawnAt: number | null;
}

export type Departure = { id: string; side: Side; died?: undefined } | { id: string; died: true; side?: undefined };

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
}

/**
 * One region of the world, simulated authoritatively. A region knows nothing
 * about sockets or storage: it talks to players through `Connection`, so it
 * can run in tests, and later in its own process per region.
 */
export class Region {
  readonly map: RegionMap;
  private readonly players = new Map<string, PlayerState>();
  private creatures: Creature[];
  /** Bodies of defeated creatures, until they fade. */
  private bodies: Body[] = [];
  private bodyCount = 0;
  /** The map's NPCs (the same objects as `map.npcs`, so it stays current) and those wishes added. */
  private townsfolk: Townsperson[];
  private tickCount = 0;

  private readonly hooks: RegionHooks;
  private readonly trades: TradeDesk;

  constructor(
    readonly def: RegionDef,
    hooks?: RegionHooks,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {
    // A region on its own is a world of one.
    this.hooks = hooks ?? { worldChat: (m) => this.broadcast(m), online: () => this.players.size };
    this.map = generateRegion(def);
    this.creatures = this.map.creatures.flatMap((c, i) => this.makeCreature(`${def.id}-${c.kind}-${i}`, c.kind, c.x, c.y));
    this.townsfolk = this.map.npcs.map((n) => this.makeStroller(n));
    this.trades = new TradeDesk({
      character: (id) => this.players.get(id)?.character,
      nameOf: (id) => this.players.get(id)?.info.name,
      findByName: (name) => [...this.players.values()].find((p) => p.info.name.toLowerCase() === name.toLowerCase())?.info.id,
      distance: (a, b) => {
        const pa = this.players.get(a);
        const pb = this.players.get(b);
        return pa && pb ? Math.hypot(pa.x - pb.x, pa.y - pb.y) : Infinity;
      },
      send: (id, m) => this.send(id, m),
      changed: (id) => {
        const p = this.players.get(id);
        if (p) p.dirty = true;
      },
      now: this.now,
    });
  }

  /** Lets an NPC stroll about where they were placed. */
  private makeStroller(npc: NpcPlacement): Townsperson {
    return Object.assign(npc, { home: { x: npc.x, y: npc.y }, target: null, rest: Math.floor(this.random() * TICK_RATE * 3) });
  }

  private makeCreature(id: string, kind: string, x: number, y: number): Creature[] {
    const cdef = CREATURES[kind];
    if (!cdef) return [];
    return [{
      id,
      kind,
      def: cdef,
      x,
      y,
      home: { x, y },
      hp: cdef.hp,
      target: null,
      rest: Math.floor(this.random() * TICK_RATE * 3),
      aggro: null,
      returning: false,
      lastAttack: 0,
      respawnAt: null,
    }];
  }

  // --- Wished content ----------------------------------------------------------

  /** Places a wished creature kind at these spots. */
  addCreatures(kind: string, spots: { x: number; y: number }[]): void {
    spots.forEach((s, i) => this.creatures.push(...this.makeCreature(`${kind}-${i}`, kind, s.x, s.y)));
  }

  /** Places a wished NPC, who strolls about that spot. */
  addNpc(npc: NpcPlacement): void {
    this.townsfolk = this.townsfolk.filter((n) => n.id !== npc.id);
    this.townsfolk.push(this.makeStroller({ ...npc }));
  }

  /** Takes away everything a wish placed here. */
  removeWish(id: string): void {
    for (const p of this.players.values()) {
      if (this.creatures.some((c) => c.kind === id && c.aggro === p.info.id)) p.lastHurt = this.now();
    }
    this.creatures = this.creatures.filter((c) => c.kind !== id);
    this.bodies = this.bodies.filter((b) => b.kind !== id);
    this.townsfolk = this.townsfolk.filter((n) => n.id !== id);
  }

  /**
   * Up to `count` walkable spots around a point, nearest first, at least a
   * tile apart, for placing wished things.
   */
  findSpots(x: number, y: number, count: number, min = 1.5, max = 4): { x: number; y: number }[] {
    const spots: { x: number; y: number }[] = [];
    for (let r = min; r <= max && spots.length < count; r += 0.75) {
      for (let a = 0; a < 12 && spots.length < count; a++) {
        const angle = (a / 12) * Math.PI * 2 + r;
        const s = { x: Math.round((x + Math.cos(angle) * r) * 2) / 2, y: Math.round((y + Math.sin(angle) * r) * 2) / 2 };
        if (outsideSide(this.map, s.x, s.y) || collides(this.map, s.x, s.y)) continue;
        if (spots.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < 1)) continue;
        spots.push(s);
      }
    }
    return spots;
  }

  /** Short lines about what is near a player, for the God's context. */
  nearby(id: string): string[] {
    const p = this.players.get(id);
    if (!p) return [];
    const lines: string[] = [];
    const near = (x: number, y: number, r: number) => Math.hypot(x - p.x, y - p.y) <= r;
    for (const other of this.players.values()) if (other !== p && near(other.x, other.y, 10)) lines.push(`${other.info.name} (player)`);
    for (const n of this.townsfolk) if (near(n.x, n.y, 10)) lines.push(`${n.name} (NPC)`);
    const kinds = new Map<string, number>();
    for (const c of this.creatures) if (c.respawnAt === null && near(c.x, c.y, 10)) kinds.set(c.def.name, (kinds.get(c.def.name) ?? 0) + 1);
    for (const [name, n] of kinds) lines.push(`${n} ${name}${n > 1 ? 's' : ''}`);
    return lines;
  }

  /** Changes a player's character outside the tick (Favor spent on a wish, a wished item given). */
  updateCharacter(id: string, change: (c: Character) => void): void {
    const p = this.players.get(id);
    if (!p) return;
    change(p.character);
    p.dirty = true;
    this.flush(p);
  }

  /** True when a tile of this kind lies within `radius` tiles of the player. */
  nearTile(id: string, tile: Tile, radius: number): boolean {
    const p = this.players.get(id);
    return Boolean(p && this.nearestTile(p.x, p.y, [tile], radius));
  }

  /** XP from a scripted rule, with the usual level-up messages. */
  grantXp(id: string, amount: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.levelUps(p, gainXp(p.character, amount));
    p.dirty = true;
    this.flush(p);
  }

  /** A line in one player's log. */
  tell(id: string, text: string): void {
    const p = this.players.get(id);
    if (p) this.notice(p, text);
  }

  /** A system line for everyone in the region. */
  announce(text: string): void {
    this.broadcastSystem(text);
  }

  /** Sends one player a message. */
  send(id: string, message: ServerMessage): void {
    this.players.get(id)?.conn.send(message);
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
    for (const p of this.players.values()) {
      // A road may now run where someone stood; the new land never traps anyone.
      if (collides(this.map, p.x, p.y)) Object.assign(p, this.map.spawn);
      this.welcome(p);
    }
  }

  /** Sends everyone here a fresh welcome: the land around changed. */
  welcomeAll(): void {
    for (const p of this.players.values()) this.welcome(p);
  }

  private welcome(p: PlayerState): void {
    p.conn.send({ t: 'welcome', you: p.info, region: this.info, neighbours: this.hooks.neighbours?.() ?? [], x: p.x, y: p.y, ack: p.ack, tickRate: TICK_RATE, character: p.character });
  }

  get online(): number {
    return this.players.size;
  }

  playerIds(): string[] {
    return [...this.players.keys()];
  }

  has(id: string): boolean {
    return this.players.has(id);
  }

  nameOf(id: string): string | undefined {
    return this.players.get(id)?.info.name;
  }

  position(id: string): { x: number; y: number } | undefined {
    const p = this.players.get(id);
    return p && { x: p.x, y: p.y };
  }

  character(id: string): Character | undefined {
    return this.players.get(id)?.character;
  }

  /** Live creature ids, for tests and tools. */
  creatureIds(): string[] {
    return this.creatures.filter((c) => c.respawnAt === null).map((c) => c.id);
  }

  /** Bodies lying here now, for tests and tools. */
  bodyList(): { id: string; kind: string; x: number; y: number; finders: string[]; loot: InventorySlot[] }[] {
    return this.bodies.map((b) => ({ id: b.id, kind: b.kind, x: b.x, y: b.y, finders: [...b.finders], loot: b.loot.map((s) => ({ ...s })) }));
  }

  /** Where an NPC stands now, for tests and tools. */
  npc(id: string): { x: number; y: number; home: { x: number; y: number } } | undefined {
    const n = this.townsfolk.find((t) => t.id === id);
    return n && { x: n.x, y: n.y, home: { ...n.home } };
  }

  creature(id: string): { kind: string; x: number; y: number; hp: number; alive: boolean } | undefined {
    const c = this.creatures.find((k) => k.id === id);
    return c && { kind: c.kind, x: c.x, y: c.y, hp: c.hp, alive: c.respawnAt === null };
  }

  /** Moves a player, for tests and tools. */
  placePlayer(id: string, x: number, y: number): void {
    const p = this.players.get(id);
    if (p) Object.assign(p, { x, y });
  }

  /** Moves a creature, for tests and (later) wishes. */
  placeCreature(id: string, x: number, y: number): void {
    const c = this.creatures.find((k) => k.id === id);
    if (c) Object.assign(c, { x, y, home: { x, y }, target: null });
  }

  /**
   * Adds a player at the given position, or at the spawn point when it is
   * missing or no longer walkable (a wish may have changed the map).
   */
  join(info: PlayerInfo, conn: Connection, at: { x: number | null; y: number | null }, character: Character, announce?: string, carry?: Carry): void {
    const existing = this.players.get(info.id);
    if (existing) {
      existing.conn.close('Signed in from another window.');
      this.players.delete(info.id);
    }
    let { x, y } = this.map.spawn;
    if (at.x !== null && at.y !== null && !outsideSide(this.map, at.x, at.y) && !collides(this.map, at.x, at.y)) {
      x = at.x;
      y = at.y;
    }
    const p: PlayerState = {
      info, conn, character, x, y, inputs: [], ack: 0, chatTimes: [], lastAttack: 0, lastHurt: 0, readyAt: new Map(), dirty: false, ...carry,
    };
    this.players.set(info.id, p);
    this.welcome(p);
    // Every wished region carries a credit line (design doc, World structure).
    const wild = this.def.wild;
    if (wild) this.notice(p, `✦ ${this.def.name} was wished into being by ${wild.wisher}. Danger ${wild.danger} of 6.`);
    this.broadcastSystem(announce ?? `${info.name} entered ${this.def.name}.`);
  }

  /** Removes a player, announcing why; returns what the world needs to move them on. */
  remove(id: string, announce?: string): Leaving | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    this.trades.leave(id);
    this.players.delete(id);
    for (const c of this.creatures) if (c.aggro === id) this.giveUp(c);
    this.broadcastSystem(announce ?? `${p.info.name} left.`);
    const carry: Carry = { ack: p.ack, inputs: p.inputs, lastAttack: p.lastAttack, lastHurt: p.lastHurt, readyAt: p.readyAt };
    return { info: p.info, conn: p.conn, character: p.character, x: p.x, y: p.y, carry };
  }

  handle(id: string, message: ClientMessage): void {
    const p = this.players.get(id);
    if (!p) return;
    switch (message.t) {
      case 'input':
        if (message.seq <= p.ack) return;
        if (p.inputs.length >= MAX_QUEUED_INPUTS) return;
        p.inputs.push({ seq: message.seq, dx: message.dx, dy: message.dy });
        break;
      case 'chat':
        this.chat(p, message.channel, message.text, message.to);
        break;
      case 'attack':
        this.attack(p);
        break;
      case 'interact':
        this.interact(p);
        break;
      case 'accept':
        this.accept(p, message.quest);
        break;
      case 'use':
        this.useItem(p, message.item);
        break;
      case 'equip':
        this.wear(p, message.item, message.slot);
        break;
      case 'ability':
        this.useAbility(p, message.ability, message.target);
        break;
      case 'craft':
        this.craft(p, message.recipe);
        break;
      case 'shop':
        this.shop(p, message);
        break;
      case 'trade':
        this.trades.handle(id, message);
        break;
    }
    this.flush(p);
  }

  /** Delivers a message to everyone in this region. */
  broadcast(message: ServerMessage): void {
    for (const p of this.players.values()) p.conn.send(message);
  }

  /**
   * Advances the simulation one tick and sends each player a snapshot.
   * Returns players who walked off an open edge or fell, for the world to move.
   */
  tick(): Departure[] {
    this.tickCount++;
    const now = this.now();
    const departures: Departure[] = [];
    for (const p of this.players.values()) {
      const batch = p.inputs.splice(0, MAX_INPUTS_PER_TICK);
      for (const input of batch) {
        const next = step(this.map, p, input.dx, input.dy);
        p.x = next.x;
        p.y = next.y;
        p.ack = input.seq;
      }
      const side = outsideSide(this.map, p.x, p.y);
      if (side) departures.push({ id: p.info.id, side });
      const max = maxHp(p.character);
      if (p.character.hp > 0 && p.character.hp < max && now - p.lastHurt >= REGEN_DELAY_MS) {
        p.character.hp = Math.min(max, p.character.hp + regenPerSecond(p.character) * TICK_SECONDS);
      }
      const maxE = maxEnergy(p.character);
      if (p.character.hp > 0 && p.character.energy < maxE) {
        p.character.energy = Math.min(maxE, p.character.energy + energyPerSecond(p.character) * TICK_SECONDS);
      }
    }
    for (const c of this.creatures) this.think(c, now);
    this.bodies = this.bodies.filter((b) => now < b.until);
    for (const n of this.townsfolk) this.stroll(n);
    for (const p of this.players.values()) {
      if (p.character.hp <= 0 && !departures.some((d) => d.id === p.info.id)) departures.push({ id: p.info.id, died: true });
    }

    const all = [...this.players.values()];
    const online = this.hooks.online();
    for (const p of all) {
      const near = (x: number, y: number) => Math.abs(x - p.x) <= VIEW_RADIUS && Math.abs(y - p.y) <= VIEW_RADIUS;
      const players: EntityState[] = [];
      for (const other of all) {
        if (other === p || !near(other.x, other.y)) continue;
        players.push({
          id: other.info.id, name: other.info.name, color: other.info.color, x: round(other.x), y: round(other.y),
          health: round(other.character.hp / maxHp(other.character)),
        });
      }
      const creatures: CreatureState[] = [];
      for (const c of this.creatures) {
        if (c.respawnAt !== null || !near(c.x, c.y)) continue;
        creatures.push({
          id: c.id, kind: c.kind, asset: c.def.art, name: c.def.name, x: round(c.x), y: round(c.y), health: round(c.hp / c.def.hp),
        });
      }
      const bodies: BodyState[] = [];
      for (const b of this.bodies) {
        if (!near(b.x, b.y)) continue;
        bodies.push({ id: b.id, kind: b.kind, asset: b.def.art, name: b.def.name, x: round(b.x), y: round(b.y), loot: this.lootFor(b, p) });
      }
      const npcs: NpcState[] = [];
      for (const n of this.townsfolk) {
        if (near(n.x, n.y)) npcs.push({ id: n.id, name: n.name, asset: n.asset, x: round(n.x), y: round(n.y) });
      }
      p.conn.send({
        t: 'snapshot', tick: this.tickCount, ack: p.ack, x: p.x, y: p.y, hp: Math.ceil(p.character.hp), energy: Math.floor(p.character.energy), players, creatures, bodies, npcs, online,
      });
      this.flush(p);
    }
    return departures;
  }

  // --- Combat ----------------------------------------------------------------

  private attack(p: PlayerState): void {
    const now = this.now();
    if (p.character.hp <= 0 || now - p.lastAttack < attackCooldown(p.character) * 1000 - 1) return;
    p.lastAttack = now;
    const target = this.creatureInReach(p, ATTACK_RANGE);
    if (!target) return;
    this.strike(p, target, attackPower(p.character) * (0.8 + this.random() * 0.4));
  }

  /** The nearest live creature within reach, or the one asked for if it is in reach. */
  private creatureInReach(p: PlayerState, range: number, id?: string): Creature | undefined {
    let target: Creature | undefined;
    let best = range;
    for (const c of this.creatures) {
      if (c.respawnAt !== null || (id && c.id !== id)) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d <= best) {
        best = d;
        target = c;
      }
    }
    return target;
  }

  /** Damages a creature (halved while Weakened); a defeat pays the rewards. */
  private strike(p: PlayerState, target: Creature, raw: number, ability?: string): void {
    const weakened = this.now() < p.character.weakenedUntil ? 0.5 : 1;
    const amount = Math.max(1, Math.round(raw * weakened));
    target.hp = Math.max(0, target.hp - amount);
    const defeated = target.hp === 0;
    this.broadcastNear(target, { t: 'hit', by: p.info.id, target: target.id, amount, defeated, ...(ability ? { ability } : {}) });
    if (!defeated) {
      target.aggro = p.info.id;
      target.returning = false;
      target.target = null;
      return;
    }
    target.respawnAt = this.now() + target.def.respawnSeconds * 1000;
    target.aggro = null;
    this.reward(p, target);
  }

  // --- Abilities ---------------------------------------------------------------

  private useAbility(p: PlayerState, id: string, targetId?: string): void {
    const a = ABILITIES[id];
    const ch = p.character;
    if (!a || !ch.abilities.includes(id) || ch.hp <= 0) return;
    const now = this.now();
    if (now < (p.readyAt.get(id) ?? 0) - 1) return;
    if (ch.energy < a.energy) return this.notice(p, `Not enough Energy for ${a.name}.`);
    const max = maxHp(ch);
    let target: Creature | undefined;
    if (a.effect === 'heal') {
      if (ch.hp >= max) return this.notice(p, 'You are already at full health.');
    } else {
      target = this.creatureInReach(p, a.range, targetId) ?? (targetId ? this.creatureInReach(p, a.range) : undefined);
      if (!target) return this.notice(p, a.effect === 'bolt' ? `No creature within ${a.range} steps.` : 'Nothing in reach to strike.');
    }
    ch.energy -= a.energy;
    p.readyAt.set(id, now + a.cooldown * 1000);
    p.conn.send({ t: 'cooldown', ability: id, seconds: a.cooldown });
    p.dirty = true;
    const amount = abilityAmount(ch, a) * (0.9 + this.random() * 0.2);
    if (target) this.strike(p, target, amount, id);
    else {
      const healed = Math.min(max - ch.hp, Math.round(amount));
      ch.hp += healed;
      this.notice(p, `${a.name} restores ${healed} health.`);
    }
    this.credit(id, p, 'use');
  }

  // --- The Adventurer's kit: gear, crafting, shops --------------------------------

  /** Wears an item from the bag, or takes off what is in a slot. */
  private wear(p: PlayerState, item?: string, slot?: EquipSlot): void {
    if (item) {
      const why = equip(p.character, item);
      if (why) return this.notice(p, why);
      this.notice(p, `You put on the ${ITEMS[item]!.name}.`);
      this.credit(item, p, 'equip');
    } else if (slot && !unequip(p.character, slot)) {
      return;
    }
    p.dirty = true;
  }

  private craft(p: PlayerState, recipe: string): void {
    const why = craft(p.character, recipe);
    if (why) return this.notice(p, why);
    const r = RECIPES[recipe]!;
    this.notice(p, `You made ${r.result.qty > 1 ? `${r.result.qty} × ` : 'a '}${ITEMS[r.result.item]!.name}.`);
    this.credit(recipe, p, 'craft');
    p.dirty = true;
  }

  /** Buying, selling and lessons, only while standing by the shopkeeper. */
  private shop(p: PlayerState, m: ShopMessage): void {
    const keeper = this.townsfolk.find((n) => n.id === m.npc);
    if (!keeper || !SHOPS[m.npc] || Math.hypot(keeper.x - p.x, keeper.y - p.y) > TALK_RANGE + 1) {
      return this.notice(p, `Walk up to ${npcName(m.npc)} to trade.`);
    }
    const ch = p.character;
    const before = ch.gold;
    const why = m.action === 'buy' ? buy(ch, m.npc, m.id) : m.action === 'sell' ? sell(ch, m.npc, m.id, m.qty ?? 1) : train(ch, m.npc, m.id);
    if (why) return this.notice(p, why);
    const name = m.action === 'learn' ? ABILITIES[m.id]!.name : ITEMS[m.id]?.name ?? m.id;
    this.notice(p, m.action === 'buy'
      ? `You bought a ${name} for ${before - ch.gold} gold.`
      : m.action === 'sell'
        ? `You sold ${m.qty && m.qty > 1 ? `${m.qty} × ` : 'a '}${name} for ${ch.gold - before} gold.`
        : `${npcName(m.npc)} teaches you ${name}. It is on the ${ch.abilities.length} key.`);
    p.dirty = true;
  }

  /** Someone enjoyed a wished thing; its wisher earns Creator XP (the world decides how much). */
  private credit(thing: string, p: PlayerState, credit: CreatorCredit): void {
    if (wisherOf(thing)) this.hooks.creator?.(thing, p.info.id, credit);
  }

  private reward(p: PlayerState, c: Creature): void {
    const ch = p.character;
    // Party members close by share the XP and the quest progress.
    const party = this.hooks.party?.(p.info.id) ?? [p.info.id];
    const sharers = party
      .map((id) => this.players.get(id))
      .filter((m): m is PlayerState => !!m && (m === p || (m.character.hp > 0 && Math.abs(m.x - c.x) <= VIEW_RADIUS && Math.abs(m.y - c.y) <= VIEW_RADIUS)));
    const xp = partyXp(c.def.xp, sharers.length);
    const gained: string[] = [sharers.length > 1 ? `+${xp} XP (shared)` : `+${xp} XP`];
    const [lo, hi] = c.def.gold;
    const gold = lo + Math.floor(this.random() * (hi - lo + 1));
    if (gold) {
      ch.gold += gold;
      gained.push(`${gold} gold`);
    }
    // What it carried stays on its body for its finders to search (E).
    this.bodies.push({
      id: `body-${++this.bodyCount}`, kind: c.kind, def: c.def, x: c.x, y: c.y,
      until: this.now() + BODY_SECONDS * 1000, finders: sharers.map((m) => m.info.id), loot: rollDrops(c.def.drops, this.random),
    });
    discover(ch, c.kind);
    this.hooks.event?.('defeat', p.info.id, { creature: c.kind });
    this.credit(c.kind, p, 'defeat');
    this.notice(p, `Defeated ${c.def.name}: ${gained.join(', ')}. Press E beside its body to search it.`);
    for (const m of sharers) {
      if (m !== p) {
        discover(m.character, c.kind);
        this.notice(m, `${p.info.name} defeated ${c.def.name}: +${xp} XP (shared).`);
      }
      this.countDefeat(m, c.kind);
      this.levelUps(m, gainXp(m.character, xp));
      m.dirty = true;
    }
  }

  /** A defeat counts toward the player's defeat quests for that creature. */
  private countDefeat(p: PlayerState, kind: string): void {
    for (const q of p.character.quests) {
      const goal = QUESTS[q.id]?.goal;
      if (q.done || goal?.kind !== 'defeat' || goal.creature !== kind || q.count >= goal.count) continue;
      q.count++;
      if (q.count === goal.count) this.notice(p, `${QUESTS[q.id]!.title}: done! Return to ${npcName(QUESTS[q.id]!.giver)}.`);
    }
  }

  private levelUps(p: PlayerState, levels: number): void {
    if (!levels) return;
    this.notice(p, `You reached level ${p.character.level}! Every stat rose by ${levels}.`);
    this.broadcastSystem(`${p.info.name} reached level ${p.character.level}.`);
    this.hooks.journal?.(`${p.info.name} reached level ${p.character.level}.`, p.info.id);
  }

  /** Creature behaviour for one tick: respawn, fight, walk home or wander. */
  private think(c: Creature, now: number): void {
    if (c.respawnAt !== null) {
      if (now < c.respawnAt) return;
      Object.assign(c, { respawnAt: null, hp: c.def.hp, x: c.home.x, y: c.home.y, target: null, returning: false, aggro: null });
      return;
    }
    if (!c.aggro && !c.returning && c.def.behavior !== 'wander') {
      const from = c.def.behavior === 'guard' ? c.home : c;
      for (const p of this.players.values()) {
        if (p.character.hp > 0 && Math.hypot(p.x - from.x, p.y - from.y) <= c.def.notice) {
          c.aggro = p.info.id;
          break;
        }
      }
    }
    if (c.aggro) {
      const p = this.players.get(c.aggro);
      if (!p || p.character.hp <= 0 || Math.hypot(c.x - c.home.x, c.y - c.home.y) > LEASH) return this.giveUp(c);
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d > CREATURE_REACH * 0.8) this.moveToward(c, p.x, p.y, c.def.speed);
      if (d <= CREATURE_REACH && now - c.lastAttack >= c.def.cooldown * 1000) {
        c.lastAttack = now;
        this.hurt(p, c, now);
      }
      return;
    }
    if (c.returning) {
      if (this.moveToward(c, c.home.x, c.home.y, c.def.speed) || this.tickCount % (TICK_RATE * 5) === 0) {
        c.returning = false;
        c.hp = c.def.hp;
      }
      return;
    }
    this.wander(c, WANDER_SPEED, WANDER_RADIUS);
  }

  /** NPCs stroll about their spot, but stand still while someone is close enough to talk. */
  private stroll(n: Townsperson): void {
    for (const p of this.players.values()) {
      if (p.character.hp > 0 && Math.hypot(p.x - n.x, p.y - n.y) <= TALK_RANGE) {
        n.target = null;
        n.rest = TICK_RATE;
        return;
      }
    }
    this.wander(n, STROLL_SPEED, STROLL_RADIUS);
  }

  private giveUp(c: Creature): void {
    c.aggro = null;
    c.returning = true;
    c.target = null;
  }

  private hurt(p: PlayerState, c: Creature, now: number): void {
    const amount = afterArmor(c.def.damage * (0.8 + this.random() * 0.4), gearBonus(p.character, 'armor'));
    p.character.hp = Math.max(0, p.character.hp - amount);
    p.lastHurt = now;
    const defeated = p.character.hp === 0;
    this.broadcastNear(p, { t: 'hit', by: c.id, target: p.info.id, amount, defeated });
    if (defeated) this.giveUp(c);
  }

  /** Steps toward a point, sliding along walls. True once it arrives. */
  private moveToward(c: Walker, tx: number, ty: number, speed: number): boolean {
    const dx = tx - c.x;
    const dy = ty - c.y;
    const dist = Math.hypot(dx, dy);
    const len = speed * TICK_SECONDS;
    if (dist <= len) {
      if (!collides(this.map, tx, ty)) {
        c.x = tx;
        c.y = ty;
      }
      return true;
    }
    const nx = c.x + (dx / dist) * len;
    const ny = c.y + (dy / dist) * len;
    if (!collides(this.map, nx, c.y)) c.x = nx;
    if (!collides(this.map, c.x, ny)) c.y = ny;
    return false;
  }

  /** Creatures and NPCs stroll between spots near home, resting in between. */
  private wander(c: Walker, speed: number, radius: number): void {
    if (!c.target) {
      if (c.rest-- > 0) return;
      for (let tries = 0; tries < 5 && !c.target; tries++) {
        const angle = this.random() * Math.PI * 2;
        const dist = 1 + this.random() * (radius - 1);
        const t = { x: c.home.x + Math.cos(angle) * dist, y: c.home.y + Math.sin(angle) * dist };
        if (!outsideSide(this.map, t.x, t.y) && !collides(this.map, t.x, t.y)) c.target = t;
      }
      if (!c.target) c.rest = TICK_RATE;
      return;
    }
    const before = { x: c.x, y: c.y };
    if (this.moveToward(c, c.target.x, c.target.y, speed)) {
      c.target = null;
      c.rest = Math.floor(TICK_RATE * (1 + this.random() * 3));
    } else if (c.x === before.x && c.y === before.y) {
      c.target = null;
      c.rest = TICK_RATE;
    }
  }

  // --- Talking, quests and items -----------------------------------------------

  private interact(p: PlayerState): void {
    let npc: NpcPlacement | undefined;
    let best = TALK_RANGE;
    for (const n of this.townsfolk) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d <= best) {
        best = d;
        npc = n;
      }
    }
    if (npc) this.credit(npc.id, p, 'talk');
    if (!npc && this.search(p)) return;
    if (!npc) {
      // Nobody to talk to: the player is acting on the land (fishing at water, say).
      const spot = this.nearestTile(p.x, p.y, [Tile.Water, Tile.Tree, Tile.Rock], 1.6);
      const tile = spot ? spot.tile : tileAt(this.map, p.x, p.y);
      const name = Object.keys(TILE_NAMES).find((k) => TILE_NAMES[k] === tile) ?? 'ground';
      this.hooks.event?.('interact', p.info.id, { tile: name, x: spot?.x ?? Math.floor(p.x), y: spot?.y ?? Math.floor(p.y) });
      return;
    }
    const ch = p.character;
    let text: string | undefined;

    // A talk quest that ends here, or a finished quest to hand in.
    for (const q of ch.quests) {
      const def = QUESTS[q.id];
      if (!def || q.done) continue;
      const handIn = def.goal.kind === 'talk' ? def.goal.npc === npc.id : def.giver === npc.id && questComplete(q);
      if (handIn) {
        const levels = completeQuest(ch, q);
        this.notice(p, `Quest complete: ${def.title}. You received ${rewardText(q.id)}.`);
        this.levelUps(p, levels);
        p.dirty = true;
        text = def.thanks;
        break;
      }
      if (def.giver === npc.id && def.goal.kind === 'defeat') text = def.waiting;
    }

    const offer = questOffered(ch, npc.id);
    const message: ServerMessage = {
      t: 'dialogue',
      npc: { id: npc.id, name: npc.name, asset: npc.asset },
      text: [text, offer && QUESTS[offer]!.offer].filter(Boolean).join('\n\n') || NPC_GREETINGS[npc.id] || '...',
    };
    if (offer) message.offer = { quest: offer, title: QUESTS[offer]!.title, reward: rewardText(offer) };
    if (SHOPS[npc.id]) message.shop = true;
    p.conn.send(message);
  }

  /**
   * Searches the nearest body in reach with something on it for this player,
   * taking it all; false when there is none. A body that is empty or someone
   * else's only gets a word, so E still acts on the land beside it (fishing).
   */
  private search(p: PlayerState): boolean {
    const inReach = this.bodies
      .map((b) => ({ b, d: Math.hypot(b.x - p.x, b.y - p.y) }))
      .filter((o) => o.d <= SEARCH_RANGE)
      .sort((a, c) => a.d - c.d)
      .map((o) => o.b);
    const body = inReach.find((b) => this.lootFor(b, p));
    if (!body) {
      const near = inReach[0];
      if (near) {
        this.notice(p, near.finders.includes(p.info.id)
          ? `You search the ${near.def.name}, but there is nothing more to find.`
          : `Someone else defeated this ${near.def.name}. What it carried is theirs to find.`);
      }
      return false;
    }
    const found = body.loot.splice(0);
    for (const s of found) addItem(p.character, s.item, s.qty);
    p.dirty = true;
    const names = found.map((s) => `${s.qty > 1 ? `${s.qty} × ` : 'a '}${ITEMS[s.item]?.name ?? s.item}`).join(', ');
    this.notice(p, `You search the ${body.def.name} and find ${names}.`);
    for (const id of body.finders) {
      if (id !== p.info.id) this.tell(id, `${p.info.name} searched the ${body.def.name} and found ${names}.`);
    }
    return true;
  }

  /** True when this body still holds something this player may take. */
  private lootFor(b: Body, p: PlayerState): boolean {
    return b.loot.length > 0 && b.finders.includes(p.info.id);
  }

  private accept(p: PlayerState, questId: string): void {
    const def = QUESTS[questId];
    if (!def || questOffered(p.character, def.giver) !== questId) return;
    const giver = this.map.npcs.find((n) => n.id === def.giver);
    if (!giver || Math.hypot(giver.x - p.x, giver.y - p.y) > TALK_RANGE + 1) return;
    p.character.quests.push({ id: questId, count: 0, done: false });
    this.notice(p, `New quest: ${def.title}.`);
    p.dirty = true;
  }

  private useItem(p: PlayerState, item: string): void {
    const def = ITEMS[item];
    const ch = p.character;
    if (!def || itemCount(ch, item) === 0 || ch.hp <= 0) return;
    if (def.slot) return this.wear(p, item);
    if (def.teaches) {
      const why = readScroll(ch, item);
      if (why) return this.notice(p, why);
      this.notice(p, `You read the scroll and learn ${ABILITIES[def.teaches]!.name}. It is on the ${ch.abilities.length} key.`);
      this.credit(item, p, 'learn');
      p.dirty = true;
      return;
    }
    // Items without a built-in use are for scripted rules (a fishing rod).
    if (!def.heal) {
      if (def.kind !== 'book') {
        this.hooks.event?.('use', p.info.id, { item });
        this.credit(item, p, 'use');
      }
      return;
    }
    const max = maxHp(ch);
    if (ch.hp >= max) return this.notice(p, 'You are already at full health.');
    takeItem(ch, item);
    ch.hp = Math.min(max, ch.hp + def.heal);
    this.notice(p, `You drink a ${def.name}.`);
    this.credit(item, p, 'use');
    p.dirty = true;
  }

  /** The nearest tile of these kinds within a radius of a point (tile coordinates). */
  private nearestTile(x: number, y: number, kinds: Tile[], radius: number): { tile: Tile; x: number; y: number } | undefined {
    let best: { tile: Tile; x: number; y: number } | undefined;
    let bestD = Infinity;
    const r = Math.ceil(radius);
    for (let ty = Math.floor(y) - r; ty <= Math.floor(y) + r; ty++) {
      for (let tx = Math.floor(x) - r; tx <= Math.floor(x) + r; tx++) {
        if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) continue;
        const tile = tileAt(this.map, tx, ty);
        if (!kinds.includes(tile)) continue;
        // Distance from the player to the closest point of the tile.
        const d = Math.hypot(Math.max(tx - x, 0, x - (tx + 1)), Math.max(ty - y, 0, y - (ty + 1)));
        if (d <= radius && d < bestD) {
          bestD = d;
          best = { tile, x: tx, y: ty };
        }
      }
    }
    return best;
  }

  // --- Messages --------------------------------------------------------------

  private flush(p: PlayerState): void {
    if (!p.dirty) return;
    p.dirty = false;
    p.conn.send({ t: 'character', character: p.character });
  }

  private notice(p: PlayerState, text: string): void {
    p.conn.send({ t: 'notice', text });
  }

  private broadcastNear(at: { x: number; y: number }, message: ServerMessage): void {
    for (const p of this.players.values()) {
      if (Math.abs(p.x - at.x) <= VIEW_RADIUS && Math.abs(p.y - at.y) <= VIEW_RADIUS) p.conn.send(message);
    }
  }

  private chat(from: PlayerState, channel: ChatChannel, raw: string, to?: string): void {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
    if (!text) return;
    const now = this.now();
    from.chatTimes = from.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
    if (from.chatTimes.length >= CHAT_BURST) {
      from.conn.send({ t: 'error', code: 'chat_rate', message: 'You are speaking too fast. Wait a moment.' });
      return;
    }
    from.chatTimes.push(now);
    const message: ChatMessage = { t: 'chat', channel, from: { id: from.info.id, name: from.info.name }, text, at: now };
    if (channel === 'world') {
      this.hooks.worldChat(message);
      return;
    }
    if (channel === 'region') return this.broadcast(message);
    if (channel === 'party' || channel === 'whisper') {
      const why = this.hooks.route ? this.hooks.route(message, to) : 'Nobody can hear that here.';
      if (why) from.conn.send({ t: 'error', code: 'chat_undelivered', message: why });
      return;
    }
    for (const p of this.players.values()) {
      if (Math.hypot(p.x - from.x, p.y - from.y) <= SAY_RADIUS) p.conn.send(message);
    }
  }

  private broadcastSystem(text: string): void {
    this.broadcast({ t: 'system', text, at: this.now() });
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
