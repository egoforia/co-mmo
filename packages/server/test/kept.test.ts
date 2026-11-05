import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoryKept, PostgresKept, type Kept } from '../src/kept.ts';
import { Auth } from '../src/auth.ts';
import { KeptDoc } from '../src/kept-doc.ts';
import { RecipeBook } from '../src/art-recipes.ts';
import { ArtJobs } from '../src/art-jobs.ts';
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

describe('art bookkeeping kept in the database', () => {
  it('brings in an old file once, keeps it as a backup, and works from the database after', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'co-mmo-kept-'));
    const file = join(dir, 'up-next-queue.json');
    await writeFile(file, JSON.stringify([{ id: 'a' }]));
    const kept = new MemoryKept();
    const doc = new KeptDoc<{ id: string }[]>(kept, 'art-up-next', 'queue', file);
    expect(await doc.read()).toEqual([{ id: 'a' }]);
    expect(existsSync(file)).toBe(false);
    expect(JSON.parse(await readFile(`${file}.in-db`, 'utf8'))).toEqual([{ id: 'a' }]);
    await doc.write([]);
    expect(await new KeptDoc(kept, 'art-up-next', 'queue', file).read()).toEqual([]);
  });

  it('keeps recipes of earlier versions, and brings one back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'co-mmo-kept-'));
    const kept = new MemoryKept();
    const book = new RecipeBook(dir, kept);
    const recipe = (prompt: string) => ({ at: 1, steps: [{ label: 'Paint', media: 'picture', provider: 'p', model: 'm', prompt, pictures: [], settings: [], usd: 0.04 }] }) as never;
    await book.record('sanctum-rock', recipe('first'));
    await book.putAside('sanctum-rock', 'v1');
    expect(await book.current('sanctum-rock')).toBeUndefined();
    expect(await book.ofVersion('sanctum-rock', 'v1')).toEqual(recipe('first'));
    await book.bringBack('sanctum-rock', 'v1');
    expect(await book.current('sanctum-rock')).toEqual(recipe('first'));
    // Nothing was written beside the art.
    expect(existsSync(join(dir, 'recipes'))).toBe(false);
    expect(existsSync(join(dir, 'history'))).toBe(false);
  });
});

describe('the painting log kept across a restart', () => {
  it('brings back finished jobs, older than anything logged since, and not unfinished ones', async () => {
    const kept = new MemoryKept();
    let t = 1000;
    const before = new ArtJobs(() => t++, kept);
    before.add('sanctum-rock', 'Sanctum rock', 'picture', 'gods-view', 0.04).done(0.039);
    before.add('woods-tree-a', 'Woods tree', 'picture', 'wish', 0.04).fail('The model said no.');
    before.add('desert-ruin', 'Desert ruin', 'picture', 'start-up', 0.04);
    await before.flush();

    const after = new ArtJobs(() => t++, kept);
    after.add('shore-palm-a', 'Shore palm', 'picture', 'gods-view', 0.04);
    await after.restore();
    expect(after.list().map((j) => [j.asset, j.status])).toEqual([
      ['shore-palm-a', 'queued'],
      ['woods-tree-a', 'failed'],
      ['sanctum-rock', 'done'],
    ]);
    expect(after.list()[2]!.usd).toBe(0.039);
  });
});
