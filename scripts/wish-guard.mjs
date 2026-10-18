#!/usr/bin/env node
// Guardrails for code written by the coding agent (design doc, Building
// Engine wishes automatically). Run on a wish branch:
//
//   node scripts/wish-guard.mjs [--base origin/main] [--allow-core]
//
// It fails when the change is too big for one review, or touches what a
// wish may not change: sign-in, roles, the budget, API keys, the script
// sandbox and package dependencies (unless the Owner's approval allows
// them with --allow-core), and never the build workflows or this file. It
// also fails when the change draws art in code: game art is painted by the
// image model chosen in God's View, from a description (BUILDING_STYLES,
// the biome kit, or a wish's look).

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Most files and changed lines one wish may touch. Lockfiles don't count. */
export const MAX_FILES = 25;
export const MAX_LINES = 1500;

/** Never changed by a wish, whatever the Owner allows. */
export const FORBIDDEN = [
  /^\.github\//,
  /^scripts\/wish-guard\.mjs$/,
  /^scripts\/dev\.mjs$/,
  /(^|\/)\.env/,
  /^CLAUDE\.md$/,
  /^\.claude\//,
];

/** Changed only when the Owner's approval allows core changes. */
export const CORE = [
  { pattern: /^packages\/server\/src\/store\.ts$/, what: 'accounts, roles and saved settings' },
  { pattern: /^packages\/server\/src\/auth\.ts$/, what: 'sign-in by email, Google and GitHub' },
  { pattern: /^packages\/server\/src\/settings\.ts$/, what: 'saved settings, AI model choices and budget limits' },
  { pattern: /^packages\/server\/src\/budget\.ts$/, what: 'the budget' },
  { pattern: /^packages\/server\/src\/admin\.ts$/, what: "God's View permissions, keys and the budget" },
  { pattern: /^packages\/server\/src\/ai\//, what: 'AI providers and their keys' },
  { pattern: /^packages\/server\/src\/rules\.ts$/, what: 'the script sandbox' },
  { pattern: /^packages\/server\/src\/live-rules\.ts$/, what: 'the script sandbox' },
  { pattern: /^packages\/server\/src\/builds\.ts$/, what: 'the build pipeline' },
  { pattern: /^packages\/server\/src\/updates\.ts$/, what: 'updates and restarts' },
  { pattern: /^packages\/server\/src\/main\.ts$/, what: 'server start-up and secrets' },
  { pattern: /(^|\/)package(-lock)?\.json$/, what: 'package dependencies' },
  { pattern: /^Dockerfile$/, what: 'the server image' },
  // A wish adds buildings as data (a BuildingSpec), never by changing how the kit builds or checks them.
  { pattern: /^packages\/shared\/src\/building-kit\//, what: 'the building kit and its checks' },
  // A wish may add a playtest (a new .play.ts file), not change how the robot judges the game.
  { pattern: /^packages\/server\/playtest\/(?!.*\.play\.ts$)/, what: 'the robot playtester' },
  { pattern: /^vitest(\.playtest)?\.config\.ts$/, what: 'how the tests run' },
];

const UNCOUNTED = /(^|\/)package-lock\.json$/;

/** Game code, where drawing calls would mean art made by code. God's View's charts are not game art. */
const GAME_CODE = /^packages\/(client|shared)\/src\/(?!gods-view)[^/]+\.ts$/;
/** Canvas and Phaser calls that draw shapes or colour pixels. */
const DRAWING = /\b(getContext\s*\(|fillRect|strokeRect|beginPath|quadraticCurveTo|bezierCurveTo|roundRect|createLinearGradient|createRadialGradient|add\.graphics|generateTexture)\b|\.(arc|ellipse)\s*\(/;

/** Server code, where SVG shapes would mean pictures made by code. */
const SERVER_CODE = /^packages\/server\/src\/.+\.ts$/;
const SVG_SHAPES = /<(circle|ellipse|rect|path|line|polygon|polyline)\b/;
/**
 * The only server files that may draw, because what they draw only steers
 * the image model and players never see it: walk pose guides (the Owner's
 * exception, 2026-10-15) and the doorway sketch sent with building art.
 */
const MAY_DRAW = [/^packages\/server\/src\/assets\/pose-guide\.ts$/, /^packages\/server\/src\/assets\/building-art\.ts$/];

/**
 * Checks the lines a change adds ({ path, text }) for art drawn in code, and
 * returns the problems, in plain words; an empty list passes.
 */
export function checkArt(additions) {
  const draws = (a) => (GAME_CODE.test(a.path) && DRAWING.test(a.text)) || (SERVER_CODE.test(a.path) && !MAY_DRAW.some((p) => p.test(a.path)) && SVG_SHAPES.test(a.text));
  const drawn = [...new Set(additions.filter(draws).map((a) => a.path))];
  return drawn.map((path) => `${path} draws art in code. Describe the picture instead (BUILDING_STYLES in packages/shared/src/buildings.ts for buildings and furniture, the biome kit for scenery) and the game paints it with the image model chosen in God's View.`);
}

/** Lines added between the base and HEAD, from git. */
export function addedLines(base) {
  const out = execFileSync('git', ['diff', '-U0', '--no-renames', `${base}...HEAD`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lines = [];
  let path = '';
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ ')) path = line.startsWith('+++ b/') ? line.slice(6) : '';
    else if (line.startsWith('+') && path) lines.push({ path, text: line.slice(1) });
  }
  return lines;
}

/**
 * Checks a list of changed files ({ path, added, removed }) and returns the
 * problems, in plain words; an empty list passes.
 */
export function checkChanges(files, { allowCore = false } = {}) {
  const problems = [];
  for (const f of files) {
    if (FORBIDDEN.some((p) => p.test(f.path))) problems.push(`${f.path} may not be changed by a wish.`);
    else if (!allowCore) {
      const core = CORE.find((c) => c.pattern.test(f.path));
      if (core) problems.push(`${f.path} holds ${core.what}; the Owner's approval did not allow core changes.`);
    }
  }
  const counted = files.filter((f) => !UNCOUNTED.test(f.path));
  const lines = counted.reduce((n, f) => n + f.added + f.removed, 0);
  if (counted.length > MAX_FILES) problems.push(`The change touches ${counted.length} files; one wish may touch at most ${MAX_FILES}. Split the wish into smaller steps.`);
  if (lines > MAX_LINES) problems.push(`The change is ${lines} lines; one wish may change at most ${MAX_LINES}. Split the wish into smaller steps.`);
  return problems;
}

/** Game code outside tests, where a wish's own switch is checked. */
const SOURCE = /^packages\/(client|server|shared)\/src\/.+\.ts$/;

/**
 * Checks that a wish adding game code puts it behind its own switch,
 * `modOn(engineModId(<issue>))`, so a Steward can switch it off from God's
 * View. A change that takes more code out than it adds (undoing a wish)
 * needs no switch. Returns the problems, in plain words.
 */
export function checkMod(files, additions, issue) {
  if (!issue) return [];
  const source = files.filter((f) => SOURCE.test(f.path));
  const added = source.reduce((n, f) => n + f.added, 0);
  const removed = source.reduce((n, f) => n + f.removed, 0);
  if (added <= removed) return [];
  const byNumber = new RegExp(`engineModId\\(\\s*${issue}\\s*\\)|['"\`]wish-${issue}['"\`]`);
  if (additions.some((a) => SOURCE.test(a.path) && byNumber.test(a.text))) return [];
  return [`The wish adds game code but never checks its switch. Put what it adds behind modOn(engineModId(${issue})) from @co-mmo/shared, so a Steward can switch it off in God's View; while it is off, the game must work as it did before the wish.`];
}

/** The wish's issue number, from the branch wish/<issue> (in GitHub Actions, the pull request's branch). */
export function wishIssue() {
  let ref = process.env.GITHUB_HEAD_REF ?? '';
  if (!ref) {
    try {
      ref = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      return undefined;
    }
  }
  const m = ref.match(/^wish\/(\d+)/);
  return m ? Number(m[1]) : undefined;
}

/** Files changed between the base and HEAD, from git. */
export function changedFiles(base) {
  const out = execFileSync('git', ['diff', '--numstat', '--no-renames', `${base}...HEAD`], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map((line) => {
    const [added, removed, ...path] = line.split('\t');
    // Binary files show "-"; count them as one line each.
    return { path: path.join('\t'), added: added === '-' ? 1 : Number(added), removed: removed === '-' ? 1 : Number(removed) };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
  const allowCore = args.includes('--allow-core');
  const files = changedFiles(base);
  const additions = addedLines(base);
  const problems = [...checkChanges(files, { allowCore }), ...checkArt(additions), ...checkMod(files, additions, wishIssue())];
  if (!files.length) problems.push('The change is empty.');
  if (problems.length) {
    console.log(problems.map((p) => `- ${p}`).join('\n'));
    process.exit(1);
  }
  console.log(`Wish guard passed: ${files.length} files${allowCore ? ' (core changes allowed by the Owner)' : ''}.`);
}
