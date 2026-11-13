// Edit mode itself, in a real browser: a Steward opens the world editor and
// the game steps back (HUD and chat hidden, the character left where they
// stand); the rail's letters, the finder, the sheet of keys and Esc do what
// they say; the free camera pans without moving the character; the panel is
// dragged wider and is as wide after a reload; the Plan camera shows another
// land and the World camera brings the editor home; Done hands the game back.
// Screenshots land in playtest-results/.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { newCharacter } from '@co-mmo/shared';
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

/** Where the scene draws the player, and the middle of its camera's view, in world pixels. */
const where = (page: Page) => page.evaluate(() => {
  const scene = (window as unknown as { scene: { playerPosition: { x: number; y: number }; cameras: { main: { scrollX: number; scrollY: number } } } }).scene;
  return { me: { ...scene.playerPosition }, view: { x: scene.cameras.main.scrollX, y: scene.cameras.main.scrollY } };
});
const pressed = (page: Page, selector: string) => page.locator(selector).getAttribute('aria-pressed');
const landName = (page: Page) => page.locator('#editor .editor-bar .land-name b').textContent();
const panelWidth = async (page: Page) => Math.round((await page.locator('#editor .editor-panel').boundingBox())!.width);

describe('edit mode', () => {
  it('takes over the screen, answers its keys, remembers its panel and switches cameras', async () => {
    const world = await playWorld({ clientDir });
    const problems: string[] = [];
    const { id, token } = account(world.store, 'Sten', 'steward');
    world.store.savePosition(id, 129.5, 140.5, 'sanctum', newCharacter());

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on('pageerror', (err) => problems.push(`The page threw: ${err.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`The page logged an error: ${m.text()}`);
    });
    await context.addInitScript((t) => localStorage.setItem('co-mmo.token', t), token);
    const open = async () => {
      await page.goto(`${world.base}/`);
      await page.waitForSelector('#game canvas', { timeout: 20_000 });
      await page.waitForTimeout(1500);
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden]) .editor-rail');
    };
    await open();

    // The game steps back: no HUD, no chat until asked for.
    expect.soft(await page.locator('#hud').isVisible(), 'the HUD is hidden').toBe(false);
    expect.soft(await page.locator('#chat').isVisible(), 'the chat is hidden').toBe(false);
    await page.click('#editor [data-chat]');
    expect.soft(await page.locator('#chat').isVisible(), 'Chat shows the chat').toBe(true);
    await page.click('#editor [data-chat]');

    // A group's letter chooses it; again, its next tool.
    await page.keyboard.press('g');
    expect.soft(await pressed(page, '#editor [data-group="ground"]')).toBe('true');
    expect.soft(await pressed(page, '#editor [data-tool="paint"]')).toBe('true');
    await page.keyboard.press('g');
    expect.soft(await pressed(page, '#editor [data-tool="scenery"]'), 'G again: the next Ground tool').toBe('true');

    // The finder: a few letters, then Enter.
    await page.keyboard.press('Control+k');
    await page.keyboard.type('kit build');
    await page.keyboard.press('Enter');
    expect.soft(await pressed(page, '#editor [data-tool="kit"]'), 'the finder chose Kit building').toBe('true');

    // The sheet of keys, and Esc closing it before the editor.
    await page.keyboard.press('?');
    await page.waitForSelector('#editor .editor-keys:not([hidden])');
    expect.soft(await page.locator('#editor .editor-keys').textContent()).toContain('Switch between the World and the Plan camera');
    await page.screenshot({ path: resolve(shots, 'edit-mode-keys.png') });
    await page.keyboard.press('Escape');
    expect.soft(await page.locator('#editor .editor-keys').isHidden(), 'Esc closes the sheet').toBe(true);
    expect.soft(await page.locator('#editor').isVisible(), 'and leaves the editor open').toBe(true);

    // The free camera pans with D; the character stays where they stand.
    const before = await where(page);
    await page.keyboard.down('d');
    // Headless drawing runs few frames a second: hold the key a while.
    await page.waitForTimeout(2000);
    await page.keyboard.up('d');
    const after = await where(page);
    expect.soft(after.view.x - before.view.x, 'the camera panned east').toBeGreaterThan(50);
    expect.soft(after.me, 'the character did not move').toEqual(before.me);

    // The panel's grip: dragged 100 pixels left, the panel is 100 wider, and stays so after a reload.
    const usual = await panelWidth(page);
    const grip = (await page.locator('#editor .panel-grip').boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + 200);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 - 50, grip.y + 200, { steps: 4 });
    await page.mouse.move(grip.x + grip.width / 2 - 100, grip.y + 200, { steps: 4 });
    await page.mouse.up();
    expect.soft(await panelWidth(page), 'the panel is wider').toBe(usual + 100);
    await open();
    expect.soft(await panelWidth(page), 'as wide after a reload').toBe(usual + 100);

    // The Plan camera shows another land; the World camera brings the editor home.
    expect.soft(await landName(page)).toBe('the Sanctum');
    await page.keyboard.press('Tab');
    await page.waitForSelector('#editor .editor-plan canvas');
    await page.selectOption('#editor select[name="plan-land"]', 'woods');
    await expect.poll(() => landName(page), { timeout: 10_000 }).toBe('Whispering Woods');
    await page.screenshot({ path: resolve(shots, 'edit-mode-plan.png') });
    await page.keyboard.press('Tab');
    await expect.poll(() => landName(page), { timeout: 10_000 }).toBe('the Sanctum');
    expect.soft(await page.locator('#editor .editor-plan').isHidden()).toBe(true);

    // Esc with nothing part way through closes the editor, and the game is back.
    await page.keyboard.press('Escape');
    await page.waitForSelector('#editor', { state: 'hidden' });
    expect.soft(await page.locator('#hud').isVisible(), 'the HUD is back').toBe(true);

    expect(problems).toEqual([]);
    expect(world.problems()).toEqual([]);
    await context.close();
  });
});
