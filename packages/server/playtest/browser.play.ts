// The robot plays in a real browser (Chromium, through Playwright): it opens
// an invite link, makes a character, walks with the keys, prays for a wish
// and grants it, then opens every God's View tab. Any error the page throws
// or logs, and any request the server answers with an error, is a finding.
// Screenshots land in playtest-results/ to look at afterwards.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { app } from '../test/helpers.ts';
import { playWorld } from './harness.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const clientDir = resolve(root, 'packages/client/dist');
const shots = resolve(root, 'playtest-results');
let browser: Browser;

beforeAll(() => {
  // The server serves the built client; build it once if nobody has.
  if (!existsSync(resolve(clientDir, 'index.html'))) execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  mkdirSync(shots, { recursive: true });
}, 180_000);

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

/** Collects what goes wrong on a page: thrown errors, console errors, and failed requests. */
function watch(page: Page, problems: string[]): void {
  page.on('pageerror', (err) => problems.push(`The page threw: ${err.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`The page logged an error: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500 || (r.status() >= 400 && r.status() !== 401)) problems.push(`${r.request().method()} ${new URL(r.url()).pathname} answered ${r.status()}.`);
  });
}

describe('the robot plays in a browser', () => {
  it('joins by invite, walks, makes a wish, and opens every tab of God\'s View', async () => {
    const world = await playWorld({ clientDir });
    const problems: string[] = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    watch(page, problems);

    // The Owner's invite link, as the server prints it on first start.
    const invite = world.store.createInvite(null, 'owner');
    await page.goto(`${world.base}/?invite=${invite.code}`);
    await page.fill('#name', 'Robo');
    await page.check('#adult');
    await page.click('#accept-form button[type=submit]');
    await page.waitForSelector('#hud:not([hidden])', { timeout: 20_000 });
    await page.waitForSelector('#game canvas', { timeout: 20_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(shots, 'game.png') });

    // Walking with the keys moves the player on the server.
    const id = world.store.accountByName('Robo')!.id;
    const before = { ...app!.world.regionOf(id)!.position(id)! };
    await page.locator('#game canvas').click();
    // A browser without a graphics card draws few frames a second, so hold the key a while.
    await page.keyboard.down('ArrowLeft');
    await expect.poll(() => app!.world.regionOf(id)!.position(id)!.x, { timeout: 20_000, message: 'walking left with the arrow key moves the player' }).toBeLessThan(before.x - 1.5);
    await page.keyboard.up('ArrowLeft');

    // Pray with G, wish, and grant it from the card.
    await page.keyboard.press('g');
    await page.waitForSelector('#prayer:not([hidden])');
    await page.fill('#prayer-input', 'I wish for a glowing lantern');
    await page.press('#prayer-input', 'Enter');
    const grant = page.locator('#prayer [data-confirm="yes"]').first();
    await grant.waitFor({ timeout: 15_000 });
    await page.screenshot({ path: resolve(shots, 'wish-card.png') });
    await grant.click();
    await expect.poll(() => world.store.content.some((r) => r.status === 'granted'), { timeout: 10_000, message: 'the wish is granted' }).toBe(true);
    await page.keyboard.press('Escape');

    // The bag shows the wished lantern.
    await page.keyboard.press('i');
    await page.waitForSelector('#inventory:not([hidden])');
    expect.soft(await page.textContent('#inventory'), 'the bag shows the lantern').toMatch(/lantern/i);
    await page.screenshot({ path: resolve(shots, 'bag.png') });
    await page.keyboard.press('Escape');

    // God's View: every tab opens and draws something.
    const gods = await context.newPage();
    watch(gods, problems);
    await gods.goto(`${world.base}/gods-view.html`);
    await gods.waitForSelector('nav [data-tab]', { timeout: 15_000 });
    const tabs = await gods.locator('nav [data-tab]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tab!));
    expect.soft(tabs.length, 'God\'s View shows its tabs').toBeGreaterThan(5);
    for (const tab of tabs) {
      await gods.click(`nav [data-tab="${tab}"]`);
      await gods.waitForTimeout(600);
      const text = (await gods.textContent('#panel'))?.trim() ?? '';
      if (!text) problems.push(`God's View's ${tab} tab stayed empty.`);
      await gods.screenshot({ path: resolve(shots, `gods-view-${tab}.png`), fullPage: true });
    }

    // The Art tab lists the building kit's looks, each with a button to paint its sheet.
    await gods.click('nav [data-tab="art"]');
    await gods.click('a[href="#art/looks"]');
    await gods.waitForSelector('.look', { timeout: 15_000 });
    expect.soft(await gods.textContent('.looks'), 'the building looks list the castle\'s stone').toMatch(/castle/i);
    expect.soft(await gods.locator('.look [data-art-review]').count(), 'each look has a paint button').toBeGreaterThan(3);
    await gods.screenshot({ path: resolve(shots, 'gods-view-art-looks.png'), fullPage: true });

    // The Buildings page lists every building with how it stands, and furniture footprints to change.
    await gods.click('a[href="#art/buildings"]');
    await gods.waitForSelector('.building', { timeout: 15_000 });
    expect.soft(await gods.textContent('.buildings'), 'the buildings list the Arcanum').toMatch(/Arcanum/);
    expect.soft(await gods.locator('form.footprint').count(), 'furniture footprints can be changed').toBeGreaterThan(3);
    await gods.screenshot({ path: resolve(shots, 'gods-view-art-buildings.png'), fullPage: true });

    // A phone-sized screen still shows the game.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const small = await phone.newPage();
    watch(small, problems);
    const token = await page.evaluate(() => Object.entries(localStorage).find(([k]) => /token/i.test(k)));
    if (token) await small.addInitScript(([k, v]) => localStorage.setItem(k, v), token);
    // Opening the game here replaces the desktop window's connection, as playing on two devices does.
    await small.goto(`${world.base}/`);
    await small.waitForSelector('#game canvas', { timeout: 20_000 });
    await small.waitForTimeout(1000);
    await small.screenshot({ path: resolve(shots, 'game-phone.png') });
    await phone.close();
    await context.close();

    expect([...problems, ...world.problems()]).toEqual([]);
  });
});
