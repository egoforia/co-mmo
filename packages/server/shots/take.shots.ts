// Takes every shot in the shot list (list.ts) in a real browser, each on its
// own fresh server with the sky pinned, and writes to SHOTS_OUT:
//   <name>.png        the screen
//   <name>.close.png  the middle enlarged 2x (game shots), for small details
//   contact-sheet.png every shot small, with its name
//   shots.json        what each shot is for, what must be seen, and what a machine found
// Run it with `npm run shots` (scripts/shots.mjs), not on its own.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright';
import { generateRegion, maxHp, newCharacter, regionDef } from '@co-mmo/shared';
import { SHOTS, type Shot, type Spot } from './list.ts';
import { pinnedSky } from './sky.ts';
import { drawKitHouses, newArtDir, owner, shotWorld } from './world.ts';
import { changedShare, closeUp, contactSheet, pictureProblems } from './pictures.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const clientDir = resolve(root, 'packages/client/dist');
const out = resolve(process.env.SHOTS_OUT ?? resolve(root, 'shot-results/now'));
const only = (process.env.SHOTS_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
/** The longest the page is left to settle before the picture: a browser without a graphics card draws slowly. */
const SETTLE_MS = Number(process.env.SHOTS_SETTLE_MS) || 20_000;
/** The screen has settled when less than this share changes in a second (idle sway and water keep moving). */
const STILL = 0.01;

const chosen = only.length ? SHOTS.filter((s) => only.some((o) => s.name.includes(o))) : SHOTS;

/** One shot's line in shots.json. */
interface Taken {
  name: string;
  about: string;
  file: string;
  close?: string;
  region?: string;
  page?: string;
  hour?: number;
  weather?: string;
  screen: string;
  mustSee: string[];
  /** What a machine found: page errors and picture checks. Empty is good. */
  problems: string[];
}

const taken: Taken[] = [];
let browser: Browser;

beforeAll(() => {
  if (!existsSync(resolve(clientDir, 'index.html'))) execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  mkdirSync(out, { recursive: true });
}, 300_000);

/** Art shared by every shot of this run: kit houses drawn once, before the first shot. */
let artDir: string;
/** Kit houses that couldn't be drawn: a finding on every shot. */
let houseProblems: string[] = [];

beforeAll(async () => {
  browser = await launch();
  artDir = await newArtDir();
  const world = await shotWorld(root, clientDir, artDir);
  try {
    const regions = [...new Set(chosen.map((s) => s.region ?? 'sanctum'))];
    houseProblems = await drawKitHouses(world, owner(world.store).token, regions);
  } finally {
    await world.close();
  }
}, 300_000);

/** Chromium as Playwright installs it, or the copy cloud sessions have when Playwright's own is missing. */
async function launch(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (err) {
    const cloud = '/opt/pw-browsers/chromium';
    if (!existsSync(cloud)) throw err;
    return chromium.launch({ executablePath: cloud, args: ['--headless=new', '--no-sandbox'] });
  }
}

afterAll(async () => {
  await browser?.close();
  if (!taken.length) return;
  writeFileSync(resolve(out, 'shots.json'), JSON.stringify({ at: new Date().toISOString(), shots: taken }, null, 2));
  await contactSheet(taken.map((t) => ({ name: t.name, file: resolve(out, t.file) })), resolve(out, 'contact-sheet.png'));
}, 120_000);

/** A browser window sized for the shot, signed in with `token`. */
async function windowFor(shot: Shot, token: string): Promise<BrowserContext> {
  const size = shot.screen === 'phone' ? { ...devices['iPhone 13'] } : { viewport: { width: 1280, height: 800 } };
  const context = await browser.newContext({ ...size, deviceScaleFactor: 1 });
  await context.addInitScript((t) => {
    localStorage.setItem('co-mmo.token', t);
  }, token);
  return context;
}

/** Waits until a second passes with the screen nearly the same; false when it never did. */
async function settle(page: Page): Promise<boolean> {
  const until = Date.now() + SETTLE_MS;
  await page.waitForTimeout(1500);
  let last = await page.screenshot();
  while (Date.now() < until) {
    await page.waitForTimeout(1000);
    const now = await page.screenshot();
    if ((await changedShare(last, now)) < STILL) return true;
    last = now;
  }
  return false;
}

async function take(shot: Shot): Promise<Taken> {
  const regionId = shot.region ?? 'sanctum';
  const problems = houseProblems.filter((h) => !shot.page && h.startsWith(`${regionId}:`)).map((h) => `A kit house could not be drawn (${h}).`);
  const def = regionDef(regionId);
  if (!def) throw new Error(`The shot ${shot.name} names a land that doesn't exist: ${regionId}.`);
  const hour = shot.hour ?? 12;
  const weather = shot.weather ?? 'clear';
  const sky = pinnedSky(regionId, def.biome, hour, weather);
  if (typeof sky === 'string') throw new Error(`The shot ${shot.name} can't be taken: ${sky}`);

  const world = await shotWorld(root, clientDir, artDir, sky);
  try {
    const { id, token } = owner(world.store);
    const map = generateRegion(def);
    const spot: Spot = shot.at ? shot.at(map) : map.spawn;
    // Tough, so the land's creatures can't knock the player back to a shrine before the picture.
    const hardy = { ...newCharacter(), level: 30 };
    world.store.savePosition(id, spot.x, spot.y, regionId, { ...hardy, hp: maxHp(hardy) }, spot.floor ?? 0);

    const context = await windowFor(shot, token);
    const page = await context.newPage();
    page.on('pageerror', (err) => problems.push(`The page threw: ${err.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`The page logged an error: ${m.text()}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && r.status() !== 401) problems.push(`${r.request().method()} ${new URL(r.url()).pathname} answered ${r.status()}.`);
    });
    if (shot.page) {
      await page.goto(`${world.base}${shot.page}`);
      await page.waitForLoadState('networkidle');
      await page.waitForSelector(shot.ready ?? 'body', { timeout: 20_000 });
    } else {
      await page.goto(`${world.base}/`);
      await page.waitForSelector('#game canvas', { timeout: 30_000 });
    }
    // Pictures load and the light eases in after the page opens; wait until the screen holds still.
    const settled = await settle(page);
    if (!settled) problems.push(`The screen was still changing after ${SETTLE_MS / 1000} s; the picture may catch something half drawn.`);
    if (shot.open) await shot.open(page);
    await page.waitForTimeout(500);
    const file = `${shot.name}.png`;
    await page.screenshot({ path: resolve(out, file), fullPage: Boolean(shot.page) });
    await context.close();

    problems.push(...(await pictureProblems(resolve(out, file))));
    let close: string | undefined;
    if (!shot.page) {
      close = `${shot.name}.close.png`;
      await closeUp(resolve(out, file), resolve(out, close));
    }
    return {
      name: shot.name,
      about: shot.about,
      file,
      ...(close ? { close } : {}),
      ...(shot.page ? { page: shot.page } : { region: regionId, hour, weather }),
      screen: shot.screen ?? 'desktop',
      mustSee: shot.mustSee,
      problems,
    };
  } finally {
    await world.close();
  }
}

describe('shots', () => {
  it.each(chosen.map((s) => [s.name, s] as const))('%s', async (_name, shot) => {
    const result = await take(shot);
    taken.push(result);
    // Findings go into shots.json for the report; a shot only fails when it couldn't be taken.
    expect(existsSync(resolve(out, result.file))).toBe(true);
  });
});
