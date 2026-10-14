import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { TICK_SECONDS, isClientMessage, validateName, type PlayerInfo } from '@co-mmo/shared';
import { World } from './world.ts';
import { Store, StoreError, type Account } from './store.ts';

export interface AppOptions {
  store: Store;
  /** Public base URL used in invite links, e.g. http://localhost:5173 */
  publicUrl: string;
  /** Built client to serve; omitted in development, where Vite serves it. */
  clientDir?: string;
  /** How often player positions are saved, in ms. */
  autosaveMs?: number;
}

export interface App {
  server: Server;
  world: World;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 4096;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** HTTP API, static client, and game WebSocket on one server. */
export function createApp(options: AppOptions): App {
  const { store } = options;
  const world = new World();

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
      try {
        const { account, token } = store.acceptInvite(code, name, world.home.def.id);
        return json(res, 200, { token, player: publicInfo(account) });
      } catch (err) {
        if (err instanceof StoreError) return json(res, 400, { error: err.code, message: err.message });
        throw err;
      }
    }

    if (path === '/api/me' && req.method === 'GET') {
      const account = authenticate(req);
      if (!account) return json(res, 401, { error: 'unauthorized' });
      return json(res, 200, { player: publicInfo(account) });
    }

    if (path === '/api/invites' && req.method === 'POST') {
      const account = authenticate(req);
      if (!account) return json(res, 401, { error: 'unauthorized' });
      const invite = store.createInvite(account.id);
      return json(res, 200, { code: invite.code, url: inviteUrl(options.publicUrl, invite.code) });
    }

    if (path.startsWith('/api/')) return json(res, 404, { error: 'not_found' });

    if (options.clientDir && req.method === 'GET') return serveStatic(options.clientDir, path, res);
    json(res, 404, { error: 'not_found' });
  }

  function authenticate(req: IncomingMessage): Account | undefined {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return token ? store.accountByToken(token) : undefined;
  }

  // Game connections. The session token arrives as the first message rather
  // than in the URL, so it never shows up in proxy or server logs.
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  const sockets = new Map<string, WebSocket>();
  wss.on('connection', (socket: WebSocket) => {
    let account: Account | undefined;
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
        sockets.set(account.id, socket);
        world.join(publicInfo(account), {
          send: (m) => {
            if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
          },
          close: (reason) => socket.close(4000, reason),
        }, { regionId: account.regionId, x: account.x, y: account.y });
        return;
      }
      if (isClientMessage(parsed)) world.handle(account.id, parsed);
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      if (!account) return;
      // A replaced connection must not remove the newer session.
      if (sockets.get(account.id) !== socket) return;
      sockets.delete(account.id);
      const place = world.leave(account.id);
      if (place) store.savePosition(account.id, place.x, place.y, place.regionId);
    });
  });

  const tickTimer = setInterval(() => world.tick(), TICK_SECONDS * 1000);
  const autosaveTimer = setInterval(() => saveAll(), options.autosaveMs ?? 30_000);

  function saveAll(): void {
    for (const p of world.places()) store.savePosition(p.id, p.x, p.y, p.regionId);
  }

  return {
    server,
    world,
    async close() {
      clearInterval(tickTimer);
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
  try {
    await stat(file);
  } catch {
    return json(res, 404, { error: 'not_found' });
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}
