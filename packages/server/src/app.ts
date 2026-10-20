import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { TICK_SECONDS, type ArtManifest, type SkyConfig } from '@co-mmo/shared';
import { Auth, type Mailer } from './auth.ts';
import { World } from './world.ts';
import type { Account, Store } from './store.ts';
import { dailyClips } from './settings.ts';
import { AiServices } from './ai/services.ts';
import { Budget } from './budget.ts';
import { OfflineGod } from './god.ts';
import { OfflineCompiler } from './compiler.ts';
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
import type { VideoProvider } from './assets/video.ts';
import { ArtJobs } from './art-jobs.ts';
import { RecipeBook } from './art-recipes.ts';
import { ArtStudio } from './art-studio.ts';
import { KitSheets } from './assets/building-kit/kit-sheets.ts';
import { KitHouses } from './assets/building-kit/kit-houses.ts';
import { handleKitHouses } from './kit-house-routes.ts';
import { STYLE } from './assets/style-profile.ts';
import { DailyClips, MemoryPaintQueue, nextDailyReset, type PaintQueue } from './paint-queue.ts';
import { SoundMaker } from './sound-maker.ts';
import type { SoundProvider } from './assets/sound.ts';
import type { FinishedSound } from './assets/sound-finish.ts';
import { FilePaintRequests } from './paint-requests.ts';
import { HandFinder } from './hand-finder.ts';
import type { Bus } from './bus.ts';
import { RegionServers } from './region-servers.ts';
import { ApiLog, watchFetch } from './api-log.ts';
import { bearer, json, readJson, serveStatic } from './http.ts';
import { handleAccount } from './account-routes.ts';
import { serveArtFile } from './art-files.ts';
import { openGameSocket } from './game-socket.ts';
import { artFileReader, pointSources } from './hand-sources.ts';

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
  /** The building kit's texture sheets shipped with the game, one folder per look. */
  kitSheets?: string;
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
  /** Every request to an outside service, for God's View's API Log; kept in memory unless given. */
  apiLog?: ApiLog;
  /** How the sky turns: the length of a day and of each spell of weather (from .env). */
  sky?: SkyConfig;
}

export interface App {
  server: Server;
  world: World;
  wishes: Wishes;
  /** Every AI service, chosen from settings and keys. */
  ai: AiServices;
  /** Spending against the month's budget and today's cap. */
  budget: Budget;
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
  /** Every request sent to an outside service, for God's View's API Log. */
  apiLog: ApiLog;
  /** Resolves once the app listens for region servers. */
  ready: Promise<void>;
  close(): Promise<void>;
}

/** HTTP API, static client, and game WebSocket on one server. */
export function createApp(options: AppOptions): App {
  const { store } = options;
  const world = new World(Date.now, Math.random, options.sky);
  world.offlineCreatorXp = (playerId, amount) => store.addCreatorXp(playerId, amount);
  world.onJournal = (text, playerId) => store.addJournal(text, playerId);
  const env = options.wishes.env ?? process.env;
  // Before anything that sends requests is made, so every one of them is logged.
  const apiLog = options.apiLog ?? ApiLog.memory({ env });
  const unwatchFetch = watchFetch(apiLog);
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
  // Money first: every paid call below asks the budget and records its cost there.
  const budget = new Budget(store, options.wishes.now);
  // Every picture and clip takes its turn here, within each model's rate limit.
  const paintQueue = options.paintQueue ?? new MemoryPaintQueue();
  // Google caps Veo clips a day without saying so when it refuses, so the game counts its own.
  const clips = new DailyClips({
    cap: () => dailyClips(store.settings),
    madeSince: (model, since) => store.spendSince(since).filter((s) => s.kind === 'video' && s.model === model).length,
  });
  // Every AI service the game uses, chosen from God's View settings and the server's keys.
  const ai = new AiServices({
    settings: () => store.settings,
    env,
    overBudget: () => budget.state().over,
    offlineGod: new OfflineGod(),
    offlineCompiler: new OfflineCompiler(),
    paintQueue,
    clips,
    overrides: {
      ...pick(options.wishes, ['chatModel', 'compilerModel', 'imageProvider', 'judgeModel']),
      ...(options.videoProvider ? { videoProvider: options.videoProvider } : {}),
      ...(options.sound?.effects ? { effects: options.sound.effects } : {}),
      ...(options.sound?.music ? { music: options.sound.music } : {}),
    },
  });
  // The painting log God's View shows, paintings kept across a restart, and what was sent to make each picture.
  const artJobs = new ArtJobs();
  const paintRequests = new FilePaintRequests(resolve(options.wishes.artDir, 'paint-requests.json'));
  const recipes = new RecipeBook(options.wishes.artDir);
  const wishes = new Wishes(store, world, rules, options.wishes, { ai, budget, artJobs, paintRequests, recipes });
  // Regions run on region servers when there are any (design doc, Scaling without a cap).
  const regionServers = options.regionBus ? new RegionServers(options.regionBus, world, { content: () => wishes.entries() }) : undefined;
  if (regionServers) world.hosting = regionServers;
  const ready = regionServers ? regionServers.start() : Promise.resolve();
  // How hard this process works, for God's View's Server health tab.
  const meter = new LoadMeter();
  const workshop = new Workshop(store, world, wishes, { anchorDir: options.wishes.anchorDir, artDir: options.wishes.artDir, now: options.wishes.now, ai, budget });
  wishes.restore();
  const painterOptions: BuildingPainterOptions = {
    provider: () => ai.image('buildings'),
    overBudget: () => budget.paused(),
    spend: (usd, provider) => budget.spend('image', { provider: provider.id, model: provider.model }, usd),
    anchorDir: options.wishes.anchorDir,
    artDir: options.wishes.artDir,
    shipped: async () => (options.shippedArt ? JSON.parse(await readFile(options.shippedArt, 'utf8')) : {}),
    jobs: artJobs,
    recipes,
  };
  const buildingPainter = new BuildingPainter(painterOptions);
  const walkPainter = new WalkPainter({
    ...painterOptions,
    provider: () => ai.image('walks'),
    video: () => ai.video(),
    spendVideo: (usd, provider) => budget.spend('video', { provider: provider.id, model: provider.model }, usd),
    ...(options.videoFrames ? { toFrames: options.videoFrames } : {}),
    // Pages already open load the new walks without a reload.
    onPainted: (walks) => world.broadcast({ t: 'art', walks }),
  });
  // Sound effects from ElevenLabs and music from Google's Lyria, as chosen in God's View.
  const sounds = new SoundMaker({
    effects: () => ai.effects(),
    music: () => ai.music(),
    overBudget: () => budget.paused(),
    spend: (usd, provider) => budget.spend('sound', { provider: provider.id, model: provider.model }, usd),
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
    if (budget.paused()) return;
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
  // Kit buildings' texture sheets, and the houses drawn from them for the isometric camera.
  const kitSheets = new KitSheets({ shippedDir: options.kitSheets, dir: resolve(options.wishes.artDir, 'kit-sheets'), style: STYLE.kitTextures });
  const kitHouses = new KitHouses({ dir: resolve(options.wishes.artDir, 'kit-houses'), url: '/wished-art/kit-houses', sheets: kitSheets });
  const artStudio = new ArtStudio({
    store, wishes, ai, budget, buildings: buildingPainter, walks: walkPainter, jobs: artJobs, sounds,
    anchorDir: options.wishes.anchorDir, artDir: options.wishes.artDir, shipped: painterOptions.shipped, requests: paintRequests, recipes,
    readArt: artFileReader(options.wishes.artDir, options.shippedArt),
    sheets: kitSheets,
    // Pages already open load a newly painted normal map without a reload.
    onPainted: (ids) => world.broadcast({ t: 'art', walks: ids }),
  });
  // Held items: where each walker's free hand is and where each weapon or charm is gripped.
  const paintedArt = async (): Promise<ArtManifest> => ({ ...(await wishes.kitManifest()), ...buildingPainter.manifest(), ...(await walkPainter.standingManifest()), ...walkPainter.manifest(), ...(await artStudio.manifest()) });
  const handFinder = new HandFinder({
    artDir: options.wishes.artDir,
    model: () => ai.judgeModel(),
    paused: () => budget.paused(),
    spend: (usd, model) => budget.spend('chat', model, usd),
    sources: async () => pointSources(store, await painterOptions.shipped(), await paintedArt(), artFileReader(options.wishes.artDir, options.shippedArt)),
  });
  // Looked for after start-up painting, then now and again for what was painted since.
  if (options.shippedArt) void Promise.resolve(buildingPainter.job).then(() => walkPainter.job).then(() => handFinder.start());
  const handTimer = setInterval(() => void handFinder.start(), 5 * 60_000);
  handTimer.unref?.();
  // Paintings a restart cut short are asked for again, behind start-up painting.
  const resuming = paintRequests.resume({
    wish: (request) => wishes.resumePaint(request),
    repaint: (request) => artStudio.repaint(request.asset, request.note),
    walk: (request) => artStudio.walk(request.walker, request.body, [], false),
    view: (request) => artStudio.paintView(request.walker, request.direction, request.prompt, request.from),
    clip: (request) => artStudio.makeClip(request.walker, request.body, request.direction, request.prompt),
    sheet: (request) => artStudio.paintSheet(request.look, request.textures, request.note),
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

    if (await handleAccount(req, res, path, { store, auth, wishes, homeRegion: () => world.home.def.id, publicUrl: options.publicUrl, commit: options.commit, updater: options.updater, authenticate })) return;

    if (await auth.handle(req, res, url, json, readJson, authenticate(req))) return;

    const admin = { store, world, wishes, ai, budget, rules, reports, builds, art: artStudio, hands: handFinder, resumeArt, clips, kick, updater: options.updater, restarting, env, json, readJson, meter, apiLog, ...(regionServers ? { regionServers } : {}) };
    if (await handleAdmin(req, res, path, authenticate(req), admin)) return;

    if (await handleKitHouses(req, res, url, authenticate(req), { world, houses: kitHouses })) return;

    // Building art and wished biomes' kits painted here, beyond what ships with the game.
    if (path === '/api/art' && req.method === 'GET') return json(res, 200, await paintedArt());
    // Where hands and grips are in painted pictures, for held items.
    if (path === '/api/art-points' && req.method === 'GET') return json(res, 200, await handFinder.manifest());
    // Sound effects and each land's music, made here.
    if (path === '/api/sounds' && req.method === 'GET') return json(res, 200, await sounds.manifest());
    if (path.startsWith('/api/')) return json(res, 404, { error: 'not_found' });

    if (await serveArtFile(options.wishes.artDir, path, req.method, res)) return;

    if (options.clientDir && req.method === 'GET') return serveStatic(options.clientDir, path, res);
    json(res, 404, { error: 'not_found' });
  }

  function authenticate(req: IncomingMessage): Account | undefined {
    const token = bearer(req);
    return token ? store.accountByToken(token) : undefined;
  }

  /** Disconnects a player who was just suspended. */
  function kick(id: string, reason: string): void {
    socket.kick(id, reason);
  }

  /** Tells every player the world is restarting for an update, and saves. */
  async function restarting(): Promise<void> {
    socket.closeAll(4010, 'The world is updating. Back in a moment.');
    saveAll();
    await store.flush();
  }

  const socket = openGameSocket({ server, store, world, wishes, workshop, reports, rules, builds, heartbeatMs: options.heartbeatMs });

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
    ai,
    budget,
    rules,
    reports,
    builds,
    auth,
    art: artStudio,
    hands: handFinder,
    ...(regionServers ? { regionServers } : {}),
    apiLog,
    ready,
    async close() {
      clearInterval(tickTimer);
      meter.close();
      clearTimeout(dayTimer);
      clearInterval(handTimer);
      options.updater?.stop();
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
      await kitHouses.close();
      await Promise.allSettled([...wishes.painting]);
      rules.dispose();
      clearInterval(autosaveTimer);
      await Promise.allSettled([...world.pending]);
      saveAll();
      await regionServers?.close();
      await socket.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.flush();
      unwatchFetch();
      await apiLog.flush();
    },
  };
}

/** The keys of `from` that are set, as a new object. */
function pick<T extends object, K extends keyof T>(from: T, keys: K[]): Partial<Pick<T, K>> {
  return Object.fromEntries(keys.filter((k) => from[k] !== undefined).map((k) => [k, from[k]])) as Partial<Pick<T, K>>;
}
