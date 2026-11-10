// A robot player for the network bench: it walks back and forth, and writes
// down what a player would feel: how evenly snapshots arrive, how long a step
// takes to be answered, and how smoothly the others walk on its screen, drawn
// exactly as the browser draws them (the shared smoothing in prediction.ts).

import { WebSocket } from 'ws';
import { PLAYER_SPEED, type ServerMessage, type SnapshotMessage } from '@co-mmo/shared';
import { RemoteMotion } from './remote-motion.ts';

/** The ways a bench robot walks: back and forth along one line. */
const LINES: [number, number][] = [[1, 0], [0, 1]];
/** How long a robot walks one way before turning back, ms. */
export const LEG_MS = 2000;
/** Frames this soon after another robot turned are left out: turning is meant to change speed. */
const SETTLE_MS = 900;
/** How often the robot looks at its screen, ms (a 60 Hz display). */
const FRAME_MS = 1000 / 60;

/** What one robot measured. */
export interface BotNumbers {
  snapshots: number;
  /** ms between snapshots arriving. */
  gaps: number[];
  /** ms from sending a step until a snapshot said the server took it. */
  answered: number[];
  /** Others' speed on screen, tiles a second, one per frame while they walk straight. */
  speeds: number[];
  /** Characters of JSON received (before any compression). */
  chars: number;
}

/** A bench robot: a socket, its walk and its measurements. */
export class BenchBot {
  readonly numbers: BotNumbers = { snapshots: 0, gaps: [], answered: [], speeds: [], chars: 0 };
  id = '';
  private seq = 0;
  private sent = new Map<number, number>();
  private lastArrival = 0;
  private walkTimer?: ReturnType<typeof setInterval>;
  private frameTimer?: ReturnType<typeof setInterval>;
  private measuring = false;
  private readonly motion = new RemoteMotion();
  private readonly seenAt = new Map<string, { x: number; y: number; at: number }>();

  private constructor(private readonly socket: WebSocket, private readonly index: number, private readonly watching: boolean, private readonly turns: (id: string) => number) {}

  /**
   * Connects through `url` and waits for the welcome. `watching` robots also
   * draw the others each frame and measure their smoothness; `turns` says when
   * a robot last turned, so turning is not counted as stutter.
   */
  static async join(url: string, token: string, index: number, watching: boolean, turns: (id: string) => number): Promise<BenchBot> {
    const socket = new WebSocket(url);
    const bot = new BenchBot(socket, index, watching, turns);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No welcome in 20 s.')), 20_000);
      socket.on('open', () => socket.send(JSON.stringify({ t: 'hello', token })));
      socket.on('error', reject);
      socket.on('message', (raw) => {
        const text = raw.toString();
        const message = JSON.parse(text) as ServerMessage;
        if (message.t === 'welcome') {
          bot.id = message.you.id;
          clearTimeout(timer);
          resolve();
        }
        bot.received(message, text.length);
      });
    });
    return bot;
  }

  /** Starts walking and measuring; `startedAt` lines the legs up so turns are known. */
  start(startedAt: number, onTurn: (id: string, at: number) => void): void {
    this.measuring = true;
    const [lx, ly] = LINES[this.index % LINES.length]!;
    let leg = -1;
    this.walkTimer = setInterval(() => {
      const now = performance.now();
      const thisLeg = Math.floor((now - startedAt) / LEG_MS);
      if (thisLeg !== leg) {
        leg = thisLeg;
        onTurn(this.id, now);
      }
      const sign = leg % 2 === 0 ? 1 : -1;
      const seq = ++this.seq;
      this.sent.set(seq, now);
      this.send({ t: 'input', seq, dx: lx * sign, dy: ly * sign });
    }, 50);
    if (this.watching) this.frameTimer = setInterval(() => this.frame(), FRAME_MS);
  }

  /** Stops walking and measuring. */
  stop(): void {
    this.measuring = false;
    clearInterval(this.walkTimer);
    clearInterval(this.frameTimer);
  }

  close(): void {
    this.stop();
    this.socket.close();
  }

  private send(message: unknown): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private received(message: ServerMessage, chars: number): void {
    if (!this.measuring) return;
    this.numbers.chars += chars;
    if (message.t !== 'snapshot') return;
    const now = performance.now();
    this.numbers.snapshots++;
    if (this.lastArrival) this.numbers.gaps.push(now - this.lastArrival);
    this.lastArrival = now;
    for (const [seq, at] of this.sent) {
      if (seq > message.ack) break;
      this.numbers.answered.push(now - at);
      this.sent.delete(seq);
    }
    if (this.watching) this.motion.snapshot(message as SnapshotMessage, now);
  }

  /** One frame on the robot's screen: where each other player is drawn, and how fast they moved since the last frame. */
  private frame(): void {
    const now = performance.now();
    for (const [id, pos] of this.motion.positions(now)) {
      const before = this.seenAt.get(id);
      this.seenAt.set(id, { ...pos, at: now });
      if (!before) continue;
      if (now - this.turns(id) < SETTLE_MS) continue;
      const dt = (now - before.at) / 1000;
      if (dt <= 0) continue;
      this.numbers.speeds.push(Math.hypot(pos.x - before.x, pos.y - before.y) / dt);
    }
  }
}

/** How unevenly others walked on screen: the spread of their speed as a share of walking speed, and the share of frames they stood still or leapt. */
export function smoothness(speeds: number[]): { wobble: number; stalls: number; leaps: number } {
  if (!speeds.length) return { wobble: 0, stalls: 0, leaps: 0 };
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const sd = Math.sqrt(speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / speeds.length);
  return {
    wobble: sd / PLAYER_SPEED,
    stalls: speeds.filter((v) => v < PLAYER_SPEED * 0.25).length / speeds.length,
    leaps: speeds.filter((v) => v > PLAYER_SPEED * 2).length / speeds.length,
  };
}
