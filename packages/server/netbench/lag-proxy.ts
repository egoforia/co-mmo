// A pretend network for the network bench: a TCP proxy that sits between
// robot players and the game server and gives each connection the delay,
// wobble (jitter) and bandwidth of a real link, so smoothness can be measured
// on one machine. Bytes keep their order, as TCP keeps it: a late chunk holds
// back the ones behind it.

import { createServer, connect, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { MemoryBus, type Bus, type BusHandler } from '../src/bus.ts';

/** What a link between a player and the game server is like. */
export interface Link {
  /** Name shown in the report. */
  name: string;
  /** One-way delay each way, ms. */
  delayMs: number;
  /** Extra delay toward the player, from 0 up to this, ms, chosen anew for each chunk. */
  jitterMs: number;
  /** Bytes a second toward the player; unlimited when missing. A slower link queues, as a weak connection does. */
  bytesPerSecond?: number;
}

/** Bytes that went through the proxy toward the players, on the wire (after any compression). */
export interface ProxyCounts {
  down: number;
  up: number;
}

/** A running proxy: connect to `port` instead of the game server. */
export interface LagProxy {
  port: number;
  counts: ProxyCounts;
  close(): Promise<void>;
}

/** Starts a proxy on a random port that forwards to `target` over `link`. */
export async function lagProxy(target: number, link: Link, random: () => number = Math.random): Promise<LagProxy> {
  const counts: ProxyCounts = { down: 0, up: 0 };
  const open = new Set<Socket>();
  const server: Server = createServer((player) => {
    const game = connect(target, '127.0.0.1');
    player.setNoDelay(true);
    game.setNoDelay(true);
    open.add(player);
    open.add(game);
    pipe(game, player, link.delayMs, link.jitterMs, link.bytesPerSecond, random, (n) => (counts.down += n));
    pipe(player, game, link.delayMs, 0, undefined, random, (n) => (counts.up += n));
    const end = () => {
      player.destroy();
      game.destroy();
      open.delete(player);
      open.delete(game);
    };
    player.on('close', end).on('error', end);
    game.on('close', end).on('error', end);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    counts,
    async close() {
      for (const s of open) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Forwards `from` to `to`, each chunk late by the delay plus some jitter, never before the chunk ahead of it, and no faster than the bandwidth. */
function pipe(from: Socket, to: Socket, delayMs: number, jitterMs: number, bytesPerSecond: number | undefined, random: () => number, count: (n: number) => void): void {
  const line = new LateLine();
  // When the last chunk queued leaves; a slow link sends one after another, and its queue is the lag that builds up.
  let freeAt = 0;
  from.on('data', (chunk: Buffer) => {
    const now = performance.now();
    const sendTime = bytesPerSecond ? (chunk.length / bytesPerSecond) * 1000 : 0;
    freeAt = Math.max(now, freeAt) + sendTime;
    line.add(freeAt + delayMs + random() * jitterMs, () => {
      if (to.destroyed) return;
      count(chunk.length);
      to.write(chunk);
    });
  });
}

/** Things to do later, each at its time but never before the one added ahead of it: order is kept, as TCP keeps it. */
export class LateLine {
  private readonly queue: { at: number; run: () => void }[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private lastAt = 0;

  add(at: number, run: () => void): void {
    this.lastAt = Math.max(at, this.lastAt);
    this.queue.push({ at: this.lastAt, run });
    if (!this.timer) this.wait();
  }

  private wait(): void {
    const next = this.queue[0];
    if (!next) {
      this.timer = undefined;
      return;
    }
    this.timer = setTimeout(() => {
      const now = performance.now();
      while (this.queue.length && this.queue[0]!.at <= now + 1) this.queue.shift()!.run();
      this.wait();
    }, Math.max(0, next.at - performance.now()));
  }
}

/** A bus whose messages take `ms` to reach the other server, in order, as Redis between two machines would. */
export class SlowBus implements Bus {
  private readonly inner = new MemoryBus();
  private readonly line = new LateLine();
  /** Messages sent, for the bench. */
  sent = 0;
  constructor(private readonly ms: number) {}
  publish(channel: string, message: unknown): void {
    this.sent++;
    const text = JSON.stringify(message);
    this.line.add(performance.now() + this.ms, () => this.inner.publish(channel, JSON.parse(text)));
  }
  subscribe(channel: string, handler: BusHandler): Promise<() => Promise<void>> {
    return this.inner.subscribe(channel, handler);
  }
  close(): Promise<void> {
    return this.inner.close();
  }
}
