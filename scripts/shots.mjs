#!/usr/bin/env node
// Screenshots as part of making the game (docs/screenshots.md).
//
//   npm run shots                         take every shot of this working tree
//   npm run shots -- --only sanctum,floor take the shots whose names contain these
//   npm run shots -- --compare            also take them on origin/main and compare
//   npm run shots -- --compare <ref>      ...on another commit or branch
//   npm run shots -- --base-dir <dir>     compare with shots already taken (an approved golden set)
//
// Pictures go to shot-results/now/, the commit compared with to
// shot-results/base-<commit>/ (kept, so a second comparison is quick), and
// the comparison to shot-results/compare/ with report.md. Paid AI keys are
// never passed on: shots use the offline God and the art in the repo.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --compare may come without a ref.
const argv = process.argv.slice(2);
const args = { only: '', compare: '', baseDir: '', out: resolve(root, 'shot-results'), build: true };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '');
  if (a === '--only') args.only = next();
  else if (a === '--compare') args.compare = next() || 'origin/main';
  else if (a === '--base-dir') args.baseDir = resolve(next());
  else if (a === '--out') args.out = resolve(next());
  else if (a === '--no-build') args.build = false;
  else {
    console.error(`I don't know ${a}. See the top of scripts/shots.mjs.`);
    process.exit(2);
  }
}

/** The environment for every step, without anything that could pay for AI or reach a real database. */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/API_KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|REDIS_URL|REGION_SERVERS/i.test(k)),
);

function run(cmd, cmdArgs, cwd, extra = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env: { ...env, ...extra } });
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed in ${cwd}.`);
}

const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();

/** Builds the client in `dir` and takes the shots there into `out`. */
function shoot(dir, out) {
  if (args.build) run('npm', ['run', 'build', '--silent'], dir);
  rmSync(out, { recursive: true, force: true });
  run('npx', ['vitest', 'run', '-c', 'vitest.shots.config.ts'], dir, { SHOTS_OUT: out, SHOTS_ONLY: args.only });
}

/**
 * A checkout of `sha` beside the repo with this branch's shot runner copied in
 * (older commits don't have it). It borrows this checkout's installed packages
 * when both lock files match, and installs its own otherwise.
 */
function checkout(sha) {
  const dir = resolve(tmpdir(), `co-mmo-shots-${sha.slice(0, 12)}`);
  if (!existsSync(dir)) git('worktree', 'add', '--detach', dir, sha);
  const sameLock = readFileSync(resolve(root, 'package-lock.json'), 'utf8') === readFileSync(resolve(dir, 'package-lock.json'), 'utf8');
  const modules = resolve(dir, 'node_modules');
  if (!existsSync(modules)) {
    if (sameLock) {
      mkdirSync(modules);
      for (const name of readdirSync(resolve(root, 'node_modules'))) {
        if (name === '@co-mmo') continue;
        symlinkSync(resolve(root, 'node_modules', name), resolve(modules, name));
      }
      // The game's own packages are that commit's, not this branch's.
      mkdirSync(resolve(modules, '@co-mmo'));
      for (const pkg of ['shared', 'server', 'client']) symlinkSync(resolve(dir, 'packages', pkg), resolve(modules, '@co-mmo', pkg));
      for (const pkg of ['shared', 'server', 'client']) {
        const own = resolve(root, 'packages', pkg, 'node_modules');
        if (existsSync(own) && !existsSync(resolve(dir, 'packages', pkg, 'node_modules'))) symlinkSync(own, resolve(dir, 'packages', pkg, 'node_modules'));
      }
    } else {
      console.log(`${sha.slice(0, 7)} uses other packages; installing them (once).`);
      run('npm', ['ci', '--no-audit', '--no-fund'], dir);
    }
  }
  cpSync(resolve(root, 'packages/server/shots'), resolve(dir, 'packages/server/shots'), { recursive: true });
  cpSync(resolve(root, 'vitest.shots.config.ts'), resolve(dir, 'vitest.shots.config.ts'));
  return dir;
}

const now = resolve(args.out, 'now');
console.log(`Taking shots of this working tree into ${now}`);
shoot(root, now);

let before = args.baseDir;
if (args.compare) {
  const sha = git('rev-parse', args.compare);
  before = resolve(args.out, `base-${sha.slice(0, 12)}${args.only ? `-${args.only.replace(/[^a-z0-9]+/gi, '_')}` : ''}`);
  if (existsSync(resolve(before, 'shots.json'))) console.log(`Reusing the shots of ${args.compare} (${sha.slice(0, 7)}) in ${before}`);
  else {
    console.log(`Taking the same shots on ${args.compare} (${sha.slice(0, 7)}) into ${before}`);
    shoot(checkout(sha), before);
  }
}
if (before) {
  const out = resolve(args.out, 'compare');
  rmSync(out, { recursive: true, force: true });
  run('npx', ['tsx', 'packages/server/shots/compare.ts', '--before', before, '--after', now, '--out', out], root);
} else {
  console.log(`\nShots: ${now} (contact-sheet.png, shots.json). Compare with main: npm run shots -- --compare`);
}
