import type { IncomingMessage, ServerResponse } from 'node:http';
import { ITEMS, WALK_DIRECTIONS, wishProgress, type Role, type WalkDirection } from '@co-mmo/shared';
import { DEFAULT_MODELS, KEY_ENV, type ProviderId } from './ai/chat.ts';
import { askGod } from './god.ts';
import { knownMusicModels, soundUsd } from './assets/sound.ts';
import { knownVideoModels, videoUsd } from './assets/video.ts';
import { estimateImageUsd, knownImageModels } from './assets/wish-art.ts';
import type { LiveRules } from './live-rules.ts';
import type { Reports } from './reports.ts';
import { ART_USES, DEFAULT_BUILDS, DEFAULT_DAILY_USD, dailyClips, DEFAULT_WORKSHOP, soundSettings, styleCheckSettings, videoSettings, type Account, type BuildSettings, type ModelChoice, type Settings, type SoundSettings, type StyleCheckSettings, type Store } from './store.ts';
import type { Builds } from './builds.ts';
import type { DailyClips } from './paint-queue.ts';
import { ArtRequestError, type ArtStudio } from './art-studio.ts';
import type { Updater } from './updates.ts';
import type { Wishes } from './wishes.ts';
import type { World } from './world.ts';
import type { LoadMeter } from './load-meter.ts';
import { hostStatus, type RegionServers } from './region-servers.ts';

export interface AdminContext {
  store: Store;
  world: World;
  wishes: Wishes;
  rules: LiveRules;
  reports: Reports;
  builds: Builds;
  /** The Art tab: painting log, repaints and walks (Owner). */
  art?: ArtStudio;
  /** Paints and makes what is missing, now that a limit was raised. */
  resumeArt?(): void;
  /** Video clips made since Google's daily reset, against the day's cap. */
  clips?: DailyClips;
  /** Disconnects a player now (after a suspension). */
  kick(id: string, reason: string): void;
  /** Pulls main and restarts the game; absent in tests. */
  updater?: Updater;
  /** Disconnects everyone with a "the world is updating" notice and saves. */
  restarting(): Promise<void>;
  env: Record<string, string | undefined>;
  /** How hard this process (the gateway) works. */
  meter: LoadMeter;
  /** The region servers, when REDIS_URL lets them join; absent when every region runs here. */
  regionServers?: RegionServers;
  json(res: ServerResponse, status: number, body: unknown): void;
  readJson(req: IncomingMessage): Promise<Record<string, unknown> | null>;
}

const PROVIDERS: ProviderId[] = ['gemini', 'anthropic', 'openai', 'offline'];

/**
 * God's View API (design doc, God's View). The Owner sees everything;
 * Stewards see the world, the wish queue, the content log and players, but
 * not AI keys or the budget. Returns false when the path is not an admin one.
 */
export async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  account: Account | undefined,
  ctx: AdminContext,
): Promise<boolean> {
  if (!path.startsWith('/api/admin/')) return false;
  const { store, world, wishes, rules, reports, builds, json } = ctx;
  if (!account) return json(res, 401, { error: 'unauthorized' }), true;
  if (account.suspended) return json(res, 403, { error: 'suspended', message: 'Your account is suspended.' }), true;
  if (account.role === 'player') return json(res, 403, { error: 'forbidden', message: "God's View is for Stewards and the Owner." }), true;
  const owner = account.role === 'owner';
  const ownerOnly = () => (owner ? false : (json(res, 403, { error: 'forbidden', message: 'Only the Owner can do that.' }), true));
  const route = path.slice('/api/admin/'.length);
  const method = req.method ?? 'GET';

  if (route === 'overview' && method === 'GET') {
    const regions = [...world.regions.values()].map((r) => ({
      id: r.def.id,
      name: r.def.name,
      biome: r.def.biome,
      at: r.def.at,
      ...(r.def.wild ? { wisher: r.def.wild.wisher, danger: r.def.wild.danger } : {}),
      width: r.map.width,
      height: r.map.height,
      players: r.playerIds().map((id) => ({ id, name: r.nameOf(id), ...r.position(id), level: r.character(id)?.level })),
      creatures: r.creatureIds().map((id) => r.creature(id)).filter(Boolean),
      npcs: r.map.npcs.map((n) => ({ name: n.name, x: n.x, y: n.y })),
      landmarks: r.map.landmarks.map((l) => ({ asset: l.asset, x: l.x, y: l.y })),
    }));
    const content = wishes.entries();
    return json(res, 200, {
      you: { name: account.name, role: account.role },
      regions,
      online: regions.reduce((n, r) => n + r.players.length, 0),
      recent: content.filter((c) => c.status === 'granted').slice(-10).reverse(),
      queue: content.filter((c) => c.status === 'pending').length,
      reports: reports.open().length,
      rules: content.filter((c) => c.status === 'granted' && c.definition?.kind === 'rule').length,
      budget: owner ? wishes.budget() : null,
      update: owner ? updateSummary(ctx.updater) : null,
      building: store.content.filter((c) => c.build && ['queued', 'building', 'review', 'merged'].includes(c.build.state)).length,
    }), true;
  }

  if (route === 'content' && method === 'GET') {
    const records = [...store.content].reverse().map((r) => ({
      ...r,
      progress: wishProgress(r),
      usd: owner ? r.usd : undefined,
      // What each picture cost is the Owner's to see, like the wish's total.
      ...(r.artPrompts && !owner ? { artPrompts: Object.fromEntries(Object.entries(r.artPrompts).map(([k, { usd: _u, ...p }]) => [k, p])) } : {}),
      live: r.status === 'granted' && r.definition?.kind === 'rule' ? rules.status(r.id) ?? null : undefined,
    }));
    return json(res, 200, { content: records }), true;
  }

  const contentAction = route.match(/^content\/([\w-]+)\/(rollback|review|paint|revise|rule|build)$/);
  if (contentAction && method === 'POST') {
    const [, id, action] = contentAction;
    const record = store.contentById(id!);
    if (!record) return json(res, 404, { error: 'not_found' }), true;
    if (action === 'rollback') {
      if (record.build) return json(res, 409, { error: 'code_change', message: 'This wish changed the game\'s code. Undo it by reverting its pull request on GitHub, then update.' }), true;
      const done = wishes.rollback(id!);
      return json(res, done ? 200 : 409, done ? { ok: true } : { error: 'not_granted', message: 'Only a granted wish can be rolled back.' }), true;
    }
    if (action === 'review') {
      if (record.tier === 'engine' && ownerOnly()) return true;
      const body = await ctx.readJson(req);
      const done = await wishes.review(id!, body?.approve === true);
      if ('error' in done) return json(res, 409, done), true;
      // An approved Engine wish goes to the coding agent.
      if (record.tier === 'engine' && done.record.status === 'approved') {
        await builds.queue(id!, typeof body?.note === 'string' ? body.note : undefined, body?.allowCore === true);
      }
      return json(res, 200, { ok: true, status: store.contentById(id!)?.status, build: store.contentById(id!)?.build?.state }), true;
    }
    if (action === 'build') {
      // Send a Major wish to be built as code, queue an approved one, or try a failed build again.
      if (ownerOnly()) return true;
      const body = await ctx.readJson(req);
      const note = typeof body?.note === 'string' ? body.note : undefined;
      const allowCore = body?.allowCore === true;
      if (record.build?.state === 'failed') {
        const done = await builds.retry(id!, note);
        return json(res, done ? 200 : 409, done ? { ok: true, build: done.build?.state } : { error: 'not_failed' }), true;
      }
      const sendable = (record.status === 'pending' && (record.tier === 'major' || record.tier === 'engine')) || (record.status === 'approved' && !record.build);
      if (!sendable) return json(res, 409, { error: 'not_buildable', message: 'Only a Major or Engine wish that is not built yet can be sent to be built.' }), true;
      const done = await builds.queue(id!, note, allowCore);
      if (record.status === 'pending') wishes.tellWisher(record, `Your wish "${record.title}" was approved. It will be built into the game, and you will hear when it is live.`);
      return json(res, 200, { ok: true, build: done?.build?.state }), true;
    }
    if (action === 'revise') {
      if (record.status !== 'pending' || record.tier !== 'major') return json(res, 409, { error: 'not_major', message: 'Only a Major wish waiting for review can have a rule drafted.' }), true;
      const body = await ctx.readJson(req);
      const note = typeof body?.note === 'string' ? body.note : '';
      const job = wishes.draft(id!, note);
      return json(res, 202, { ok: true, drafting: Boolean(job) }), true;
    }
    if (action === 'rule') {
      const body = await ctx.readJson(req);
      const done = rules.setPaused(id!, body?.paused === true, `Paused by ${account.name}.`);
      if (done) wishes.changed(id!);
      return json(res, done ? 200 : 409, done ? { ok: true } : { error: 'not_live', message: 'This rule is not running.' }), true;
    }
    // A Steward or the Owner may reword one picture's prompt before it is painted again; a plain repaint is the Owner's.
    const body = await ctx.readJson(req);
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim().slice(0, 4000) : '';
    const picture = typeof body?.picture === 'string' ? body.picture : '';
    if (!prompt && ownerOnly()) return true;
    if (prompt && !record.artPrompts?.[picture]) return json(res, 409, { error: 'no_prompt', message: 'Only a picture that was painted before can be repainted with new words.' }), true;
    const job = wishes.paint(record, owner, prompt ? { [picture]: prompt } : {}, picture || undefined);
    return json(res, job ? 202 : 409, job ? { ok: true } : { error: 'no_image_provider', message: 'Nothing can be painted now: no image model is set, or this month\'s budget is spent.' }), true;
  }

  if (route === 'players' && method === 'GET') {
    const players = store.accounts.map((a) => {
      const region = world.regionOf(a.id);
      const c = region?.character(a.id) ?? a.character;
      return {
        id: a.id,
        name: a.name,
        role: a.role,
        online: Boolean(region),
        region: region?.def.name ?? null,
        level: c?.level ?? 1,
        favor: c?.favor ?? null,
        createdAt: a.createdAt,
        invitedBy: a.invitedBy ? store.accountById(a.invitedBy)?.name ?? null : null,
        suspended: a.suspended ? { ...a.suspended, by: store.accountById(a.suspended.by)?.name ?? 'someone' } : null,
      };
    });
    return json(res, 200, { players, you: account.id }), true;
  }

  const suspend = route.match(/^players\/([\w-]+)\/suspend$/);
  if (suspend && method === 'POST') {
    const target = store.accountById(suspend[1]!);
    if (!target) return json(res, 404, { error: 'not_found' }), true;
    // Stewards can suspend players; only the Owner can suspend a Steward. Nobody suspends the Owner.
    if (target.role === 'owner' || target.id === account.id || (target.role === 'steward' && !owner)) {
      return json(res, 403, { error: 'forbidden', message: target.role === 'steward' ? 'Only the Owner can suspend a Steward.' : 'You cannot suspend this account.' }), true;
    }
    const body = await ctx.readJson(req);
    if (body?.suspend === true) {
      const reason = typeof body.reason === 'string' ? body.reason.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      store.setSuspended(target.id, { by: account.id, at: Date.now(), reason });
      ctx.kick(target.id, `You were suspended${reason ? `: ${reason}` : ''}.`);
    } else {
      store.setSuspended(target.id, null);
    }
    return json(res, 200, { ok: true }), true;
  }

  if (route === 'reports' && method === 'GET') {
    const list = [...store.reports].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || b.at - a.at).slice(0, 200);
    const named = list.map((r) => (r.closed ? { ...r, closed: { ...r.closed, by: store.accountById(r.closed.by)?.name ?? 'someone' } } : r));
    return json(res, 200, { reports: named }), true;
  }

  const closeReport = route.match(/^reports\/([\w-]+)\/close$/);
  if (closeReport && method === 'POST') {
    const body = await ctx.readJson(req);
    const status = body?.status === 'resolved' ? 'resolved' : 'dismissed';
    const action = typeof body?.action === 'string' && body.action.trim() ? body.action.trim().slice(0, 200) : status === 'resolved' ? 'handled' : 'no action';
    const done = reports.close(closeReport[1]!, account.id, status, action);
    return json(res, done ? 200 : 409, done ? { ok: true } : { error: 'not_open', message: 'This report is already closed.' }), true;
  }

  const role = route.match(/^players\/([\w-]+)\/role$/);
  if (role && method === 'POST') {
    if (ownerOnly()) return true;
    const body = await ctx.readJson(req);
    const next = body?.role;
    if (next !== 'steward' && next !== 'player') return json(res, 400, { error: 'bad_role' }), true;
    const target = store.accountById(role[1]!);
    if (!target || target.role === 'owner') return json(res, 404, { error: 'not_found' }), true;
    store.setRole(target.id, next as Role);
    world.sendTo(target.id, {
      t: 'god',
      say: next === 'steward' ? 'You are named a Steward of this world. Keep it kind.' : 'You are no longer a Steward. Thank you for your care.',
    });
    return json(res, 200, { ok: true }), true;
  }

  if (route === 'ai' && method === 'GET') {
    if (ownerOnly()) return true;
    const video = { ...videoSettings(store.settings, ctx.env), dailyClips: dailyClips(store.settings) };
    const clips = video.provider === 'gemini' && ctx.clips ? ctx.clips.used(video.model) : undefined;
    return json(res, 200, {
      ai: { ...store.settings.ai, video, sound: soundSettings(store.settings, ctx.env), styleCheck: styleCheckSettings(store.settings) },
      providers: PROVIDERS.map((id) => ({
        id,
        keySet: id === 'offline' || Boolean(ctx.env[KEY_ENV[id as Exclude<ProviderId, 'offline'>]]),
        keyName: id === 'offline' ? null : KEY_ENV[id as Exclude<ProviderId, 'offline'>],
        defaultModel: DEFAULT_MODELS[id],
      })),
      imageKeySet: Boolean(ctx.env.GEMINI_API_KEY),
      ...(clips ? { clipsToday: { count: clips.count, resetsAt: clips.resetsAt } } : {}),
      effectsKeySet: Boolean(ctx.env.ELEVENLABS_API_KEY),
      // Every key the game can use, whether it is set, and what it is for; never the key itself.
      keys: [
        { name: 'GEMINI_API_KEY', set: Boolean(ctx.env.GEMINI_API_KEY), for: 'Google: the God, pictures, walk videos (Veo) and music (Lyria)' },
        { name: 'ANTHROPIC_API_KEY', set: Boolean(ctx.env.ANTHROPIC_API_KEY), for: 'Anthropic Claude for the God' },
        { name: 'OPENAI_API_KEY', set: Boolean(ctx.env.OPENAI_API_KEY), for: 'OpenAI or a compatible service for the God' },
        { name: 'ELEVENLABS_API_KEY', set: Boolean(ctx.env.ELEVENLABS_API_KEY), for: 'ElevenLabs sound effects' },
      ],
      // Models with a known price, offered in each picker; any other name can still be typed.
      catalog: {
        image: knownImageModels().map((model) => ({ model, usd: estimateImageUsd(model), per: 'picture' })),
        video: knownVideoModels().map((model) => ({ model, usd: videoUsd(model, { mimeType: 'video/mp4', data: Buffer.alloc(0), seconds: 8 }), per: '8-second clip' })),
        music: knownMusicModels().map((model) => ({ model, usd: soundUsd(model, { seconds: 30 }), per: 'track' })),
        effects: [{ model: 'eleven_text_to_sound_v2', usd: soundUsd('eleven_text_to_sound_v2', { seconds: 1 }), per: 'second of sound' }],
      },
    }), true;
  }

  if (route === 'ai' && method === 'PUT') {
    if (ownerOnly()) return true;
    const body = await ctx.readJson(req);
    const god = modelChoice(body?.god);
    if (!god) return json(res, 400, { error: 'bad_model', message: 'Choose a provider and model for the God.' }), true;
    const fallback = body?.fallback ? modelChoice(body.fallback) : null;
    const compiler = body?.compiler ? modelChoice(body.compiler) : null;
    const img = body?.image as Record<string, unknown> | undefined;
    const image: Settings['ai']['image'] = img?.provider === 'gemini'
      ? { provider: 'gemini', model: typeof img.model === 'string' && img.model ? img.model.slice(0, 80) : 'gemini-2.5-flash-image' }
      : { provider: 'none', model: '' };
    // Each kind of art may name its own image model; blank uses the main one.
    const uses = (img?.uses ?? {}) as Record<string, unknown>;
    const chosen = Object.fromEntries(ART_USES.flatMap((u) => (typeof uses[u] === 'string' && (uses[u] as string).trim() ? [[u, (uses[u] as string).trim().slice(0, 80)]] : [])));
    if (image.provider === 'gemini' && Object.keys(chosen).length) image.uses = chosen;
    const vid = body?.video as Record<string, unknown> | undefined;
    const video: Settings['ai']['video'] = vid === undefined ? videoSettings(store.settings, ctx.env)
      : vid.provider === 'gemini' ? { provider: 'gemini', model: typeof vid.model === 'string' && vid.model.trim() ? vid.model.trim().slice(0, 80) : 'veo-3.1-lite-generate-preview' }
      : { provider: 'none', model: '' };
    // Google's daily clip cap for the key, which the game stops at rather than finding out from refusals.
    const clipsADay = vid?.dailyClips === undefined || vid.dailyClips === '' ? dailyClips(store.settings) : Number(vid.dailyClips);
    if (!(Number.isInteger(clipsADay) && clipsADay >= 0 && clipsADay <= 1000)) {
      return json(res, 400, { error: 'bad_daily_clips', message: 'Clips a day must be a whole number from 0 to 1000.' }), true;
    }
    if (video) video.dailyClips = clipsADay;
    const sound = soundChoice(body?.sound, soundSettings(store.settings, ctx.env));
    const styleCheck = styleCheckChoice(body?.styleCheck, styleCheckSettings(store.settings));
    store.updateSettings({ ...store.settings, ai: { god, fallback, compiler, image, video, sound, styleCheck } });
    // A raised clip limit lets walks held back today be made now.
    ctx.resumeArt?.();
    return json(res, 200, { ok: true }), true;
  }

  if (route === 'ai/test' && method === 'POST') {
    if (ownerOnly()) return true;
    const body = await ctx.readJson(req);
    const prompt = typeof body?.prompt === 'string' ? body.prompt.slice(0, 400) : '';
    if (!prompt) return json(res, 400, { error: 'empty' }), true;
    try {
      let usd = 0;
      const { reply, model } = await askGod(
        wishes.models(),
        { playerName: account.name, role: account.role, favor: 0, regionName: 'the Sanctum', biome: 'Sanctum', nearby: [], recentWishes: [] },
        [{ role: 'user', content: prompt }],
        (r, m) => {
          usd += r.usd;
          store.recordSpend({ at: Date.now(), usd: r.usd, kind: 'chat', provider: m.provider, model: m.model, playerId: account.id });
        },
      );
      return json(res, 200, { provider: model.provider, model: model.model, reply, usd }), true;
    } catch (err) {
      return json(res, 502, { error: 'model_failed', message: (err as Error).message }), true;
    }
  }

  if (route === 'builds' && method === 'GET') {
    if (ownerOnly()) return true;
    return json(res, 200, { settings: builds.settings, connection: builds.connection(), today: builds.buildsToday() }), true;
  }

  if (route === 'builds' && method === 'PUT') {
    if (ownerOnly()) return true;
    const body = await ctx.readJson(req);
    const next = buildSettings(body);
    if (!next) return json(res, 400, { error: 'bad_builds', message: 'Builds per day must be 0 to 20, and the cost per build $0 to $50.' }), true;
    store.updateSettings({ ...store.settings, builds: next });
    void builds.pump();
    return json(res, 200, { ok: true }), true;
  }

  if (route === 'builds/sync' && method === 'POST') {
    if (ownerOnly()) return true;
    await builds.sync();
    return json(res, 200, { ok: true, connection: builds.connection() }), true;
  }

  // The Art tab: every picture, the painting log, and paid repaints, all the Owner's.
  if (route.startsWith('art') && ctx.art) {
    if (ownerOnly()) return true;
    if (route === 'art' && method === 'GET') return json(res, 200, await ctx.art.overview()), true;
    if (route === 'art/jobs' && method === 'GET') return json(res, 200, { jobs: ctx.art.jobs(), budget: wishes.budget() }), true;
    const body = method === 'POST' ? await ctx.readJson(req) : null;
    try {
      if (route === 'art/paint' && method === 'POST') {
        const done = await ctx.art.repaint(String(body?.asset ?? ''), typeof body?.note === 'string' ? body.note : '');
        return json(res, 202, { ok: true, ...done }), true;
      }
      if (route === 'art/paint-group' && method === 'POST') {
        const done = await ctx.art.repaintGroup(String(body?.group ?? ''));
        return json(res, 202, { ok: true, ...done }), true;
      }
      if (route === 'art/restore' && method === 'POST') {
        await ctx.art.restore(String(body?.asset ?? ''), String(body?.version ?? ''));
        return json(res, 200, { ok: true }), true;
      }
      if (route === 'art/sound' && method === 'POST') {
        const done = await ctx.art.sound(String(body?.sound ?? ''), typeof body?.note === 'string' ? body.note : '');
        return json(res, 202, { ok: true, ...done }), true;
      }
      if (route === 'art/walk' && method === 'POST') {
        const directions = Array.isArray(body?.directions) ? body.directions.filter((d): d is WalkDirection => typeof d === 'string' && (WALK_DIRECTIONS as readonly string[]).includes(d)) : [];
        const done = await ctx.art.walk(String(body?.walker ?? ''), String(body?.body ?? 'two-legged'), directions, body?.views === true);
        return json(res, 202, { ok: true, ...done }), true;
      }
    } catch (err) {
      if (err instanceof ArtRequestError) return json(res, 409, { error: 'art_refused', message: err.message }), true;
      throw err;
    }
  }

  if (route === 'budget' && method === 'GET') {
    if (ownerOnly()) return true;
    const spend = store.spendThisMonth(Date.now());
    const byKind: Record<string, number> = {};
    const byPlayer: Record<string, number> = {};
    const byProvider: Record<string, number> = {};
    let estimatedUsd = 0;
    for (const s of spend) {
      const kind = s.sample ? 'sample' : s.kind;
      byKind[kind] = (byKind[kind] ?? 0) + s.usd;
      byProvider[providerName(s.provider)] = (byProvider[providerName(s.provider)] ?? 0) + s.usd;
      if (s.estimate) estimatedUsd += s.usd;
      const name = s.playerId ? store.accountById(s.playerId)?.name ?? 'unknown' : 'system';
      byPlayer[name] = (byPlayer[name] ?? 0) + s.usd;
    }
    return json(res, 200, { ...wishes.budget(), byKind, byPlayer, byProvider, estimatedUsd, calls: spend.length, workshop: store.settings.workshop ?? DEFAULT_WORKSHOP }), true;
  }

  if (route === 'budget' && method === 'PUT') {
    if (ownerOnly()) return true;
    const body = await ctx.readJson(req);
    const monthlyUsd = Number(body?.monthlyUsd);
    const warnUsd = Number(body?.warnUsd);
    if (!(monthlyUsd >= 0 && monthlyUsd <= 10_000) || !(warnUsd >= 0 && warnUsd <= monthlyUsd)) {
      return json(res, 400, { error: 'bad_budget', message: 'The warning must be between 0 and the ceiling.' }), true;
    }
    const dailyUsd = body?.dailyUsd === undefined ? store.settings.budget.dailyUsd ?? DEFAULT_DAILY_USD : Number(body.dailyUsd);
    if (!(dailyUsd >= 0 && dailyUsd <= monthlyUsd)) {
      return json(res, 400, { error: 'bad_daily', message: 'The daily cap must be between 0 and the monthly ceiling.' }), true;
    }
    // Workshop samples are paid painting, so their switch sits with the budget.
    const sampleFavor = Number(body?.sampleFavor ?? DEFAULT_WORKSHOP.sampleFavor);
    if (!(Number.isInteger(sampleFavor) && sampleFavor >= 0 && sampleFavor <= 10)) {
      return json(res, 400, { error: 'bad_sample_favor', message: 'A sample costs 0 to 10 Favor.' }), true;
    }
    store.updateSettings({ ...store.settings, budget: { monthlyUsd, warnUsd, dailyUsd }, workshop: { samples: body?.samples === true, sampleFavor } });
    // A raised limit lets what was held back be painted now.
    ctx.resumeArt?.();
    return json(res, 200, { ok: true }), true;
  }

  // Server health (Owner): where each region runs and how hard each host works.
  if (route === 'servers' && method === 'GET') {
    if (ownerOnly()) return true;
    const servers = ctx.regionServers;
    return json(res, 200, {
      hosts: servers ? servers.status(ctx.meter.load()) : hostStatus(world, ctx.meter.load()),
      regionServers: Boolean(servers),
      store: store.label,
      now: Date.now(),
    }), true;
  }

  // Moves a region to another host, or sets it up again where it is (a restart).
  if (route === 'servers/move' && method === 'POST') {
    if (ownerOnly()) return true;
    const body = await ctx.readJson(req);
    const id = typeof body?.region === 'string' ? body.region : '';
    const region = world.region(id);
    if (!region) return json(res, 404, { error: 'not_found', message: 'There is no such region.' }), true;
    const to = typeof body?.to === 'string' && body.to ? body.to : region.host;
    try {
      if (ctx.regionServers) await ctx.regionServers.move(id, to);
      else if (to === 'gateway') await world.moveRegion(id);
      else return json(res, 400, { error: 'no_server', message: 'That region server is not running.' }), true;
    } catch (err) {
      return json(res, 400, { error: 'cannot_move', message: (err as Error).message }), true;
    }
    const moved = world.region(id)!;
    return json(res, 200, { region: id, host: moved.host, message: to === region.host ? `Restarted ${moved.def.name}.` : `Moved ${moved.def.name}.` }), true;
  }

  if (route === 'update' && method === 'GET') {
    if (ownerOnly()) return true;
    if (!ctx.updater) return json(res, 200, { available: false, reason: 'Updates are off on this server.' }), true;
    return json(res, 200, { ...(ctx.updater.cached() ?? (await ctx.updater.check())), releases: releases(store) }), true;
  }

  if (route === 'update/check' && method === 'POST') {
    if (ownerOnly()) return true;
    if (!ctx.updater) return json(res, 409, { error: 'no_updates', message: 'Updates are off on this server.' }), true;
    return json(res, 200, { ...(await ctx.updater.check(true)), releases: releases(store) }), true;
  }

  if (route === 'update' && method === 'POST') {
    if (ownerOnly()) return true;
    if (!ctx.updater) return json(res, 409, { error: 'no_updates', message: 'Updates are off on this server.' }), true;
    const done = await ctx.updater.request(account.name, ctx.restarting);
    if (!done.ok) return json(res, 409, { error: 'blocked', message: done.message }), true;
    return json(res, 202, { ok: true, from: done.status.commit, to: done.status.upstream }), true;
  }

  if (route === 'items' && method === 'GET') {
    return json(res, 200, { items: Object.keys(ITEMS) }), true;
  }

  json(res, 404, { error: 'not_found' });
  return true;
}

function updateSummary(updater: Updater | undefined): { behind: number; blocked?: string } | null {
  const s = updater?.cached();
  return s?.available ? { behind: s.behind, blocked: s.blocked } : null;
}

/** Merged wishes the next update makes live. */
function releases(store: Store): { id: string; title: string; wisher: string; pr?: string }[] {
  return store.content
    .filter((c) => c.build?.state === 'merged')
    .map((c) => ({ id: c.id, title: c.title, wisher: c.wisher.name, ...(c.build?.pr ? { pr: c.build.pr.url } : {}) }));
}

function buildSettings(raw: Record<string, unknown> | null): BuildSettings | null {
  if (!raw) return null;
  const agent = raw.agent === 'manual' ? 'manual' : 'claude';
  const dailyLimit = raw.dailyLimit === undefined ? DEFAULT_BUILDS.dailyLimit : Number(raw.dailyLimit);
  const usdPerBuild = raw.usdPerBuild === undefined ? DEFAULT_BUILDS.usdPerBuild : Number(raw.usdPerBuild);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 20) return null;
  if (!(usdPerBuild >= 0 && usdPerBuild <= 50)) return null;
  return { agent, dailyLimit, usdPerBuild };
}

function modelChoice(raw: unknown): ModelChoice | null {
  const r = raw as Record<string, unknown> | undefined;
  if (!r || !PROVIDERS.includes(r.provider as ProviderId)) return null;
  const provider = r.provider as ProviderId;
  const model = typeof r.model === 'string' && r.model.trim() ? r.model.trim().slice(0, 80) : DEFAULT_MODELS[provider];
  return { provider, model };
}

/** The style check as God's View set it; anything missing keeps what was set. */
function styleCheckChoice(raw: unknown, current: StyleCheckSettings): StyleCheckSettings {
  const r = raw as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return current;
  const judge = r.judge === null ? null : r.judge === undefined ? current.judge : modelChoice(r.judge) ?? current.judge;
  const retries = typeof r.retries === 'number' && Number.isFinite(r.retries) ? Math.max(0, Math.min(2, Math.round(r.retries))) : current.retries;
  return { judge, retries, reuse: typeof r.reuse === 'boolean' ? r.reuse : current.reuse };
}

/** The company that bills each provider id, as the Owner sees it on their invoices. */
function providerName(provider: string): string {
  return ({ gemini: 'Google (Gemini)', anthropic: 'Anthropic (Claude)', 'claude-code': 'Anthropic (Claude)', openai: 'OpenAI', elevenlabs: 'ElevenLabs' } as Record<string, string>)[provider] ?? provider;
}

/** The sound services God's View chose; anything missing or unknown keeps what was set. */
function soundChoice(raw: unknown, current: SoundSettings): SoundSettings {
  const r = (raw ?? {}) as { effects?: { provider?: unknown; model?: unknown }; music?: { provider?: unknown; model?: unknown } };
  const model = (m: unknown, fallback: string) => (typeof m === 'string' && m.trim() ? m.trim().slice(0, 80) : fallback);
  const effects: SoundSettings['effects'] = r.effects?.provider === 'elevenlabs'
    ? { provider: 'elevenlabs', model: model(r.effects.model, 'eleven_text_to_sound_v2') }
    : r.effects?.provider === 'none' ? { provider: 'none', model: '' } : current.effects;
  const music: SoundSettings['music'] = r.music?.provider === 'gemini'
    ? { provider: 'gemini', model: model(r.music.model, 'lyria-3-clip-preview') }
    : r.music?.provider === 'none' ? { provider: 'none', model: '' } : current.music;
  return { effects, music };
}
