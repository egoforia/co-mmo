import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { TICK_SECONDS, WishError, isClientMessage, upgradeCharacter, validateName, type PlayerInfo } from '@co-mmo/shared';
import { Auth, cleanEmail, type Mailer } from './auth.ts';
import { awayFeed } from './feed.ts';
import { World } from './world.ts';
import { Store, StoreError, type Account } from './store.ts';
import { Wishes, type WishOptions } from './wishes.ts';
import { Workshop } from './workshop.ts';
import { handleAdmin } from './admin.ts';
import { LiveRules } from './live-rules.ts';
import { Reports } from './reports.ts';
import type { Updater } from './updates.ts';
import { Builds, type BuildOptions } from './builds.ts';
import { BuildingPainter } from './building-painter.ts';

export interface AppOptions {
  store: Store;
  /** Public base URL used in invite links, e.g. http://localhost:5173 */
  publicUrl: string;
  /** Built client to serve; omitted in development, where Vite serves it. */
  clientDir?: string;
  /** How often player positions are saved, in ms. */
  autosaveMs?: number;
  /** How often idle connections are pinged, in ms. */
  heartbeatMs?: number;
  /** Prayers and wishes: where art lives, and test overrides. */
  wishes: WishOptions;
  /** Checks GitHub for new commits and pulls them (Owner, God's View). */
  updater?: Updater;
  /** The commit this server runs, so clients can tell it restarted. */
  commit?: string | null;
  /** Building Engine wishes on GitHub: test overrides and where the checkout is. */
  builds?: BuildOptions;
  /** Sign-in by email and Google/GitHub: test overrides for sending email and calling providers. */
  auth?: { mailer?: Mailer; fetch?: typeof fetch };
  /**
   * The art manifest shipped with the client. When set, building art missing
   * from it is painted at start-up with the image model chosen in God's View.
   */
  shippedArt?: string;
}

export interface App {
  server: Server;
  world: World;
  wishes: Wishes;
  rules: LiveRules;
  reports: Reports;
  builds: Builds;
  auth: Auth;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 4096;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** HTTP API, static client, and game WebSocket on one server. */
export function createApp(options: AppOptions): App {
  const { store } = options;
  const world = new World();
  world.offlineCreatorXp = (playerId, amount) => store.addCreatorXp(playerId, amount);
  world.onJournal = (text, playerId) => store.addJournal(text, playerId);
  const env = options.wishes.env ?? process.env;
  const auth = new Auth({ store, publicUrl: options.publicUrl, env, ...options.auth, ...(options.wishes.now ? { now: options.wishes.now } : {}) });
  const rules = new LiveRules(store, world, {
    now: options.wishes.now,
    onPause: (record, reason) => {
      wishes.notifyStewards(`The rule "${record.title}" paused itself: ${reason}`);
      wishes.tellWisher(record, `Your wish "${record.title}" stopped itself after errors. The Stewards have been told.`);
      wishes.changed(record.id);
    },
  });
  world.onEvent = (type, playerId, data) => rules.fire(type, playerId, data);
  const wishes = new Wishes(store, world, rules, options.wishes);
  const workshop = new Workshop(store, world, wishes, { anchorDir: options.wishes.anchorDir, artDir: options.wishes.artDir, now: options.wishes.now });
  wishes.restore();
  const buildingPainter = new BuildingPainter({
    provider: () => wishes.imageProvider(),
    overBudget: () => wishes.budget().over,
    spend: (usd, provider) => store.recordSpend({ at: Date.now(), usd, kind: 'image', provider: provider.id, model: provider.model, playerId: null }),
    anchorDir: options.wishes.anchorDir,
    artDir: options.wishes.artDir,
    shipped: async () => (options.shippedArt ? JSON.parse(await readFile(options.shippedArt, 'utf8')) : {}),
  });
  if (options.shippedArt) void buildingPainter.start();
  const reports = new Reports(store, world);
  const builds = new Builds(store, {
    changed: (id) => wishes.changed(id),
    tellWisher: (record, text) => wishes.tellWisher(record, text),
    notifyOwner: (text) => wishes.notifyStewards(text),
    announce: (text) => world.broadcast({ t: 'system', text, at: Date.now() }),
    addWish: (from, title, summary) => wishes.addStep(from, title, summary),
  }, {
    env: options.wishes.env ?? process.env,
    now: options.wishes.now,
    ...(options.updater ? { contains: (sha: string) => options.updater!.contains(sha) } : {}),
    ...options.builds,
  });
  const restoring = builds.restore().catch((err) => console.error('Builds did not restore:', (err as Error).message));
  builds.start();

  const server = createServer((req, res) => {
    handleHttp(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: 'server_error', message: 'Something went wrong.' });
    });
  });

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path.startsWith('/api/invites/') && req.method === 'GET') {
      const invite = store.findInvite(decodeURIComponent(path.slice('/api/invites/'.length)));
      if (!invite || invite.usedBy) return json(res, 404, { valid: false });
      const inviter = invite.createdBy ? store.accountById(invite.createdBy)?.name ?? null : null;
      return json(res, 200, { valid: true, invitedBy: inviter, role: invite.role });
    }

    if (path === '/api/accept' && req.method === 'POST') {
      const body = await readJson(req);
      const code = typeof body?.code === 'string' ? body.code : '';
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (body?.adult !== true) {
        return json(res, 400, { error: 'adult_required', message: 'co-MMO is for players aged 18 and over.' });
      }
      const nameError = validateName(name);
      if (nameError) return json(res, 400, { error: 'name_invalid', message: nameError });
      // An email and a look are optional; both can be added later from Account.
      const rawEmail = typeof body?.email === 'string' ? body.email.trim() : '';
      const email = rawEmail ? cleanEmail(rawEmail) : '';
      if (rawEmail && !email) return json(res, 400, { error: 'email_invalid', message: 'That does not look like an email address.' });
      if (email && store.accountByEmail(email)) return json(res, 400, { error: 'email_taken', message: 'Another player already signs in with that email.' });
      const look = typeof body?.look === 'string' ? body.look.trim() : '';
      let created: ReturnType<Store['acceptInvite']>;
      try {
        created = store.acceptInvite(code, name, world.home.def.id);
      } catch (err) {
        if (err instanceof StoreError) return json(res, 400, { error: err.code, message: err.message });
        throw err;
      }
      const { account, token } = created;
      const inviter = account.invitedBy ? store.accountById(account.invitedBy)?.name : undefined;
      store.addJournal(`${account.name} joined the world${inviter ? `, invited by ${inviter}` : ''}.`, account.id);
      const notes: string[] = [];
      if (look) {
        try {
          wishes.grantLook(account, look);
        } catch (err) {
          if (!(err instanceof WishError)) throw err;
          notes.push(err.message);
        }
      }
      if (email) {
        notes.push(await auth.confirmEmail(account, email, req.socket.remoteAddress ?? '').catch((err: Error) => `We could not send the email: ${err.message}`));
      }
      return json(res, 200, { token, player: publicInfo(account), notes });
    }

    if (path === '/api/version' && req.method === 'GET') {
      return json(res, 200, { commit: options.commit ?? null, updating: options.updater?.requested ?? false });
    }

    if (path === '/api/me' && req.method === 'GET') {
      const account = authenticate(req);
      if (!account) return json(res, 401, { error: 'unauthorized' });
      if (account.suspended) return json(res, 403, { error: 'suspended', message: suspendedText(account) });
      return json(res, 200, { player: publicInfo(account) });
    }

    if (path === '/api/invites' && req.method === 'POST') {
      const account = authenticate(req);
      if (!account) return json(res, 401, { error: 'unauthorized' });
      if (account.suspended) return json(res, 403, { error: 'suspended', message: suspendedText(account) });
      const invite = store.createInvite(account.id);
      return json(res, 200, { code: invite.code, url: inviteUrl(options.publicUrl, invite.code) });
    }

    if (path === '/api/account' && req.method === 'GET') {
      const account = authenticate(req);
      if (!account) return json(res, 401, { error: 'unauthorized' });
      const look = wishes.lookOf(account.id);
      return json(res, 200, {
        name: account.name,
        email: account.email ?? null,
        logins: (account.logins ?? []).map((l) => l.provider),
        providers: auth.providers(),
        look: look ? { description: look.summary, ...(look.art ? { art: look.art } : {}) } : null,
      });
    }

    if (path === '/api/account/look' && req.method === 'POST') {
      const account = authenticate(req);
      if (!account) return json(res, 401, { error: 'unauthorized' });
      if (account.suspended) return json(res, 403, { error: 'suspended', message: suspendedText(account) });
      const body = await readJson(req);
      try {
        wishes.grantLook(account, typeof body?.look === 'string' ? body.look : '');
      } catch (err) {
        if (err instanceof WishError) return json(res, 400, { error: 'look_invalid', message: err.message });
        throw err;
      }
      return json(res, 200, { message: 'The God has heard how you look. Your picture is being painted.' });
    }

    if (await auth.handle(req, res, url, json, readJson, authenticate(req))) return;

    const admin = { store, world, wishes, rules, reports, builds, kick, updater: options.updater, restarting, env, json, readJson };
    if (await handleAdmin(req, res, path, authenticate(req), admin)) return;

    // Building art and wished biomes' kits painted here, beyond what ships with the game.
    if (path === '/api/art' && req.method === 'GET') return json(res, 200, { ...(await wishes.kitManifest()), ...buildingPainter.manifest() });
    if (path.startsWith('/api/')) return json(res, 404, { error: 'not_found' });

    const art = path.match(/^\/wished-art\/([\w-]+)\.png$/);
    if (art && req.method === 'GET') return serveFile(join(options.wishes.artDir, `${art[1]}.png`), res);
    const building = path.match(/^\/wished-art\/buildings\/([\w-]+\.(?:png|webp))$/);
    if (building && req.method === 'GET') return serveFile(join(options.wishes.artDir, 'buildings', building[1]!), res);
    const kit = path.match(/^\/wished-art\/biomes\/([\w-]+\.png)$/);
    if (kit && req.method === 'GET') return serveFile(join(options.wishes.artDir, 'biomes', kit[1]!), res);

    if (options.clientDir && req.method === 'GET') return serveStatic(options.clientDir, path, res);
    json(res, 404, { error: 'not_found' });
  }

  function authenticate(req: IncomingMessage): Account | undefined {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return token ? store.accountByToken(token) : undefined;
  }

  /** Disconnects a player who was just suspended. */
  function kick(id: string, reason: string): void {
    const socket = sockets.get(id);
    if (!socket) return;
    socket.send(JSON.stringify({ t: 'error', code: 'suspended', message: reason }));
    socket.close(4003, reason.slice(0, 120));
  }

  /** Tells every player the world is restarting for an update, and saves. */
  async function restarting(): Promise<void> {
    for (const socket of sockets.values()) socket.close(4010, 'The world is updating. Back in a moment.');
    saveAll();
    await store.flush();
  }

  // Game connections. The session token arrives as the first message rather
  // than in the URL, so it never shows up in proxy or server logs.
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  const sockets = new Map<string, WebSocket>();
  // Heartbeat: ping every client so idle connections stay open through proxies,
  // and drop any that stopped answering (a sleeping laptop, a dead network).
  const alive = new WeakSet<WebSocket>();
  const heartbeatTimer = setInterval(() => {
    for (const client of wss.clients) {
      if (!alive.has(client)) {
        client.terminate();
        continue;
      }
      alive.delete(client);
      client.ping();
    }
  }, options.heartbeatMs ?? 25_000);
  wss.on('connection', (socket: WebSocket) => {
    let account: Account | undefined;
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
    const authTimer = setTimeout(() => socket.close(4001, 'Sign-in timed out.'), 5000);

    socket.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!account) {
        const token = (parsed as { t?: string; token?: unknown })?.t === 'hello' ? (parsed as { token?: unknown }).token : undefined;
        account = typeof token === 'string' ? store.accountByToken(token) : undefined;
        clearTimeout(authTimer);
        if (!account) {
          socket.send(JSON.stringify({ t: 'error', code: 'unauthorized', message: 'Please sign in again.' }));
          socket.close(4001, 'Unauthorized');
          return;
        }
        if (account.suspended) {
          const message = suspendedText(account);
          socket.send(JSON.stringify({ t: 'error', code: 'suspended', message }));
          socket.close(4003, message.slice(0, 120));
          account = undefined;
          return;
        }
        sockets.set(account.id, socket);
        const away = awayFeed(store, account);
        world.join(publicInfo(account), {
          send: (m) => {
            if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
          },
          close: (reason) => socket.close(4000, reason),
        }, { regionId: account.regionId, x: account.x, y: account.y }, upgradeCharacter(account.character));
        world.sendTo(account.id, { t: 'content', entries: wishes.entries(), replace: true });
        if (away) world.sendTo(account.id, away);
        rules.fire('join', account.id);
        builds.greet(account.id);
        void workshop.greet(account.id);
        return;
      }
      if (!isClientMessage(parsed)) return;
      if (parsed.t === 'pray') {
        // The role may have changed since sign-in (a Steward was appointed).
        const current = store.accountById(account.id) ?? account;
        void wishes.pray(publicInfo(current), parsed.text);
      } else if (parsed.t === 'report') {
        const say = reports.file(publicInfo(account), parsed.kind, parsed.target, parsed.reason);
        world.sendTo(account.id, { t: 'god', say });
      } else if (parsed.t === 'wish') {
        wishes.answer(publicInfo(store.accountById(account.id) ?? account), parsed.card, parsed.confirm);
      } else if (parsed.t === 'draft') {
        const who = publicInfo(store.accountById(account.id) ?? account);
        const done = parsed.action === 'start' ? workshop.start(who, parsed.category ?? '', parsed.sub ?? '', parsed.fields)
          : parsed.action === 'edit' ? workshop.edit(who, parsed.fields)
            : parsed.action === 'send' ? workshop.send(who) : workshop.drop(who);
        done.catch((err) => console.error('Workshop failed:', err));
      } else {
        world.handle(account.id, parsed);
      }
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      if (!account) return;
      // A replaced connection must not remove the newer session.
      if (sockets.get(account.id) !== socket) return;
      sockets.delete(account.id);
      const place = world.leave(account.id);
      if (place) store.savePosition(account.id, place.x, place.y, place.regionId, place.character);
    });
  });

  const tickTimer = setInterval(() => {
    world.tick();
    rules.tick();
  }, TICK_SECONDS * 1000);
  const autosaveTimer = setInterval(() => saveAll(), options.autosaveMs ?? 30_000);

  function saveAll(): void {
    for (const p of world.places()) store.savePosition(p.id, p.x, p.y, p.regionId, p.character);
  }

  return {
    server,
    world,
    wishes,
    rules,
    reports,
    builds,
    auth,
    async close() {
      clearInterval(tickTimer);
      options.updater?.stop();
      clearInterval(heartbeatTimer);
      builds.stop();
      await restoring;
      await Promise.allSettled([...builds.jobs]);
      await Promise.allSettled([...wishes.drafts]);
      await buildingPainter.job;
      await Promise.allSettled([...wishes.painting]);
      rules.dispose();
      clearInterval(autosaveTimer);
      saveAll();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.flush();
    },
  };
}

export function inviteUrl(publicUrl: string, code: string): string {
  return `${publicUrl.replace(/\/$/, '')}/?invite=${encodeURIComponent(code)}`;
}

function suspendedText(account: Account): string {
  return `Your account is suspended${account.suspended?.reason ? `: ${account.suspended.reason}` : ''}. Talk to the Owner.`;
}

function publicInfo(account: Account): PlayerInfo {
  return { id: account.id, name: account.name, color: account.color, role: account.role };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof value === 'object' && value !== null ? value : null;
  } catch {
    return null;
  }
}

async function serveStatic(root: string, urlPath: string, res: ServerResponse): Promise<void> {
  const safe = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, safe);
  if (!file.startsWith(root)) return json(res, 403, { error: 'forbidden' });
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    // Unknown paths fall back to the app shell so invite links work.
    file = join(root, 'index.html');
  }
  return serveFile(file, res);
}

async function serveFile(file: string, res: ServerResponse): Promise<void> {
  try {
    await stat(file);
  } catch {
    return json(res, 404, { error: 'not_found' });
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}
