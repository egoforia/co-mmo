import type { Redis } from 'ioredis';

// Messages between the game server (the gateway players connect to) and the
// region servers that run parts of the world (design doc, Scaling without a
// cap). Redis carries them between machines; in tests, and for regions the
// gateway runs itself, they never leave the process.

/** One channel's handler. Messages arrive in the order they were sent on that channel. */
export type BusHandler = (message: unknown) => void;

/** Publish and subscribe by channel name. */
export interface Bus {
  publish(channel: string, message: unknown): void;
  /** Starts delivering a channel's messages; returns how to stop. */
  subscribe(channel: string, handler: BusHandler): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

/** A bus inside one process: several servers in one test, delivered a moment later, as Redis would. */
export class MemoryBus implements Bus {
  private readonly channels = new Map<string, Set<BusHandler>>();
  /** Messages not yet delivered, in order, so each channel stays in order. */
  private readonly pending: { channel: string; text: string }[] = [];
  private scheduled = false;
  /** Set to drop every message, as when the network between servers fails. */
  down = false;

  publish(channel: string, message: unknown): void {
    if (this.down) return;
    // Sent as text, as over Redis: nothing shared by reference between servers.
    this.pending.push({ channel, text: JSON.stringify(message) });
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => this.deliver());
  }

  private deliver(): void {
    this.scheduled = false;
    for (const { channel, text } of this.pending.splice(0)) {
      for (const handler of [...(this.channels.get(channel) ?? [])]) handler(JSON.parse(text));
    }
  }

  async subscribe(channel: string, handler: BusHandler): Promise<() => Promise<void>> {
    let set = this.channels.get(channel);
    if (!set) this.channels.set(channel, (set = new Set()));
    set.add(handler);
    return async () => {
      set.delete(handler);
    };
  }

  async close(): Promise<void> {
    this.channels.clear();
  }
}

/** The bus over Redis pub/sub: one connection publishes, another listens. Keys start with `prefix`. */
export class RedisBus implements Bus {
  private readonly listener: Redis;
  private readonly handlers = new Map<string, Set<BusHandler>>();

  constructor(private readonly redis: Redis, private readonly prefix = 'co-mmo:bus:') {
    this.listener = redis.duplicate();
    this.listener.on('error', () => {});
    this.listener.on('message', (channel: string, text: string) => {
      const handlers = this.handlers.get(channel);
      if (!handlers) return;
      let message: unknown;
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      for (const handler of [...handlers]) handler(message);
    });
  }

  publish(channel: string, message: unknown): void {
    void this.redis.publish(this.prefix + channel, JSON.stringify(message)).catch(() => {});
  }

  async subscribe(channel: string, handler: BusHandler): Promise<() => Promise<void>> {
    const name = this.prefix + channel;
    let set = this.handlers.get(name);
    if (!set) {
      this.handlers.set(name, (set = new Set()));
      await this.listener.subscribe(name);
    }
    set.add(handler);
    return async () => {
      set.delete(handler);
      if (!set.size) {
        this.handlers.delete(name);
        await this.listener.unsubscribe(name).catch(() => {});
      }
    };
  }

  async close(): Promise<void> {
    this.listener.disconnect();
  }
}

/**
 * Asking another server and waiting for its answer: requests carry an id,
 * answers come back on the asker's own channel.
 */
export class Requests {
  private next = 1;
  private readonly waiting = new Map<number, { done: (value: unknown) => void; fail: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly bus: Bus, private readonly replyTo: string, private readonly timeoutMs = 5000) {}

  /** Sends `message` (given a request id and where to answer) to `channel`, and waits for the answer. */
  ask<T>(channel: string, message: Record<string, unknown>): Promise<T> {
    const id = this.next++;
    return new Promise<T>((done, fail) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        fail(new Error(`No answer from ${channel} to ${String(message.t)}.`));
      }, this.timeoutMs);
      timer.unref?.();
      this.waiting.set(id, { done: done as (value: unknown) => void, fail, timer });
      this.bus.publish(channel, { ...message, ask: id, replyTo: this.replyTo });
    });
  }

  /** Hands an answer to whoever asked; false when the message is not an answer. */
  answered(message: { t?: string; ask?: number; value?: unknown; error?: string }): boolean {
    if (message.t !== 'answer' || typeof message.ask !== 'number') return false;
    const waiting = this.waiting.get(message.ask);
    if (!waiting) return true;
    this.waiting.delete(message.ask);
    clearTimeout(waiting.timer);
    if (message.error) waiting.fail(new Error(message.error));
    else waiting.done(message.value);
    return true;
  }

  /** Refuses everything still waiting (shutting down, or the other side is gone). */
  failAll(why: string): void {
    for (const [id, w] of this.waiting) {
      clearTimeout(w.timer);
      w.fail(new Error(why));
      this.waiting.delete(id);
    }
  }
}

/** Answers a request on the bus. */
export function answer(bus: Bus, request: { ask?: number; replyTo?: string }, value: unknown, error?: string): void {
  if (request.ask === undefined || !request.replyTo) return;
  bus.publish(request.replyTo, { t: 'answer', ask: request.ask, ...(error ? { error } : { value }) });
}
