// Scripted rules: the second layer of "How wishes become mechanics" in the
// design doc. A rule is a small event script ("when someone presses E beside
// water holding a rod, wait, then give them a fish") that runs in a QuickJS
// sandbox: no network, no files, no timers of its own, a memory cap, a time
// cap per event, and a narrow API of building-block effects with balance
// limits. A rule that keeps failing or hits its limits is paused on its own.

import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, type QuickJSWASMModule } from 'quickjs-emscripten';
import { ITEMS, addItem, dayPart, discover, gameHour, itemCount, maxHp, ruleItemId, takeItem, type DayPart, type RuleWish, type Weather } from '@co-mmo/shared';
import { TILE_NAMES } from './region.ts';
import type { World } from './world.ts';
import type { CharacterOp } from './character-ops.ts';

/** Events the engine sends to rules; scripts may also name their own, for timers. */
export const ENGINE_EVENTS = ['join', 'enter', 'use', 'interact', 'defeat'] as const;

export interface RuleEvent {
  type: string;
  player?: string;
  item?: string;
  tile?: string;
  creature?: string;
  region?: string;
  biome?: string;
  x?: number;
  y?: number;
  data?: unknown;
}

/** Sandbox limits. Generous for a fishing rule, tight for a runaway loop. */
export const LIMITS = {
  memoryBytes: 4 * 1024 * 1024,
  stackBytes: 256 * 1024,
  /** Time one event may take, in ms. */
  eventMs: 30,
  /** Time to load the script, in ms. */
  loadMs: 200,
  /** Effects one event may cause. */
  callsPerEvent: 60,
  timers: 200,
  minDelay: 0.5,
  maxDelay: 600,
  stateBytesPerPlayer: 2048,
  stateBytesShared: 8192,
  /** Balance caps per player, per rule, per hour. */
  perHour: { gold: 200, xp: 300, items: 60, messages: 120 },
  /** Most a single call may heal, hurt, pay or teach. */
  perCall: { heal: 50, hurt: 20, gold: 50, xp: 50, qty: 5 },
  /** Errors in a row (within a minute of each other) before the rule pauses. */
  errorsToPause: 5,
  /** Limit hits (time, memory, too many effects) before the rule pauses. */
  limitHitsToPause: 3,
};

/** What a script can touch in the world. One for the live world; the test run uses a fresh one. */
export interface RuleHost {
  name(player: string): string | null;
  where(player: string): { region: string; biome: string; x: number; y: number } | null;
  near(player: string, tile: string, radius: number): boolean;
  /** The hour and the weather where the player is. */
  sky(player: string): { time: DayPart; hour: number; weather: Weather } | null;
  count(player: string, item: string): number;
  give(player: string, item: string, qty: number): boolean;
  take(player: string, item: string, qty: number): boolean;
  heal(player: string, amount: number): boolean;
  hurt(player: string, amount: number): boolean;
  gold(player: string, amount: number): boolean;
  xp(player: string, amount: number): boolean;
  tell(player: string, text: string): boolean;
  announce(player: string, text: string): boolean;
}

/** Per-player and shared state a rule keeps between events. */
export interface RuleState {
  read(ruleId: string): Record<string, Record<string, unknown>>;
  write(ruleId: string, data: Record<string, Record<string, unknown>>): void;
}

export interface RuleStatus {
  paused: boolean;
  reason?: string;
  runs: number;
  errors: { at: number; message: string }[];
  /** Effects caused so far, by kind. */
  effects: Record<string, number>;
}

export class RuleError extends Error {
  constructor(message: string, readonly limit = false) {
    super(message);
  }
}

let quickjs: Promise<QuickJSWASMModule> | null = null;
/** Loads the QuickJS engine once. */
export function loadSandbox(): Promise<QuickJSWASMModule> {
  quickjs ??= getQuickJS();
  return quickjs;
}

// Runs inside the sandbox before the rule's script. `__host` is the only way
// out, and it is removed from the global scope once captured here.
const PRELUDE = `
'use strict';
(() => {
  const host = __host;
  delete globalThis.__host;
  const call = (op, ...args) => {
    const r = host(op, JSON.stringify(args.map((a) => (a === undefined ? null : a))));
    return r === undefined ? undefined : JSON.parse(r);
  };
  const handlers = Object.create(null);
  globalThis.on = (event, fn) => {
    if (typeof event !== 'string' || typeof fn !== 'function') throw new TypeError('use on("event", (e) => { ... })');
    (handlers[event] = handlers[event] || []).push(fn);
    call('on', event);
  };
  const random = () => call('random');
  Math.random = random;
  Date.now = () => call('now');
  globalThis.game = Object.freeze({
    name: (p) => call('name', p),
    where: (p) => call('where', p),
    near: (p, tile, radius = 1.5) => call('near', p, tile, radius),
    sky: (p) => call('sky', p),
    has: (p, item) => call('has', p, item),
    give: (p, item, qty = 1) => call('give', p, item, qty),
    take: (p, item, qty = 1) => call('take', p, item, qty),
    heal: (p, n) => call('heal', p, n),
    hurt: (p, n) => call('hurt', p, n),
    gold: (p, n) => call('gold', p, n),
    xp: (p, n) => call('xp', p, n),
    tell: (p, text) => call('tell', p, String(text)),
    announce: (p, text) => call('announce', p, String(text)),
    after: (seconds, event, data) => call('after', seconds, event, data),
    get: (p, key) => call('get', p, key),
    set: (p, key, value) => call('set', p, key, value),
    random,
    now: () => call('now'),
    chance: (p) => random() < p,
    pick: (list) => {
      if (!Array.isArray(list) || !list.length) return undefined;
      const weighted = list.map((x) => (Array.isArray(x) ? x : [x, 1]));
      let r = random() * weighted.reduce((s, [, w]) => s + Math.max(0, Number(w) || 0), 0);
      for (const [v, w] of weighted) if ((r -= Math.max(0, Number(w) || 0)) < 0) return v;
      return weighted[weighted.length - 1][0];
    },
  });
  globalThis.__dispatch = (json) => {
    const e = JSON.parse(json);
    for (const fn of handlers[e.type] || []) fn(e);
  };
})();
`;

interface Timer {
  at: number;
  event: string;
  data: unknown;
}

export interface RuleRuntimeOptions {
  host: RuleHost;
  state: RuleState;
  now?: () => number;
  random?: () => number;
  /** Called once when the rule pauses itself. */
  onPause?: (reason: string) => void;
}

/** One loaded rule: its sandbox, timers, state and limits. */
export class RuleRuntime {
  readonly status: RuleStatus = { paused: false, runs: 0, errors: [], effects: {} };
  private runtime: QuickJSRuntime | null = null;
  private vm: QuickJSContext | null = null;
  private dispatchFn: QuickJSHandle | null = null;
  private readonly listening = new Set<string>();
  private timers: Timer[] = [];
  private calls = 0;
  private limitHits = 0;
  private hour = { start: 0, used: new Map<string, number>() };
  private readonly now: () => number;
  private readonly random: () => number;

  private constructor(readonly id: string, readonly def: RuleWish, private readonly options: RuleRuntimeOptions) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  /** Loads a rule's script into a fresh sandbox. Throws a RuleError the God can relay when it does not load. */
  static async load(id: string, def: RuleWish, options: RuleRuntimeOptions): Promise<RuleRuntime> {
    const rule = new RuleRuntime(id, def, options);
    const QuickJS = await loadSandbox();
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(LIMITS.memoryBytes);
    runtime.setMaxStackSize(LIMITS.stackBytes);
    const vm = runtime.newContext();
    rule.runtime = runtime;
    rule.vm = vm;
    const host = vm.newFunction('__host', (opHandle, argsHandle) => {
      try {
        const op = vm.getString(opHandle);
        const args = JSON.parse(vm.getString(argsHandle)) as unknown[];
        const result = rule.hostCall(op, args);
        return result === undefined ? vm.undefined : vm.newString(JSON.stringify(result));
      } catch (err) {
        if (err instanceof RuleError && err.limit) rule.pendingLimit = err;
        return { error: vm.newError((err as Error).message) };
      }
    });
    vm.setProp(vm.global, '__host', host);
    host.dispose();
    try {
      rule.run(() => vm.evalCode(PRELUDE, 'prelude.js'), LIMITS.loadMs);
      rule.dispatchFn = vm.getProp(vm.global, '__dispatch');
      rule.run(() => vm.evalCode(def.script ?? '', 'rule.js'), LIMITS.loadMs);
    } catch (err) {
      rule.dispose();
      throw err;
    }
    return rule;
  }

  /** Events this rule has handlers for. */
  get events(): string[] {
    return [...this.listening];
  }

  listens(event: string): boolean {
    return this.listening.has(event);
  }

  /** Runs the rule's handlers for an event. Errors are recorded, never thrown. */
  dispatch(event: RuleEvent): void {
    if (this.status.paused || !this.vm || !this.dispatchFn || !this.listening.has(event.type)) return;
    const vm = this.vm;
    const fn = this.dispatchFn;
    this.status.runs++;
    try {
      const arg = vm.newString(JSON.stringify(event));
      try {
        this.run(() => vm.callFunction(fn, vm.undefined, arg), LIMITS.eventMs);
      } finally {
        arg.dispose();
      }
    } catch (err) {
      this.fail(err as Error);
    }
  }

  /** Fires timers that are due. */
  tick(): void {
    if (this.status.paused || !this.timers.length) return;
    const now = this.now();
    const due = this.timers.filter((t) => t.at <= now);
    if (!due.length) return;
    this.timers = this.timers.filter((t) => t.at > now);
    for (const t of due) {
      const data = t.data as { player?: unknown } | null;
      const player = data && typeof data === 'object' && typeof data.player === 'string' ? data.player : undefined;
      this.dispatch({ ...this.context(player), type: t.event, data: t.data });
    }
  }

  get pendingTimers(): number {
    return this.timers.length;
  }

  /** Sends an engine event about a player, with who and where filled in. */
  fire(type: string, player: string, data: Record<string, string | number> = {}): void {
    if (!this.listening.has(type)) return;
    const event: RuleEvent = { ...this.context(player), ...data, type };
    // Scripts know their own items by key.
    const prefix = ruleItemId(this.id, '');
    if (typeof event.item === 'string' && event.item.startsWith(prefix)) event.item = event.item.slice(prefix.length);
    this.dispatch(event);
  }

  /** Who and where, added to every event about a player. */
  context(player?: string): Partial<RuleEvent> {
    if (!player) return {};
    const at = this.options.host.where(player);
    return at ? { player, region: at.region, biome: at.biome, x: at.x, y: at.y } : { player };
  }

  /** Stops the rule; `alert` is false when a Steward did it rather than the rule's own failures. */
  pause(reason: string, alert = true): void {
    if (this.status.paused) return;
    this.status.paused = true;
    this.status.reason = reason;
    this.timers = [];
    if (alert) this.options.onPause?.(reason);
  }

  resume(): void {
    this.status.paused = false;
    delete this.status.reason;
    this.status.errors = [];
    this.limitHits = 0;
  }

  dispose(): void {
    this.dispatchFn?.dispose();
    this.vm?.dispose();
    this.runtime?.dispose();
    this.dispatchFn = this.vm = this.runtime = null;
  }

  // --- Inside the sandbox ---------------------------------------------------

  private pendingLimit: RuleError | null = null;

  /** Evaluates under a deadline; throws a RuleError on any failure. */
  private run(body: () => { error?: QuickJSHandle; value?: QuickJSHandle }, ms: number): void {
    const vm = this.vm!;
    this.calls = 0;
    this.pendingLimit = null;
    this.runtime!.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + ms));
    let result: { error?: QuickJSHandle; value?: QuickJSHandle };
    try {
      result = body();
    } catch (err) {
      // The engine itself gave up (out of memory while marshalling).
      throw new RuleError(`The sandbox stopped: ${(err as Error).message}`, true);
    }
    if (result.error) {
      const dumped = vm.dump(result.error) as { name?: string; message?: string } | string;
      result.error.dispose();
      if (this.pendingLimit) throw this.pendingLimit;
      const message = typeof dumped === 'string' ? dumped : `${dumped?.name ?? 'Error'}: ${dumped?.message ?? 'unknown'}`;
      const limit = /interrupted|out of memory|stack overflow/i.test(message);
      throw new RuleError(limit ? `Hit a sandbox limit (${message})` : message, limit);
    }
    result.value?.dispose();
  }

  private fail(err: Error): void {
    const now = this.now();
    const limit = err instanceof RuleError && err.limit;
    this.status.errors = [...this.status.errors, { at: now, message: err.message.slice(0, 300) }].slice(-10);
    if (limit && ++this.limitHits >= LIMITS.limitHitsToPause) return this.pause(`It hit its limits ${this.limitHits} times: ${err.message}`);
    const recent = this.status.errors.filter((e) => now - e.at < 60_000);
    if (recent.length >= LIMITS.errorsToPause) this.pause(`${recent.length} errors in a minute; the last: ${err.message}`);
  }

  /** Every call from the script lands here, already parsed from JSON. */
  private hostCall(op: string, args: unknown[]): unknown {
    if (op === 'on') {
      const event = str(args[0], 32);
      if (!/^[a-z][\w-]*$/i.test(event)) throw new RuleError(`"${event}" is not a usable event name.`);
      this.listening.add(event);
      return undefined;
    }
    if (op === 'random') return this.random();
    if (op === 'now') return this.now();
    if (++this.calls > LIMITS.callsPerEvent) throw new RuleError(`More than ${LIMITS.callsPerEvent} actions in one event.`, true);
    const host = this.options.host;
    const p = args[0] === null ? null : str(args[0], 64);
    const player = () => {
      if (!p || host.name(p) === null) throw new RuleError('That player is not in the world.');
      return p;
    };
    switch (op) {
      case 'name':
        return p ? host.name(p) : null;
      case 'where':
        return p ? host.where(p) : null;
      case 'sky':
        return p ? host.sky(p) : null;
      case 'near': {
        const tile = str(args[1], 16);
        if (!(tile in TILE_NAMES)) throw new RuleError(`Unknown tile "${tile}"; use ${Object.keys(TILE_NAMES).join(', ')}.`);
        return host.near(player(), tile, clamp(num(args[2], 1.5), 0.5, 3));
      }
      case 'has':
        return host.count(player(), this.item(args[1]));
      case 'give': {
        const qty = int(args[2], 1, LIMITS.perCall.qty);
        const item = this.item(args[1]);
        if (!this.allow(player(), 'items', qty)) return false;
        this.effect('give', qty);
        return host.give(player(), item, qty);
      }
      case 'take':
        return host.take(player(), this.item(args[1]), int(args[2], 1, 99));
      case 'heal':
        this.effect('heal');
        return host.heal(player(), int(args[1], 1, LIMITS.perCall.heal));
      case 'hurt':
        this.effect('hurt');
        return host.hurt(player(), int(args[1], 1, LIMITS.perCall.hurt));
      case 'gold': {
        const n = Math.round(clamp(num(args[1], 0), -1000, LIMITS.perCall.gold));
        if (!n) return true;
        if (n > 0 && !this.allow(player(), 'gold', n)) return false;
        this.effect('gold', n);
        return host.gold(player(), n);
      }
      case 'xp': {
        const n = int(args[1], 1, LIMITS.perCall.xp);
        if (!this.allow(player(), 'xp', n)) return false;
        this.effect('xp', n);
        return host.xp(player(), n);
      }
      case 'tell':
      case 'announce': {
        const text = str(args[1], 200).replace(/\s+/g, ' ').trim();
        if (!text || !this.allow(player(), 'messages', op === 'announce' ? 5 : 1)) return false;
        this.effect(op);
        return op === 'tell' ? host.tell(player(), text) : host.announce(player(), text);
      }
      case 'after': {
        const seconds = clamp(num(args[0], 1), LIMITS.minDelay, LIMITS.maxDelay);
        const event = str(args[1], 32);
        if (!/^[a-z][\w-]*$/i.test(event)) throw new RuleError(`"${event}" is not a usable event name.`);
        if ((ENGINE_EVENTS as readonly string[]).includes(event)) throw new RuleError(`"${event}" belongs to the engine; name your own event.`);
        if (this.timers.length >= LIMITS.timers) throw new RuleError(`More than ${LIMITS.timers} timers waiting.`, true);
        const data = args[2] ?? null;
        if (JSON.stringify(data).length > 1024) throw new RuleError('Timer data is larger than 1 KB.');
        this.timers.push({ at: this.now() + seconds * 1000, event, data });
        return true;
      }
      case 'get': {
        const scope = this.options.state.read(this.id)[p ?? '_'] ?? {};
        return scope[str(args[1], 40)] ?? null;
      }
      case 'set': {
        const key = str(args[1], 40);
        if (!key) throw new RuleError('State needs a key.');
        const all = this.options.state.read(this.id);
        const scope = { ...(all[p ?? '_'] ?? {}) };
        if (args[2] === null) delete scope[key];
        else scope[key] = args[2];
        const max = p ? LIMITS.stateBytesPerPlayer : LIMITS.stateBytesShared;
        if (JSON.stringify(scope).length > max) throw new RuleError(`State for ${p ? 'a player' : 'the world'} is larger than ${max} bytes.`);
        this.options.state.write(this.id, { ...all, [p ?? '_']: scope });
        return true;
      }
    }
    throw new RuleError(`game has no "${op}".`);
  }

  /** A rule's own item key, or any existing item that can be traded. */
  private item(raw: unknown): string {
    const key = str(raw, 64);
    if (this.def.items[key]) return ruleItemId(this.id, key);
    const def = ITEMS[key];
    if (def && !def.bound) return key;
    throw new RuleError(`Unknown item "${key}". This rule's items: ${Object.keys(this.def.items).join(', ') || 'none'}.`);
  }

  /** Balance caps per player per hour; false (and a quiet no) when spent. */
  private allow(player: string, kind: keyof typeof LIMITS.perHour, amount: number): boolean {
    const now = this.now();
    if (now - this.hour.start >= 3_600_000) this.hour = { start: now, used: new Map() };
    const key = `${player}:${kind}`;
    const used = this.hour.used.get(key) ?? 0;
    if (used + amount > LIMITS.perHour[kind]) {
      this.effect(`capped-${kind}`);
      return false;
    }
    this.hour.used.set(key, used + amount);
    return true;
  }

  private effect(kind: string, n = 1): void {
    this.status.effects[kind] = (this.status.effects[kind] ?? 0) + n;
  }
}

/**
 * The live world as rules see it. Reads come from the player's region (or,
 * on a region server, what it last sent); changes go to wherever the player is.
 */
export function worldHost(world: World): RuleHost {
  const at = (player: string) => world.regionOf(player);
  const change = (player: string, op: CharacterOp): boolean => {
    if (!at(player)) return false;
    void world.change(player, op);
    return true;
  };
  return {
    name: (p) => at(p)?.nameOf(p) ?? null,
    where: (p) => {
      const region = at(p);
      const pos = region?.position(p);
      if (!region || !pos) return null;
      return { region: region.def.id, biome: region.def.biome, x: Math.round(pos.x * 10) / 10, y: Math.round(pos.y * 10) / 10 };
    },
    near: (p, tile, radius) => at(p)?.nearTile(p, TILE_NAMES[tile]!, radius) ?? false,
    sky: (p) => {
      const region = at(p);
      if (!region) return null;
      const { phase, weather } = world.skyOver(region.def);
      return { time: dayPart(phase), hour: Math.floor(gameHour(phase)), weather };
    },
    count: (p, item) => {
      const c = at(p)?.character(p);
      return c ? itemCount(c, item) : 0;
    },
    give: (p, item, qty) => change(p, { op: 'give', item, qty, discover: true }),
    take: (p, item, qty) => {
      const c = at(p)?.character(p);
      if (!c || itemCount(c, item) < qty) return false;
      return change(p, { op: 'take', item, qty });
    },
    heal: (p, n) => change(p, { op: 'heal', amount: n }),
    hurt: (p, n) => change(p, { op: 'hurt', amount: n }),
    gold: (p, n) => {
      const c = at(p)?.character(p);
      if (!c || c.gold + n < 0) return false;
      return change(p, { op: 'gold', amount: n });
    },
    xp: (p, n) => change(p, { op: 'xp', amount: n }),
    tell: (p, text) => {
      const region = at(p);
      region?.tell(p, text);
      return Boolean(region);
    },
    announce: (p, text) => {
      const region = at(p);
      region?.announce(text);
      return Boolean(region);
    },
  };
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '';
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function int(v: unknown, lo: number, hi: number): number {
  return Math.round(clamp(num(v, lo), lo, hi));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
