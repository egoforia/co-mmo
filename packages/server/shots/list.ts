// The shot list: fixed places, hours, weather and screens that agents
// photograph before and after a change to what the game draws, so two runs
// can be laid side by side. Add a shot when a feature draws something none of
// these show; keep names stable, because comparisons pair shots by name.
// docs/screenshots.md explains the process; `/shots` runs it.

import type { Page } from 'playwright';
import { EDIT_KINDS, type RegionMap, type Weather, type WorldEditDraft } from '@co-mmo/shared';

/** Where the camera stands: a tile on a floor. */
export interface Spot {
  x: number;
  y: number;
  floor?: number;
}

/** One picture the shot runner takes. */
export interface Shot {
  /** File name without .png; comparisons pair shots by it. */
  name: string;
  /** What the shot is for, in a sentence. */
  about: string;
  /** Another page than the game, by its path ('/gods-view.html'); the game when missing. */
  page?: string;
  /** On another page: what shows once it has loaded (a CSS selector). */
  ready?: string;
  /** The land the player stands in (game shots). */
  region?: string;
  /** Where they stand; the land's spawn point when missing. */
  at?: (map: RegionMap) => Spot;
  /** The game hour, 0-24 (noon when missing), and the weather (clear when missing). */
  hour?: number;
  weather?: Weather;
  /** Screen size: desktop 1280x800 (default) or a phone. */
  screen?: 'desktop' | 'phone';
  /** Things the player carries besides the Bible, for shots of the bag and what it does. */
  carry?: { item: string; qty: number }[];
  /** Skills the player knows, put on hotbar keys 1, 2 and on, for shots of the hotbar. */
  skills?: string[];
  /** World edits laid live before the page opens (a stash chest beside the player), worked out from the land and the spot. */
  edits?: (map: RegionMap, spot: Spot) => WorldEditDraft[];
  /** What the account's shared stash holds (docs/stash.md). */
  stash?: { item: string; qty: number }[];
  /** More characters on the player's account, by name, for shots of the character screen (docs/characters.md). */
  characters?: string[];
  /** Hide the HUD and windows, for shots of the world itself (buildings, floors). */
  hideUi?: boolean;
  /** Done after the page has settled and before the picture: open a window, click a tab. */
  open?: (page: Page) => Promise<void>;
  /** What someone looking at the picture must find in it; each is checked by eye and named in the report. */
  mustSee: string[];
}

/** The middle of a building's floor, for shots inside it (moved to the nearest free tile if furniture stands there). */
const inside = (style: string, floor = 0) => (map: RegionMap): Spot => {
  const b = map.buildings.find((x) => x.style === style);
  if (!b) throw new Error(`There is no ${style} here.`);
  return { x: Math.floor(b.x + b.width / 2), y: Math.floor(b.y + b.height / 2), floor };
};

/** Standing at the top of the stairs that lead up from `lower`, on the floor above. */
const upstairs = (lower: number, nth = 0) => (map: RegionMap): Spot => {
  const way = map.stairways.filter((s) => s.lower === lower)[nth];
  if (!way) throw new Error(`There are no stairs up from floor ${lower} here.`);
  return { ...way.top, floor: way.upper };
};

/** Standing on a land's bookmark (a world editor edit), by its name. */
const bookmark = (name: string) => (map: RegionMap): Spot => {
  const b = map.bookmarks?.find((m) => m.name === name);
  if (!b) throw new Error(`There is no bookmark ${name} here.`);
  return { x: b.x, y: b.y, floor: b.floor };
};

/** Standing a little way from the first home of a kind of monster, to see it beside the player. */
const nearMonster = (kind: string, dx = 2) => (map: RegionMap): Spot => {
  const c = map.creatures.find((m) => m.kind === kind);
  if (!c) throw new Error(`No ${kind} lives here.`);
  return { x: Math.floor(c.x) + dx, y: Math.floor(c.y), floor: c.floor };
};

/** A stash chest on the first open spot just beside the player, in reach. */
const chestBeside = (map: RegionMap, spot: Spot): WorldEditDraft[] => {
  const x = Math.floor(spot.x);
  const y = Math.floor(spot.y);
  const at = [[1, -1], [-2, -1], [1, 1], [-2, 1], [0, -2], [-1, 1]].map(([dx, dy]) => [x + dx!, y + dy!] as [number, number])
    .find((a) => !EDIT_KINDS.stash.check(map, { kind: 'stash', at: a }, { creatures: {} }));
  if (!at) throw new Error('There is no open ground for a stash chest beside the player.');
  return [{ kind: 'stash', at }];
};

/** Every shot, in the order the contact sheet shows them. */
export const SHOTS: Shot[] = [
  {
    name: 'sanctum-noon',
    about: 'Where every player arrives, in full daylight.',
    region: 'sanctum',
    mustSee: ['the player standing in the middle, whole and the right way up', 'flagstones join without seams or gaps', 'buildings stand on the ground, not floating or sunk', 'the HUD (bars, buttons) is readable and not covering the player'],
  },
  {
    name: 'sanctum-night',
    about: 'The same spot at night: the moon, lamps and windows light the scene.',
    region: 'sanctum',
    hour: 23,
    mustSee: ['the scene is dark but the player is still readable', 'lamps light the ground around them', 'no picture glows as if it were daylight'],
  },
  {
    name: 'sanctum-dusk-rain',
    about: 'Dusk in the rain: the light grade and the weather together.',
    region: 'sanctum',
    hour: 18.5,
    weather: 'rain',
    mustSee: ['a low dusk light, greyed by the rain (weather grades the light; there is no falling rain yet)', 'names and the HUD stay readable'],
  },
  {
    name: 'sanctum-arcanum-inside',
    hideUi: true,
    about: 'Inside the Arcanum: the cutaway of a kit house.',
    region: 'sanctum',
    at: inside('sanctum-arcanum'),
    mustSee: ['near walls are cut low so the room shows', 'far walls are tall and join at the corners', 'furniture stands on the floor, inside the walls', 'the room is lit by its own lights'],
  },
  {
    name: 'sanctum-temple-inside',
    hideUi: true,
    about: 'Inside the temple: furniture where it was designed, centred in the room.',
    region: 'sanctum',
    at: inside('sanctum-temple'),
    mustSee: ['the altar and benches sit centred in the room, not slid to one side', 'no piece overlaps another', 'furniture stands on the floor, inside the walls'],
  },
  {
    name: 'sanctum-inn-inside',
    hideUi: true,
    about: 'Inside the inn: tables and benches where they were designed.',
    region: 'sanctum',
    at: inside('sanctum-inn'),
    mustSee: ['each bench stands beside its table, not under it', 'no piece overlaps another', 'furniture stands on the floor, inside the walls'],
  },
  {
    name: 'woods-noon',
    about: 'Whispering Woods at its arrival point.',
    region: 'woods',
    mustSee: ['trees stand on the ground with their trunks, not floating', 'moss ground joins without seams'],
  },
  {
    name: 'woods-fog',
    about: 'Whispering Woods in fog.',
    region: 'woods',
    hour: 9,
    weather: 'fog',
    mustSee: ['a paler, greyer light than woods-noon', 'the player stays readable'],
  },
  {
    name: 'shore-noon',
    about: 'Sunlit Shore: sand, sea and their edge.',
    region: 'shore',
    mustSee: ['sand and sea meet in a clean edge', 'the player stands on sand, not in the sea'],
  },
  {
    name: 'shore-sea-cave-loft',
    hideUi: true,
    about: "One floor up in the sea cave: only this floor's walls and people show.",
    region: 'shore',
    at: upstairs(0),
    mustSee: ['the floor the player is on is drawn; the land outside is hidden or dimmed', 'walls of other floors are not drawn'],
  },
  {
    name: 'woods-cave-wall-looks',
    hideUi: true,
    about: "The Whispering Woods cave's south wall from outside, with four wall tiles each side of the doorway given looks of their own (W2): grey castle stone on the left, the inn's walls on the right.",
    region: 'woods',
    at: () => ({ x: 66.5, y: 184 }),
    open: async (page) => {
      // Laid live through the editor's API, as a published change would be.
      const tiles = (xs: number[]) => xs.map((x) => ({ kind: 'wall-look', at: [x, 181] }));
      const edits = [...tiles([62, 63, 64, 65]).map((e) => ({ ...e, style: 'woods-castle' })), ...tiles([68, 69, 70, 71]).map((e) => ({ ...e, style: 'sanctum-inn' }))];
      await page.evaluate(async (body) => {
        const token = localStorage.getItem('co-mmo.token');
        const res = await fetch('/api/world-edits', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(await res.text());
      }, { region: 'woods', edits, live: true });
      // The land is laid out again and every screen in it welcomed afresh.
      await page.waitForTimeout(3000);
    },
    mustSee: ['the cave seen closed from a few tiles away: its wall left of the doorway in green-grey castle stone for four tiles, right of it in the pale inn wall for four tiles', 'the rest of the cave wall in its own dark rock', 'no gaps where the looks meet, only the change of texture'],
  },
  {
    name: 'desert-noon',
    about: 'Mirage Desert in bright sun.',
    region: 'desert',
    mustSee: ['dunes in three close shades, no stray rocks in the ground texture', 'cacti and ruins sit on the sand'],
  },
  {
    name: 'desert-sandstorm',
    about: 'Mirage Desert in a sandstorm.',
    region: 'desert',
    hour: 15,
    weather: 'sandstorm',
    mustSee: ['a warm, dusty light, more orange than desert-noon', 'cacti and the player stay readable'],
  },
  {
    name: 'frostpeak-snow',
    about: 'Frostpeak in falling snow.',
    region: 'frostpeak',
    weather: 'snow',
    mustSee: ['a cold, pale light', 'houses and cliffs stand on the ground'],
  },
  {
    name: 'frostpeak-upstairs',
    hideUi: true,
    about: 'A Frostpeak terrace one floor up: open rims, parapets and cliff skirts.',
    region: 'frostpeak',
    at: upstairs(0),
    mustSee: ['the terrace edge has a low parapet and a cliff skirt below it', 'nothing from the floor below pokes through'],
  },
  {
    name: 'mushroom-hollow-noon',
    about: 'Mushroom Hollow at its arrival point.',
    region: 'mushroom-hollow',
    mustSee: ['mushrooms and ground are painted, not blank or magenta'],
  },
  {
    name: 'sanctum-readied-skill',
    about: 'A skill readied with Shift and its number, waiting for the next Space.',
    region: 'sanctum',
    skills: ['shield-bash', 'lunge'],
    open: async (page) => {
      await page.waitForSelector('#abilities button:not(.empty)');
      await page.keyboard.press('Shift+Digit1');
      await page.waitForSelector('#abilities button.readied');
    },
    mustSee: ['the first hotbar button is ringed as readied, the others are not', 'nothing was cast: no skill effect on the player'],
  },
  {
    name: 'sanctum-bag',
    about: 'The bag open over the game.',
    region: 'sanctum',
    open: async (page) => {
      await page.keyboard.press('i');
      await page.waitForSelector('#inventory:not([hidden])');
    },
    mustSee: ['the bag window is whole on screen, its slots and words readable', 'the player stands in the doll with worn slots down both sides and the Bag slot marked', 'all 20 cells drawn, five across, empty ones dashed'],
  },
  {
    name: 'sanctum-bag-menu',
    about: 'The item menu, opened with a right-click on a carried thing.',
    region: 'sanctum',
    open: async (page) => {
      await page.keyboard.press('i');
      await page.click('#inventory .bag-grid [data-index="0"]', { button: 'right' });
      await page.waitForSelector('#item-menu:not([hidden])');
    },
    mustSee: ['the menu stands beside the cell with the thing\'s name and its actions', 'no item card covers the menu'],
  },
  {
    name: 'sanctum-pile',
    about: 'Shells dropped from the bag, lying as a pile anyone may take.',
    region: 'sanctum',
    carry: [{ item: 'wooden-sword', qty: 1 }, { item: 'crab-shell', qty: 5 }],
    open: async (page) => {
      await page.keyboard.press('i');
      await page.click('#inventory .bag-grid [data-item="crab-shell"]', { button: 'right' });
      await page.click('#item-menu button:has-text("Drop all 5")');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#chat-log')?.textContent?.includes('Anyone may take it'));
    },
    mustSee: ['a small shell picture stands at the player\'s feet with the name "Dropped Crab Shell (E for loot)"', 'the chat says anyone may take it for ten minutes'],
  },
  {
    name: 'woods-bag-risk',
    about: 'The bag outside a safe area: the "If you fall here" line names what a death costs.',
    region: 'woods',
    at: (map) => ({ x: map.spawn.x + 12, y: map.spawn.y }),
    carry: [{ item: 'gold', qty: 340 }],
    open: async (page) => {
      await page.keyboard.press('i');
      await page.waitForSelector('#inventory .risk-line:not(.safe)');
    },
    mustSee: ['a red line at the top of the bag: the XP and all 340 gold lost, and the 15% chances', 'a Why? link at its end'],
  },
  {
    name: 'shore-shop-docked',
    about: "Marina's shop open with the bag docked beside it, after one shell was Shift-clicked across.",
    region: 'shore',
    at: (map) => {
      const n = map.npcs.find((x) => x.id === 'marina');
      if (!n) throw new Error('Marina is not on the shore.');
      return { x: Math.floor(n.x) + 1, y: Math.floor(n.y) };
    },
    carry: [{ item: 'crab-shell', qty: 4 }, { item: 'gold', qty: 30 }],
    open: async (page) => {
      await page.keyboard.press('e');
      await page.click('#dialogue [data-shop]');
      await page.waitForSelector('#shop:not([hidden])');
      await page.waitForSelector('#inventory:not([hidden])');
      // Shift-click sells one shell across.
      await page.click('#inventory [data-item="crab-shell"]', { modifiers: ['Shift'] });
      await page.waitForSelector('#inventory [data-item="crab-shell"] .qty:text("3")');
    },
    mustSee: ['the bag on the left and the shop on the right, side by side, neither covering the other', 'three shells left in the bag after one was Shift-clicked across, and more gold'],
  },
  {
    name: 'sanctum-bag-phone',
    about: 'The bag on a phone-sized screen: the doll above the grid.',
    region: 'sanctum',
    screen: 'phone',
    open: async (page) => {
      await page.keyboard.press('i');
      await page.waitForSelector('#inventory:not([hidden])');
    },
    mustSee: ['the doll sits above the grid', 'nothing runs off the screen sideways'],
  },
  {
    name: 'sanctum-bag-card',
    about: 'The item card beside a carried thing in the bag.',
    region: 'sanctum',
    open: async (page) => {
      await page.keyboard.press('i');
      await page.hover('#inventory [data-card]');
      await page.waitForSelector('#item-card:not([hidden])');
    },
    mustSee: ['the card stands beside the slot, not over it, and inside the screen', 'its name, kind and description are readable'],
  },
  {
    name: 'sanctum-phone',
    about: 'The game on a phone-sized screen.',
    region: 'sanctum',
    screen: 'phone',
    mustSee: ['the player is on screen', 'HUD parts do not overlap each other or run off the edge'],
  },
  {
    name: 'character-screen',
    about: 'The character screen after sign-in, for an account with three characters.',
    page: '/',
    ready: '.panel .characters',
    characters: ['Ilya', 'Petra'],
    mustSee: ['the title Your characters and a line saying each has their own Favor and things', 'three lines: Owner (played last), Ilya and Petra, each with level, people and Calling, the land and Play and Delete buttons', 'a New character button under the list'],
  },
  {
    name: 'character-new',
    about: 'Making a new character from the character screen.',
    page: '/',
    ready: '.panel .characters',
    characters: ['Ilya'],
    open: async (page) => {
      await page.click('#new-character');
      await page.waitForSelector('#character-form');
    },
    mustSee: ['the title New character', 'a name box, the people and Calling choosers and a box for how they look', 'Make this character and Back to your characters buttons'],
  },
  {
    name: 'sanctum-account',
    about: 'The Account window in the Sanctum, with Switch character.',
    region: 'sanctum',
    open: async (page) => {
      await page.click('#account-button');
      await page.waitForSelector('#switch-character');
    },
    mustSee: ['the Account window with Your look, then Characters with a Switch character button, then Signing in', 'nothing in the window cut off or overlapping'],
  },
  {
    name: 'sanctum-stash',
    about: 'The shared stash opened by a stash chest in the Sanctum, docked beside the bag.',
    region: 'sanctum',
    edits: chestBeside,
    stash: [{ item: 'gold', qty: 120 }, { item: 'tonic', qty: 4 }, { item: 'goat-horn', qty: 2 }],
    carry: [{ item: 'tonic', qty: 2 }],
    open: async (page) => {
      await page.keyboard.press('e');
      await page.waitForSelector('#stash:not([hidden])');
    },
    mustSee: ['the bag on the left and the Shared stash window on the right, side by side', 'the stash header says 3 of 40 slots', 'gold, tonics and goat horns in the stash with their counts', 'a line saying every character on the account opens this stash'],
  },
  {
    name: 'gods-view',
    about: "God's View as the Owner first sees it.",
    page: '/gods-view.html',
    ready: 'nav [data-tab]',
    mustSee: ['tabs along the top, the first tab filled in', 'no error text'],
  },
  {
    name: 'gods-view-sky',
    about: "God's View Sky tab: day length presets, the night share, the 24-hour strip, weather odds per land and the event tools.",
    page: '/gods-view.html#sky',
    ready: '#sky-form',
    mustSee: ['a strip showing night, dawn, day, dusk and night again with a mark for now', 'day length buttons from 1 h to 24 h and Follow the real day', 'a table of weather odds by land with sliders', 'Set the hour now and Change the weather in a land now', 'nothing cut off or overlapping'],
  },
  {
    name: 'gods-view-monsters',
    about: "God's View Monsters tab: every kind of monster with its size and loot, one size form open.",
    page: '/gods-view.html',
    ready: 'nav [data-tab]',
    open: async (page) => {
      await page.click('nav [data-tab="loot"]');
      await page.waitForSelector('section.loot');
      await page.click('section.loot details:first-of-type summary');
    },
    mustSee: ['the tab is called Monsters', 'each monster card shows its level and its size', 'the first card\'s size form is open: a Size list with its height in px, which size is its own, and the other monsters of the same size'],
  },
  {
    name: 'woods-monsters',
    about: 'Walking mushrooms (small, harmless) beside the player in Whispering Woods, to check monsters stand their size.',
    region: 'woods',
    at: nearMonster('walking-mushroom'),
    mustSee: ['the walking mushrooms stand about two thirds of the player\'s height (112 against 168 px before the camera shrinks them)', 'their feet stand on the ground'],
  },
  {
    name: 'gather-spot-hover',
    about: 'A gathering spot in the Sanctum hovered: it says it is ready to gather. Its state pictures (Picked, Growing) are not painted, so it shows its Ready picture.',
    region: 'sanctum',
    // One tile west of the first spot, so it stands just right of the player.
    at: (map) => ({ x: map.spots[0]!.x - 0.5, y: map.spots[0]!.y + 0.5 }),
    open: async (page) => {
      // The spot's tile is one tile east (80, 40 world px) of us at zoom 0.6; aim a little up its picture.
      await page.mouse.move(640 + 48, 400 + 24 - 20);
      await page.waitForTimeout(400);
    },
    mustSee: ['a gathering spot just right of the player, with a label above it naming it and saying "Ready to gather"'],
  },
  {
    name: 'art-studio',
    about: 'The AI Art Studio, where the Owner reviews and paints pictures.',
    page: '/art-studio.html',
    ready: '.asset-list button',
    mustSee: ['pictures load (no broken image icons)', 'buttons and labels are readable', 'workspaces along the top, assets docked left, the Inspector right, the painting strip along the bottom'],
  },
  {
    name: 'art-studio-picked',
    about: 'The AI Art Studio with a set piece picked in the asset browser.',
    page: '/art-studio.html',
    ready: '.asset-list button',
    open: async (page) => {
      await page.click('.asset-chips [data-group="pieces"]');
      await page.fill('.dock-left input[name=search]', 'shrine');
      await page.click('.asset-list button[data-asset="sanctum-shrine"]');
      await page.waitForSelector('.dock-right .props');
    },
    mustSee: ['the shrine row is marked in the list', 'the Inspector shows its picture and a property table with a 2 × 1 footprint'],
  },
  {
    name: 'art-studio-paint-pick',
    about: "The Paint workspace's Items page with a picture's card clicked: it is outlined and the Inspector shows it.",
    page: '/art-studio.html#art/items',
    ready: '.art-item[data-asset-card]',
    open: async (page) => {
      const id = await page.$$eval('.art-item[data-asset-card]', (els) => (els[Math.min(2, els.length - 1)] as HTMLElement).dataset.assetCard!);
      await page.click(`[data-asset-card="${id}"] figcaption b`);
      await page.waitForSelector(`[data-asset-card="${id}"][data-picked]`);
      await page.waitForFunction((x) => document.querySelector('#dock-right')?.textContent?.includes(x), id);
    },
    mustSee: ['a picture card on the Items page outlined in gold', "the Inspector on the right shows that picture's name, id and kind", 'the address ends with ?asset= and its id'],
  },
  {
    name: 'art-studio-canvas',
    about: 'The Studio canvas: the Sanctum shrine standing on its 2 by 1 tiles at game size, a player beside it, lit at dusk.',
    page: '/art-studio.html#art/canvas?asset=sanctum-shrine',
    ready: '.studio-canvas',
    open: async (page) => {
      await page.click('.canvas-bar [data-hour="19"]');
      await page.waitForSelector('.studio-canvas[data-lit="19"]');
    },
    mustSee: ['the shrine stands on two outlined tile diamonds, on painted Sanctum meadow', 'a player figure stands beside it at game size', 'the Place workspace and its Canvas tab are marked', 'the Inspector shows the shrine'],
  },
  {
    name: 'art-studio-offset',
    about: 'The Offset tool: the shrine nudged 20 px left on the canvas, not saved yet.',
    page: '/art-studio.html#art/canvas?asset=sanctum-shrine',
    ready: '.studio-canvas[data-lit="none"]',
    open: async (page) => {
      await page.keyboard.press('Shift+ArrowLeft');
      await page.keyboard.press('Shift+ArrowLeft');
      await page.waitForSelector('.fit-panel input[name=fit-x][value="-20"]');
    },
    mustSee: ['the shrine stands 20 px left of where it did, an orange cross at its anchor', 'the Inspector\'s Offset section shows x -20 and "not saved yet"', 'Save the fit is enabled'],
  },
  {
    name: 'art-studio-hitbox',
    about: 'The Hitbox tool: the shrine with its left tile opened and the tile left of its footprint blocked, not saved yet.',
    page: '/art-studio.html#art/canvas?asset=sanctum-shrine',
    ready: '.studio-canvas[data-lit="none"]',
    open: async (page) => {
      await page.keyboard.press('b');
      await page.waitForSelector('.studio-canvas[data-hitbox="true"]');
      // The shrine's left tile (0, 0): its middle is 80 px right of the canvas world origin's projection.
      await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('.studio-canvas')!;
        const r = c.getBoundingClientRect();
        // The tiles' middle (1, 0.5) sits at the canvas middle, 62 % down; tile (0, 0)'s middle is (0.5, 0.5), 40 px left and 20 px up of it.
        // Tile (-1, 0), just past the footprint, is 120 px left and 60 px up of it.
        for (const [dx, dy] of [[-40, -20], [-120, -60]]) {
          const [x, y] = [r.left + r.width / 2 + dx, r.top + r.height * 0.62 + dy];
          for (const type of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
        }
      });
      await page.waitForSelector('.fit-panel .hitbox-words');
      await page.waitForFunction(() => document.querySelector('.fit-panel .hitbox-words')?.textContent?.startsWith('Blocks 2 tiles'));
    },
    mustSee: ['the shrine\'s left tile is green and its right tile red on the canvas', 'the tile just left of the footprint is red, and faint outlined tiles ring the footprint two deep', 'the Inspector\'s Hitbox section says "Blocks 2 tiles; its footprint is 2 by 1" and "Done choosing"', 'Save the fit is enabled, "not saved yet"'],
  },
  {
    name: 'art-studio-light',
    about: "The Light tool: the shrine's glow turned blue, 150 % bright, reaching 3.5 tiles and moved 40 px up, seen at night, not saved yet.",
    page: '/art-studio.html#art/canvas?asset=sanctum-shrine',
    ready: '.studio-canvas[data-lit="none"]',
    open: async (page) => {
      await page.waitForSelector('.light-panel input[name=light-color]');
      const type = async (name: string, value: string) => {
        await page.$eval(`.light-panel input[name=${name}]`, (el, v) => {
          (el as HTMLInputElement).value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
      };
      await type('light-color', '#66aaff');
      await type('light-strength', '150');
      await type('light-radius', '3.5');
      await type('light-y', '-40');
      await page.click('.canvas-light [data-hour="23"]');
      await page.waitForSelector('.studio-canvas[data-lit="23"]');
      await page.waitForFunction(() => document.querySelector('.light-panel .light-words')?.textContent?.includes('#66aaff'));
      await page.$eval('.light-panel', (el) => el.scrollIntoView({ block: 'start' }));
    },
    mustSee: ['a blue marker above the shrine with a soft blue pool of light around it on the night-lit ground', 'the Inspector\'s Light section with Colour, Brightness 150 %, Reach 3.5, x 0, y -40 and Flickers unticked', 'its words say "40 px up, #66aaff, at 150 %, reaching 3.5 tiles"', 'Save the fit is enabled, "not saved yet"'],
  },
  {
    name: 'art-studio-frames',
    about: 'The frame strip: Bramble Ursine\'s walk, one track per way, stopped on frame 4 of front left, with Create with AI in the Inspector.',
    page: '/art-studio.html#art/canvas?asset=bramble-ursine',
    ready: '.asset-list button',
    open: async (page) => {
      // The shot server ships no art manifest, so Bramble Ursine's shipped walk sheets (12 frames each) are added to what it says.
      await page.route('**/api/admin/art', async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        const strip = (d: string) => ({ url: `/art/bramble-ursine-walk-${d}.png`, frames: 12, width: 1656, height: 185, cycleSeconds: 1.5, versions: [] });
        for (const w of body.walkers ?? []) if (w.id === 'bramble-ursine') w.walks = Object.fromEntries(['front-left', 'front-right', 'back-left', 'back-right'].map((d) => [d, strip(d)]));
        await route.fulfill({ response: res, json: body });
      });
      await page.reload();
      await page.waitForSelector('.frames:not([hidden]) .frames-track button');
      await page.click('.frames-track [data-way="front-left"][data-frame="3"]');
      await page.waitForSelector('.frames [data-way="front-left"][data-frame="3"][aria-current="true"]');
      await page.evaluate(() => document.querySelector('.create-dock')?.scrollIntoView({ block: 'center' }));
    },
    mustSee: ['four tracks of walk frames along the bottom, front left frame 4 marked', 'the preview shows that frame and the button says Play', 'the Inspector has a Create with AI section with paint buttons and their costs'],
  },
  {
    name: 'art-studio-hands',
    about: 'Hands and gear: from Sylvan Cervid on the canvas, H opens its hand workbench on its Animate page.',
    page: '/art-studio.html#art/canvas?asset=sylvan-cervid',
    ready: '.asset-list button',
    open: async (page) => {
      await page.waitForSelector('#dock-right a[data-hands-to]');
      await page.keyboard.press('h');
      await page.waitForSelector('.hand-workbench[data-wb-walker="sylvan-cervid"]');
      await page.waitForTimeout(1200);
    },
    mustSee: ['the Animate workspace is open on Sylvan Cervid\'s page', 'the hand workbench is at the top of the page, with Walk/Run/Attack, the four ways, and Right Hand and Left Hand item choices', 'the Inspector shows a Hands and gear section with "Edit hands and try gear (H)"'],
  },
  {
    name: 'art-studio-spot-states',
    about: 'A gathering spot in the Studio: the strip shows its Ready, Picked and Growing pictures side by side (none painted on the shot server).',
    page: '/art-studio.html#art/canvas?asset=spot-sanctum-sage',
    ready: '.frames:not([hidden]) .spot-state',
    mustSee: ['the bottom strip says "States · Sage Bush" with three boxes, Ready, Picked and Growing', 'the Inspector shows the Sage Bush and Create with AI'],
  },
  {
    name: 'art-studio-centre',
    about: 'Auto-centre for a group: the Centre page offering to measure the set pieces shown.',
    page: '/art-studio.html#art/centre',
    ready: '.asset-list button',
    open: async (page) => {
      await page.click('.asset-chips [data-group="pieces"]');
      await page.waitForSelector('[data-centre-measure]');
    },
    mustSee: ['the Place workspace with Canvas, Centre a group and Buildings tabs, Centre a group marked', 'a button to measure the pieces shown, with their number'],
  },
  {
    name: 'art-studio-phone',
    about: 'The AI Art Studio on a phone: one pane at a time, chosen with tabs.',
    page: '/art-studio.html',
    ready: '#strip .strip-title',
    screen: 'phone',
    mustSee: ['the page fills the screen, no docks squeezed beside it', 'the Assets, Page and Inspector tabs are readable', 'nothing runs off the right edge'],
  },
  {
    name: 'testbed-terrace-rim',
    about: "The testbed's bookmark G2-B: the first terrace's rim, with its low parapet and cliff skirt.",
    region: 'arch-testbed',
    at: bookmark('G2-B'),
    hideUi: true,
    mustSee: ['an open terrace a floor up, its low parapet along the rim', 'the cliff skirt below the rim down to the ground'],
  },
  {
    name: 'testbed-outdoor-stairs',
    about: "The testbed's bookmark G6-A: outdoor stairs from the ground up onto a small terrace, the terrace reaching over the stairs' top.",
    region: 'arch-testbed',
    at: bookmark('G6-A'),
    hideUi: true,
    mustSee: ['stairs climbing north from the ground onto the terrace', 'the terrace floor meeting the top of the stairs with no gap'],
  },
  {
    name: 'testbed-terrace-stairs',
    about: "The testbed's bookmark G6-E: stairs from the first-floor terrace up to the second-floor terrace above it.",
    region: 'arch-testbed',
    at: bookmark('G6-E'),
    hideUi: true,
    mustSee: ['the stairs between the two terraces', 'both terraces drawn whole, nothing floating'],
  },
  {
    name: 'testbed-ramp',
    about: "The testbed's bookmark G6-F: a stone ramp 3 long rising north from the ground onto the terrace's south edge. Its picture is not painted yet, so it shows its label.",
    region: 'arch-testbed',
    at: bookmark('G6-F'),
    hideUi: true,
    mustSee: ['a "Ramp up to floor 1" label on the ground south of the terrace', 'a "Ramp down to the ground floor" label at the terrace\'s south edge', 'no ramp picture yet: it is painted in R3'],
  },
  {
    name: 'editor-testbed',
    about: 'The world editor open in the Architectural Testbed, beside the mini map.',
    region: 'arch-testbed',
    at: () => ({ x: 50, y: 52 }),
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
    },
    mustSee: [
      'edit mode: the game HUD, chat, stats and key bar are gone; a top bar (land, floor stepper, hour and weather, Tiles and Hitboxes, drafts, Done) runs across the top',
      'the editor panel on the right and the mini map at the bottom left, neither covering the other',
      'with nothing selected the panel shows the land: its name, tabs Changes, Places (25), Checks and Land, and the Changes tab with Drafts, Published and a folded Built in list',
      'a status strip along the bottom with Chat, Undo and Redo',
      'no red hitbox fill: hitboxes start off',
    ],
  },
  {
    name: 'editor-free-camera',
    about: 'The world editor with its camera moved away from the player and zoomed out one step, with the tile wireframe on around the middle of the screen.',
    region: 'arch-testbed',
    at: () => ({ x: 50, y: 52 }),
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.click('#editor input[name="tile-grid"]');
      await page.mouse.move(400, 400);
      await page.mouse.wheel(0, 200);
      // A right-drag pans (the keys pan too, but software drawing runs too few frames to show it here).
      await page.mouse.move(600, 450);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(400, 450, { steps: 8 });
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(1200);
    },
    mustSee: [
      'the world seen from further out than editor-testbed, panned east: the player stands well left of the middle',
      'the tile wireframe around the middle of the screen, not around the player',
      'the status strip says the zoom (75%) and offers Back to me and Bring me here',
      'the mini map centred on the camera rather than on the player',
    ],
  },
  {
    name: 'editor-finder',
    about: 'The world editor with the Life group chosen on the rail and the finder (Ctrl K) open with "sta" typed.',
    region: 'arch-testbed',
    at: () => ({ x: 50, y: 52 }),
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.click('#editor [data-group="life"]');
      await page.keyboard.press('Control+k');
      await page.keyboard.type('sta');
      await page.waitForTimeout(300);
    },
    mustSee: [
      'a rail of six groups down the left (Select, Ground, Build, Furnish, Life, Places), each with its key letter, Life standing out',
      'the options bar beside the rail with the Life tools (Person, Monsters, Gathering), Person chosen',
      'the finder in the middle near the top: Stairs first, then bookmarks to go to (Go to …), with Tool, Place or Do beside each',
      'the panel on the right no longer has a wall of tool buttons',
    ],
  },
  {
    name: 'editor-land-places',
    about: "The world editor's land panel on its Places tab, in the Architectural Testbed.",
    region: 'arch-testbed',
    at: () => ({ x: 50, y: 52 }),
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.click('#editor [data-land-tab="places"]');
    },
    mustSee: ['the Places tab chosen: a name box and "Bookmark this view (Ctrl D)", then the testbed\'s bookmarks each with Go', 'the list scrolls inside the panel, above the status strip'],
  },
  {
    name: 'editor-land-checks',
    about: "The world editor's land panel after Check again, in the Sanctum.",
    region: 'sanctum',
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.click('#editor [data-land-tab="checks"]');
      await page.click('#editor [data-check]');
      await page.waitForTimeout(500);
    },
    mustSee: ['the Checks tab chosen, with Shapes, Walks and Not painted yet, each saying all is well or listing what it found', 'when something is listed, the Checks tab shows a count and red squares mark those places in the world'],
  },
  {
    name: 'editor-asset-picker',
    about: "The world editor's asset picker, opened from the Person tool's \"Looks like\", with the pointer over a picture.",
    region: 'arch-testbed',
    at: () => ({ x: 50, y: 52 }),
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.click('#editor [data-group="life"]');
      await page.click('#editor [data-asset-field="look"]');
      await page.waitForSelector('.asset-picker:not([hidden]) [data-asset]');
      await page.hover('.asset-picker [data-asset]:nth-child(3)');
      await page.waitForTimeout(800);
    },
    mustSee: [
      'a picker over the editor: "Choose: Looks like", a search box, and filters All, Kept, Recent, In this land, Not painted yet',
      'a grid of character pictures, each with its name and a star to keep it; the chosen one outlined in green',
      'the hovered picture large on the right with its name and "Stands on 1 × 1 tile"',
    ],
  },
  {
    name: 'editor-ghost',
    about: 'The Person tool in the world editor with the pointer over open ground: a see-through ghost of who would stand there and the check result.',
    region: 'arch-testbed',
    at: () => ({ x: 50, y: 52 }),
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.click('#editor [data-group="life"]');
      await page.mouse.move(700, 520);
      await page.mouse.move(720, 540, { steps: 4 });
      await page.waitForTimeout(500);
    },
    mustSee: [
      'a see-through figure standing on the tile under the pointer, the size of the player, with a yellow outline on its tile',
      'the status strip starts with "✓ It fits here"',
      'the Person form shows "Looks like" as a picture button',
    ],
  },
  {
    name: 'editor-wall',
    about: 'The Wall tool in the world editor: an L of walls dragged as two lines, the second after R turned the side, with the pointer showing the next side to wall.',
    region: 'arch-testbed',
    at: () => ({ x: 50, y: 52 }),
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.click('#editor [data-tools~="wall"]');
      await page.click('#editor [data-tool="wall"]');
      await page.selectOption('#editor select[name="shape"]', 'line');
      // Tiles are 96 by 48 pixels on screen here: a line east along the north sides, then R and a line south along the east sides.
      const line = async (from: [number, number], to: [number, number]) => {
        await page.mouse.move(...from);
        await page.mouse.down();
        await page.mouse.move(...to, { steps: 6 });
        await page.mouse.up();
        // The editor takes no press while a change is saving: wait for the save (Undo comes back), so the next line is not lost.
        await page.waitForSelector('[data-undo]:not([disabled])', { timeout: 15_000 });
      };
      await line([400, 280], [592, 376]);
      await page.keyboard.press('r');
      await line([592, 376], [400, 472]);
      await page.mouse.move(328, 544);
      await page.waitForTimeout(1200);
    },
    mustSee: [
      'two upright walls meeting in an L, painted in grey castle stone, as tall as the player: one running to the lower right, one to the lower left from its end',
      'they stand on the lines between tiles, not filling whole tiles',
      'the Wall tool chosen in the options bar under Build; the panel shows Side (East), a Look picture button (Mossgate Castle), Height, Shape and "Take walls down instead"',
      'a thin yellow outline along one side of the tile under the pointer',
    ],
  },
  {
    name: 'editor-wall-hitboxes',
    about: 'The same L of walls as editor-wall, with Hitboxes switched on: each wall marked by a thin red band along its edge, not a whole tile.',
    region: 'arch-testbed',
    at: () => ({ x: 50, y: 52 }),
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.click('#editor [data-tools~="wall"]');
      await page.click('#editor [data-tool="wall"]');
      await page.selectOption('#editor select[name="shape"]', 'line');
      const line = async (from: [number, number], to: [number, number]) => {
        await page.mouse.move(...from);
        await page.mouse.down();
        await page.mouse.move(...to, { steps: 6 });
        await page.mouse.up();
        // The editor takes no press while a change is saving: wait for the save (Undo comes back), so the next line is not lost.
        await page.waitForSelector('[data-undo]:not([disabled])', { timeout: 15_000 });
      };
      await line([400, 280], [592, 376]);
      await page.keyboard.press('r');
      await line([592, 376], [400, 472]);
      await page.click('#editor input[name="hitboxes"]');
      await page.mouse.move(328, 544);
      await page.waitForTimeout(1200);
    },
    mustSee: [
      'thin red bands on the ground along the foot of both walls of the L, each as long as the wall and much thinner than a tile',
      'the buildings\' walls nearby filled red tile by tile as before',
    ],
  },
  {
    name: 'editor-wall-picked',
    about: 'Select picks one wall of the L from editor-wall (pointer near its side of the tile): the inspector names the wall and offers its look and height for this wall or its whole run.',
    region: 'arch-testbed',
    at: () => ({ x: 50, y: 52 }),
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.click('#editor [data-tools~="wall"]');
      await page.click('#editor [data-tool="wall"]');
      await page.selectOption('#editor select[name="shape"]', 'line');
      const line = async (from: [number, number], to: [number, number]) => {
        await page.mouse.move(...from);
        await page.mouse.down();
        await page.mouse.move(...to, { steps: 6 });
        await page.mouse.up();
        await page.waitForSelector('[data-undo]:not([disabled])', { timeout: 15_000 });
      };
      await line([400, 280], [592, 376]);
      await page.keyboard.press('r');
      await line([592, 376], [400, 472]);
      await page.click('#editor [data-group="select"]');
      // On the first wall's line, halfway along it.
      await page.mouse.click(496, 328);
      await page.waitForSelector('#editor details[data-section="wall-look"]');
      await page.mouse.move(328, 544);
      await page.waitForTimeout(600);
    },
    mustSee: [
      'one wall of the L outlined in green along its foot, not a whole tile',
      'the inspector: "Mossgate Castle wall" with "Wall" beside it, "A storey high, running east to west", "Stood with 4 more in one go", and Move, Copy and Take away',
      'a "Look and height" section open with a Look picture button, Height, and Change (This wall only)',
    ],
  },
  {
    name: 'editor-inspector',
    about: 'The world editor with the shop the player stands in selected: its inspector, with the Floors section unfolded.',
    region: 'sanctum',
    at: inside('sanctum-arcanum'),
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.mouse.click(640, 400);
      await page.click('#editor details[data-section="floors"] summary');
      await page.waitForTimeout(300);
    },
    mustSee: [
      'the shop outlined in green in the world',
      'the inspector: the building\'s name with "Building" beside it, its size, and Move (M), Copy (Ctrl C) and Take away (Del)',
      'sections "Look and size" (open, its look chosen) and "Floors above and below" (open, with Floors up, Floors down and Ladders, and a "Set the floors" button)',
    ],
  },
  {
    name: 'editor-monster',
    about: "The world editor after clicking a wandering walking mushroom: its home is picked, and the inspector links to the monster's size and loot in God's View.",
    region: 'woods',
    at: nearMonster('walking-mushroom', 3),
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      // Where a live walking mushroom is drawn on the screen (the game puts its scene on window for checks like this).
      const at = await page.evaluate(() => {
        const scene = (window as unknown as { scene: any }).scene;
        const cam = scene.cameras.main;
        const box = scene.game.canvas.getBoundingClientRect();
        const ratio = box.width / scene.scale.width;
        for (const [id, a] of scene.creatures) {
          if (!String(id).includes('walking-mushroom') || !a.body.visible) continue;
          const b = a.body.getBounds();
          return { x: box.left + (b.centerX - cam.worldView.x) * cam.zoom * ratio, y: box.top + (b.centerY - cam.worldView.y) * cam.zoom * ratio };
        }
        return undefined;
      });
      if (!at) throw new Error('No walking mushroom is in view.');
      await page.mouse.click(at.x, at.y);
      await page.waitForSelector('#editor .gods-view-link');
    },
    mustSee: [
      'the inspector says "Walking Mushroom’s home" with "Monster’s home" beside it, and its home outlined in the world (not where the mushroom was clicked)',
      'a "Size and loot in God\'s View ↗" link under its details, then Move, Copy and Take away',
      'the section "Level, ways and hours" open',
    ],
  },
  {
    name: 'gods-view-monster-link',
    about: "God's View opened from the editor's link for the bark golem: the Monsters tab scrolled to its card, size form open.",
    page: '/gods-view.html#loot/bark-golem',
    ready: 'section.loot.linked',
    mustSee: ['the Monsters tab chosen', 'the Bark Golem card at the top of the view, outlined in the accent colour, its "Change its size" form open with Tall chosen'],
  },
  {
    name: 'editor-kit-form',
    about: 'The world editor in edit mode with the Kit building tool chosen, so its settings and shape checks show in the panel.',
    region: 'arch-testbed',
    at: () => ({ x: 50, y: 52 }),
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.click('#editor [data-group="build"]');
      await page.click('#editor [data-tool="kit"]');
    },
    mustSee: ['the Kit building settings (Look, Bays across, Bays deep, Storeys) in the panel under the tools', 'the panel ends above the status strip and scrolls rather than running off the screen'],
  },
  {
    name: 'editor-drafts-menu',
    about: 'The world editor with the drafts menu open and hitboxes switched on.',
    region: 'arch-testbed',
    at: () => ({ x: 50, y: 52 }),
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.click('#editor input[name="hitboxes"]');
      await page.click('#editor .publish-menu summary');
    },
    mustSee: ['the drafts pill reads "No drafts" and its menu shows "Make my changes live at once"', 'red and orange hitbox fills on the walls near the player', 'the Hitboxes box ticked in the top bar'],
  },
  {
    name: 'editor-phone',
    about: 'The world editor opened on a phone-sized screen, which says it needs a bigger one.',
    region: 'arch-testbed',
    at: () => ({ x: 50, y: 52 }),
    screen: 'phone',
    open: async (page) => {
      // The HUD may push the button off a narrow screen; the shot is about what the editor shows.
      await page.evaluate(() => document.getElementById('edit-world-button')?.click());
      await page.waitForSelector('#editor:not([hidden])');
    },
    mustSee: ['a short note saying the world editor needs a bigger screen', 'a Done button to leave', 'no squeezed tool panel'],
  },
  {
    name: 'editor-tile-grid',
    about: 'The world editor open in the Architectural Testbed with its Tiles switch on: a thin wireframe around every tile near the player.',
    region: 'arch-testbed',
    at: () => ({ x: 50, y: 52 }),
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.click('#editor input[name="tile-grid"]');
    },
    mustSee: ['thin light lines along the tile edges around the player, lying flat on the ground in the diamond grid', 'the Tiles switch ticked beside Hitboxes in the editor title', 'the lines stop at the land\'s edge and do not cover the editor window'],
  },
  {
    name: 'editor-plan',
    about: "The world editor's Plan camera over the Sanctum, zoomed in twice, with the Build group chosen.",
    region: 'sanctum',
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.click('#editor [data-camera="plan"]');
      await page.waitForSelector('#editor .editor-plan canvas');
      await page.click('#editor [data-plan-zoom="in"]');
      await page.click('#editor [data-plan-zoom="in"]');
      await page.click('#editor [data-group="build"]');
    },
    mustSee: ['the Sanctum from above, coloured by tile, filling the space between the rail and the panel and scrolling inside it', 'World and Plan in the top bar with Plan chosen; the plan\'s own bar with the land menu, zoom at 225% and Tiles, Hitboxes, Spots, People & monsters', 'the Build tools (Kit building, House, Storey, Stairs) and Kit building\'s settings in the panel', 'no mini map, sky or game HUD showing through'],
  },
  {
    name: 'editor-plan-architect',
    about: "The world editor's Plan camera over the Sanctum with its Tiles layer on and the land panel's Architect tab.",
    region: 'sanctum',
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      await page.keyboard.press('Tab');
      await page.waitForSelector('#editor .editor-plan canvas');
      await page.click('#editor [data-plan-zoom="in"]');
      await page.click('#editor input[name="plan-layer"][value="grid"]');
      await page.click('#editor [data-land-tab="architect"]');
    },
    mustSee: ['a thin line around every tile of the plan, brighter every fifth tile', 'the Architect tab chosen: a box to say what to change and "Show the steps"', 'the Tiles box ticked in the plan\'s bar'],
  },
  {
    name: 'editor-keys',
    about: "The world editor's sheet of keys (?), over the Sanctum, with the panel dragged 100 pixels wider.",
    region: 'sanctum',
    open: async (page) => {
      await page.click('#edit-world-button');
      await page.waitForSelector('#editor:not([hidden])');
      const grip = (await page.locator('#editor .panel-grip').boundingBox())!;
      await page.mouse.move(grip.x + 4, grip.y + 200);
      await page.mouse.down();
      await page.mouse.move(grip.x - 96, grip.y + 200, { steps: 6 });
      await page.mouse.up();
      await page.keyboard.press('?');
      await page.waitForSelector('#editor .editor-keys:not([hidden])');
    },
    mustSee: ['a sheet of keys in the middle: Tools with each group\'s letter, Camera, What is picked and Editor', 'the panel on the right about 440 pixels wide, the options bar and world left of it', 'Keys ? in the status strip'],
  },
  {
    name: 'studio-map',
    about: "The Art Studio's Map editor tab: a link into the game's Plan camera.",
    page: '/art-studio.html#art/map-editor',
    ready: '[data-plan-link]',
    mustSee: ['a short card saying the map editor is in the game now', 'a button-like link "Open the Plan camera in the game"'],
  },
  {
    name: 'studio-models',
    about: "The Art Studio's AI Models tab: which provider and model paint pictures, clips and sounds.",
    page: '/art-studio.html#art/models',
    ready: '#studio-models-form',
    mustSee: ['an image provider list that offers Gemini and Replicate', 'a note that owner/name models paint on Replicate', 'the price table lists openai/gpt-image-2 at about $0.047 a picture'],
  },
];
