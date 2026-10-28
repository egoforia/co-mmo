// The robot playtester's player: one WebSocket connection that plays the
// game as a person would, through the same messages the client sends. It
// walks (predicting its own steps the way the client does), crosses region
// edges, fights, loots, talks and makes wishes, and writes down anything that
// looks broken in `problems` instead of stopping at the first one.

import { WebSocket } from 'ws';
import {
  SEARCH_RANGE,
  SIDE_STEP,
  TALK_RANGE,
  attackCooldown,
  attackReach,
  collides,
  generateRegion,
  itemCount,
  maxHp,
  regionDef,
  step,
  type BodyState,
  type Character,
  type ClientMessage,
  type CreatureState,
  type DialogueMessage,
  type GodMessage,
  type LootView,
  type PlayerInfo,
  type RegionDef,
  type RegionInfo,
  type RegionMap,
  type ServerMessage,
  type Side,
  type SnapshotMessage,
  type WishCard,
} from '@co-mmo/shared';
import { findPath, type Point } from './paths.ts';

/** How a fight ended. */
export type FightResult =
  | { result: 'defeated'; id: string; kind: string; at: Point }
  | { result: 'fell' }
  | { result: 'none' }
  | { result: 'timeout'; id: string };

interface Route {
  target: () => Point | undefined;
  near: number;
  path: Point[];
  i: number;
  plannedAt: number;
}

/** Inputs sent but not yet applied by the server; more would be dropped there. */
const MAX_PENDING = 3;
/** A waypoint counts as reached this close, in tiles. */
const WAYPOINT = 0.2;

/** A robot player connected to the game. */
export class Bot {
  /** Every message the server sent, in order. */
  readonly log: ServerMessage[] = [];
  /** What looked broken, in plain words, for the playtest report. */
  readonly problems: string[] = [];
  you!: PlayerInfo;
  region!: RegionInfo;
  map!: RegionMap;
  character!: Character;
  x = 0;
  y = 0;
  snapshot: SnapshotMessage | undefined;
  /** Why the server closed the connection, once it has. */
  closed: string | null = null;
  private seq = 0;
  private pending: { seq: number; dx: number; dy: number }[] = [];
  private readonly regions = new Map<string, RegionDef>();
  private readonly waiters = new Set<() => void>();
  private lastAttack = 0;

  private constructor(readonly name: string, private readonly socket: WebSocket, /** Its session, for God's View calls. */ readonly token: string) {
    socket.on('message', (raw) => this.receive(JSON.parse(raw.toString()) as ServerMessage));
    socket.on('close', (code, reason) => {
      this.closed = `${code} ${reason.toString()}`.trim();
      this.wake();
    });
  }

  /** Connects with a session token and waits to be welcomed into the world. */
  static async join(url: string, token: string, name: string): Promise<Bot> {
    const socket = new WebSocket(url);
    const bot = new Bot(name, socket, token);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.send(JSON.stringify({ t: 'hello', token }));
    await bot.waitFor((m) => m.t === 'welcome', { what: 'a welcome into the world' });
    return bot;
  }

  /** Where the bot will be once the server applies the steps it has sent. */
  get at(): Point {
    let p: Point = { x: this.x, y: this.y };
    for (const input of this.pending) p = step(this.map, p, input.dx, input.dy);
    return p;
  }

  /** A mark in the log: `waitFor` with `since` only looks at messages after it. */
  mark(): number {
    return this.log.length;
  }

  send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  /**
   * The first message after `since` that matches, waiting up to `ms`.
   * Rejects (and notes a problem) when none comes.
   */
  async waitFor<T extends ServerMessage>(
    pred: (m: ServerMessage) => boolean,
    { since = 0, ms = 5000, what = 'a message' }: { since?: number; ms?: number; what?: string } = {},
  ): Promise<T> {
    const found = await this.until(() => this.log.slice(since).find(pred), ms);
    if (found) return found as T;
    const why = `${this.name} waited ${ms / 1000}s for ${what}, and it never came.`;
    this.problems.push(why);
    throw new Error(why);
  }

  /** Waits for the next snapshot (or a close); false when none came. */
  async tick(ms = 2000): Promise<boolean> {
    const since = this.mark();
    return Boolean(await this.until(() => this.closed !== null || this.log.slice(since).some((m) => m.t === 'snapshot'), ms));
  }

  /** Sends a message and waits for the answer it should bring. */
  async ask<T extends ServerMessage>(message: ClientMessage, pred: (m: ServerMessage) => boolean, what: string, ms = 5000): Promise<T> {
    const since = this.mark();
    this.send(message);
    return this.waitFor<T>(pred, { since, ms, what });
  }

  /** Waits until the server has applied every step sent, so it stands where the bot thinks it does. */
  async caughtUp(ms = 5000): Promise<boolean> {
    return Boolean(await this.until(() => this.pending.length === 0, ms));
  }

  /** Stands still for a moment, still listening. */
  async idle(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  // --- Walking ---------------------------------------------------------------

  /**
   * Walks to a spot, or to within `near` tiles of a moving one (a creature, a
   * person strolling). True on arrival; false, with a problem noted unless
   * `quiet`, when there is no way, it got stuck, or it left the region.
   */
  async walkTo(
    target: Point | (() => Point | undefined),
    { near = 0, ms = 180_000, what = 'a spot', quiet = false }: { near?: number; ms?: number; what?: string; quiet?: boolean } = {},
  ): Promise<boolean> {
    const fail = (why: string) => {
      if (!quiet) this.problems.push(`${this.name} could not walk to ${what} in ${this.region.def.name}: ${why}`);
      return false;
    };
    const goal = typeof target === 'function' ? target : () => target;
    const regionId = this.region.id;
    const route: Route = { target: goal, near, path: [], i: 0, plannedAt: 0 };
    if (!this.plan(route)) return fail(`no way there from (${fmt(this.at)}).`);
    const end = Date.now() + ms;
    let best = Infinity;
    let lastProgress = Date.now();
    let replans = 0;
    while (Date.now() < end) {
      if (!(await this.tick())) return fail('the server stopped sending snapshots.');
      if (this.closed) return fail(`the connection closed (${this.closed}).`);
      if (this.region.id !== regionId) return fail(`it found itself in ${this.region.def.name} instead.`);
      const to = goal();
      if (!to) return fail('it is gone.');
      const p = this.at;
      const d = Math.hypot(to.x - p.x, to.y - p.y);
      if ((near > 0 && d <= near) || (near === 0 && d <= WAYPOINT)) return true;
      if (d < best - 0.5) {
        best = d;
        lastProgress = Date.now();
      }
      // A moving target: plan again now and then; stuck: plan again from here.
      const stuck = Date.now() - lastProgress > 4000;
      if (stuck || (typeof target === 'function' && Date.now() - route.plannedAt > 1000)) {
        if (stuck && ++replans > 3) return fail(`stuck at (${fmt(p)}), ${d.toFixed(1)} tiles away.`);
        if (stuck) lastProgress = Date.now();
        if (!this.plan(route)) return fail(`no way there from (${fmt(p)}).`);
      }
      this.stepAlong(route);
    }
    return fail(`it took longer than ${ms / 1000}s.`);
  }

  /** Walks off the region's edge on `side` and waits to arrive in the region beyond. */
  async cross(side: Side): Promise<boolean> {
    const entry = this.map.entries[side];
    const from = this.region;
    if (!entry) {
      this.problems.push(`${from.def.name} has no road ${side}.`);
      return false;
    }
    if (!(await this.walkTo(entry, { what: `the road ${side}` }))) return false;
    const push = SIDE_STEP[side];
    const end = Date.now() + 10_000;
    while (Date.now() < end && this.region.id === from.id && !this.closed) {
      await this.tick();
      if (this.pending.length < MAX_PENDING) this.input(push.x, push.y);
    }
    if (this.region.id === from.id) {
      this.problems.push(`${this.name} walked off ${from.def.name}'s ${side} edge at (${fmt(this.at)}) but stayed in ${from.def.name}.`);
      return false;
    }
    const expected = from.def.exits[side];
    if (expected && this.region.id !== expected) {
      this.problems.push(`Walking ${side} from ${from.def.name} led to ${this.region.def.name}, not ${regionDef(expected)?.name ?? expected}.`);
    }
    if (collides(this.map, this.x, this.y)) this.problems.push(`${this.name} arrived in ${this.region.def.name} inside something solid at (${fmt(this)}).`);
    return true;
  }

  /** Walks region to region until it stands in `regionId`. */
  async travelTo(regionId: string): Promise<boolean> {
    for (let hops = 0; hops < 20 && this.region.id !== regionId; hops++) {
      const side = this.nextSide(regionId);
      if (!side) {
        this.problems.push(`${this.name} found no road from ${this.region.def.name} to ${regionDef(regionId)?.name ?? regionId}.`);
        return false;
      }
      if (!(await this.cross(side))) return false;
    }
    return this.region.id === regionId;
  }

  // --- Fighting and loot -----------------------------------------------------

  /**
   * Fights the nearest creature that `pick` likes until it is defeated,
   * drinking a Tonic when hurt. Says how it ended.
   */
  async fight(pick: (c: CreatureState) => boolean = () => true, ms = 90_000): Promise<FightResult> {
    const target = this.nearest(this.snapshot?.creatures.filter(pick) ?? []);
    if (!target) return { result: 'none' };
    const id = target.id;
    let last: Point = { x: target.x, y: target.y };
    const regionId = this.region.id;
    const since = this.mark();
    const route: Route = { target: () => last, near: attackReach(this.character) * 0.8, path: [], i: 0, plannedAt: 0 };
    this.plan(route);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await this.tick();
      if (this.closed || this.region.id !== regionId) return { result: 'fell' };
      const won = this.log.slice(since).find((m) => m.t === 'hit' && m.by === this.you.id && m.target === id && m.defeated);
      if (won) return { result: 'defeated', id, kind: target.kind, at: last };
      const now = this.snapshot?.creatures.find((c) => c.id === id);
      if (now) last = { x: now.x, y: now.y };
      else if (this.log.slice(since).some((m) => m.t === 'hit' && m.target === id && m.defeated)) return { result: 'none' };
      if (this.snapshot && this.snapshot.hp < maxHp(this.character) * 0.4 && itemCount(this.character, 'tonic') > 0) this.send({ t: 'use', item: 'tonic' });
      const p = this.at;
      if (Math.hypot(last.x - p.x, last.y - p.y) <= attackReach(this.character) * 0.9) {
        if (Date.now() - this.lastAttack >= attackCooldown(this.character) * 1000 + 30) {
          this.lastAttack = Date.now();
          this.send({ t: 'attack' });
        }
        continue;
      }
      if (Date.now() - route.plannedAt > 500) this.plan(route);
      this.stepAlong(route);
    }
    return { result: 'timeout', id };
  }

  /**
   * Finds a creature of this kind (walking toward where they live when none
   * is in sight) and fights it.
   */
  async hunt(kind: string, ms = 120_000): Promise<FightResult> {
    const end = Date.now() + ms;
    const homes = [...this.map.creatures.filter((c) => c.kind === kind)];
    while (Date.now() < end) {
      if (this.snapshot?.creatures.some((c) => c.kind === kind)) return this.fight((c) => c.kind === kind, end - Date.now());
      const home = this.nearest(homes);
      if (!home) break;
      homes.splice(homes.indexOf(home), 1);
      await this.walkTo(home, { near: 6, quiet: true, ms: Math.max(1000, end - Date.now()) });
      if (!homes.length) homes.push(...this.map.creatures.filter((c) => c.kind === kind));
    }
    this.problems.push(`${this.name} looked all over ${this.region.def.name} and found no ${kind} to fight.`);
    return { result: 'none' };
  }

  /**
   * Searches the nearest body that still holds something and takes it all.
   * Returns what the window showed, or null (with a problem noted) when it failed.
   */
  async lootNearest(): Promise<LootView | null> {
    const body = this.nearest((this.snapshot?.bodies ?? []).filter((b) => b.loot));
    if (!body) return null;
    if (!(await this.walkTo({ x: body.x, y: body.y }, { near: SEARCH_RANGE * 0.6, what: `the ${body.name}'s body` }))) return null;
    await this.settle();
    const opened = await this.ask<{ t: 'loot'; loot: LootView | null }>({ t: 'interact' }, (m) => m.t === 'loot' && m.loot?.id === body.id, `the ${body.name}'s loot window`).catch(() => null);
    if (!opened?.loot) return null;
    const before = structuredClone(this.character);
    const since = this.mark();
    this.send({ t: 'loot', action: 'all', body: body.id });
    await this.waitFor((m) => m.t === 'loot' && m.loot === null, { since, what: 'the loot window to close once empty' }).catch(() => undefined);
    await this.waitFor((m) => m.t === 'character', { since, what: 'the bag to change after taking loot' }).catch(() => undefined);
    for (const slot of opened.loot.items) {
      if (itemCount(this.character, slot.item) < itemCount(before, slot.item) + slot.qty) {
        this.problems.push(`${this.name} took ${slot.qty} × ${slot.item} from the ${body.name}, but the bag did not get it.`);
      }
    }
    await this.tick();
    await this.tick();
    const after = this.snapshot?.bodies.find((b: BodyState) => b.id === body.id);
    if (after?.loot) this.problems.push(`The ${body.name}'s body still shows loot after everything was taken.`);
    return opened.loot;
  }

  // --- People and the God ----------------------------------------------------

  /** Walks up to a person of the town and presses E. */
  async talkTo(npcId: string): Promise<DialogueMessage | null> {
    const where = () => {
      const seen = this.snapshot?.npcs.find((n) => n.id === npcId);
      const placed = this.map.npcs.find((n) => n.id === npcId);
      return seen ? { x: seen.x, y: seen.y } : placed;
    };
    if (!where()) {
      this.problems.push(`${this.name} looked for ${npcId} in ${this.region.def.name}, but nobody by that name is there.`);
      return null;
    }
    if (!(await this.walkTo(where, { near: TALK_RANGE * 0.6, what: npcId }))) return null;
    await this.settle();
    return this.ask<DialogueMessage>({ t: 'interact' }, (m) => m.t === 'dialogue' && m.npc.id === npcId, `${npcId} to answer`).catch(() => null);
  }

  /** Says something to the God and waits for the answer. */
  async pray(text: string): Promise<GodMessage> {
    for (let tries = 0; ; tries++) {
      const answer = await this.ask<GodMessage>({ t: 'pray', text }, (m) => m.t === 'god', `the God to answer "${text}"`, 15_000);
      // The God hears only so many prayers a minute; a player would wait and ask again.
      if (!/^Breathe, child/.test(answer.say) || tries >= 8) return answer;
      await this.idle(10_000);
    }
  }

  /**
   * Asks the God for a wish and takes the card it offers. Returns the card and
   * what the God said after, or null (with a problem noted) when no card came.
   */
  async wish(text: string): Promise<{ card: WishCard; after: GodMessage } | null> {
    const answer = await this.pray(text).catch(() => null);
    if (!answer) return null;
    if (!answer.card) {
      this.problems.push(`The God offered no wish card for "${text}" and said: ${answer.say}`);
      return null;
    }
    const after = await this.ask<GodMessage>({ t: 'wish', card: answer.card.id, confirm: true }, (m) => m.t === 'god', `the God to grant "${text}"`, 15_000).catch(() => null);
    return after ? { card: answer.card, after } : null;
  }

  /** Disconnects. */
  close(): void {
    this.socket.close();
  }

  // --- Inside ----------------------------------------------------------------

  private receive(m: ServerMessage): void {
    this.log.push(m);
    switch (m.t) {
      case 'welcome':
        this.you = m.you;
        this.region = m.region;
        this.map = generateRegion(m.region.def);
        this.character = m.character;
        this.x = m.x;
        this.y = m.y;
        this.pending = this.pending.filter((p) => p.seq > m.ack);
        this.regions.set(m.region.id, m.region.def);
        for (const n of m.neighbours) this.regions.set(n.id, n);
        if (collides(this.map, m.x, m.y)) this.problems.push(`${this.name} was welcomed into ${m.region.def.name} inside something solid at (${fmt(m)}).`);
        break;
      case 'snapshot':
        this.snapshot = m;
        this.x = m.x;
        this.y = m.y;
        this.pending = this.pending.filter((p) => p.seq > m.ack);
        if (m.hp > maxHp(this.character) + 0.001 || m.hp < 0) this.problems.push(`${this.name}'s health read ${m.hp}, outside 0 to ${maxHp(this.character)}.`);
        break;
      case 'character':
        this.character = m.character;
        break;
      case 'error':
        this.problems.push(`The server sent ${this.name} an error: ${m.message} (${m.code})`);
        break;
    }
    this.wake();
  }

  private wake(): void {
    for (const w of [...this.waiters]) w();
  }

  /** Resolves with `check()`'s first truthy answer, re-checked on every message, or undefined after `ms`. */
  private until<T>(check: () => T | undefined | false, ms: number): Promise<T | undefined> {
    return new Promise((resolve) => {
      const done = (value: T | undefined) => {
        clearTimeout(timer);
        this.waiters.delete(poll);
        resolve(value);
      };
      const poll = () => {
        const value = check();
        if (value) done(value);
      };
      const timer = setTimeout(() => done(undefined), ms);
      this.waiters.add(poll);
      poll();
    });
  }

  private input(dx: number, dy: number): void {
    const seq = ++this.seq;
    this.pending.push({ seq, dx, dy });
    this.send({ t: 'input', seq, dx, dy });
  }

  /** Waits until the server has applied every step sent, so positions agree. */
  private async settle(): Promise<void> {
    for (let i = 0; i < 20 && this.pending.length; i++) await this.tick();
  }

  private plan(route: Route): boolean {
    const to = route.target();
    route.plannedAt = Date.now();
    if (!to) return false;
    const path = findPath(this.map, this.at, to, route.near);
    if (!path) return false;
    route.path = path;
    route.i = 0;
    return true;
  }

  /** Sends one step toward the route's next waypoint. */
  private stepAlong(route: Route): void {
    if (this.pending.length >= MAX_PENDING) return;
    const p = this.at;
    while (route.i < route.path.length && Math.hypot(route.path[route.i]!.x - p.x, route.path[route.i]!.y - p.y) < WAYPOINT) route.i++;
    const wp = route.path[route.i] ?? route.target();
    if (!wp) return;
    const dx = Math.abs(wp.x - p.x) > 0.1 ? Math.sign(wp.x - p.x) : 0;
    const dy = Math.abs(wp.y - p.y) > 0.1 ? Math.sign(wp.y - p.y) : 0;
    if (dx || dy) this.input(dx, dy);
  }

  /** The side to leave by, on the shortest road to `regionId`. */
  private nextSide(regionId: string): Side | undefined {
    const def = (id: string) => this.regions.get(id) ?? regionDef(id);
    const first = new Map<string, Side>();
    const queue = [this.region.id];
    const seen = new Set(queue);
    while (queue.length) {
      const id = queue.shift()!;
      if (id === regionId) return first.get(id);
      for (const [side, next] of Object.entries(def(id)?.exits ?? {}) as [Side, string][]) {
        if (seen.has(next)) continue;
        seen.add(next);
        first.set(next, first.get(id) ?? side);
        queue.push(next);
      }
    }
    return undefined;
  }

  private nearest<T extends Point>(things: T[]): T | undefined {
    const p = this.at;
    return things.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  }
}

function fmt(p: Point): string {
  return `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`;
}
