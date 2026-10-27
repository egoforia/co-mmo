import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { chooseCalling, isClientMessage, needsCalling, upgradeCharacter } from '@co-mmo/shared';
import { publicInfo, suspendedText } from './account-routes.ts';
import type { Builds } from './builds.ts';
import { awayFeed } from './feed.ts';
import type { LiveRules } from './live-rules.ts';
import type { Reports } from './reports.ts';
import type { Account, Store } from './store.ts';
import type { Wishes } from './wishes.ts';
import type { Workshop } from './workshop.ts';
import { settle, type World } from './world.ts';

export interface GameSocketOptions {
  server: Server;
  store: Store;
  world: World;
  wishes: Wishes;
  workshop: Workshop;
  reports: Reports;
  rules: LiveRules;
  builds: Builds;
  /** How often idle connections are pinged, in ms. */
  heartbeatMs?: number;
}

/** The game's WebSocket, as the rest of the server sees it. */
export interface GameSocket {
  /** Disconnects a player now, telling them why (a suspension). */
  kick(id: string, reason: string): void;
  /** Disconnects everyone with a reason (an update). */
  closeAll(code: number, reason: string): void;
  /** Stops pinging and closes every connection. */
  close(): Promise<void>;
}

/**
 * Game connections (design doc, Technical architecture): sign-in by the first
 * message, then each message goes to the part of the server that owns it:
 * prayers and wish cards to Wishes, drafts to the Workshop, reports to
 * Reports, and everything that happens in the world to World. The session
 * token arrives as the first message rather than in the URL, so it never
 * shows up in proxy or server logs.
 */
export function openGameSocket(options: GameSocketOptions): GameSocket {
  const { store, world, wishes, workshop, reports, rules, builds } = options;
  const wss = new WebSocketServer({ server: options.server, path: '/ws', maxPayload: 4096 });
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
    // Signed in but still choosing a people and Calling: not in the world yet.
    let choosing = false;
    let entered = false;
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
    const authTimer = setTimeout(() => socket.close(4001, 'Sign-in timed out.'), 5000);

    /** Puts the signed-in player into the world. */
    const enter = (account: Account): void => {
      entered = true;
      const away = awayFeed(store, account);
      world.join(publicInfo(account), {
        send: (m) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
        },
        close: (reason) => socket.close(4000, reason),
      }, { regionId: account.regionId, x: account.x, y: account.y, floor: account.floor }, upgradeCharacter(account.character));
      world.sendTo(account.id, { t: 'content', entries: wishes.entries(), replace: true });
      if (away) world.sendTo(account.id, away);
      rules.fire('join', account.id);
      builds.greet(account.id);
      void workshop.greet(account.id);
    };

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
        // A character from before Callings chooses a people and Calling before entering (docs/classes.md, Migration).
        if (needsCalling(account.character)) {
          choosing = true;
          socket.send(JSON.stringify({ t: 'callingNeeded', level: account.character?.level ?? 1 }));
          return;
        }
        enter(account);
        return;
      }
      if (choosing) {
        if (!isClientMessage(parsed) || parsed.t !== 'chooseCalling') return;
        const character = upgradeCharacter(account.character);
        chooseCalling(character, parsed.race, parsed.calling);
        store.saveCharacter(account.id, character);
        choosing = false;
        enter(store.accountById(account.id) ?? account);
        return;
      }
      if (!isClientMessage(parsed)) return;
      if (parsed.t === 'ping') {
        // Answered here, before any region: the overlay times the network and this server, not the queue behind it.
        socket.send(JSON.stringify({ t: 'pong', n: parsed.n }));
      } else if (parsed.t === 'pray') {
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
        const done = parsed.action === 'start' ? workshop.start(who, parsed.category ?? '', parsed.sub ?? '', parsed.fields, parsed.carry)
          : parsed.action === 'edit' ? workshop.edit(who, parsed.fields, parsed.locked)
            : parsed.action === 'ask' ? workshop.ask(who, parsed.say ?? '', parsed.fields, parsed.locked)
              : parsed.action === 'fill' ? workshop.fill(who, parsed.fields, parsed.locked)
                : parsed.action === 'shape' ? workshop.shape(who)
                  : parsed.action === 'sample' ? workshop.sample(who)
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
      if (!entered) return;
      const id = account.id;
      void settle(world.leave(id), (place) => {
        if (place) store.savePosition(id, place.x, place.y, place.regionId, place.character, place.floor);
      });
    });
  });

  return {
    kick(id, reason) {
      const socket = sockets.get(id);
      if (!socket) return;
      socket.send(JSON.stringify({ t: 'error', code: 'suspended', message: reason }));
      socket.close(4003, reason.slice(0, 120));
    },
    closeAll(code, reason) {
      for (const socket of sockets.values()) socket.close(code, reason);
    },
    async close() {
      clearInterval(heartbeatTimer);
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
