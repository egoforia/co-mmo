// The performance overlay, in a real browser: a Steward shows it with F3,
// it counts frames, times a ping and hears from the server running their
// region, and stays on across a reload; a player's F3 shows nothing.
// A screenshot lands in playtest-results/ to look at afterwards.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { account } from '../test/helpers.ts';
import { playWorld } from './harness.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const clientDir = resolve(root, 'packages/client/dist');
const shots = resolve(root, 'playtest-results');
let browser: Browser;

beforeAll(() => {
  if (!existsSync(resolve(clientDir, 'index.html'))) execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  mkdirSync(shots, { recursive: true });
}, 180_000);

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

/** A browser signed in as this account, at the game. */
async function signedIn(token: string, base: string, problems: string[]): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((t) => localStorage.setItem('co-mmo.token', t), token);
  const page = await context.newPage();
  page.on('pageerror', (err) => problems.push(`The page threw: ${err.message}`));
  await page.goto(`${base}/`);
  await page.waitForSelector('#game canvas', { timeout: 20_000 });
  return context;
}

describe('the performance overlay', () => {
  it('shows a Steward the frame rate, the network and the server, and nothing to a player', async () => {
    const world = await playWorld({ clientDir });
    const problems: string[] = [];
    const steward = account(world.store, 'Robo', 'steward');
    const context = await signedIn(steward.token, world.base, problems);
    const page = context.pages()[0]!;
    const overlay = page.locator('#perf');
    await expect.poll(() => overlay.isVisible()).toBe(false);

    await page.keyboard.press('F3');
    await expect.poll(() => overlay.isVisible()).toBe(true);
    // Frames counted, a ping answered, and the server running the Sanctum heard from.
    await expect.poll(() => overlay.innerText(), { timeout: 15_000 }).toMatch(/ms round trip/);
    const text = await overlay.innerText();
    expect(text).toMatch(/\d+ fps/);
    expect(text).toMatch(/Game server · tick/);
    expect(text).toMatch(/in the Sanctum/);
    await page.screenshot({ path: resolve(shots, 'perf-overlay.png') });

    // Kept in this browser across a reload, and hidden again from Account.
    await page.reload();
    await page.waitForSelector('#game canvas', { timeout: 20_000 });
    await expect.poll(() => overlay.isVisible()).toBe(true);
    await page.click('#account-button');
    await page.click('#perf-overlay');
    await expect.poll(() => overlay.isVisible()).toBe(false);
    await context.close();

    // A player has no overlay: F3 does nothing, and the server's numbers are not theirs to ask.
    const player = account(world.store, 'Ilya');
    const theirs = await signedIn(player.token, world.base, problems);
    const theirPage = theirs.pages()[0]!;
    await theirPage.keyboard.press('F3');
    expect(await theirPage.locator('#perf').count()).toBe(0);
    const asked = await fetch(`${world.base}/api/admin/perf`, { headers: { authorization: `Bearer ${player.token}` } });
    expect(asked.status).toBe(403);
    await theirs.close();

    expect(problems).toEqual([]);
    expect(world.problems()).toEqual([]);
  });
});
