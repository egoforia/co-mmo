import { describe, expect, it } from 'vitest';
import { Tile, collides, tileAt, validateRule, type GodMessage } from '@co-mmo/shared';
import type { ChatModel, ChatRequest } from '../src/ai/chat.ts';
import { FISHING, OfflineCompiler, compileRule } from '../src/compiler.ts';
import { testRule } from '../src/rule-test.ts';
import { LIMITS, RuleRuntime, type RuleHost } from '../src/rules.ts';
import { account, api, app, connect, joined, pray, start, wish } from './helpers.ts';

/** A world of one player, recording what the rule did. */
function fakeHost() {
  const log: string[] = [];
  const bag = new Map<string, number>();
  let gold = 0;
  const host: RuleHost = {
    name: (p) => (p === 'p1' ? 'Mara' : null),
    where: (p) => (p === 'p1' ? { region: 'shore', biome: 'sunlit-shore', x: 10, y: 10 } : null),
    near: (_p, tile) => tile === 'water',
    count: (_p, item) => bag.get(item) ?? 0,
    give: (_p, item, qty) => (bag.set(item, (bag.get(item) ?? 0) + qty), true),
    take: (_p, item, qty) => {
      if ((bag.get(item) ?? 0) < qty) return false;
      bag.set(item, bag.get(item)! - qty);
      return true;
    },
    heal: () => true,
    hurt: () => true,
    gold: (_p, n) => ((gold += n), true),
    xp: () => true,
    tell: (_p, text) => (log.push(text), true),
    announce: (_p, text) => (log.push(`[all] ${text}`), true),
  };
  return { host, log, bag, gold: () => gold };
}

async function load(script: string, opts: { now?: () => number; items?: Record<string, unknown> } = {}) {
  const fake = fakeHost();
  const data: Record<string, Record<string, Record<string, unknown>>> = {};
  const paused: string[] = [];
  const rule = await RuleRuntime.load('wrule1', validateRule({ name: 'Test', script, items: opts.items ?? {} }), {
    host: fake.host,
    state: { read: (id) => data[id] ?? {}, write: (id, d) => void (data[id] = d) },
    now: opts.now,
    random: () => 0.5,
    onPause: (reason) => paused.push(reason),
  });
  return { rule, ...fake, data, paused };
}

describe('the rule sandbox', () => {
  it('runs handlers with the game API, its own items and saved state', async () => {
    const { rule, log, bag, data } = await load(`
      on('use', (e) => {
        const n = (game.get(e.player, 'uses') || 0) + 1;
        game.set(e.player, 'uses', n);
        game.give(e.player, 'pebble', 2);
        game.tell(e.player, game.name(e.player) + ' used ' + e.item + ' ' + n + ' times in ' + e.biome);
      });`, { items: { pebble: { name: 'Pebble', description: 'Smooth.', itemKind: 'material' } } });
    rule.fire('use', 'p1', { item: 'wrule1-pebble' });
    rule.fire('use', 'p1', { item: 'tonic' });
    expect(log).toEqual(['Mara used pebble 1 times in sunlit-shore', 'Mara used tonic 2 times in sunlit-shore']);
    expect(bag.get('wrule1-pebble')).toBe(4);
    expect(data.wrule1!.p1).toEqual({ uses: 2 });
    expect(rule.events).toEqual(['use']);
    rule.dispose();
  });

  it('has no way out: no fetch, require, process or timers of its own', async () => {
    const { rule, log } = await load(`on('join', (e) => game.tell(e.player, [typeof fetch, typeof require, typeof process, typeof setTimeout, typeof __host].join(',')));`);
    rule.fire('join', 'p1');
    expect(log).toEqual(['undefined,undefined,undefined,undefined,undefined']);
    rule.dispose();
  });

  it('fires timers on time, with the player in the event', async () => {
    let now = 1_000_000;
    const { rule, log } = await load(`
      on('interact', (e) => game.after(5, 'ding', { player: e.player, n: 3 }));
      on('ding', (e) => game.tell(e.player, 'ding ' + e.data.n));`, { now: () => now });
    rule.fire('interact', 'p1', { tile: 'water' });
    now += 4000;
    rule.tick();
    expect(log).toEqual([]);
    now += 1000;
    rule.tick();
    expect(log).toEqual(['ding 3']);
    rule.dispose();
  });

  it('stops a runaway loop and pauses the rule after repeated limit hits', async () => {
    const { rule, paused } = await load(`on('join', () => { while (true) {} });`);
    const started = Date.now();
    for (let i = 0; i < 4; i++) rule.fire('join', 'p1');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(rule.status.paused).toBe(true);
    expect(rule.status.runs).toBe(LIMITS.limitHitsToPause);
    expect(paused[0]).toMatch(/limits/);
    rule.dispose();
  });

  it('pauses a rule that keeps throwing errors', async () => {
    const { rule, paused } = await load(`on('use', () => { throw new Error('oops'); });`);
    for (let i = 0; i < 6; i++) rule.fire('use', 'p1', { item: 'tonic' });
    expect(rule.status.paused).toBe(true);
    expect(rule.status.errors.at(-1)!.message).toMatch(/oops/);
    expect(paused).toHaveLength(1);
    rule.dispose();
  });

  it('enforces balance caps per player per hour', async () => {
    const { rule, gold } = await load(`on('interact', (e) => { for (let i = 0; i < 10; i++) game.gold(e.player, 999); });`);
    rule.fire('interact', 'p1', { tile: 'rock' });
    // Each call is cut to the per-call maximum, and the hour's total is capped.
    expect(gold()).toBe(LIMITS.perHour.gold);
    expect(rule.status.effects['capped-gold']).toBeGreaterThan(0);
    rule.dispose();
  });

  it('refuses unknown items and the Bible', async () => {
    const { rule } = await load(`on('use', (e) => game.give(e.player, e.item));`);
    rule.fire('use', 'p1', { item: 'bible' });
    rule.fire('use', 'p1', { item: 'dragon-egg' });
    expect(rule.status.errors.map((e) => e.message)).toEqual([expect.stringMatching(/Unknown item "bible"/), expect.stringMatching(/Unknown item "dragon-egg"/)]);
    rule.dispose();
  });

  it('reports scripts that do not load', async () => {
    await expect(load(`on('join', (e) => {`)).rejects.toThrow(/SyntaxError/);
  });
});

describe('the test run', () => {
  it('passes the fishing rule, which catches fish in the launch regions', async () => {
    const report = await testRule('wfish', validateRule(FISHING));
    expect(report.passed).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.effects.give).toBeGreaterThan(4);
    expect(report.sample.join('\n')).toMatch(/Fishing Rod appears/);
  });

  it('fails a rule that does nothing, or that breaks', async () => {
    expect((await testRule('wnone', validateRule({ name: 'Nothing', script: `on('join', () => {});` }))).passed).toBe(false);
    const broken = await testRule('wbroken', validateRule({ name: 'Broken', script: `on('join', (e) => game.give(e.player, 'nonsense'));` }));
    expect(broken.passed).toBe(false);
    expect(broken.errors[0]).toMatch(/Unknown item/);
  });
});

describe('the rule compiler', () => {
  it('knows fishing offline and says when it cannot draft', async () => {
    const offline = new OfflineCompiler();
    const fishing = await compileRule([offline], { title: 'Fishing', summary: 'Fishing at the shore', conversation: [] }, () => undefined);
    expect(fishing).toMatchObject({ ok: true, definition: { name: 'Fishing' } });
    const weather = await compileRule([offline], { title: 'Weather', summary: 'Rain', conversation: [] }, () => undefined);
    expect(weather).toMatchObject({ ok: false, impossible: true });
  });
});

/** A model that answers from a list, recording what it was asked. */
function scripted(replies: unknown[]): ChatModel & { asked: ChatRequest[] } {
  return {
    provider: 'gemini',
    model: 'scripted-test',
    asked: [],
    async complete(req) {
      this.asked.push(req);
      return { text: JSON.stringify(replies.shift() ?? { impossible: 'out of answers' }), inputTokens: 10, outputTokens: 10, usd: 0.001 };
    },
  };
}

/** A walkable spot beside water in a region. */
function besideWater(regionId: string): { x: number; y: number } {
  const map = app!.world.region(regionId)!.map;
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) {
      if (tileAt(map, x, y) !== Tile.Water) continue;
      const s = { x: x - 0.5, y: y + 0.5 };
      if (!collides(map, s.x, s.y)) return s;
    }
  }
  throw new Error('no water');
}

describe('scripted wishes in the game', () => {
  it('drafts, tests and, once a Steward approves, runs fishing for everyone', async () => {
    let clock = Date.UTC(2026, 9, 14, 12);
    const { store, ws, base } = await start({ now: () => clock });
    const ilya = account(store, 'Ilya');
    const mara = account(store, 'Mara', 'steward');
    const c = await joined(ws, ilya.token);
    const s = await joined(ws, mara.token);

    await wish(c, 'I wish we could go fishing at the shore');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('Stewards'));
    await Promise.all([...app!.wishes.drafts]);
    const record = store.content[0]!;
    expect(record).toMatchObject({ status: 'pending', draft: { state: 'ready' }, test: { passed: true }, definition: { kind: 'rule', name: 'Fishing' } });
    await s.waitFor((m) => m.t === 'notice' && m.text.includes('waits for your review'));
    // Everyone sees where the wish stands, live.
    await c.waitFor((m) => m.t === 'content' && m.entries.some((e) => e.progress?.label === 'Ready, waiting for a Steward'));

    // Players never see the script.
    const log = await api(base, '/api/admin/content', mara.token);
    expect(log.body.content[0].definition.script).toContain("on('interact'");
    expect(app!.wishes.entries()[0]!.definition).not.toHaveProperty('script');
    expect(log.body.content[0].progress).toMatchObject({ state: 'needs-input' });

    expect((await api(base, `/api/admin/content/${record.id}/review`, mara.token, 'POST', { approve: true })).body).toMatchObject({ ok: true, status: 'granted' });
    await c.waitFor((m) => m.t === 'system' && m.text.includes('Fishing'));
    const rod = `${record.id}-rod`;
    const sanctum = app!.world.region('sanctum')!;
    expect(sanctum.character(ilya.id)!.inventory.map((i) => i.item)).toContain(rod);

    // Cast at the pond, wait for a bite.
    const spot = besideWater('sanctum');
    sanctum.placePlayer(ilya.id, spot.x, spot.y);
    await c.send({ t: 'interact' });
    await c.waitFor((m) => m.t === 'notice' && m.text.includes('cast your line'));
    clock += 10_000;
    await c.waitFor((m) => m.t === 'notice' && /caught a fish|Nothing bites/.test(m.text) || m.t === 'system' && m.text.includes('Golden Carp'));
    expect(app!.rules.status(record.id)).toMatchObject({ paused: false });
    expect(app!.wishes.entries()[0]!.progress).toMatchObject({ state: 'done', label: 'Live' });

    // Rolling the rule back stops it and takes its items away.
    expect((await api(base, `/api/admin/content/${record.id}/rollback`, mara.token, 'POST')).status).toBe(200);
    expect(app!.rules.status(record.id)).toBeUndefined();
    expect(sanctum.character(ilya.id)!.inventory.some((i) => i.item.startsWith(record.id))).toBe(false);
  });

  it('retries a draft that fails its test run, then takes a Steward\'s revision', async () => {
    const bad = { name: 'Gifts', description: 'A gift.', howTo: 'Log in.', items: {}, script: `on('join', (e) => game.give(e.player, 'nothing-here'));` };
    const good = { ...bad, script: `on('join', (e) => { game.give(e.player, 'tonic'); game.tell(e.player, 'A gift!'); });` };
    const kinder = { ...good, script: `on('join', (e) => { game.give(e.player, 'tonic', 2); game.tell(e.player, 'Two gifts!'); });` };
    const model = scripted([bad, good, kinder]);
    const { store, ws, base } = await start({ compiler: () => [model] });
    const owner = account(store, 'Mara', 'owner');
    const c = await joined(ws, owner.token);
    await wish(c, 'I want a guild system that gives gifts');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('Stewards'));
    await Promise.all([...app!.wishes.drafts]);
    const record = store.content[0]!;
    expect(model.asked).toHaveLength(2);
    expect(model.asked[1]!.messages[0]!.content).toMatch(/Problems found in the test run: .*Unknown item/);
    expect(record.test?.passed).toBe(true);

    expect((await api(base, `/api/admin/content/${record.id}/revise`, owner.token, 'POST', { note: 'Give two' })).status).toBe(202);
    await Promise.all([...app!.wishes.drafts]);
    expect(model.asked[2]!.messages[0]!.content).toContain("Steward's note: Give two");
    expect(store.contentById(record.id)!.definition).toMatchObject({ script: kinder.script });
  });

  it('will not approve an untested rule, and lets a Steward pause a live one', async () => {
    const model = scripted([{ name: 'Broken', howTo: 'x', items: {}, script: `on('join', () => { throw new Error('no'); });` }]);
    const { store, ws, base } = await start({ compiler: () => [model] });
    const owner = account(store, 'Mara', 'owner');
    const c = await joined(ws, owner.token);
    await wish(c, 'I wish for a whole quest system');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('Stewards'));
    await Promise.all([...app!.wishes.drafts]);
    const record = store.content[0]!;
    expect(record.test?.passed).toBe(false);
    expect(app!.wishes.entries()[0]!.progress).toMatchObject({ state: 'error', label: 'Test run failed' });
    await c.waitFor((m) => m.t === 'notice' && m.text.includes('could not finish your wish'));
    const refused = await api(base, `/api/admin/content/${record.id}/review`, owner.token, 'POST', { approve: true });
    expect(refused).toMatchObject({ status: 409, body: { error: 'untested' } });

    // Swap in a passing draft and approve it, then pause it.
    store.updateContent(record.id, { definition: validateRule(FISHING), test: { ...record.test!, passed: true } });
    expect((await api(base, `/api/admin/content/${record.id}/review`, owner.token, 'POST', { approve: true })).status).toBe(200);
    expect((await api(base, `/api/admin/content/${record.id}/rule`, owner.token, 'POST', { paused: true })).status).toBe(200);
    expect(app!.rules.status(record.id)).toMatchObject({ paused: true, reason: 'Paused by Mara.' });
    expect(store.contentById(record.id)!.rule).toMatchObject({ paused: true });
    await c.waitFor((m) => m.t === 'content' && m.entries.some((e) => e.progress?.label === 'Paused'));
    expect((await api(base, `/api/admin/content/${record.id}/rule`, owner.token, 'POST', { paused: false })).status).toBe(200);
    expect(app!.rules.status(record.id)!.paused).toBe(false);
  });
});

describe('Stewards', () => {
  it('are named by the Owner through the God, and nobody else', async () => {
    const { store, ws } = await start();
    const owner = account(store, 'Mara', 'owner');
    const ilya = account(store, 'Ilya');
    const c = await joined(ws, ilya.token);
    const asked = await pray(c, 'make Ilya a Steward');
    expect(asked.card).toBeUndefined();
    expect(asked.say).toMatch(/Only the Owner/);

    const o = await joined(ws, owner.token);
    const card = await wish(o, 'Please make Ilya a Steward');
    expect(card).toMatchObject({ title: 'Make Ilya a Steward', cost: 0 });
    await c.waitFor((m) => m.t === 'god' && m.say.includes('named a Steward'));
    expect(store.accountById(ilya.id)!.role).toBe('steward');
    await o.waitFor((m) => m.t === 'god' && m.say.includes('It is done'));
    await wish(o, 'remove Ilya as Steward');
    await c.waitFor<GodMessage>((m) => m.t === 'god' && m.say.includes('no longer a Steward'));
    expect(store.accountById(ilya.id)!.role).toBe('player');
  });

  it('read reports and close them, and the reporter hears back', async () => {
    const { store, ws, base } = await start();
    const owner = account(store, 'Mara', 'owner');
    const ilya = account(store, 'Ilya');
    const o = await joined(ws, owner.token);
    await wish(o, 'I wish for a rude sign');
    await o.waitFor((m) => m.t === 'god' && m.say.includes('bag'));
    const record = store.content[0]!;

    const c = await joined(ws, ilya.token);
    await c.send({ t: 'report', kind: 'content', target: record.id, reason: 'It says something mean' });
    expect((await c.waitFor<GodMessage>((m) => m.t === 'god')).say).toMatch(/reached the Stewards/);
    await o.waitFor((m) => m.t === 'notice' && m.text.includes('Ilya reported Rude Sign'));
    await c.send({ t: 'report', kind: 'content', target: record.id, reason: 'again' });
    expect((await c.waitFor<GodMessage>((m) => m.t === 'god')).say).toMatch(/already/);
    await c.send({ t: 'report', kind: 'player', target: 'Nobody', reason: 'hm' });
    expect((await c.waitFor<GodMessage>((m) => m.t === 'god')).say).toMatch(/know no one/);

    const list = await api(base, '/api/admin/reports', owner.token);
    expect(list.body.reports).toHaveLength(1);
    expect((await api(base, '/api/admin/reports', ilya.token)).status).toBe(403);
    const id = list.body.reports[0].id;
    expect((await api(base, `/api/admin/reports/${id}/close`, owner.token, 'POST', { status: 'resolved', action: 'rolled the wish back' })).status).toBe(200);
    expect((await c.waitFor<GodMessage>((m) => m.t === 'god')).say).toMatch(/acted on your report.*rolled the wish back/);
    expect((await api(base, `/api/admin/reports/${id}/close`, owner.token, 'POST', { status: 'dismissed' })).status).toBe(409);
  });

  it('suspend players, who are disconnected and kept out until it is lifted', async () => {
    const { store, ws, base } = await start();
    const owner = account(store, 'Mara', 'owner');
    const steward = account(store, 'Ilya', 'steward');
    const other = account(store, 'Sofi', 'steward');
    const player = account(store, 'Pim');
    const c = await joined(ws, player.token);
    const closed = new Promise<number>((resolve) => c.socket.on('close', (code) => resolve(code)));

    expect((await api(base, `/api/admin/players/${other.id}/suspend`, steward.token, 'POST', { suspend: true })).status).toBe(403);
    expect((await api(base, `/api/admin/players/${owner.id}/suspend`, steward.token, 'POST', { suspend: true })).status).toBe(403);
    expect((await api(base, `/api/admin/players/${player.id}/suspend`, steward.token, 'POST', { suspend: true, reason: 'griefing' })).status).toBe(200);
    expect(await closed).toBe(4003);
    expect((await api(base, '/api/me', player.token)).body).toMatchObject({ error: 'suspended', message: expect.stringContaining('griefing') });

    const again = connect(ws, player.token);
    const refused = await again.waitFor<any>((m) => m.t === 'error');
    expect(refused.code).toBe('suspended');

    expect((await api(base, `/api/admin/players/${player.id}/suspend`, owner.token, 'POST', { suspend: false })).status).toBe(200);
    await joined(ws, player.token);
  });
});
