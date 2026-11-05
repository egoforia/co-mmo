import type { CreatureDef, ItemDef, QuestDef } from '../rpg.ts';
import { levelledCreature } from '../lands.ts';
import { rand2, valueNoise } from '../random.ts';
import { CATHEDRAL_SIZE, SANCTUM_NORTH_GATE, Tile, building, creatures, disc, road, scatter, type RegionMap } from '../world.ts';
import { addStairs, addStorey } from '../floors.ts';
import type { HomeLand } from './types.ts';
import { toolOffers } from '../crafts.ts';

// Frostpeak, north of the Sanctum: the Falcon's home on the cliffs (the
// gather and craft plan, step 1). Snow, frosted pines, frozen lakes and
// jagged rock. On the west rises Mount Zephyr, crowned by the marble town
// of Whiteledge, the soaring 8-storey Eyrie of the First Watch, and the
// deep 4-storey Sunken Drafts. Elder Ysolde keeps the glade in the middle,
// and the Hoarfrost Roc nests on the high ground to the north.

/** Snow hares, crag rams and ice wisps roam the snow; rime stalkers and matriarchs haunt the deep drafts; the Roc nests north. */
const CREATURES: Record<string, CreatureDef> = {
  'snow-hare': levelledCreature({
    name: 'Snow Hare', art: 'frostpeak-snow-hare', size: 'small', description: 'A round white hare with ears as long as its body. It bolts across the drifts at the first footstep.',
    behavior: 'timid', level: 3, speed: 3.4, notice: 3.5, drops: [{ item: 'snow-hare-fur', chance: 0.7 }],
  }),
  'crag-ram': levelledCreature({
    name: 'Crag Ram', art: 'frostpeak-crag-ram', description: 'A shaggy mountain ram with curled stone-grey horns. It guards its patch of cliff and charges anyone who comes too near.',
    behavior: 'guard', level: 4, speed: 2.6, notice: 3.5, tough: 1.4, drops: [{ item: 'mountain-wool', chance: 0.7 }, { item: 'tonic', chance: 0.1 }],
  }),
  'ice-wisp': levelledCreature({
    name: 'Ice Wisp', art: 'frostpeak-ice-wisp', size: 'small', description: 'A drifting knot of cold blue light with a heart of ice. Ice wisps come out when the moon is up and freeze what they touch.',
    behavior: 'patrol', active: 'night', level: 5, speed: 2.4, notice: 4, drops: [{ item: 'ice-crystal', chance: 0.6 }],
  }),
  'rime-stalker': levelledCreature({
    name: 'Rime Stalker', art: 'frostpeak-rime-stalker', size: 'medium', description: 'A sleek frost-predator with razor ice claws that prowls the Sunken Drafts.',
    behavior: 'patrol', level: 6, speed: 3.2, notice: 4.5, tough: 1.6, drops: [{ item: 'ice-crystal', chance: 0.8 }, { item: 'silver-ore', chance: 0.5 }],
  }),
  'deep-matriarch': levelledCreature({
    name: 'Deep Crag Matriarch', art: 'frostpeak-deep-matriarch', size: 'high', description: 'An ancient subterranean ram with silver horns that guards the silent crypts.',
    behavior: 'guard', level: 7, speed: 2.2, notice: 3.5, tough: 2.5, drops: [{ item: 'mountain-wool', qty: 2, chance: 0.9 }, { item: 'silver-ore', qty: 2, chance: 0.7 }],
  }),
  'hoarfrost-roc': {
    ...levelledCreature({
      name: 'Hoarfrost Roc', art: 'frostpeak-hoarfrost-roc', size: 'colossal', description: 'A great white bird with frost in its feathers. It was once the Falcon\'s guardian, and it has forgotten.',
      behavior: 'guard', level: 8, speed: 2.8, notice: 5, tough: 3.5, drops: [{ item: 'roc-plume', chance: 0.9 }, { item: 'mountain-wool', qty: 3, chance: 0.6 }],
    }),
    // A boss: once beaten, it takes a long while to come back.
    respawnSeconds: 900,
  },
};

/**
 * What Frostpeak's creatures leave. Each shows a picture like it until its
 * own icon is painted (material-icon-anchors.ts).
 */
const ITEMS: Record<string, ItemDef> = {
  'snow-hare-fur': { name: 'Snow Hare Fur', kind: 'material', art: 'item-snow-hare-fur', standIn: 'item-wolf-pelt', description: 'A soft white pelt, warmer than it looks. Tailors and leatherworkers both want it.', value: 9, material: { family: 'hide', homes: ['frostpeak'], source: 'creature', tier: 1, traits: ['warm'] } },
  'mountain-wool': { name: 'Mountain Wool', kind: 'material', art: 'item-mountain-wool', standIn: 'item-ancient-linen', description: 'A thick grey fleece from a crag ram, still smelling of snow. It spins into the warmest yarn there is.', value: 11, material: { family: 'fibre', homes: ['frostpeak'], source: 'creature', tier: 1, traits: ['warm'] } },
  'ice-crystal': { name: 'Ice Crystal', kind: 'material', art: 'item-ice-crystal', standIn: 'item-pearl', description: 'A shard of ice from an ice wisp\'s heart. It never melts, and it is always cold to hold.', value: 16, material: { family: 'gem', homes: ['frostpeak'], source: 'creature', tier: 2, traits: ['warding'] } },
  'roc-plume': { name: 'Roc Plume', kind: 'material', art: 'item-roc-plume', standIn: 'item-gull-feather', rarity: 'rare', description: 'A long white plume from the Hoarfrost Roc, rimed with frost that never thaws. Only a master could work it.', value: 60, material: { family: 'feather', homes: ['frostpeak'], source: 'boss', tier: 3, traits: ['light'] } },
  'guardian-harness': { name: "Guardian's Silver Harness", kind: 'equipment', slot: 'offhand', offhand: 'tome', rarity: 'rare', art: 'item-guardian-harness', standIn: 'item-scarab-charm', bonus: { armor: 2, spirit: 3 }, description: 'An ancient silver harness once worn by the Hoarfrost Roc, recovered from the Sunken Drafts.', value: 80 },
  'zephyr-mantle': { name: 'Zephyr Plume Mantle', kind: 'equipment', slot: 'cloak', rarity: 'rare', art: 'item-zephyr-mantle', standIn: 'item-pelt-cloak', bonus: { armor: 3, agility: 2, spirit: 2 }, description: 'A ceremonial Falcon mantle woven from mountain wool, snow hare down, and ancient silver thread. It keeps the coldest winds away.', value: 120 },
};

const QUESTS: Record<string, QuestDef> = {
  'frostpeak-wisps': {
    title: 'Lights on the Cliffs',
    giver: 'ysolde',
    offer: 'The ice wisps grow bolder every night. They freeze our nests and drive the hares off the high ledges. Put out five of them, and the cliffs will sleep easier.',
    waiting: 'The wisps only come out after dark. Five of them.',
    thanks: 'The nests are quiet tonight. Take this wool for your trouble. But mark my words: these wisps do not fall from the sky; they well up from the Sunken Drafts beneath Mount Zephyr to the west. Speak with Kip by the western mountain descent.',
    goal: { kind: 'defeat', creature: 'ice-wisp', count: 5 },
    reward: { xp: 160, gold: 60, items: [{ item: 'mountain-wool', qty: 3 }, { item: 'tonic', qty: 2 }] },
  },
  'frostpeak-sunken-drafts': {
    title: 'Into the Sunken Drafts',
    giver: 'kip',
    requires: 'frostpeak-wisps',
    offer: 'Ysolde sent you? Then you know the drafts are howling! Four floors down beneath Mount Zephyr, cold things crawl out of the forgotten dark. Plunge into the Whispering Tunnels on Floor -2 and fell three rime stalkers. If you find any relic of the First Watch down there, bring it back!',
    waiting: 'The tunnels on Floor -2 are cold enough to crack bone. Three rime stalkers!',
    thanks: 'You made it back! And look at this harness—engraved with the First Watch crest. Take it up to Sula on the Loom-Terraces (Floor +2 of the Eyrie); she has waited years to see such silverwork.',
    goal: { kind: 'defeat', creature: 'rime-stalker', count: 3 },
    reward: { xp: 240, gold: 90, items: [{ item: 'guardian-harness', qty: 1 }, { item: 'ice-crystal', qty: 2 }] },
  },
  'frostpeak-feather-mantle': {
    title: 'A Thread to Remember',
    giver: 'sula',
    requires: 'frostpeak-sunken-drafts',
    offer: 'Kip found the Guardian Harness? The silver thread still glints under the snow! Bring me three skeins of Mountain Wool and two Snow Hare pelts, and I will restore the ceremonial Zephyr Plume Mantle.',
    waiting: 'Three mountain wools and two snow hare furs. The loom is warm and waiting.',
    thanks: 'Feel the weave: warm as a hearth, light as a feather. Wear it with pride. Take it to Watcher Vail on Floor +8; he has kept vigil for the Roc since he was a fledgling.',
    goal: { kind: 'gather', items: [{ item: 'mountain-wool', qty: 3 }, { item: 'snow-hare-fur', qty: 2 }] },
    reward: { xp: 300, gold: 120, items: [{ item: 'zephyr-mantle', qty: 1 }] },
  },
  'frostpeak-roc-vigil': {
    title: 'The Crown Without a King',
    giver: 'vail',
    requires: 'frostpeak-feather-mantle',
    offer: 'The Zephyr Mantle... that scent of frost-pine and ancient silver! The Hoarfrost Roc circles her northern crag, trapped in the Hush and blind to her heritage. Seek her out on the high northern ledge and break the rime that grips her heart!',
    waiting: 'The Roc nests on the high northern crag. Face her not in anger, but to wake her.',
    thanks: 'Did you hear that cry across the ridges? The rage is gone from her screech. She may not return to the high dais today, but she remembers us. The First Watch endures!',
    goal: { kind: 'defeat', creature: 'hoarfrost-roc', count: 1 },
    reward: { xp: 520, gold: 260, items: [{ item: 'roc-plume', qty: 2 }] },
  },
};

/** How Frostpeak is laid out: snowfields broken by rock ridges, pine groves, frozen lakes, and Mount Zephyr on the west. */
function layout(map: RegionMap, c: number): void {
  scatter(map, (x, y) => {
    if (valueNoise(x, y, map.seed, 11) < 0.15) return Tile.Water;
    // Jagged ridges of rock, and a few loose boulders.
    if (valueNoise(x, y, map.seed + 4, 9) > 0.74 || rand2(x, y, map.seed + 5) < 0.012) return Tile.Rock;
    // Frosted pines grow in groves, thinning out between them.
    if (rand2(x, y, map.seed + 1) < 0.1 * (0.3 + valueNoise(x, y, map.seed + 2, 7) * 1.4)) return Tile.Tree;
    return Tile.Ground;
  });

  // Ysolde's central clearing in the middle of the land.
  disc(map, c, c, 6, Tile.Ground);

  // The Roc's nest on the high ground to the north, with a trail up to it.
  const nest = { x: c + 6, y: 34 };
  disc(map, nest.x, nest.y, 7, Tile.Ground);
  road(map, c, c - 6, nest.x, nest.y + 5);
  map.npcs.push({ id: 'ysolde', name: 'Ysolde', asset: 'frostpeak-ysolde', x: c - 2.5, y: c + 3.5 });

  // -------------------------------------------------------------
  // Mount Zephyr & Whiteledge on the West
  // -------------------------------------------------------------
  const town = { x: c - 50, y: c - 10 };
  disc(map, town.x, town.y, 14, Tile.Ground);
  road(map, c, c, town.x, town.y);

  // Whiteledge Masonry: Talon-Mason Kaen's stone workshop.
  // Using 10x6 so it aligns with two-tile bays for kit houses.
  const masonShop = building(map, town.x - 5, town.y + 6, 10, 6, 'sanctum-cathedral');
  map.buildings.push(masonShop);
  road(map, town.x, town.y, masonShop.door.x, masonShop.door.y + 1);
  map.npcs.push({ id: 'kaen', name: 'Talon-Mason Kaen', asset: 'frostpeak-kaen', x: town.x + 0.5, y: town.y - 0.5 });

  // The Eyrie of the First Watch: 8 Storeys High, 4 Storeys Underground.
  // Using CATHEDRAL_SIZE (18x12) so it passes all bay alignment checks.
  const eyrieLeft = town.x - 9;
  const eyrieTop = town.y - 28;
  disc(map, eyrieLeft + 9, eyrieTop + 6, 18, Tile.Ground);

  const eyrie = building(map, eyrieLeft, eyrieTop, CATHEDRAL_SIZE.width, CATHEDRAL_SIZE.height, 'sanctum-cathedral');
  map.buildings.push(eyrie);
  road(map, town.x, town.y, eyrie.door.x, eyrie.door.y + 1);

  // Above Ground (+1 to +8):
  addStorey(map, eyrie, 1, eyrie.style);
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 3, y: eyrieTop + 3, width: 2, height: 1, from: 0, names: { lower: 'Marble Hall', upper: 'Grand Portico' } });

  addStorey(map, { x: eyrieLeft + 1, y: eyrieTop + 1, width: 18, height: 12 }, 2, eyrie.style);
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 15, y: eyrieTop + 3, width: 2, height: 1, from: 1, names: { lower: 'Grand Portico', upper: 'Loom-Terraces' } });

  addStorey(map, { x: eyrieLeft + 2, y: eyrieTop + 2, width: 16, height: 10 }, 3, eyrie.style);
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 4, y: eyrieTop + 6, width: 2, height: 1, from: 2, names: { lower: 'Loom-Terraces', upper: 'Wind-Scriptorium' } });

  addStorey(map, { x: eyrieLeft + 3, y: eyrieTop + 3, width: 14, height: 8 }, 4, eyrie.style, undefined, true);
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 13, y: eyrieTop + 6, width: 2, height: 1, from: 3, names: { lower: 'Wind-Scriptorium', upper: 'Steaming Marble Baths' } });

  addStorey(map, { x: eyrieLeft + 4, y: eyrieTop + 3, width: 12, height: 8 }, 5, eyrie.style, undefined, true);
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 5, y: eyrieTop + 5, width: 2, height: 1, from: 4, names: { lower: 'Steaming Marble Baths', upper: "Master Falconer's Roost" } });

  addStorey(map, { x: eyrieLeft + 5, y: eyrieTop + 4, width: 10, height: 6 }, 6, eyrie.style);
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 12, y: eyrieTop + 5, width: 2, height: 1, from: 5, names: { lower: "Master Falconer's Roost", upper: 'High Council Chamber' } });

  addStorey(map, { x: eyrieLeft + 6, y: eyrieTop + 4, width: 8, height: 6 }, 7, eyrie.style, undefined, true);
  addStairs(map, { kind: 'ladder', x: eyrieLeft + 8, y: eyrieTop + 6, width: 1, height: 1, from: 6, names: { lower: 'High Council Chamber', upper: 'Belfry of Zephyrs' } });

  addStorey(map, { x: eyrieLeft + 6, y: eyrieTop + 4, width: 8, height: 6 }, 8, eyrie.style, undefined, true);
  addStairs(map, { kind: 'ladder', x: eyrieLeft + 11, y: eyrieTop + 6, width: 1, height: 1, from: 7, names: { lower: 'Belfry of Zephyrs', upper: 'The Crown of the Wind' } });

  // Subterranean Depths (-1 to -4): The Sunken Drafts
  addStorey(map, { x: eyrieLeft - 4, y: eyrieTop - 2, width: 28, height: 18 }, -1, eyrie.style);
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 14, y: eyrieTop + 9, width: 2, height: 1, from: -1, names: { lower: 'Upper Silver Veins', upper: 'Marble Hall' } });

  addStorey(map, { x: eyrieLeft - 5, y: eyrieTop - 3, width: 30, height: 20 }, -2, eyrie.style);
  addStairs(map, { kind: 'stairs', x: eyrieLeft - 1, y: eyrieTop + 4, width: 2, height: 1, from: -2, names: { lower: 'Whispering Tunnels', upper: 'Upper Silver Veins' } });

  addStorey(map, { x: eyrieLeft - 4, y: eyrieTop - 2, width: 28, height: 18 }, -3, eyrie.style);
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 10, y: eyrieTop + 10, width: 2, height: 1, from: -3, names: { lower: 'Crypt of the First Watchers', upper: 'Whispering Tunnels' } });

  addStorey(map, { x: eyrieLeft - 3, y: eyrieTop - 1, width: 26, height: 16 }, -4, eyrie.style);
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 2, y: eyrieTop + 2, width: 2, height: 1, from: -4, names: { lower: 'The Hoarfrost Well', upper: 'Crypt of the First Watchers' } });

  // Eyrie NPCs (placed inside the open floor footprint of their levels)
  map.npcs.push({ id: 'kip', name: 'Kip the Spelunker', asset: 'frostpeak-kip', x: eyrieLeft + 10.5, y: eyrieTop + 7.5, floor: -1 });
  map.npcs.push({ id: 'sula', name: 'Sula the Feather-Weaver', asset: 'frostpeak-sula', x: eyrieLeft + 8.5, y: eyrieTop + 6.5, floor: 2 });
  map.npcs.push({ id: 'aurius', name: 'Elder Aurius the Keen', asset: 'frostpeak-aurius', x: eyrieLeft + 8.5, y: eyrieTop + 6.5, floor: 6 });
  map.npcs.push({ id: 'vail', name: 'Watcher Vail', asset: 'frostpeak-vail', x: eyrieLeft + 9.5, y: eyrieTop + 5.5, floor: 8 });

  // Subterranean Monsters (placed inside the cleared open footprint)
  for (let i = 0; i < 4; i++) map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: eyrieLeft + 2 + i * 3, y: eyrieTop + 3, floor: -1 });
  for (let i = 0; i < 4; i++) map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: eyrieLeft + 2 + i * 3, y: eyrieTop + 4, floor: -2 });
  for (let i = 0; i < 3; i++) map.creatures.push({ kind: 'rime-stalker', name: 'Rime Stalker', asset: 'frostpeak-rime-stalker', x: eyrieLeft + 3 + i * 4, y: eyrieTop + 7, floor: -2 });
  for (let i = 0; i < 3; i++) map.creatures.push({ kind: 'deep-matriarch', name: 'Deep Crag Matriarch', asset: 'frostpeak-deep-matriarch', x: eyrieLeft + 3 + i * 4, y: eyrieTop + 3, floor: -3 });
  for (let i = 0; i < 3; i++) map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: eyrieLeft + 4 + i * 3, y: eyrieTop + 8, floor: -3 });
  for (let i = 0; i < 4; i++) map.creatures.push({ kind: 'rime-stalker', name: 'Rime Stalker', asset: 'frostpeak-rime-stalker', x: eyrieLeft + 2 + i * 3, y: eyrieTop + 5, floor: -4 });
  for (let i = 0; i < 3; i++) map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: eyrieLeft + 3 + i * 3, y: eyrieTop + 7, floor: -4 });

  // Surface creatures
  creatures(map, 'snow-hare', 'Snow Hare', 'frostpeak-snow-hare', 32);
  creatures(map, 'crag-ram', 'Crag Ram', 'frostpeak-crag-ram', 24);
  creatures(map, 'ice-wisp', 'Ice Wisp', 'frostpeak-ice-wisp', 24);
  map.creatures.push({ kind: 'hoarfrost-roc', name: 'Hoarfrost Roc', asset: 'frostpeak-hoarfrost-roc', x: nest.x + 0.5, y: nest.y + 0.5 });

  // The road south meets the Sanctum's north road, east of its Scriptorium.
  map.gates = { south: SANCTUM_NORTH_GATE(c) };
  map.spawn = { x: c, y: c + 1 };
}

/** Frostpeak: its creatures, finds, people, quest and layout. */
export const FROSTPEAK: HomeLand = {
  biome: 'frostpeak',
  layout,
  creatures: CREATURES,
  items: ITEMS,
  people: {
    ysolde: {
      name: 'Ysolde',
      greeting: 'You climbed all this way? Then you have the legs of a Falcon, whatever your feathers. Sit by the fire, and mind the edge.',
      shop: { sells: [{ item: 'tonic', price: 11 }, ...toolOffers('leatherwork')], teaches: [], buys: true, masters: ['leatherwork'] },
    },
    kaen: {
      name: 'Talon-Mason Kaen',
      greeting: 'Mind the marble dust, traveler. On Mount Zephyr we do not build with clay; we release what the stone was already dreaming.',
      shop: { sells: [{ item: 'tonic', price: 11 }, ...toolOffers('smithing')], teaches: [], buys: true, masters: ['smithing'] },
    },
    kip: {
      name: 'Kip the Spelunker',
      greeting: 'Keep your footing! The wind pulls up from the depths like a living breath. Four floors down, there is a whole forgotten world waiting.',
      shop: { sells: [{ item: 'tonic', price: 11 }, ...toolOffers('smithing')], teaches: [], buys: true },
    },
    sula: {
      name: 'Sula the Feather-Weaver',
      greeting: 'Welcome to the Loom-Terraces. The high wind sings through the warp, and mountain wool remembers the snow.',
      shop: { sells: [{ item: 'tonic', price: 11 }, ...toolOffers('tailoring'), ...toolOffers('fletching')], teaches: [], buys: true, masters: ['tailoring', 'fletching'] },
    },
    aurius: {
      name: 'Elder Aurius the Keen',
      greeting: 'From this eyrie, the First Watch surveyed every road in the age of the Listener. We watch still, though the roads are slow to remember.',
    },
    vail: {
      name: 'Watcher Vail',
      greeting: 'The Crown of the Wind is cold, but my eyes do not close. The Roc will return when the world learns to wish again.',
    },
  },
  quests: QUESTS,
};
