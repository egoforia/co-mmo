import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { newCharacter, WORLD_REGIONS } from '@co-mmo/shared';
import { ARCH_TESTBED_WAYPOINTS } from '../../../packages/shared/src/testbed/arch-testbed.ts';
import { account, app } from '../test/helpers.ts';
import { playWorld } from './harness.ts';

// Skip font readiness polling in Playwright so screenshots capture fast & reliably
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const clientDir = resolve(root, 'packages/client/dist');
const kitSheets = resolve(root, 'assets/kit-sheets');
const shippedArt = resolve(root, 'packages/client/public/art/manifest.json');
const outDir = '/home/egoforia/.gemini/antigravity/brain/b689939a-5e8e-4cba-90e5-8a38d8dc89f5';

let browser: Browser;

beforeAll(() => {
  mkdirSync(outDir, { recursive: true });
});

beforeAll(async () => {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
});

afterAll(async () => {
  await browser?.close();
});

interface ShotSpec {
  id: string;
  name: string;
  x: number;
  y: number;
  floor: number;
}

const testbedShots: ShotSpec[] = [
  // Group 1: Ground Enclosed Buildings
  { id: 'G1-A', name: 'clean_G1_A_ground_exterior_afar', ...ARCH_TESTBED_WAYPOINTS['G1-A']! },
  { id: 'G1-B', name: 'clean_G1_B_ground_doorway_threshold', ...ARCH_TESTBED_WAYPOINTS['G1-B']! },
  { id: 'G1-C', name: 'clean_G1_C_ground_active_cutaway', ...ARCH_TESTBED_WAYPOINTS['G1-C']! },
  { id: 'G1-D', name: 'clean_G1_D_ground_exterior_perimeter', ...ARCH_TESTBED_WAYPOINTS['G1-D']! },
  { id: 'G1-E', name: 'clean_G1_E_multi_building_independence', ...ARCH_TESTBED_WAYPOINTS['G1-E']! },

  // Group 2: Open Mountain Terraces
  { id: 'G2-A', name: 'clean_G2_A_terrace_interior_f1', ...ARCH_TESTBED_WAYPOINTS['G2-A']! },
  { id: 'G2-B', name: 'clean_G2_B_terrace_rim_cliff_skirt', ...ARCH_TESTBED_WAYPOINTS['G2-B']! },
  { id: 'G2-C', name: 'clean_G2_C_terrace_stepdown_f2_to_f1', ...ARCH_TESTBED_WAYPOINTS['G2-C']! },
  { id: 'G2-D', name: 'clean_G2_D_summit_panorama_f4', ...ARCH_TESTBED_WAYPOINTS['G2-D']! },
  { id: 'G2-E', name: 'clean_G2_E_terrace_rising_cliff_junction', ...ARCH_TESTBED_WAYPOINTS['G2-E']! },

  // Group 3: Multi-Storey Enclosed Buildings
  { id: 'G3-A', name: 'clean_G3_A_upper_closed_seen_from_ground', ...ARCH_TESTBED_WAYPOINTS['G3-A']! },
  { id: 'G3-B', name: 'clean_G3_B_upper_occlusion_cutaway', ...ARCH_TESTBED_WAYPOINTS['G3-B']! },
  { id: 'G3-C', name: 'clean_G3_C_upper_enclosed_interior_f1', ...ARCH_TESTBED_WAYPOINTS['G3-C']! },
  { id: 'G3-D', name: 'clean_G3_D_upper_mezzanine_overlook', ...ARCH_TESTBED_WAYPOINTS['G3-D']! },

  // Group 4: The Overlap Bug Lab
  { id: 'D1', name: 'clean_D1_terrace_over_ground_cottage', ...ARCH_TESTBED_WAYPOINTS['D1']! },
  { id: 'D2', name: 'clean_D2_terrace_adjacent_bug_spot', ...ARCH_TESTBED_WAYPOINTS['D2']! },
  { id: 'D3', name: 'clean_D3_terrace_looking_down_at_courtyard', ...ARCH_TESTBED_WAYPOINTS['D3']! },
  { id: 'D4', name: 'clean_D4_ground_looking_up_at_terrace', ...ARCH_TESTBED_WAYPOINTS['D4']! },

  // Group 5: Subterranean Cavern Vaults
  { id: 'G5-A', name: 'clean_G5_A_subterranean_cavern_f_minus_1', ...ARCH_TESTBED_WAYPOINTS['G5-A']! },
  { id: 'G5-B', name: 'clean_G5_B_deep_cavern_f_minus_2', ...ARCH_TESTBED_WAYPOINTS['G5-B']! },

  // Group 6: Vertical Proving Runway
  { id: 'G6-A', name: 'clean_G6_A_outdoor_mountain_stairway', ...ARCH_TESTBED_WAYPOINTS['G6-A']! },
  { id: 'G6-B', name: 'clean_G6_B_indoor_stairway', ...ARCH_TESTBED_WAYPOINTS['G6-B']! },
  { id: 'G6-C', name: 'clean_G6_C_crypt_descent', ...ARCH_TESTBED_WAYPOINTS['G6-C']! },
  { id: 'G6-D', name: 'clean_G6_D_isolated_viaduct_bridge', ...ARCH_TESTBED_WAYPOINTS['G6-D']! },
  { id: 'G6-E', name: 'clean_G6_E_terrace_stairs_f1_to_f2', ...ARCH_TESTBED_WAYPOINTS['G6-E']! },
];

describe('clean-room architectural testbed captures', () => {
  it('captures all 25 clean-room combinations in arch-testbed', async () => {
    // High noon daylight at 12:00:00 (phase 0.5), 24-hour cycle, zero darkness, clear skies
    const NOON_MS = 12 * 60 * 60_000;
    const sky = { dayMinutes: 24 * 60, weatherMinutes: 60, weather: false };
    const world = await playWorld({
      clientDir,
      kitSheets,
      shippedArt,
      now: () => NOON_MS,
      sky,
    });
    const totalShots = testbedShots.length;

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { id, token } = account(world.store, 'TestbedArchitect', 'owner');

    const char = newCharacter();
    char.hp = 99999;
    world.store.savePosition(id, 30, 30, 'arch-testbed', char, 0);

    await context.addInitScript((t) => localStorage.setItem('co-mmo.token', t), token);
    const page = await context.newPage();
    await page.goto(`${world.base}/`);
    await page.waitForSelector('#game canvas', { timeout: 30_000 });

    console.log('Waiting for arch-testbed scene to initialize...');
    console.log('app.world regions:', app ? [...app.world.regions.keys()] : 'app is null');
    await page.waitForTimeout(8000);

    const testbed = app!.world.local('arch-testbed');
    console.log('testbed instance:', testbed ? 'found' : 'NOT FOUND');
    if (!testbed) {
      throw new Error(`arch-testbed region not found in app.world! Available regions: ${[...app!.world.regions.keys()].join(', ')}`);
    }

    let shotIndex = 1;
    for (const s of testbedShots) {
      const shotPath = resolve(outDir, `${s.name}.png`);

      console.log(`[${shotIndex}/${totalShots}] Placing at ${s.id} (${s.x}, ${s.y}, floor ${s.floor})...`);
      testbed.placePlayer(id, s.x, s.y, s.floor);

      // Allow camera to pan, cutaways to evaluate, and tiles to draw
      await page.waitForTimeout(2500);

      await page.screenshot({ path: shotPath, timeout: 60_000 });
      const sizeKb = (statSync(shotPath).size / 1024).toFixed(0);
      console.log(`[${shotIndex}/${totalShots}] Captured ${s.id} -> ${s.name}.png (${sizeKb} KB)`);
      shotIndex++;
    }

    await context.close();
  }, 600_000);
});
