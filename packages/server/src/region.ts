import {
  ATTACK_RANGE,
  CREATURES,
  ITEMS,
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
  questComplete,
  questOffered,
  regenPerSecond,
  rewardText,
  step,
  takeItem,
  type Character,
  type ChatChannel,
  type ClientMessage,
  type CreatureDef,
  type CreatureState,
  type EntityState,
  type NpcPlacement,
  type PlayerInfo,
  type RegionDef,
  type RegionInfo,
  type RegionMap,
  type ServerMessage,
  type Side,
} from '@co-mmo/shared';

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
}

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
  /** Character changed this tick; send it once the tick ends. */
  dirty: boolean;
}

interface Creature {
  id: string;
  kind: string;
  def: CreatureDef;
  x: number;
  y: number;
  home: { x: number; y: number };
  hp: number;
  /** Where it is strolling to. */
  target: { x: number; y: number } | null;
  /** Ticks to rest before choosing the next spot. */
  rest: number;
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
}

/**
 * One region of the world, simulated authoritatively. A region knows nothing
 * about sockets or storage: it talks to players through `Connection`, so it
 * can run in tests, and later in its own process per region.
 */
export class Region {
  readonly map: RegionMap;
  private readonly players = new Map<string, PlayerState>();
  private readonly creatures: Creature[];
  private tickCount = 0;

  private readonly hooks: RegionHooks;

  constructor(
    readonly def: RegionDef,
    hooks?: RegionHooks,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {
    // A region on its own is a world of one.
    this.hooks = hooks ?? { worldChat: (m) => this.broadcast(m), online: () => this.players.size };
    this.map = generateRegion(def);
    this.creatures = this.map.creatures.flatMap((c, i) => {
      const cdef = CREATURES[c.kind];
      if (!cdef) return [];
      return [{
        id: `${def.id}-${c.kind}-${i}`,
        kind: c.kind,
        def: cdef,
        x: c.x,
        y: c.y,
        home: { x: c.x, y: c.y },
        hp: cdef.hp,
        target: null,
        rest: Math.floor(this.random() * TICK_RATE * 3),
        aggro: null,
        returning: false,
        lastAttack: 0,
        respawnAt: null,
      }];
    });
  }

  get info(): RegionInfo {
    return { id: this.def.id, name: this.def.name };
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

  creature(id: string): { kind: string; x: number; y: number; hp: number; alive: boolean } | undefined {
    const c = this.creatures.find((k) => k.id === id);
    return c && { kind: c.kind, x: c.x, y: c.y, hp: c.hp, alive: c.respawnAt === null };
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
  join(info: PlayerInfo, conn: Connection, at: { x: number | null; y: number | null }, character: Character, announce?: string): void {
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
    this.players.set(info.id, {
      info, conn, character, x, y, inputs: [], ack: 0, chatTimes: [], lastAttack: 0, lastHurt: 0, dirty: false,
    });
    conn.send({ t: 'welcome', you: info, region: this.info, x, y, tickRate: TICK_RATE, character });
    this.broadcastSystem(announce ?? `${info.name} entered ${this.def.name}.`);
  }

  /** Removes a player, announcing why; returns what the world needs to move them on. */
  remove(id: string, announce?: string): Leaving | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    this.players.delete(id);
    for (const c of this.creatures) if (c.aggro === id) this.giveUp(c);
    this.broadcastSystem(announce ?? `${p.info.name} left.`);
    return { info: p.info, conn: p.conn, character: p.character, x: p.x, y: p.y };
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
        this.chat(p, message.channel, message.text);
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
    }
    for (const c of this.creatures) this.think(c, now);
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
      p.conn.send({
        t: 'snapshot', tick: this.tickCount, ack: p.ack, x: p.x, y: p.y, hp: Math.ceil(p.character.hp), players, creatures, online,
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
    let target: Creature | undefined;
    let best = ATTACK_RANGE;
    for (const c of this.creatures) {
      if (c.respawnAt !== null) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d <= best) {
        best = d;
        target = c;
      }
    }
    if (!target) return;
    const weakened = now < p.character.weakenedUntil ? 0.5 : 1;
    const amount = Math.max(1, Math.round(attackPower(p.character) * (0.8 + this.random() * 0.4) * weakened));
    target.hp = Math.max(0, target.hp - amount);
    const defeated = target.hp === 0;
    this.broadcastNear(target, { t: 'hit', by: p.info.id, target: target.id, amount, defeated });
    if (!defeated) {
      target.aggro = p.info.id;
      target.returning = false;
      target.target = null;
      return;
    }
    target.respawnAt = now + target.def.respawnSeconds * 1000;
    target.aggro = null;
    this.reward(p, target);
  }

  private reward(p: PlayerState, c: Creature): void {
    const ch = p.character;
    const gained: string[] = [`+${c.def.xp} XP`];
    const [lo, hi] = c.def.gold;
    const gold = lo + Math.floor(this.random() * (hi - lo + 1));
    if (gold) {
      ch.gold += gold;
      gained.push(`${gold} gold`);
    }
    for (const drop of c.def.drops) {
      if (this.random() < drop.chance) {
        addItem(ch, drop.item, drop.qty ?? 1);
        gained.push(ITEMS[drop.item]?.name ?? drop.item);
      }
    }
    discover(ch, c.kind);
    this.notice(p, `Defeated ${c.def.name}: ${gained.join(', ')}.`);
    for (const q of ch.quests) {
      const goal = QUESTS[q.id]?.goal;
      if (q.done || goal?.kind !== 'defeat' || goal.creature !== c.kind || q.count >= goal.count) continue;
      q.count++;
      if (q.count === goal.count) this.notice(p, `${QUESTS[q.id]!.title}: done! Return to ${npcName(QUESTS[q.id]!.giver)}.`);
    }
    this.levelUps(p, gainXp(ch, c.def.xp));
    p.dirty = true;
  }

  private levelUps(p: PlayerState, levels: number): void {
    if (!levels) return;
    this.notice(p, `You reached level ${p.character.level}! Every stat rose by ${levels}.`);
    this.broadcastSystem(`${p.info.name} reached level ${p.character.level}.`);
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
    this.wander(c);
  }

  private giveUp(c: Creature): void {
    c.aggro = null;
    c.returning = true;
    c.target = null;
  }

  private hurt(p: PlayerState, c: Creature, now: number): void {
    const amount = Math.max(1, Math.round(c.def.damage * (0.8 + this.random() * 0.4)));
    p.character.hp = Math.max(0, p.character.hp - amount);
    p.lastHurt = now;
    const defeated = p.character.hp === 0;
    this.broadcastNear(p, { t: 'hit', by: c.id, target: p.info.id, amount, defeated });
    if (defeated) this.giveUp(c);
  }

  /** Steps toward a point, sliding along walls. True once it arrives. */
  private moveToward(c: Creature, tx: number, ty: number, speed: number): boolean {
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

  /** Creatures stroll between spots near home, resting in between. */
  private wander(c: Creature): void {
    if (!c.target) {
      if (c.rest-- > 0) return;
      for (let tries = 0; tries < 5 && !c.target; tries++) {
        const angle = this.random() * Math.PI * 2;
        const dist = 1 + this.random() * (WANDER_RADIUS - 1);
        const t = { x: c.home.x + Math.cos(angle) * dist, y: c.home.y + Math.sin(angle) * dist };
        if (!outsideSide(this.map, t.x, t.y) && !collides(this.map, t.x, t.y)) c.target = t;
      }
      if (!c.target) c.rest = TICK_RATE;
      return;
    }
    const before = { x: c.x, y: c.y };
    if (this.moveToward(c, c.target.x, c.target.y, WANDER_SPEED)) {
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
    for (const n of this.map.npcs) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d <= best) {
        best = d;
        npc = n;
      }
    }
    if (!npc) return;
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
    p.conn.send(message);
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
    if (!def?.heal || itemCount(ch, item) === 0 || ch.hp <= 0) return;
    const max = maxHp(ch);
    if (ch.hp >= max) return this.notice(p, 'You are already at full health.');
    takeItem(ch, item);
    ch.hp = Math.min(max, ch.hp + def.heal);
    this.notice(p, `You drink a ${def.name}.`);
    p.dirty = true;
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

  private chat(from: PlayerState, channel: ChatChannel, raw: string): void {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
    if (!text) return;
    const now = this.now();
    from.chatTimes = from.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
    if (from.chatTimes.length >= CHAT_BURST) {
      from.conn.send({ t: 'error', code: 'chat_rate', message: 'You are speaking too fast. Wait a moment.' });
      return;
    }
    from.chatTimes.push(now);
    const message: ServerMessage = { t: 'chat', channel, from: { id: from.info.id, name: from.info.name }, text, at: now };
    if (channel === 'world') {
      this.hooks.worldChat(message);
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
