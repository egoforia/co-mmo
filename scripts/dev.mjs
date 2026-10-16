#!/usr/bin/env node
// npm run dev: runs the game (server and client, `npm run dev:raw`) and
// restarts it when the Owner presses "Pull and restart" in God's View.
//
// The server asks for an update by writing a request file. This script then
// stops the game, pulls main with a fast-forward only, reinstalls packages
// if package.json or package-lock.json changed, writes how it went to a
// result file the server shows in God's View, and starts the game again.
// Players' pages reload themselves when the server comes back.
//
// The settings in .env are read each time the game starts, so a line added
// there takes effect on the next "Pull and restart". Anything already set in
// the terminal wins over .env.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const branch = 'main';
const remote = 'origin';
const requestFile = join(tmpdir(), `co-mmo-update-${process.pid}.json`);
const resultFile = join(root, 'data', 'last-update.json');
const envFile = join(root, '.env');

/** The KEY=value lines of .env (comments, blanks and `export ` allowed); none when there is no file. */
function readEnvFile() {
  if (!existsSync(envFile)) return {};
  const vars = {};
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2];
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '');
    vars[m[1]] = value;
  }
  return vars;
}

/** The game's environment: .env as it is now, then the terminal's own settings over it. */
function gameEnv() {
  return { ...readEnvFile(), ...process.env, CO_MMO_UPDATE_REQUEST: requestFile, CO_MMO_UPDATE_RESULT: resultFile };
}

let child = null;
let stopping = false;

/**
 * What to run: the server and Vite (`npm run dev:raw`), plus REGION_SERVERS
 * region servers when it is set and Redis is there to reach them (docs/scale.md).
 */
function gameCommand(env) {
  const count = Math.max(0, Math.min(16, Number.parseInt(env.REGION_SERVERS ?? '0', 10) || 0));
  if (!count) return ['npm', ['run', 'dev:raw']];
  if (!env.REDIS_URL) {
    console.warn('[dev] REGION_SERVERS is set but REDIS_URL is not; every region runs in the game server.');
    return ['npm', ['run', 'dev:raw']];
  }
  const names = ['server', 'client', ...Array.from({ length: count }, (_, i) => `region${i + 1}`)];
  const commands = ['npm run dev -w @co-mmo/server', 'npm run dev -w @co-mmo/client', ...Array.from({ length: count }, () => 'npm run region-server -w @co-mmo/server')];
  return ['npx', ['concurrently', '-n', names.join(','), ...commands]];
}

function startGame() {
  rmSync(requestFile, { force: true });
  const env = gameEnv();
  const [command, args] = gameCommand(env);
  // Its own process group, so one signal stops the server, Vite, tsx and the region servers.
  child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
  child.on('exit', (code, signal) => {
    child = null;
    if (updating || stopping) return;
    process.exit(code ?? (signal ? 1 : 0));
  });
}

function stopGame(signal = 'SIGTERM') {
  return new Promise((resolve) => {
    if (!child) return resolve();
    const pid = child.pid;
    const kill = (s) => {
      try {
        process.kill(-pid, s);
      } catch {
        // Already gone.
      }
    };
    const alive = () => {
      try {
        process.kill(-pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    kill(signal);
    // Give the server time to save, then make sure nothing in the group
    // (Vite, tsx, the server) outlives the npm wrapper.
    const started = Date.now();
    const wait = setInterval(() => {
      if (alive() && Date.now() - started < 15_000) return;
      clearInterval(wait);
      if (alive()) kill('SIGKILL');
      resolve();
    }, 200);
  });
}

function git(...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || `git ${args[0]} failed`).trim().split('\n')[0]);
  return r.stdout.trim();
}

function pull() {
  const from = git('rev-parse', '--short', 'HEAD');
  try {
    const current = git('rev-parse', '--abbrev-ref', 'HEAD');
    if (current !== branch) throw new Error(`This machine is on "${current}", not ${branch}.`);
    git('fetch', '--quiet', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`);
    const before = git('rev-parse', 'HEAD');
    git('merge', '--ff-only', '--quiet', `${remote}/${branch}`);
    const after = git('rev-parse', 'HEAD');
    const to = after.slice(0, 7);
    if (before === after) return { ok: true, from, to, message: 'Already up to date.' };
    const changed = git('diff', '--name-only', before, after).split('\n');
    let installed = false;
    if (changed.some((f) => /(^|\/)package(-lock)?\.json$/.test(f))) {
      console.log('[update] Packages changed, running npm install...');
      const r = spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit', env: process.env });
      if (r.status !== 0) return { ok: false, from, to, message: `Pulled ${from}..${to}, but npm install failed. Run it by hand.` };
      installed = true;
    }
    return { ok: true, from, to, installed, message: `Pulled ${from}..${to}${installed ? ' and reinstalled packages' : ''}.` };
  } catch (err) {
    return { ok: false, from, message: `The pull failed: ${err.message}` };
  }
}

let updating = false;
async function update() {
  updating = true;
  let by = 'the Owner';
  try {
    by = JSON.parse(readFileSync(requestFile, 'utf8')).by ?? by;
  } catch {
    // Unreadable request: update anyway.
  }
  rmSync(requestFile, { force: true });
  console.log(`\n[update] ${by} asked for an update. Stopping the game...`);
  await stopGame();
  const result = { at: Date.now(), by, ...pull() };
  console.log(`[update] ${result.message}`);
  try {
    writeFileSync(resultFile, JSON.stringify(result, null, 2));
  } catch {
    // No data folder yet; the server creates it on first start.
  }
  console.log('[update] Starting the game again...\n');
  updating = false;
  startGame();
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, async () => {
    stopping = true;
    await stopGame(signal === 'SIGHUP' ? 'SIGTERM' : signal);
    rmSync(requestFile, { force: true });
    process.exit(0);
  });
}

startGame();
setInterval(() => {
  if (!updating && !stopping && existsSync(requestFile)) void update();
}, 1000);
