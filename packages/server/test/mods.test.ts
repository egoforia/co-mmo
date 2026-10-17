import { describe, expect, it } from 'vitest';
import { ABILITIES, ITEMS, LIGHT_MOD, equip, modOn } from '@co-mmo/shared';
import { Store, type ContentRecord } from '../src/store.ts';
import { account, api, app, joined, start, stop, wish } from './helpers.ts';

/** A live Engine wish, as the build pipeline leaves it once merged and released. */
function liveCodeWish(store: Store, wisherId: string, issue: number): ContentRecord {
  const record: ContentRecord = {
    id: `w${Math.random().toString(36).slice(2, 10)}`,
    wisher: { id: wisherId, name: 'Mara' },
    regionId: 'sanctum',
    at: Date.now(),
    tier: 'engine',
    title: 'Dynamic Point Lighting',
    summary: 'Torches light the ground around whoever holds them.',
    status: 'granted',
    favor: 0,
    build: {
      state: 'live',
      at: Date.now(),
      issue: { number: issue, url: `https://github.com/egoforia/co-mmo/issues/${issue}` },
      pr: { number: issue + 1, url: `https://github.com/egoforia/co-mmo/pull/${issue + 1}` },
      sha: 'abc1234def',
    },
    conversation: [],
    usd: 0,
  };
  store.addContent(record);
  return record;
}

describe('wishes as mods', () => {
  it('switches an item off without taking it from anyone, and back on', async () => {
    const { store, ws, base } = await start();
    const owner = account(store, 'Mara', 'owner');
    const steward = account(store, 'Ilya', 'steward');
    const player = account(store, 'Tam');
    const c = await joined(ws, owner.token);
    await wish(c, 'I wish for a golden ring');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('bag'));
    const record = store.content[0]!;
    const full = ITEMS[record.id]!;
    expect(full.slot).toBeDefined();
    const region = app!.world.local('sanctum')!;
    region.updateCharacter(owner.id, (ch) => expect(equip(ch, record.id)).toBeUndefined());

    expect((await api(base, `/api/admin/content/${record.id}/off`, player.token, 'POST')).status).toBe(403);
    expect((await api(base, `/api/admin/content/${record.id}/off`, steward.token, 'POST')).status).toBe(200);
    expect(store.contentById(record.id)!.off).toMatchObject({ by: 'Ilya' });
    // Asleep: still in the bag, worn no more, no use and no trade.
    expect(ITEMS[record.id]).toMatchObject({ name: full.name, kind: 'material', bound: true });
    expect(ITEMS[record.id]!.slot).toBeUndefined();
    await new Promise((r) => setTimeout(r, 20));
    const ch = region.character(owner.id)!;
    expect(Object.values(ch.equipment)).not.toContain(record.id);
    expect(ch.inventory.map((s) => s.item)).toContain(record.id);
    const told = await c.waitFor<any>((m) => m.t === 'content' && m.entries.some((e: any) => e.id === record.id && e.off));
    expect(told.entries[0].progress).toMatchObject({ state: 'closed', label: 'Switched off' });
    expect((await api(base, `/api/admin/content/${record.id}/off`, steward.token, 'POST')).status).toBe(409);

    expect((await api(base, `/api/admin/content/${record.id}/on`, steward.token, 'POST')).status).toBe(200);
    expect(ITEMS[record.id]).toEqual(full);
    expect(store.contentById(record.id)!.off).toBeUndefined();
    expect(region.character(owner.id)!.inventory.map((s) => s.item)).toContain(record.id);
  });

  it('takes creatures out of the world while off, also after a restart', async () => {
    const first = await start();
    const owner = account(first.store, 'Mara', 'owner');
    const c = await joined(first.ws, owner.token);
    await wish(c, 'Please make a pink slime');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('Look around'));
    const record = first.store.content[0]!;
    const kinds = () => app!.world.region('sanctum')!.creatureIds().map((id) => app!.world.region('sanctum')!.creature(id)?.kind);
    expect(kinds()).toContain(record.id);

    expect((await api(first.base, `/api/admin/content/${record.id}/off`, owner.token, 'POST')).status).toBe(200);
    expect(kinds()).not.toContain(record.id);
    await stop();

    const again = await start({ store: first.store });
    expect(kinds()).not.toContain(record.id);
    expect((await api(again.base, `/api/admin/content/${record.id}/on`, owner.token, 'POST')).status).toBe(200);
    expect(kinds().filter((k) => k === record.id)).toHaveLength(3);
  });

  it('keeps an ability in the spellbook while its wish sleeps', async () => {
    const { store, ws, base } = await start();
    const owner = account(store, 'Mara', 'owner');
    const c = await joined(ws, owner.token);
    await wish(c, 'I wish for a spell that heals');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('bag'));
    const record = store.content.find((r) => r.definition?.kind === 'ability')!;
    const region = app!.world.local('sanctum')!;
    region.updateCharacter(owner.id, (ch) => ch.abilities.push(record.id));

    await api(base, `/api/admin/content/${record.id}/off`, owner.token, 'POST');
    expect(ABILITIES[record.id]).toBeUndefined();
    await new Promise((r) => setTimeout(r, 20));
    expect(region.character(owner.id)!.abilities).toContain(record.id);

    await api(base, `/api/admin/content/${record.id}/on`, owner.token, 'POST');
    expect(ABILITIES[record.id]).toBeDefined();
    // Undone for good, it leaves the spellbook.
    expect((await api(base, `/api/admin/content/${record.id}/undo`, owner.token, 'POST')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(region.character(owner.id)!.abilities).not.toContain(record.id);
  });

  it("switches an Engine wish's code off through its mod id", async () => {
    const { store, base } = await start();
    const owner = account(store, 'Mara', 'owner');
    const record = liveCodeWish(store, owner.id, 59);
    const { body } = await api(base, '/api/admin/content', owner.token);
    expect(body.content.find((e: any) => e.id === record.id).mod).toBe(LIGHT_MOD);
    expect(modOn(LIGHT_MOD)).toBe(true);
    expect((await api(base, `/api/admin/content/${record.id}/off`, owner.token, 'POST')).status).toBe(200);
    expect(modOn(LIGHT_MOD)).toBe(false);
    expect((await api(base, `/api/admin/content/${record.id}/on`, owner.token, 'POST')).status).toBe(200);
    expect(modOn(LIGHT_MOD)).toBe(true);
  });

  it('undoes a code change as a new Engine wish: asked by a Steward, built on the Owner\'s word, and marked undone once live', async () => {
    const first = await start();
    const { store } = first;
    const owner = account(store, 'Mara', 'owner');
    const steward = account(store, 'Ilya', 'steward');
    const record = liveCodeWish(store, owner.id, 70);

    const asked = await api(first.base, `/api/admin/content/${record.id}/undo`, steward.token, 'POST');
    expect(asked.status).toBe(200);
    expect(asked.body.queued).toBe(false);
    const undo = store.contentById(asked.body.undo)!;
    expect(undo).toMatchObject({ tier: 'engine', status: 'pending', undoes: record.id, title: 'Undo: Dynamic Point Lighting' });
    expect(undo.summary).toContain('pull request #71');
    // Asking twice does not make a second one.
    expect((await api(first.base, `/api/admin/content/${record.id}/undo`, owner.token, 'POST')).status).toBe(409);

    // The Owner approves it like any Engine wish; once its change is merged and running, the old wish is undone.
    store.updateContent(undo.id, { status: 'approved', build: { state: 'merged', at: Date.now(), sha: 'feed1234', pr: { number: 80, url: 'https://github.com/egoforia/co-mmo/pull/80' } } });
    await stop();
    await start({ store, builds: { issues: null, contains: async (sha) => sha === 'feed1234' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(store.contentById(undo.id)).toMatchObject({ status: 'granted', build: { state: 'live' } });
    expect(store.contentById(record.id)!.status).toBe('rolled-back');
  });
});
