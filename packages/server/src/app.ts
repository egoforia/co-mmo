import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { ITEMS, TICK_SECONDS, WALKING_LOOKS, WALK_FRAMES, WishError, isClientMessage, ruleItemId, upgradeCharacter, validateName, wishArtKey, type ArtManifest, type PlayerInfo } from '@co-mmo/shared';
import { Auth, cleanEmail, type Mailer } from './auth.ts';
import { awayFeed } from './feed.ts';
import { World } from './world.ts';
import { Store, StoreError, dailyClips, soundSettings, videoSettings, type Account } from './store.ts';
import { Wishes, type WishOptions } from './wishes.ts';
import { Workshop } from './workshop.ts';
import { handleAdmin } from './admin.ts';
import { LoadMeter } from './load-meter.ts';
import { LiveRules } from './live-rules.ts';
import { Reports } from './reports.ts';
import type { Updater } from './updates.ts';
import { Builds, type BuildOptions } from './builds.ts';
import { BuildingPainter, type BuildingPainterOptions } from './building-painter.ts';
import { WalkPainter } from './walk-painter.ts';
import { GeminiVideoProvider, type VideoProvider } from './assets/video.ts';
import { ArtJobs } from './art-jobs.ts';
import { RecipeBook } from './art-recipes.ts';
import { ArtStudio } from './art-studio.ts';
import { DailyClips, MemoryPaintQueue, nextDailyReset, queuedSound, queuedVideo, type PaintQueue } from './paint-queue.ts';
import { SoundMaker } from './sound-maker.ts';
import { ElevenLabsSoundProvider, LyriaMusicProvider, type SoundProvider } from './assets/sound.ts';
import type { FinishedSound } from './assets/sound-finish.ts';
import { FilePaintRequests } from './paint-requests.ts';
import { HandFinder, type PointSource } from './hand-finder.ts';
import type { Bus } from './bus.ts';
import { RegionServers } from './region-servers.ts';
import { settle } from './world.ts';

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
  /** The video model for painting walks; Veo through the Gemini key unless a test says otherwise. */
  videoProvider?: () => VideoProvider | undefined;
  /** Turns a clip into its frames; ffmpeg unless a test says otherwise. */
  videoFrames?: (mp4: Buffer) => Promise<Buffer[]>;
  /** Turns at the image and video models; per-model rate limits unless a test says otherwise. */
  paintQueue?: PaintQueue;
  /** Sound services: ElevenLabs and Lyria from the server's keys unless a test says otherwise. */
  sound?: {
    effects?: () => SoundProvider | undefined;
    music?: () => SoundProvider | undefined;
    finish?: { effect: (raw: Buffer) => Promise<FinishedSound>; music: (raw: Buffer) => Promise<FinishedSound> };
    /** Make missing sounds at start-up (on whenever shipped art is given). */
    start?: boolean;
  };
  /**
   * Messages to and from region servers (Redis when REDIS_URL is set). With
   * it, regions run on whichever region servers are up; without, all here.
   */
  regionBus?: Bus;
}

export interface App {
  server: Server;
  world: World;
  wishes: Wishes;
  rules: LiveRules;
  reports: Reports;
  builds: Builds;
  auth: Auth;
  /** God's View's Art tab: the painting log and repaint requests. */
  art: ArtStudio;
  /** Where hands and grips are, for held items. */
  hands: HandFinder;
  /** The region servers, when there is a bus to reach them. */
  regionServers?: RegionServers;
  /** Resolves once the app listens for region servers. */
  ready: Promise<void>;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 4096;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
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
  // Regions run on region servers when there are any (design doc, Scaling without a cap).
  const regionServers = options.regionBus ? new RegionServers(options.regionBus, world, { content: () => wishes.entries() }) : undefined;
  if (regionServers) world.hosting = regionServers;
  const ready = regionServers ? regionServers.start() : Promise.resolve();
  // How hard this process works, for God's View's Server health tab.
  const meter = new LoadMeter();
  const workshop = new Workshop(store, world, wishes, { anchorDir: options.wishes.anchorDir, artDir: options.wishes.artDir, now: options.wishes.now });
  wishes.restore();
  const artJobs = new ArtJobs();
  wishes.artJobs = artJobs;
  // Every picture and clip takes its turn here, within each model's rate limit.
  const paintQueue = options.paintQueue ?? new MemoryPaintQueue();
  const paintRequests = new FilePaintRequests(resolve(options.wishes.artDir, 'paint-requests.json'));
  wishes.paintQueue = paintQueue;
  wishes.paintRequests = paintRequests;
  // What was sent to make each picture, clip and sound, for God's View to show with every version.
  const recipes = new RecipeBook(options.wishes.artDir);
  wishes.recipes = recipes;
  const painterOptions: BuildingPainterOptions = {
    provider: () => wishes.imageProvider('buildings'),
    overBudget: () => wishes.budget().paused,
    spend: (usd, provider) => store.recordSpend({ at: Date.now(), usd, kind: 'image', provider: provider.id, model: provider.model, playerId: null }),
    anchorDir: options.wishes.anchorDir,
    artDir: options.wishes.artDir,
    shipped: async () => (options.shippedArt ? JSON.parse(await readFile(options.shippedArt, 'utf8')) : {}),
    jobs: artJobs,
    recipes,
  };
  const buildingPainter = new BuildingPainter(painterOptions);
  // Walks use Google's Veo on the Gemini key, with the model chosen on the AI models tab.
  const chosenVideo = options.videoProvider ?? (() => {
    const v = videoSettings(store.settings, env);
    return v.provider === 'gemini' && env.GEMINI_API_KEY ? new GeminiVideoProvider(env.GEMINI_API_KEY, v.model || undefined) : undefined;
  });
  // Google caps Veo clips a day without saying so when it refuses, so the game counts its own.
  const clips = new DailyClips({
    cap: () => dailyClips(store.settings),
    madeSince: (model, since) => store.spendSince(since).filter((s) => s.kind === 'video' && s.model === model).length,
  });
  const video = () => {
    const provider = chosenVideo();
    return provider && queuedVideo(paintQueue, provider, clips);
  };
  const walkPainter = new WalkPainter({
    ...painterOptions,
    provider: () => wishes.imageProvider('walks'),
    video,
    spendVideo: (usd, provider) => store.recordSpend({ at: Date.now(), usd, kind: 'video', provider: provider.id, model: provider.model, playerId: null }),
    ...(options.videoFrames ? { toFrames: options.videoFrames } : {}),
    // Pages already open load the new walks without a reload.
    onPainted: (walks) => world.broadcast({ t: 'art', walks }),
  });
  // Sound effects from ElevenLabs and music from Google's Lyria, as chosen in God's View.
  const sound = () => soundSettings(store.settings, env);
  const effects = options.sound?.effects ?? (() => {
    const s = sound().effects;
    return s.provider === 'elevenlabs' && env.ELEVENLABS_API_KEY ? new ElevenLabsSoundProvider(env.ELEVENLABS_API_KEY, s.model) : undefined;
  });
  const music = options.sound?.music ?? (() => {
    const s = sound().music;
    return s.provider === 'gemini' && env.GEMINI_API_KEY ? new LyriaMusicProvider(env.GEMINI_API_KEY, s.model) : undefined;
  });
  const queued = (make: () => SoundProvider | undefined) => () => {
    const provider = make();
    return provider && queuedSound(paintQueue, provider);
  };
  const sounds = new SoundMaker({
    effects: queued(effects),
    music: queued(music),
    overBudget: () => wishes.budget().paused,
    spend: (usd, provider) => store.recordSpend({ at: Date.now(), usd, kind: 'sound', provider: provider.id, model: provider.model, playerId: null }),
    artDir: options.wishes.artDir,
    jobs: artJobs,
    ...(options.sound?.finish ? { finish: options.sound.finish } : {}),
  });
  // Buildings first: a building without its picture matters more than a stiff walk.
  if (options.shippedArt) void buildingPainter.start().then(() => walkPainter.start());
  // Sounds use other services, so they are made alongside.
  const makeSounds = options.sound?.start ?? Boolean(options.shippedArt);
  if (makeSounds) void sounds.start();
  /** Paints and makes whatever is still missing, once the budget allows: after today's cap held it back, or the Owner raised a limit. */
  const resumeArt = (): void => {
    if (wishes.budget().paused) return;
    wishes.paintMissing();
    artStudio.resume();
    if (options.shippedArt) void buildingPainter.start().then(() => walkPainter.start());
    if (makeSounds) void sounds.start();
  };
  // A new day (UTC) frees the daily spending cap, and Google's reset (08:00 UTC) frees the day's clips.
  let dayTimer: ReturnType<typeof setTimeout> | undefined;
  const nextDay = (): void => {
    const now = Date.now();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 1, 0, 0);
    const wake = Math.min(midnight.getTime(), nextDailyReset(now) + 60_000);
    dayTimer = setTimeout(() => {
      resumeArt();
      nextDay();
    }, wake - now);
    dayTimer.unref?.();
  };
  nextDay();
  const artStudio = new ArtStudio({
    store, wishes, buildings: buildingPainter, walks: walkPainter, jobs: artJobs, video, sounds,
    anchorDir: options.wishes.anchorDir, artDir: options.wishes.artDir, shipped: painterOptions.shipped, requests: paintRequests, recipes,
  });
  // Held items: where each walker's free hand is and where each weapon or charm is gripped.
  const paintedArt = async (): Promise<ArtManifest> => ({ ...(await wishes.kitManifest()), ...buildingPainter.manifest(), ...walkPainter.manifest(), ...(await artStudio.manifest()) });
  const handFinder = new HandFinder({
    artDir: options.wishes.artDir,
    model: () => wishes.judgeModel(),
    paused: () => wishes.budget().paused,
    spend: (usd, model) => store.recordSpend({ at: Date.now(), usd, kind: 'chat', provider: model.provider, model: model.model, playerId: null }),
    sources: async () => pointSources(await painterOptions.shipped(), await paintedArt()),
  });
  /** Reads a picture the client is served: painted here, or shipped with the game. */
  const artFile = (file: string): Promise<Buffer> => {
    const path = file.split('?')[0]!.replace(/^\//, '');
    if (path.startsWith('wished-art/')) return readFile(resolve(options.wishes.artDir, path.slice('wished-art/'.length)));
    if (!options.shippedArt) return Promise.reject(new Error('no shipped art'));
    return readFile(resolve(dirname(dirname(options.shippedArt)), path));
  };
  /** Every walk strip, walking look and wished look (their hands), and every weapon and charm (their grips). */
  const pointSources = (shipped: ArtManifest, painted: ArtManifest): PointSource[] => {
    // As the client merges them: shipped art wins, except what the Owner had painted again.
    const art: ArtManifest = { ...painted, ...shipped, ...Object.fromEntries(Object.entries(painted).filter(([, e]) => e.redone)) };
    const wished = new Map<string, string>();
    for (const record of store.content) {
      const def = record.definition;
      if (record.status !== 'granted' || !def) continue;
      if (record.art) wished.set(wishArtKey(record.id), record.art);
      if (def.kind === 'rule') for (const key of Object.keys(def.items)) if (record.itemArt?.[ruleItemId(record.id, key)]) wished.set(wishArtKey(ruleItemId(record.id, key)), record.itemArt[ruleItemId(record.id, key)]!);
    }
    const source = (id: string, kind: PointSource['kind'], file: string | undefined, frames = 1): PointSource[] =>
      file ? [{ id, kind, file, frames, read: () => artFile(file) }] : [];
    const looks = store.content.filter((r) => r.status === 'granted' && r.definition?.kind === 'player').map((r) => wishArtKey(r.id));
    return [
      ...Object.entries(art).flatMap(([id, e]) => (e.kind === 'walk' ? source(id, 'hands', e.file, e.frames ?? WALK_FRAMES) : [])),
      ...WALKING_LOOKS.flatMap((id) => source(id, 'hands', art[id]?.file)),
      ...looks.flatMap((id) => source(id, 'hands', wished.get(id))),
      ...Object.values(ITEMS).filter((item) => item.slot === 'weapon' || item.slot === 'charm')
        .flatMap((item) => source(item.art, 'grip', item.art.startsWith('wished-') ? wished.get(item.art) : art[item.art]?.file)),
    ];
  };
  // Looked for after start-up painting, then now and again for what was painted since.
  if (options.shippedArt) void Promise.resolve(buildingPainter.job).then(() => walkPainter.job).then(() => handFinder.start());
  const handTimer = setInterval(() => void handFinder.start(), 5 * 60_000);
  handTimer.unref?.();
  // Paintings a restart cut short are asked for again, behind start-up painting.
  const resuming = paintRequests.resume({
    wish: (request) => wishes.resumePaint(request),
    repaint: (request) => artStudio.repaint(request.asset, request.note),
    walk: (request) => artStudio.walk(request.walker, request.body, [], false),
  });
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

    const admin = { store, world, wishes, rules, reports, builds, art: artStudio, resumeArt, clips, kick, updater: options.updater, restarting, env, json, readJson, meter, ...(regionServers ? { regionServers } : {}) };
    if (await handleAdmin(req, res, path, authenticate(req), admin)) return;

    // Building art and wished biomes' kits painted here, beyond what ships with the game.
    if (path === '/api/art' && req.method === 'GET') return json(res, 200, await paintedArt());
    // Where hands and grips are in painted pictures, for held items.
    if (path === '/api/art-points' && req.method === 'GET') return json(res, 200, await handFinder.manifest());
    // Sound effects and each land's music, made here.
    if (path === '/api/sounds' && req.method === 'GET') return json(res, 200, await sounds.manifest());
    if (path.startsWith('/api/')) return json(res, 404, { error: 'not_found' });

    const art = path.match(/^\/wished-art\/([\w-]+)\.png$/);
    if (art && req.method === 'GET') return serveFile(join(options.wishes.artDir, `${art[1]}.png`), res);
    const building = path.match(/^\/wished-art\/buildings\/([\w-]+\.(?:png|webp))$/);
    if (building && req.method === 'GET') return serveFile(join(options.wishes.artDir, 'buildings', building[1]!), res);
    const sample = path.match(/^\/wished-art\/samples\/([\w-]+)\.png$/);
    if (sample && req.method === 'GET') return serveFile(join(options.wishes.artDir, 'samples', `${sample[1]}.png`), res);
    const walk = path.match(/^\/wished-art\/walks\/([\w-]+\.png)$/);
    if (walk && req.method === 'GET') return serveFile(join(options.wishes.artDir, 'walks', walk[1]!), res);
    const redone = path.match(/^\/wished-art\/redone\/([\w-]+\.png)$/);
    if (redone && req.method === 'GET') return serveFile(join(options.wishes.artDir, 'redone', redone[1]!), res);
    const old = path.match(/^\/wished-art\/history\/([\w~-]+)\/([0-9a-z]+\.(?:png|webp))$/);
    if (old && req.method === 'GET') return serveFile(join(options.wishes.artDir, 'history', old[1]!, old[2]!), res);
    const walkOld = path.match(/^\/wished-art\/history\/([\w~-]+)\/([0-9a-z]+)\/strip\.png$/);
    if (walkOld && req.method === 'GET') return serveFile(join(options.wishes.artDir, 'history', walkOld[1]!, walkOld[2]!, 'strip.png'), res);
    const sent = path.match(/^\/wished-art\/recipes\/pictures\/([0-9a-f]+\.webp)$/);
    if (sent && req.method === 'GET') return serveFile(join(options.wishes.artDir, 'recipes', 'pictures', sent[1]!), res);
    const soundFile = path.match(/^\/wished-art\/sounds\/([\w-]+\.mp3)$/);
    if (soundFile && req.method === 'GET') return serveFile(join(options.wishes.artDir, 'sounds', soundFile[1]!), res);
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
      const id = account.id;
      void settle(world.leave(id), (place) => {
        if (place) store.savePosition(id, place.x, place.y, place.regionId, place.character);
      });
    });
  });

  const tickTimer = setInterval(() => meter.tick(() => {
    world.tick(meter.strain);
    rules.tick();
  }), TICK_SECONDS * 1000);
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
    art: artStudio,
    hands: handFinder,
    ...(regionServers ? { regionServers } : {}),
    ready,
    async close() {
      clearInterval(tickTimer);
      clearTimeout(dayTimer);
      clearInterval(handTimer);
      options.updater?.stop();
      clearInterval(heartbeatTimer);
      builds.stop();
      await restoring;
      // Paintings still waiting their turn are kept for the next start rather than waited out.
      await resuming;
      await paintRequests.close();
      paintQueue.close();
      await Promise.allSettled([...builds.jobs]);
      await Promise.allSettled([...wishes.drafts]);
      await buildingPainter.job;
      await walkPainter.job;
      await handFinder.job;
      await sounds.job;
      await Promise.allSettled([...sounds.pending]);
      await artStudio.idle();
      await Promise.allSettled([...wishes.painting]);
      rules.dispose();
      clearInterval(autosaveTimer);
      await Promise.allSettled([...world.pending]);
      saveAll();
      await regionServers?.close();
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
