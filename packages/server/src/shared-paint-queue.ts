import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { BACKOFF_MS, PaintStopped, afterRefusal, clock, limitFor, waitLine, type PaintQueue, type PaintTurnWatcher, type RateLimit } from './paint-queue.ts';

// The paint queue kept in Redis (design doc, Technical architecture: Redis
// for what servers share). Every server painting with the same key takes its
// turns from one ledger, and a model Google stopped for the day stays stopped
// across restarts, until Google's reset, instead of being asked again (and
// refused) by the first painting after a restart.

/** What a model's ledger says when asked for a turn. */
export type Claim =
  | { ok: true }
  /** Not yet: ask again in `waitMs`. `until` is set while the model is paused after a refusal. */
  | { ok: false; waitMs: number; pause?: Pause };

/** A model held back after Google refused it: until when, why (once stopped), and what Google said. */
export interface Pause {
  until: number;
  closed?: string;
  said?: string;
}

/** Where turns are counted: Redis when servers share it, or memory for one server and tests. */
export interface TurnLedger {
  /** Takes a turn under `lease` if the model's limit and pause allow it. */
  claim(model: string, limit: RateLimit, lease: string, leaseMs: number, now: number): Promise<Claim>;
  /** Keeps a long request's turn (a video clip can take minutes); a server that died lets its turns lapse. */
  renew(model: string, lease: string, leaseMs: number, now: number): Promise<void>;
  release(model: string, lease: string): Promise<void>;
  /** Holds the model back until `pause.until`, for every server and across restarts. */
  pause(model: string, pause: Pause, now: number): Promise<void>;
  /** The model's pause, if one is in force. */
  paused(model: string, now: number): Promise<Pause | undefined>;
  close(): Promise<void>;
}

/** A turn is kept this long without being renewed. */
const LEASE_MS = 60_000;
/** How often a busy model is asked again for a free turn. */
const BUSY_POLL_MS = 1000;

/**
 * The paint queue for servers that share a ledger. Requests on this server
 * wait in line, first come first served; the one at the front asks the
 * ledger for a turn and waits as long as it says.
 */
export class SharedPaintQueue implements PaintQueue {
  private readonly lines = new Map<string, Line>();
  private readonly limit: (model: string) => RateLimit | undefined;
  private readonly now: () => number;
  private readonly backoff: number[];
  private stopped = false;

  constructor(private readonly ledger: TurnLedger, options: { limit?: (model: string) => RateLimit | undefined; now?: () => number; backoffMs?: number[] } = {}) {
    this.limit = options.limit ?? limitFor;
    this.now = options.now ?? Date.now;
    this.backoff = options.backoffMs ?? BACKOFF_MS;
  }

  async turn<T>(model: string, call: () => Promise<T>, watcher?: PaintTurnWatcher): Promise<T> {
    if (!this.limit(model)) return call();
    for (let attempt = 0; ; attempt++) {
      const lease = await this.take(model, watcher);
      const renew = setInterval(() => void this.ledger.renew(model, lease, LEASE_MS, this.now()).catch(() => {}), LEASE_MS / 3);
      renew.unref?.();
      try {
        return await call();
      } catch (err) {
        const next = afterRefusal(model, err, attempt, this.backoff, this.now());
        if (!next) throw err;
        if (next.stop) {
          await this.ledger.pause(model, { until: next.until, closed: next.closed, said: next.said }, this.now());
          throw new PaintStopped(next.closed);
        }
        const current = await this.ledger.paused(model, this.now());
        await this.ledger.pause(model, { until: Math.max(current?.until ?? 0, next.until), said: next.said }, this.now());
        watcher?.wait(waitLine(next.said, next.until - this.now()));
      } finally {
        clearInterval(renew);
        await this.ledger.release(model, lease).catch(() => {});
        this.pump(model);
      }
    }
  }

  close(): void {
    this.stopped = true;
    for (const model of this.lines.keys()) this.pump(model);
  }

  private line(model: string): Line {
    let line = this.lines.get(model);
    if (!line) this.lines.set(model, (line = { waiting: [], asking: false }));
    return line;
  }

  /** Waits in line for a turn, and returns its lease. */
  private take(model: string, watcher?: PaintTurnWatcher): Promise<string> {
    return new Promise<string>((go, refuse) => {
      this.line(model).waiting.push({ go, refuse, watcher });
      this.pump(model);
    });
  }

  /** Asks the ledger for a turn for whoever is at the front, unless someone is already asking. */
  private pump(model: string): void {
    const line = this.line(model);
    clearTimeout(line.timer);
    line.timer = undefined;
    if (this.stopped) {
      for (const w of line.waiting.splice(0)) w.refuse(new PaintStopped('The server is shutting down; this is asked for again when it is back.'));
      return;
    }
    if (line.asking || !line.waiting.length) return;
    line.asking = true;
    const lease = randomBytes(8).toString('hex');
    void this.ledger.claim(model, this.limit(model)!, lease, LEASE_MS, this.now()).then((claim) => {
      line.asking = false;
      if (this.stopped) return this.pump(model);
      if (claim.ok) {
        const next = line.waiting.shift()!;
        next.watcher?.start();
        next.go(lease);
        return this.pump(model);
      }
      // A model stopped for the day refuses everyone in line at once.
      if (claim.pause?.closed) {
        for (const w of line.waiting.splice(0)) w.refuse(new PaintStopped(claim.pause.closed));
        return;
      }
      for (const [i, w] of line.waiting.entries()) w.watcher?.wait(this.why(model, i, claim.pause));
      line.timer = setTimeout(() => this.pump(model), Math.max(10, claim.waitMs));
      line.timer.unref?.();
    }, (err: Error) => {
      // Redis away: ask again shortly rather than lose the line.
      line.asking = false;
      console.error(`The paint queue could not reach Redis: ${err.message}`);
      line.timer = setTimeout(() => this.pump(model), 5000);
      line.timer.unref?.();
    });
  }

  private why(model: string, ahead: number, pause: Pause | undefined): string {
    const limit = this.limit(model)!;
    const more = ahead > 0 ? ` ${ahead} ahead of it.` : '';
    if (pause) return `Google asked us to slow down${pause.said ? ` ("${pause.said}")` : ''}; waiting until ${clock(pause.until)}.${more}`;
    return `${model} takes ${limit.perMinute} a minute, ${limit.atOnce} at a time.${more}`;
  }
}

interface Line {
  waiting: { go: (lease: string) => void; refuse: (err: Error) => void; watcher?: PaintTurnWatcher }[];
  /** A claim is on its way to the ledger. */
  asking: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/** The ledger in memory: one server's turns, for tests and as the shape Redis follows. */
export class MemoryTurnLedger implements TurnLedger {
  private readonly models = new Map<string, { started: Map<string, number>; leases: Map<string, number>; pause?: Pause }>();

  private of(model: string) {
    let m = this.models.get(model);
    if (!m) this.models.set(model, (m = { started: new Map(), leases: new Map() }));
    return m;
  }

  async claim(model: string, limit: RateLimit, lease: string, leaseMs: number, now: number): Promise<Claim> {
    const m = this.of(model);
    for (const [k, at] of m.started) if (at <= now - 60_000) m.started.delete(k);
    for (const [k, until] of m.leases) if (until <= now) m.leases.delete(k);
    const pause = await this.paused(model, now);
    if (pause) return { ok: false, waitMs: pause.until - now, pause };
    if (m.leases.size >= limit.atOnce) return { ok: false, waitMs: BUSY_POLL_MS };
    if (m.started.size >= limit.perMinute) return { ok: false, waitMs: Math.min(...m.started.values()) + 60_000 - now };
    m.started.set(lease, now);
    m.leases.set(lease, now + leaseMs);
    return { ok: true };
  }

  async renew(model: string, lease: string, leaseMs: number, now: number): Promise<void> {
    const m = this.of(model);
    if (m.leases.has(lease)) m.leases.set(lease, now + leaseMs);
  }

  async release(model: string, lease: string): Promise<void> {
    this.of(model).leases.delete(lease);
  }

  async pause(model: string, pause: Pause): Promise<void> {
    this.of(model).pause = pause;
  }

  async paused(model: string, now: number): Promise<Pause | undefined> {
    const m = this.of(model);
    if (m.pause && m.pause.until <= now) m.pause = undefined;
    return m.pause;
  }

  async close(): Promise<void> {}
}

/**
 * Takes a turn in one step on the Redis server, so two servers can never
 * both take the last one. KEYS: started (sorted by start time), leases
 * (sorted by expiry), pause. ARGV: now, per minute, at once, lease, lease ms.
 */
const CLAIM = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 60000)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local pause = redis.call('GET', KEYS[3])
if pause then return {'pause', pause} end
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then return {'busy', '${BUSY_POLL_MS}'} end
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {'wait', tostring(tonumber(oldest[2]) + 60000 - now)}
end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('ZADD', KEYS[2], now + tonumber(ARGV[5]), ARGV[4])
redis.call('PEXPIRE', KEYS[1], 120000)
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[5]) * 2)
return {'ok'}
`;

/** The ledger in Redis, shared by every server and kept across restarts. Keys start with `prefix`. */
export class RedisTurnLedger implements TurnLedger {
  constructor(private readonly redis: Redis, private readonly prefix = 'co-mmo:paint:') {}

  private key(model: string, part: 'started' | 'leases' | 'pause'): string {
    return `${this.prefix}${model}:${part}`;
  }

  async claim(model: string, limit: RateLimit, lease: string, leaseMs: number, now: number): Promise<Claim> {
    const [kind, value] = (await this.redis.eval(CLAIM, 3, this.key(model, 'started'), this.key(model, 'leases'), this.key(model, 'pause'), now, limit.perMinute, limit.atOnce, lease, leaseMs)) as [string, string?];
    if (kind === 'ok') return { ok: true };
    if (kind === 'pause') {
      const pause = JSON.parse(value!) as Pause;
      return { ok: false, waitMs: Math.max(10, pause.until - now), pause };
    }
    return { ok: false, waitMs: Number(value) };
  }

  async renew(model: string, lease: string, leaseMs: number, now: number): Promise<void> {
    await this.redis.zadd(this.key(model, 'leases'), 'XX', now + leaseMs, lease);
  }

  async release(model: string, lease: string): Promise<void> {
    await this.redis.zrem(this.key(model, 'leases'), lease);
  }

  async pause(model: string, pause: Pause, now: number): Promise<void> {
    const ms = Math.ceil(pause.until - now);
    if (ms > 0) await this.redis.set(this.key(model, 'pause'), JSON.stringify(pause), 'PX', ms);
  }

  async paused(model: string): Promise<Pause | undefined> {
    const raw = await this.redis.get(this.key(model, 'pause'));
    return raw ? (JSON.parse(raw) as Pause) : undefined;
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => {});
  }
}
