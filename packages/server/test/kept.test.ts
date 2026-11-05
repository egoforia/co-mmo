import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoryKept, PostgresKept, type Kept } from '../src/kept.ts';
import { Auth } from '../src/auth.ts';
import { Store } from '../src/store.ts';
import { fakeMailer } from './helpers.ts';
import { testSql, type TestSql } from './sql.ts';

let db: TestSql;
beforeAll(async () => {
  db = await testSql();
}, 30_000);
beforeEach(() => db.reset());
afterAll(() => db.end());

const kinds: [string, () => Promise<Kept>][] = [
  ['in memory', async () => new MemoryKept()],
  ['in Postgres', async () => {
    await Store.postgres(db);
    return new PostgresKept(db);
  }],
];

describe.each(kinds)('kept documents %s', (_name, make) => {
  it('saves, replaces, lists in order, takes once and runs out', async () => {
    const kept = await make();
    await kept.put('queue', 'b', { n: 1 });
    await kept.put('queue', 'a', { n: 2 });
    await kept.put('queue', 'b', { n: 3 });
    await kept.put('other', 'a', 'x');
    expect(await kept.list('queue')).toEqual([{ key: 'b', data: { n: 3 } }, { key: 'a', data: { n: 2 } }]);
    expect(await kept.get('other', 'a')).toBe('x');

    expect(await kept.take('queue', 'a')).toEqual({ n: 2 });
    expect(await kept.take('queue', 'a')).toBeUndefined();

    await kept.put('codes', 'old', 1, 100);
    await kept.put('codes', 'new', 2, 300);
    await kept.sweep(200);
    expect((await kept.list('codes')).map((r) => r.key)).toEqual(['new']);
    await kept.delete('codes', 'new');
    expect(await kept.get('codes', 'new')).toBeUndefined();
  });
});

describe('sign-in kept in the database', () => {
  it('a link emailed before a restart still signs in after it, once', async () => {
    const before = await Store.postgres(db);
    const owner = before.createInvite(null, 'owner');
    const { account } = before.acceptInvite(owner.code, 'Mara', 'sanctum');
    before.setEmail(account.id, 'mara@example.com');
    const mailer = fakeMailer();
    await new Auth({ store: before, publicUrl: 'http://game', env: {}, mailer }).emailSignIn('mara@example.com');
    await before.close();

    const after = await Store.postgres(db);
    const auth = new Auth({ store: after, publicUrl: 'http://game', env: {}, mailer: fakeMailer() });
    const code = new URL(mailer.sent[0]!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('login')!;
    expect((await auth.redeem(code)).account.name).toBe('Mara');
    await expect(auth.redeem(code)).rejects.toThrow();
  });
});
