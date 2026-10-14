import type { IncomingMessage, ServerResponse } from 'node:http';
import { ITEMS, type Role } from '@co-mmo/shared';
import { DEFAULT_MODELS, KEY_ENV, type ProviderId } from './ai/chat.ts';
import { askGod } from './god.ts';
import type { Account, ModelChoice, Settings, Store } from './store.ts';
import type { Wishes } from './wishes.ts';
import type { World } from './world.ts';

export interface AdminContext {
  store: Store;
  world: World;
  wishes: Wishes;
  env: Record<string, string | undefined>;
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
  const { store, world, wishes, json } = ctx;
  if (!account) return json(res, 401, { error: 'unauthorized' }), true;
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
      budget: owner ? wishes.budget() : null,
    }), true;
  }

  if (route === 'content' && method === 'GET') {
    const records = [...store.content].reverse().map((r) => (owner ? r : { ...r, usd: undefined }));
    return json(res, 200, { content: records }), true;
  }

  const contentAction = route.match(/^content\/([\w-]+)\/(rollback|review|paint)$/);
  if (contentAction && method === 'POST') {
    const [, id, action] = contentAction;
    const record = store.contentById(id!);
    if (!record) return json(res, 404, { error: 'not_found' }), true;
    if (action === 'rollback') {
      const done = wishes.rollback(id!);
      return json(res, done ? 200 : 409, done ? { ok: true } : { error: 'not_granted', message: 'Only a granted wish can be rolled back.' }), true;
    }
    if (action === 'review') {
      if (record.tier === 'engine' && ownerOnly()) return true;
      const body = await ctx.readJson(req);
      const done = wishes.review(id!, body?.approve === true);
      return json(res, done ? 200 : 409, done ? { ok: true } : { error: 'not_pending', message: 'This wish is not waiting for review.' }), true;
    }
    if (ownerOnly()) return true;
    const job = wishes.paint(record, true);
    return json(res, job ? 202 : 409, job ? { ok: true } : { error: 'no_image_provider', message: 'Set an image provider with a key first.' }), true;
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
      };
    });
    return json(res, 200, { players }), true;
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
    return json(res, 200, {
      ai: store.settings.ai,
      providers: PROVIDERS.map((id) => ({
        id,
        keySet: id === 'offline' || Boolean(ctx.env[KEY_ENV[id as Exclude<ProviderId, 'offline'>]]),
        keyName: id === 'offline' ? null : KEY_ENV[id as Exclude<ProviderId, 'offline'>],
        defaultModel: DEFAULT_MODELS[id],
      })),
      imageKeySet: Boolean(ctx.env.GEMINI_API_KEY),
    }), true;
  }

  if (route === 'ai' && method === 'PUT') {
    if (ownerOnly()) return true;
    const body = await ctx.readJson(req);
    const god = modelChoice(body?.god);
    if (!god) return json(res, 400, { error: 'bad_model', message: 'Choose a provider and model for the God.' }), true;
    const fallback = body?.fallback ? modelChoice(body.fallback) : null;
    const img = body?.image as Record<string, unknown> | undefined;
    const image: Settings['ai']['image'] = img?.provider === 'gemini'
      ? { provider: 'gemini', model: typeof img.model === 'string' && img.model ? img.model.slice(0, 80) : 'gemini-2.5-flash-image' }
      : { provider: 'none', model: '' };
    store.updateSettings({ ...store.settings, ai: { god, fallback, image } });
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

  if (route === 'budget' && method === 'GET') {
    if (ownerOnly()) return true;
    const spend = store.spendThisMonth(Date.now());
    const byKind: Record<string, number> = {};
    const byPlayer: Record<string, number> = {};
    for (const s of spend) {
      byKind[s.kind] = (byKind[s.kind] ?? 0) + s.usd;
      const name = s.playerId ? store.accountById(s.playerId)?.name ?? 'unknown' : 'system';
      byPlayer[name] = (byPlayer[name] ?? 0) + s.usd;
    }
    return json(res, 200, { ...wishes.budget(), byKind, byPlayer, calls: spend.length }), true;
  }

  if (route === 'budget' && method === 'PUT') {
    if (ownerOnly()) return true;
    const body = await ctx.readJson(req);
    const monthlyUsd = Number(body?.monthlyUsd);
    const warnUsd = Number(body?.warnUsd);
    if (!(monthlyUsd >= 0 && monthlyUsd <= 10_000) || !(warnUsd >= 0 && warnUsd <= monthlyUsd)) {
      return json(res, 400, { error: 'bad_budget', message: 'The warning must be between 0 and the ceiling.' }), true;
    }
    store.updateSettings({ ...store.settings, budget: { monthlyUsd, warnUsd } });
    return json(res, 200, { ok: true }), true;
  }

  if (route === 'items' && method === 'GET') {
    return json(res, 200, { items: Object.keys(ITEMS) }), true;
  }

  json(res, 404, { error: 'not_found' });
  return true;
}

function modelChoice(raw: unknown): ModelChoice | null {
  const r = raw as Record<string, unknown> | undefined;
  if (!r || !PROVIDERS.includes(r.provider as ProviderId)) return null;
  const provider = r.provider as ProviderId;
  const model = typeof r.model === 'string' && r.model.trim() ? r.model.trim().slice(0, 80) : DEFAULT_MODELS[provider];
  return { provider, model };
}
