import { describe, expect, it } from 'vitest';
import { EDIT_KINDS, generateRegion, regionDef, BAG_FULL, BAG_SLOTS, STASH_AWAY, STASH_BOUND, STASH_CHEST, STASH_FULL, goldOf, itemCount, type ServerMessage, type StashViewMessage } from '@co-mmo/shared';
import { account, api, app, joined, start } from './helpers.ts';

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}

// The shared stash (docs/stash.md): opened by a stash chest, it holds things
// for every character on one account, and moving them in and out never copies
// or loses anything.

type Conn = Awaited<ReturnType<typeof joined>>;

/** Stands a stash chest where the Sanctum's arrivals stand. */
function chestAtSpawn(): void {
  const region = app!.world.local('sanctum')!;
  const { x, y } = region.map.spawn;
  region.map.landmarks.push({ asset: STASH_CHEST, x, y: y + 0.5, footprint: { width: 2, height: 1 } });
}

/** Sends a stash message and waits for the stash or a notice. */
async function stash(c: Conn, m: Record<string, unknown>): Promise<StashViewMessage | string> {
  c.messages.length = 0;
  await c.send({ t: 'stash', ...m });
  const got = await c.waitFor((x: ServerMessage) => x.t === 'stash' || x.t === 'notice');
  return got.t === 'stash' ? got as StashViewMessage : (got as { text: string }).text;
}

const bag = (id: string) => app!.world.local('sanctum')!.character(id)!;
const cell = (id: string, item: string) => bag(id).inventory.findIndex((s) => s.item === item);

describe('the shared stash', () => {
  it('opens only by a stash chest', async () => {
    const { ws, store } = await start();
    const mara = account(store, 'Mara');
    const c = await joined(ws, mara.token);
    expect(await stash(c, { action: 'open' })).toBe(STASH_AWAY);
    chestAtSpawn();
    expect(await stash(c, { action: 'open' })).toMatchObject({ open: true, slots: [], size: 40 });
  });

  it('carries things from one character to another on the same account', async () => {
    const { base, ws, store } = await start();
    const mara = account(store, 'Mara');
    const c = await joined(ws, mara.token);
    chestAtSpawn();
    await app!.world.change(mara.id, { op: 'gold', amount: 50 });
    await app!.world.change(mara.id, { op: 'give', item: 'tonic', qty: 3 });

    const put = await stash(c, { action: 'in', index: cell(mara.id, 'tonic'), qty: 2 });
    expect(put).toMatchObject({ slots: [{ item: 'tonic', qty: 2 }] });
    expect(itemCount(bag(mara.id), 'tonic')).toBe(1);
    await stash(c, { action: 'in', index: cell(mara.id, 'gold') });
    expect(goldOf(bag(mara.id))).toBe(0);
    // The Bible is bound: it stays.
    expect(await stash(c, { action: 'in', index: cell(mara.id, 'bible') })).toBe(STASH_BOUND);
    expect(store.stashOf(store.accountById(mara.id)!)).toEqual([{ item: 'tonic', qty: 2 }, { item: 'gold', qty: 50 }]);
    expect((await store.holders('gold')).find((h) => h.place === 'stash')).toMatchObject({ accountId: mara.id, qty: 50 });

    // Another character on the account takes the coins out.
    const ilya = (await api(base, '/api/characters', mara.token, 'POST', { name: 'Ilya', race: 'ursine', calling: 'warden' })).body.id as string;
    const second = await joined(ws, mara.token);
    expect(app!.world.has(ilya)).toBe(true);
    const out = await stash(second, { action: 'out', index: 1 });
    expect(out).toMatchObject({ slots: [{ item: 'tonic', qty: 2 }] });
    expect(goldOf(bag(ilya))).toBe(50);
  });

  it('refuses, changing nothing, when there is no room', async () => {
    const { ws, store } = await start();
    const mara = account(store, 'Mara');
    const c = await joined(ws, mara.token);
    chestAtSpawn();
    const me = store.accountById(mara.id)!;
    store.saveStash(me, [{ item: 'tonic', qty: 5 }]);
    store.updateSettings({ ...store.settings, stash: { slots: 1 } });
    await app!.world.change(mara.id, { op: 'give', item: 'goat-horn', qty: 1 });
    expect(await stash(c, { action: 'in', index: cell(mara.id, 'goat-horn') })).toBe(STASH_FULL);
    expect(itemCount(bag(mara.id), 'goat-horn')).toBe(1);

    // A full bag cannot take the tonics back out.
    const filler = BAG_SLOTS - bag(mara.id).inventory.length;
    for (let i = 0; i < filler; i++) bag(mara.id).inventory.push({ item: 'scarab-shell', qty: 99 });
    expect(await stash(c, { action: 'out', index: 0 })).toBe(BAG_FULL);
    expect(store.stashOf(me)).toEqual([{ item: 'tonic', qty: 5 }]);
  });

  it('stands a stash chest from the world editor, only in a safe area', async () => {
    const { base, ws, store } = await start();
    const owner = account(store, 'Owner', 'owner');
    const map = app!.world.local('sanctum')!.map;
    const { x, y } = map.spawn;
    // The nearest open spot beside where players arrive.
    const at = [[1, 1], [-3, 1], [1, -2], [-3, -2], [2, 2], [-4, 2]].map(([dx, dy]) => [Math.floor(x) + dx!, Math.floor(y) + dy!] as [number, number])
      .find((a) => !EDIT_KINDS.stash.check(map, { kind: 'stash', at: a }, { creatures: {} }))!;
    const placed = await api(base, '/api/world-edits', owner.token, 'POST', { region: 'sanctum', edit: { kind: 'stash', at }, live: true });
    expect(placed.status).toBe(200);
    await until(() => app!.world.local('sanctum')!.map.landmarks.some((l) => l.asset === STASH_CHEST));
    const c = await joined(ws, owner.token);
    // Standing beside it, the stash opens.
    app!.world.teleport(owner.id, { t: 'teleport', x: at[0] + 1, y: at[1] + 1.5 });
    await c.waitFor((m) => m.t === 'notice' && m.text.startsWith('Teleported'));
    expect(await stash(c, { action: 'open' })).toMatchObject({ open: true });
    // Outside a safe area the editor refuses one. The Sanctum is safe everywhere, so ask of the woods.
    const woods = generateRegion(regionDef('woods')!);
    const far: [number, number][] = [];
    for (let ty = 2; ty < woods.height - 2; ty += 7) for (let tx = 2; tx < woods.width - 2; tx += 7) if (Math.hypot(tx - woods.spawn.x, ty - woods.spawn.y) > 20) far.push([tx, ty]);
    const answers = far.map((a) => EDIT_KINDS.stash.check(woods, { kind: 'stash', at: a }, { creatures: {} }));
    expect(answers).toContain('Stand stash chests in a safe area, where nobody can be robbed at one.');
    expect(answers).not.toContain(undefined);
  });

  it('lets the Owner set how big a stash is', async () => {
    const { base, store } = await start();
    const owner = account(store, 'Owner', 'owner');
    expect((await api(base, '/api/admin/players/limit', owner.token, 'POST', { stashSlots: 60 })).body.stashSlots).toBe(60);
    expect((await api(base, '/api/admin/players/limit', owner.token, 'POST', { stashSlots: 0 })).status).toBe(400);
    expect((await api(base, '/api/admin/players', owner.token)).body.stashSlots).toBe(60);
  });
});
