import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Updater } from '../src/updates.ts';
import { account, api, joined, start } from './helpers.ts';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' }).trim();

/** A "GitHub" bare repo, the laptop's clone, and a second clone to push from. */
function repos() {
  const dir = mkdtempSync(join(tmpdir(), 'co-mmo-git-'));
  const remote = join(dir, 'remote.git');
  const laptop = join(dir, 'laptop');
  const other = join(dir, 'other');
  git(dir, 'init', '--bare', '-q', remote);
  git(dir, 'clone', '-q', remote, other);
  writeFileSync(join(other, 'README.md'), 'one\n');
  git(other, 'add', '.');
  git(other, 'commit', '-q', '-m', 'First');
  git(other, 'push', '-q', 'origin', 'HEAD:main');
  git(dir, 'clone', '-q', '-b', 'main', remote, laptop);
  const push = (file: string, text: string, message: string) => {
    writeFileSync(join(other, file), text);
    git(other, 'add', '.');
    git(other, 'commit', '-q', '-m', message);
    git(other, 'push', '-q', 'origin', 'HEAD:main');
  };
  return { dir, laptop, push, requestFile: join(dir, 'request.json'), resultFile: join(dir, 'result.json') };
}

describe('Updater', () => {
  it('lists new commits on main and asks the supervisor to pull them', async () => {
    const r = repos();
    const updater = new Updater({ repoDir: r.laptop, requestFile: r.requestFile, resultFile: r.resultFile });
    expect((await updater.check(true)).blocked).toBe('Already up to date.');

    r.push('a.txt', 'a', 'Add fishing');
    r.push('b.txt', 'b', 'Add boats');
    const status = await updater.check(true);
    expect(status.behind).toBe(2);
    expect(status.commits.map((c) => c.subject)).toEqual(['Add boats', 'Add fishing']);
    expect(status.blocked).toBeUndefined();

    const done = await updater.request('Ego');
    expect(done.ok).toBe(true);
    expect(JSON.parse(readFileSync(r.requestFile, 'utf8'))).toMatchObject({ by: 'Ego', from: status.commit, to: status.upstream });
    expect(await updater.request('Ego')).toEqual({ ok: false, message: 'An update is already under way.' });
  });

  it('refuses when there are local changes, local commits or another branch', async () => {
    const r = repos();
    r.push('a.txt', 'a', 'Add fishing');
    const updater = new Updater({ repoDir: r.laptop, requestFile: r.requestFile });

    writeFileSync(join(r.laptop, 'README.md'), 'edited\n');
    expect((await updater.check(true)).blocked).toMatch(/uncommitted changes \(README.md\)/);
    const refused = await updater.request('Ego');
    expect(refused).toMatchObject({ ok: false });
    expect(existsSync(r.requestFile)).toBe(false);

    git(r.laptop, 'commit', '-q', '-am', 'Local tweak');
    expect((await updater.check(true)).blocked).toMatch(/1 commit that main on GitHub does not/);

    git(r.laptop, 'checkout', '-q', '-b', 'experiment');
    expect((await updater.check(true)).blocked).toMatch(/branch "experiment"/);
  });

  it('says so when it cannot restart or is not in a git checkout', async () => {
    const r = repos();
    r.push('a.txt', 'a', 'Add fishing');
    expect((await new Updater({ repoDir: r.laptop }).check(true)).blocked).toMatch(/npm run dev/);
    const plain = await new Updater({ repoDir: mkdtempSync(join(tmpdir(), 'co-mmo-plain-')) }).check(true);
    expect(plain.available).toBe(false);
  });

  it('reports a fetch that fails without hanging', async () => {
    const r = repos();
    git(r.laptop, 'remote', 'set-url', 'origin', join(r.dir, 'missing.git'));
    const status = await new Updater({ repoDir: r.laptop, requestFile: r.requestFile }).check(true);
    expect(status.fetchError).toBeTruthy();
    expect(status.behind).toBe(0);
  });

  it('shows how the last update went', async () => {
    const r = repos();
    writeFileSync(r.resultFile, JSON.stringify({ at: 1, ok: true, message: 'Pulled a..b.' }));
    const status = await new Updater({ repoDir: r.laptop, requestFile: r.requestFile, resultFile: r.resultFile }).check(true);
    expect(status.lastUpdate?.message).toBe('Pulled a..b.');
  });
});

describe("God's View updates", () => {
  it('lets only the Owner pull, and tells players the world is updating', async () => {
    const r = repos();
    r.push('a.txt', 'a', 'Add fishing');
    const updater = new Updater({ repoDir: r.laptop, requestFile: r.requestFile });
    const { store, base, ws } = await start({ updater });
    const owner = account(store, 'Ego', 'owner');
    const steward = account(store, 'Sam', 'steward');

    expect((await api(base, '/api/admin/update', steward.token)).status).toBe(403);
    expect((await api(base, '/api/admin/update', steward.token, 'POST')).status).toBe(403);
    const status = await api(base, '/api/admin/update/check', owner.token, 'POST');
    expect(status.body.behind).toBe(1);
    expect((await api(base, '/api/admin/overview', owner.token)).body.update).toEqual({ behind: 1 });
    expect((await api(base, '/api/admin/overview', steward.token)).body.update).toBeNull();

    const player = await joined(ws, account(store, 'Pip').token);
    const closed = new Promise<number>((resolve) => player.socket.on('close', (code) => resolve(code)));
    const pulled = await api(base, '/api/admin/update', owner.token, 'POST');
    expect(pulled.status).toBe(202);
    expect(await closed).toBe(4010);
    expect(existsSync(r.requestFile)).toBe(true);
    expect((await (await fetch(`${base}/api/version`)).json())).toEqual({ commit: 'abc1234', updating: true });
  });

  it('explains why an update is blocked', async () => {
    const r = repos();
    const { store, base } = await start({ updater: new Updater({ repoDir: r.laptop, requestFile: r.requestFile }) });
    const owner = account(store, 'Ego', 'owner');
    const res = await api(base, '/api/admin/update', owner.token, 'POST');
    expect(res).toEqual({ status: 409, body: { error: 'blocked', message: 'Already up to date.' } });
  });
});
