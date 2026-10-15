// Shared by the server tests: an app on a random port, accounts, and a
// WebSocket client that collects messages.

import { afterEach, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { WebSocket } from 'ws';
import { ABILITIES, CREATURES, ITEMS, NPC_GREETINGS, RECIPES, WISHED_REGIONS, type GodMessage, type ServerMessage, type WishCard } from '@co-mmo/shared';
import { createApp, type App, type AppOptions } from '../src/app.ts';
import type { ChatModel } from '../src/ai/chat.ts';
import { OfflineGod } from '../src/god.ts';
import type { ImageProvider } from '../src/assets/provider.ts';
import type { VideoProvider } from '../src/assets/video.ts';
import { Store } from '../src/store.ts';
import type { Updater } from '../src/updates.ts';
import type { BuildOptions } from '../src/builds.ts';
import type { Mail, Mailer } from '../src/auth.ts';
import { MemoryPaintQueue, type PaintQueue } from '../src/paint-queue.ts';

export let app: App | null = null;
const sockets: WebSocket[] = [];

/** Closes the running app, as a server shutdown would. */
export async function stop(): Promise<void> {
  await app?.close();
  app = null;
}

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await app?.close();
  app = null;
  // Forget wished things; built-in ones (the Walking Mushroom, the Wooden Sword) stay.
  for (const [registry, keep] of BUILT_IN) for (const id of Object.keys(registry)) if (!keep.has(id)) delete registry[id];
  WISHED_REGIONS.clear();
});

const BUILT_IN: [Record<string, unknown>, Set<string>][] = [ITEMS, CREATURES, NPC_GREETINGS, RECIPES, ABILITIES].map((r) => [r, new Set(Object.keys(r))]);

/** Paints a small magenta-backed square, like the image service would. */
export const fakePainter = (): ImageProvider & { calls: number; prompts: string[] } => ({
  id: 'fake',
  model: 'fake-image',
  calls: 0,
  prompts: [],
  async generate(request) {
    this.calls++;
    this.prompts.push(request.prompt);
    const data = await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 255, g: 0, b: 255 } } })
      .composite([{ input: await sharp({ create: { width: 100, height: 120, channels: 3, background: { r: 40, g: 90, b: 160 } } }).png().toBuffer(), left: 78, top: 70 }])
      .png()
      .toBuffer();
    return { mimeType: 'image/png', data };
  },
});

/** Keeps the emails the game sends, instead of sending them. */
export const fakeMailer = (): Mailer & { sent: Mail[] } => ({
  kind: 'email',
  sent: [],
  async send(mail) {
    this.sent.push(mail);
  },
});

export async function start(opts: {
  store?: Store; chat?: () => ChatModel[]; compiler?: () => ChatModel[]; judge?: () => ChatModel | undefined; painter?: ImageProvider | null; now?: () => number;
  updater?: Updater; builds?: BuildOptions; env?: Record<string, string>; mailer?: Mailer; fetch?: typeof fetch;
  /** Art: the shipped manifest, the anchors, and a video model with its frame cutter. */
  shippedArt?: string; anchorDir?: string; video?: VideoProvider; frames?: (mp4: Buffer) => Promise<Buffer[]>;
  /** Paint turns: no rate limits unless a test gives some; `artDir` to start again on the same art. */
  paintQueue?: PaintQueue; artDir?: string;
  /** Use the real image providers from the env and settings instead of the fake painter. */
  realImages?: boolean;
  /** Sound services, how made sounds are finished, and whether to make them at start-up. */
  sound?: AppOptions['sound'];
} = {}) {
  const store = opts.store ?? Store.memory();
  const artDir = opts.artDir ?? (await mkdtemp(join(tmpdir(), 'co-mmo-art-')));
  const painter = opts.painter === undefined ? fakePainter() : opts.painter;
  app = createApp({
    store,
    publicUrl: 'http://game.test',
    updater: opts.updater,
    commit: 'abc1234',
    builds: opts.builds ?? { issues: null },
    auth: { mailer: opts.mailer ?? fakeMailer(), ...(opts.fetch ? { fetch: opts.fetch } : {}) },
    ...(opts.shippedArt ? { shippedArt: opts.shippedArt } : {}),
    ...(opts.realImages && !opts.video ? {} : { videoProvider: () => opts.video }),
    ...(opts.frames ? { videoFrames: opts.frames } : {}),
    paintQueue: opts.paintQueue ?? new MemoryPaintQueue({ limit: () => undefined }),
    ...(opts.sound ? { sound: opts.sound } : {}),
    wishes: {
      env: opts.env ?? {},
      anchorDir: opts.anchorDir ?? '/nonexistent',
      artDir,
      chatModel: opts.chat ?? (() => [new OfflineGod()]),
      ...(opts.compiler ? { compilerModel: opts.compiler } : {}),
      ...(opts.judge ? { judgeModel: opts.judge } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.realImages ? {} : { imageProvider: () => painter ?? undefined }),
    },
  });
  await new Promise<void>((resolve) => app!.server.listen(0, resolve));
  const port = (app.server.address() as AddressInfo).port;
  return { store, artDir, painter, base: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws` };
}

export function account(store: Store, name: string, role: 'owner' | 'steward' | 'player' = 'player') {
  const invite = store.createInvite(null, role === 'owner' ? 'owner' : 'player');
  const { account, token } = store.acceptInvite(invite.code, name, 'sanctum');
  if (role === 'steward') store.setRole(account.id, 'steward');
  return { id: account.id, token };
}

export function connect(url: string, token: string) {
  const socket = new WebSocket(url);
  sockets.push(socket);
  const messages: ServerMessage[] = [];
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  const opened = new Promise<void>((resolve) => socket.on('open', () => {
    socket.send(JSON.stringify({ t: 'hello', token }));
    resolve();
  }));
  const send = async (m: unknown) => {
    await opened;
    socket.send(JSON.stringify(m));
  };
  const waitFor = async <T extends ServerMessage>(pred: (m: ServerMessage) => boolean, ms = 3000): Promise<T> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const i = messages.findIndex(pred);
      if (i >= 0) return messages.splice(i, 1)[0] as T;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out waiting for message');
  };
  return { socket, messages, send, waitFor };
}

export async function joined(url: string, token: string) {
  const c = connect(url, token);
  await c.waitFor((m) => m.t === 'welcome');
  return c;
}

export async function pray(c: ReturnType<typeof connect>, text: string): Promise<GodMessage> {
  await c.send({ t: 'pray', text });
  return c.waitFor<GodMessage>((m) => m.t === 'god');
}

export async function wish(c: ReturnType<typeof connect>, text: string): Promise<WishCard> {
  const answer = await pray(c, text);
  expect(answer.card).toBeDefined();
  await c.send({ t: 'wish', card: answer.card!.id, confirm: true });
  return answer.card!;
}

export async function api(base: string, path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

