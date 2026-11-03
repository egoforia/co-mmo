import type { CreatureDef, ItemDef, QuestDef } from '../rpg.ts';
import { levelledCreature } from '../lands.ts';
import { rand2, valueNoise } from '../random.ts';
import { SANCTUM_NORTH_GATE, Tile, creatures, disc, road, scatter, type RegionMap } from '../world.ts';
import type { HomeLand } from './types.ts';

// Frostpeak, north of the Sanctum: the Falcon's home on the cliffs (the
// gather and craft plan, step 1). Snow, frosted pines, frozen lakes and
// jagged rock; the Falcon elder Ysolde keeps the clearing in the middle, and
// the Hoarfrost Roc nests on the high ground to the north.

/** Snow hares, crag rams and ice wisps roam the snow; the Hoarfrost Roc keeps to its nest. */
const CREATURES: Record<string, CreatureDef> = {
  'snow-hare': levelledCreature({
    name: 'Snow Hare', art: 'frostpeak-snow-hare', description: 'A round white hare with ears as long as its body. It bolts across the drifts at the first footstep.',
    behavior: 'timid', level: 3, speed: 3.4, notice: 3.5, drops: [{ item: 'snow-hare-fur', chance: 0.7 }],
  }),
  'crag-ram': levelledCreature({
    name: 'Crag Ram', art: 'frostpeak-crag-ram', description: 'A shaggy mountain ram with curled stone-grey horns. It guards its patch of cliff and charges anyone who comes too near.',
    behavior: 'guard', level: 4, speed: 2.6, notice: 3.5, tough: 1.4, drops: [{ item: 'mountain-wool', chance: 0.7 }, { item: 'tonic', chance: 0.1 }],
  }),
  'ice-wisp': levelledCreature({
    name: 'Ice Wisp', art: 'frostpeak-ice-wisp', description: 'A drifting knot of cold blue light with a heart of ice. Ice wisps come out when the moon is up and freeze what they touch.',
    behavior: 'patrol', active: 'night', level: 5, speed: 2.4, notice: 4, drops: [{ item: 'ice-crystal', chance: 0.6 }],
  }),
  'hoarfrost-roc': {
    ...levelledCreature({
      name: 'Hoarfrost Roc', art: 'frostpeak-hoarfrost-roc', description: 'A great white bird with frost in its feathers. It was once the Falcon\'s guardian, and it has forgotten.',
      behavior: 'guard', level: 8, speed: 2.8, notice: 5, tough: 3.5, drops: [{ item: 'roc-plume', chance: 0.9 }, { item: 'mountain-wool', qty: 3, chance: 0.6 }],
    }),
    // A boss: once beaten, it takes a long while to come back.
    respawnSeconds: 900,
  },
};

/**
 * What Frostpeak's creatures leave. Their own icons are painted with the
 * material icons (plan step 6); until then each shows a picture like it.
 */
const ITEMS: Record<string, ItemDef> = {
  'snow-hare-fur': { name: 'Snow Hare Fur', kind: 'material', art: 'item-wolf-pelt', description: 'A soft white pelt, warmer than it looks. Tailors and leatherworkers both want it.', value: 9 },
  'mountain-wool': { name: 'Mountain Wool', kind: 'material', art: 'item-ancient-linen', description: 'A thick grey fleece from a crag ram, still smelling of snow. It spins into the warmest yarn there is.', value: 11 },
  'ice-crystal': { name: 'Ice Crystal', kind: 'material', art: 'item-pearl', description: 'A shard of ice from an ice wisp\'s heart. It never melts, and it is always cold to hold.', value: 16 },
  'roc-plume': { name: 'Roc Plume', kind: 'material', art: 'item-gull-feather', rarity: 'rare', description: 'A long white plume from the Hoarfrost Roc, rimed with frost that never thaws. Only a master could work it.', value: 60 },
};

const QUESTS: Record<string, QuestDef> = {
  'frostpeak-wisps': {
    title: 'Lights on the Cliffs',
    giver: 'ysolde',
    offer: 'The ice wisps grow bolder every night. They freeze our nests and drive the hares off the high ledges. Put out five of them, and the cliffs will sleep easier.',
    waiting: 'The wisps only come out after dark. Five of them.',
    thanks: 'The nests are quiet tonight. Take this wool for your trouble; you will want it before the winter is out.',
    goal: { kind: 'defeat', creature: 'ice-wisp', count: 5 },
    reward: { xp: 160, gold: 60, items: [{ item: 'mountain-wool', qty: 3 }, { item: 'tonic', qty: 2 }] },
  },
};

/** How Frostpeak is laid out: snowfields broken by rock ridges, pine groves and frozen lakes. */
function layout(map: RegionMap, c: number): void {
  scatter(map, (x, y) => {
    if (valueNoise(x, y, map.seed, 11) < 0.15) return Tile.Water;
    // Jagged ridges of rock, and a few loose boulders.
    if (valueNoise(x, y, map.seed + 4, 9) > 0.74 || rand2(x, y, map.seed + 5) < 0.012) return Tile.Rock;
    // Frosted pines grow in groves, thinning out between them.
    if (rand2(x, y, map.seed + 1) < 0.1 * (0.3 + valueNoise(x, y, map.seed + 2, 7) * 1.4)) return Tile.Tree;
    return Tile.Ground;
  });
  disc(map, c, c, 6, Tile.Ground);
  // The Roc's nest on the high ground to the north, with a trail up to it.
  const nest = { x: c + 6, y: 34 };
  disc(map, nest.x, nest.y, 7, Tile.Ground);
  road(map, c, c - 6, nest.x, nest.y + 5);
  map.npcs.push({ id: 'ysolde', name: 'Ysolde', asset: 'frostpeak-ysolde', x: c - 2.5, y: c + 3.5 });
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
      shop: { sells: [{ item: 'tonic', price: 11 }], teaches: [], buys: true },
    },
  },
  quests: QUESTS,
};
