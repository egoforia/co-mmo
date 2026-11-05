import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newCharacter } from '@co-mmo/shared';
import { Store } from '../src/store.ts';
import { defaultSettings } from '../src/settings.ts';
import { openBuiltInPostgres, type Sql } from '../src/db.ts';
import { testSql, type TestSql } from './sql.ts';

// One embedded Postgres for the file: it takes a few seconds to start.
let db: TestSql;
beforeAll(async () => {
  db = await testSql();
}, 30_000);
beforeEach(() => db.reset());
afterAll(() => db.end());

/** Counts the rows each save writes, to show only changes are sent. */
function counting(sql: Sql) {
  const writes: string[] = [];
  const wrapped: Sql = {
    ...sql,
    transaction: (work) => sql.transaction((q) => work({
      query: (text, params) => {
        if (/^(INSERT|DELETE)/.test(text)) writes.push(text.split(' ')[2]!);
        return q.query(text, params);
      },
    })),
  };
  return { sql: wrapped, writes };
}

describe('the world in Postgres', () => {
  it('keeps players, wishes, spending and settings across a restart', async () => {
    const store = await Store.postgres(db);
    const owner = store.createInvite(null, 'owner');
    const { account, token } = store.acceptInvite(owner.code, 'Mara', 'sanctum');
    store.savePosition(account.id, 12, 34, 'woods');
    store.recordSpend({ at: 1000, usd: 0.04, kind: 'image', provider: 'gemini', model: 'm', playerId: account.id });
    store.recordSpend({ at: 2000, usd: 0.5, kind: 'chat', provider: 'gemini', model: 'm', playerId: null });
    store.addJournal('Mara joined the world.', account.id, 3000);
    store.setRuleData('rule-1', { _: { fish: 3 } });
    store.saveDraft(account.id, { category: 'thing', sub: 'item', fields: {}, at: Date.now() } as never);
    store.updateSettings({ ...store.settings, budget: { ...store.settings.budget, monthlyUsd: 55 } });
    await store.close();

    const again = await Store.postgres(db);
    expect(again.label).toBe('Postgres');
    expect(again.accountByToken(token)).toMatchObject({ name: 'Mara', regionId: 'woods', x: 12, y: 34 });
    expect(again.findInvite(owner.code)?.usedBy).toBe(account.id);
    expect(await again.spendBetween(0, Date.now())).toHaveLength(2);
    expect((await again.spendBetween(0, Date.now())).map((s) => s.usd)).toEqual([0.04, 0.5]);
    expect(again.journalSince(0).map((j) => j.text)).toEqual(['Mara joined the world.']);
    expect(again.ruleData('rule-1')).toEqual({ _: { fish: 3 } });
    expect(again.draftOf(account.id)).toBeTruthy();
    expect(again.settings.budget.monthlyUsd).toBe(55);
  });

  it('writes only what changed, and removes what went away', async () => {
    const { sql, writes } = counting(db);
    const store = await Store.postgres(sql);
    const invite = store.createInvite(null, 'owner');
    const { account } = store.acceptInvite(invite.code, 'Ilya', 'sanctum');
    for (let i = 0; i < 5; i++) store.recordSpend({ at: i, usd: 0.01, kind: 'image', provider: 'p', model: 'm', playerId: null });
    await store.flush();
    writes.length = 0;

    store.savePosition(account.id, 1, 2);
    await store.flush();
    expect(writes).toEqual(['accounts']);

    // A guess swapped for the real figure: one row out, one in.
    writes.length = 0;
    store.recordSpend({ at: 9, usd: 1.5, kind: 'build', provider: 'claude', model: 'm', playerId: null, ref: 'run-1', estimate: true });
    await store.flush();
    store.settleSpend('run-1', { at: 10, usd: 1.2, kind: 'build', provider: 'claude', model: 'm', playerId: null, ref: 'run-1/real' });
    store.saveDraft(account.id, null);
    await store.close();
    expect(writes.filter((w) => w === 'spend_log')).toHaveLength(3);

    const again = await Store.postgres(db);
    expect((await again.spendBetween(0, Date.now())).map((s) => s.usd)).toEqual([0.01, 0.01, 0.01, 0.01, 0.01, 1.2]);
  });

  it('brings in the old world file on its first run only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'co-mmo-import-'));
    const file = join(dir, 'world.json');
    // As an older game wrote it, before the world was always kept in Postgres.
    await writeFile(file, JSON.stringify({
      accounts: [{ id: 'a1', name: 'Amala', role: 'owner', color: 0, createdAt: 1, invitedBy: null, tokenHash: '', regionId: 'sanctum', x: null, y: null }],
      invites: [],
      spend: [{ at: 5, usd: 0.2, kind: 'video', provider: 'gemini', model: 'veo', playerId: null }],
    }));

    const store = await Store.postgres(db, file);
    expect(store.accountByName('Amala')).toBeTruthy();
    expect(await store.spendBetween(0, Date.now())).toHaveLength(1);
    await store.close();

    // Later the file is left alone, even if it changes.
    await writeFile(file, JSON.stringify({ accounts: [], settings: defaultSettings({}) }));
    const again = await Store.postgres(db, file);
    expect(again.accountByName('Amala')).toBeTruthy();
    expect(await again.spendBetween(0, Date.now())).toHaveLength(1);
  });

  it('keeps playing when a save fails, and saves on the next change', async () => {
    let fail = false;
    const flaky: Sql = { ...db, transaction: (work) => (fail ? Promise.reject(new Error('database went away')) : db.transaction(work)) };
    const store = await Store.postgres(flaky);
    const invite = store.createInvite(null, 'owner');
    fail = true;
    const { account } = store.acceptInvite(invite.code, 'Mara', 'sanctum');
    await store.flush();
    fail = false;
    store.addJournal('Mara joined the world.', account.id);
    await store.close();

    const again = await Store.postgres(db);
    expect(again.accountByName('Mara')).toBeTruthy();
  });
});

describe('spending and the journal', () => {
  it('adds each line once, and keeps only recent spending in memory', async () => {
    const { sql, writes } = counting(db);
    const store = await Store.postgres(sql);
    const now = Date.now();
    const longAgo = now - 400 * 24 * 3600 * 1000;
    store.recordSpend({ at: longAgo, usd: 2, kind: 'image', provider: 'p', model: 'm', playerId: null });
    store.recordSpend({ at: now, usd: 0.1, kind: 'image', provider: 'p', model: 'm', playerId: null });
    store.addJournal('Ilya found the cave.', null, now);
    await store.flush();
    writes.length = 0;

    // Later saves send only the new line, never the old ones again.
    store.recordSpend({ at: now + 1, usd: 0.2, kind: 'chat', provider: 'p', model: 'm', playerId: null });
    await store.close();
    expect(writes).toEqual(['spend_log']);

    const again = await Store.postgres(db);
    expect(again.spendSince(0).map((s) => s.usd)).toEqual([0.1, 0.2]);
    expect((await again.spendBetween(0, now + 1)).map((s) => s.usd)).toEqual([2, 0.1, 0.2]);
    expect(again.journalSince(0).map((j) => j.text)).toEqual(['Ilya found the cave.']);
  });

  it('moves spending and journal lines out of an older database', async () => {
    await db.query('CREATE TABLE spend (key text PRIMARY KEY, n bigint NOT NULL, data jsonb NOT NULL)');
    await db.query('CREATE TABLE journal (key text PRIMARY KEY, n bigint NOT NULL, data jsonb NOT NULL)');
    await db.query('CREATE TABLE accounts (key text PRIMARY KEY, n bigint NOT NULL, data jsonb NOT NULL)');
    const at = Date.now();
    await db.query(`INSERT INTO spend VALUES ('2', 2, $1), ('1', 1, $2)`, [
      JSON.stringify({ at: at + 1, usd: 0.3, kind: 'chat', provider: 'p', model: 'm', playerId: null }),
      JSON.stringify({ at, usd: 0.7, kind: 'image', provider: 'p', model: 'm', playerId: null, ref: 'r', estimate: true }),
    ]);
    await db.query(`INSERT INTO journal VALUES ('3', 3, $1)`, [JSON.stringify({ at, text: 'Mara joined the world.', playerId: 'a1' })]);
    await db.query(`INSERT INTO accounts VALUES ('a1', 4, $1)`, [JSON.stringify({ id: 'a1', name: 'Mara', role: 'owner', color: 0, createdAt: 1, invitedBy: null, tokenHash: '', regionId: 'sanctum', x: null, y: null })]);

    const store = await Store.postgres(db);
    expect(store.accountByName('Mara')).toBeTruthy();
    expect(store.spendSince(0).map((s) => s.usd)).toEqual([0.7, 0.3]);
    expect(store.journalSince(0).map((j) => j.text)).toEqual(['Mara joined the world.']);
    const { rows } = await db.query<{ found: string | null }>(`SELECT to_regclass('public.spend')::text AS found`);
    expect(rows[0]?.found).toBeNull();

    // The old guess can still be settled after the move.
    store.settleSpend('r', { at: at + 2, usd: 0.5, kind: 'build', provider: 'p', model: 'm', playerId: null, ref: 'r/real' });
    await store.close();
    const again = await Store.postgres(db);
    expect(again.spendSince(0).map((s) => s.usd)).toEqual([0.3, 0.5]);
  });
});

describe('the Postgres built into the game', () => {
  it('keeps the world in its folder across a restart, and lets only one server open it', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'co-mmo-db-')), 'db');
    const sql = await openBuiltInPostgres(dir);
    const store = await Store.postgres(sql, undefined, 'built in');
    const invite = store.createInvite(null, 'owner');
    store.acceptInvite(invite.code, 'Mara', 'sanctum');
    await store.flush();

    // A live process (here the test runner's parent) holding the folder keeps a second server out.
    const lock = join(dir, 'co-mmo-server.pid');
    expect(await readFile(lock, 'utf8')).toBe(String(process.pid));
    await writeFile(lock, String(process.ppid));
    await expect(openBuiltInPostgres(dir)).rejects.toThrow(/already using the world/);
    await writeFile(lock, String(process.pid));
    await store.close();

    const again = await Store.postgres(await openBuiltInPostgres(dir), undefined, 'built in');
    expect(again.label).toBe('built in');
    expect(again.accountByName('Mara')).toBeTruthy();
    await again.close();
  }, 60_000);
});

describe('characters apart from their accounts', () => {
  it('keeps each character in its own row, with what it holds, and rewrites only the ones that changed', async () => {
    const { sql, writes } = counting(db);
    const store = await Store.postgres(sql);
    const owner = store.createInvite(null, 'owner');
    const mara = store.acceptInvite(owner.code, 'Mara', 'sanctum', { ...newCharacter(), gold: 40, inventory: [{ item: 'wooden-sword', qty: 1 }, { item: 'tonic', qty: 3 }], equipment: { head: 'straw-hat' } }).account;
    const ilya = store.acceptInvite(store.createInvite(mara.id).code, 'Ilya', 'sanctum', { ...newCharacter(), inventory: [{ item: 'tonic', qty: 1 }] }).account;
    await store.flush();

    const { rows: accountRows } = await db.query<{ data: Record<string, unknown> }>('SELECT data FROM accounts');
    expect(accountRows.every((r) => !('character' in r.data))).toBe(true);
    const { rows: gold } = await db.query<{ gold: string }>('SELECT gold FROM characters WHERE account_id = $1', [mara.id]);
    expect(Number(gold[0]!.gold)).toBe(40);
    expect((await store.holders('tonic')).map((h) => [h.accountId, h.qty])).toEqual([[mara.id, 3], [ilya.id, 1]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    expect(await store.holders('straw-hat')).toEqual([{ accountId: mara.id, place: 'worn', slot: 'head', item: 'straw-hat', qty: 1 }]);

    writes.length = 0;
    store.saveCharacter(ilya.id, { ...store.accountById(ilya.id)!.character!, inventory: [] });
    await store.close();
    expect(writes.filter((w) => w === 'characters')).toHaveLength(1);

    const again = await Store.postgres(db);
    expect(again.accountByName('Mara')!.character).toMatchObject({ gold: 40, equipment: { head: 'straw-hat' } });
    expect(again.accountByName('Ilya')!.character!.inventory).toEqual([]);
    expect(await again.holders('tonic')).toHaveLength(1);
  });

  it('moves characters out of account rows from an older database', async () => {
    await db.query('CREATE TABLE accounts (key text PRIMARY KEY, n bigint NOT NULL, data jsonb NOT NULL)');
    const character = { ...newCharacter(), gold: 7, inventory: [{ item: 'goat-horn', qty: 2 }] };
    await db.query(`INSERT INTO accounts VALUES ('a1', 1, $1)`, [JSON.stringify({ id: 'a1', name: 'Amala', role: 'owner', color: 0, createdAt: 1, invitedBy: null, tokenHash: '', regionId: 'sanctum', x: null, y: null, character })]);
    const store = await Store.postgres(db);
    expect(store.accountByName('Amala')!.character!.gold).toBe(7);
    store.savePosition('a1', 3, 4);
    await store.close();
    const { rows } = await db.query<{ data: Record<string, unknown> }>(`SELECT data FROM accounts WHERE key = 'a1'`);
    expect('character' in rows[0]!.data).toBe(false);
    const again = await Store.postgres(db);
    expect(again.accountByName('Amala')!.character!.gold).toBe(7);
    expect((await again.holders('goat-horn'))[0]).toMatchObject({ accountId: 'a1', qty: 2 });
  });
});
