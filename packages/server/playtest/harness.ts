// A world for the robot playtester: the real server on a random port, with
// fake AI (the offline God and a fake painter, no video or sound), so a
// playtest never pays for anything. Bots join it as real players would.

import { afterEach } from 'vitest';
import { generateRegion, newCharacter, regionDef, type Character, type Role } from '@co-mmo/shared';
import { account, start } from '../test/helpers.ts';
import { Bot } from './bot.ts';

/** Server errors written to the log while a playtest runs: each is a finding. */
const serverErrors: string[] = [];
const original = console.error;
let capturing = false;

afterEach(() => {
  console.error = original;
  capturing = false;
  serverErrors.length = 0;
});

export interface BotOptions {
  role?: Exclude<Role, 'player'> | 'player';
  /** Where it starts: a region id (its spawn point) or the Sanctum. */
  region?: string;
  /** Changes to a new character: more Favor for wishes, a level for fights. */
  character?: Partial<Character>;
}

/** Starts the game with fake AI. Options go to the test server as they are. */
export async function playWorld(options: Parameters<typeof start>[0] = {}) {
  if (!capturing) {
    capturing = true;
    console.error = (...args: unknown[]) => {
      serverErrors.push(args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(' '));
      original(...args);
    };
  }
  const world = await start(options);
  const bots: Bot[] = [];
  return {
    ...world,
    /** What the server logged as errors so far. */
    serverErrors,
    /** Everything every bot found wrong, then the server's errors. */
    problems: () => [...bots.flatMap((b) => b.problems), ...serverErrors.map((e) => `The server logged an error: ${e}`)],
    /** Makes an account and joins the world with it as a robot player. */
    async bot(name: string, opts: BotOptions = {}): Promise<Bot> {
      const { id, token } = account(world.store, name, opts.role ?? 'player');
      if (opts.region || opts.character) {
        const regionId = opts.region ?? 'sanctum';
        const def = regionDef(regionId);
        if (!def) throw new Error(`There is no region ${regionId}.`);
        const spawn = generateRegion(def).spawn;
        world.store.savePosition(id, spawn.x, spawn.y, regionId, { ...newCharacter(), ...opts.character });
      }
      const bot = await Bot.join(world.ws, token, name);
      bots.push(bot);
      return bot;
    },
  };
}

export type PlayWorld = Awaited<ReturnType<typeof playWorld>>;

/** Chooses a world editor tool the way an editor does: its group on the rail, then the tool in the options bar. */
export async function chooseTool(page: import('playwright').Page, tool: string, root = '#editor'): Promise<void> {
  await page.click(`${root} [data-tools~="${tool}"]`);
  await page.click(`${root} [data-tool="${tool}"]`);
}

/** Makes the world editor's changes go live at once (the drafts pill's menu). */
export async function goLive(page: import('playwright').Page): Promise<void> {
  await page.click('#editor .publish-menu summary');
  // Ticking it draws the bar again, which folds the menu away.
  await page.check('#editor input[name="live"]');
}

/** Selects the building at a point of the screen and gives it floors from the inspector's Floors section. */
export async function giveFloors(page: import('playwright').Page, at: { x: number; y: number }, up: number, down: number): Promise<void> {
  await page.mouse.click(at.x, at.y);
  await page.click('#editor details[data-section="floors"] summary');
  await page.selectOption('#editor select[name="insp.floors.up"]', String(up));
  await page.selectOption('#editor select[name="insp.floors.down"]', String(down));
  await page.click('#editor [data-pick="apply:floors"]');
}
