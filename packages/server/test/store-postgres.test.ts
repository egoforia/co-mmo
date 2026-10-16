import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Store, defaultSettings } from '../src/store.ts';
import type { Sql } from '../src/db.ts';
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
    expect(again.spendSince(0).map((s) => s.usd)).toEqual([0.04, 0.5]);
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
    expect(writes.filter((w) => w === 'spend')).toHaveLength(3);

    const again = await Store.postgres(db);
    expect(again.spendSince(0).map((s) => s.usd)).toEqual([0.01, 0.01, 0.01, 0.01, 0.01, 1.2]);
  });

  it('brings in the old world file on its first run only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'co-mmo-import-'));
    const file = join(dir, 'world.json');
    const old = await Store.open(file);
    const invite = old.createInvite(null, 'owner');
    old.acceptInvite(invite.code, 'Amala', 'sanctum');
    old.recordSpend({ at: 5, usd: 0.2, kind: 'video', provider: 'gemini', model: 'veo', playerId: null });
    await old.close();

    const store = await Store.postgres(db, file);
    expect(store.accountByName('Amala')).toBeTruthy();
    expect(store.spendSince(0)).toHaveLength(1);
    await store.close();

    // Later the file is left alone, even if it changes.
    await writeFile(file, JSON.stringify({ accounts: [], settings: defaultSettings({}) }));
    const again = await Store.postgres(db, file);
    expect(again.accountByName('Amala')).toBeTruthy();
    expect(again.spendSince(0)).toHaveLength(1);
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
