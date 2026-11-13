// The shot list: fixed places, hours, weather and screens that agents
// photograph before and after a change to what the game draws, so two runs
// can be laid side by side. Add a shot when a feature draws something none of
// these show; keep names stable, because comparisons pair shots by name.
// docs/screenshots.md explains the process; `/shots` runs it.

import type { Page } from 'playwright';
import type { RegionMap, Weather } from '@co-mmo/shared';

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
    name: 'sanctum-bag',
    about: 'The bag open over the game.',
    region: 'sanctum',
    open: async (page) => {
      await page.keyboard.press('i');
      await page.waitForSelector('#inventory:not([hidden])');
    },
    mustSee: ['the bag window is whole on screen, its slots and words readable'],
  },
  {
    name: 'sanctum-phone',
    about: 'The game on a phone-sized screen.',
    region: 'sanctum',
    screen: 'phone',
    mustSee: ['the player is on screen', 'HUD parts do not overlap each other or run off the edge'],
  },
  {
    name: 'gods-view',
    about: "God's View as the Owner first sees it.",
    page: '/gods-view.html',
    ready: 'nav [data-tab]',
    mustSee: ['tabs along the top, the first tab filled in', 'no error text'],
  },
  {
    name: 'art-studio',
    about: 'The AI Art Studio, where the Owner reviews and paints pictures.',
    page: '/art-studio.html',
    mustSee: ['pictures load (no broken image icons)', 'buttons and labels are readable'],
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
      'the tool buttons (Select, Take away and Bookmark among them) and the edit list are readable in the panel',
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
      'the options bar beside the rail with the Life tools (Person, Quest, Monsters, Change monsters, Patrol path, Clear, Gathering), Person chosen',
      'the finder in the middle near the top: Stairs first, then bookmarks to go to (Go to …), with Tool, Place or Do beside each',
      'the panel on the right no longer has a wall of tool buttons',
    ],
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
    name: 'studio-map',
    about: "The Art Studio's map of the Sanctum, zoomed in twice, with the Floors tool chosen.",
    page: '/art-studio.html#art/map-editor',
    ready: '#studio-map-canvas',
    open: async (page) => {
      await page.click('.studio-map [data-map-zoom="in"]');
      await page.click('.studio-map [data-map-zoom="in"]');
      await page.click('.studio-map [data-group="build"]');
      await page.click('.studio-map [data-tool="floors"]');
    },
    mustSee: ['the map fills its box and scrolls, tiles bigger than zoomed out', 'zoom buttons, floors from 3 down to 4 up, and the Floors tool settings (up, down, ladders)', 'the edit list beside the map'],
  },
  {
    name: 'studio-map-tiles',
    about: "The Art Studio's map of the Sanctum, zoomed in twice, with the Tiles layer on.",
    page: '/art-studio.html#art/map-editor',
    ready: '#studio-map-canvas',
    open: async (page) => {
      await page.click('.studio-map [data-map-zoom="in"]');
      await page.click('.studio-map [data-map-zoom="in"]');
      await page.click('.studio-map [data-map-layer="showGrid"]');
    },
    mustSee: ['a thin line around every tile, brighter every fifth tile', 'the Tiles box ticked beside Hitboxes'],
  },
];
