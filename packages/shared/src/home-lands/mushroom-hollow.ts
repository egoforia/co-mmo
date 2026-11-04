import type { CreatureDef, ItemDef, QuestDef } from '../rpg.ts';
import { levelledCreature } from '../lands.ts';
import { rand2, valueNoise } from '../random.ts';
import { WOODS_WEST_GATE, Tile, creatures, disc, road, scatter, type RegionMap } from '../world.ts';
import type { HomeLand } from './types.ts';
import { toolOffers } from '../crafts.ts';

// Mushroom Hollow, west of the Whispering Woods: the Cervid's home under the
// forest beyond the Woods (the gather and craft plan, step 1). Giant
// mushrooms stand thick on violet soil around still pools; Mother Morel keeps
// the clearing in the middle, and the Rootless King wanders a ring of its own
// to the west, cut off from the mycelium by the Hush.

/** Spore puffs, glowcap beetles and mycelid stalkers, with the Woods' walking mushrooms and lantern moths. */
const CREATURES: Record<string, CreatureDef> = {
  'spore-puff': levelledCreature({
    name: 'Spore Puff', art: 'hollow-spore-puff', description: 'A round puffball on two stubby legs that bursts into a cloud of spores and waddles off when anyone comes near.',
    behavior: 'timid', level: 3, speed: 2.6, notice: 3, drops: [{ item: 'spore-dust', chance: 0.7 }],
  }),
  'glowcap-beetle': levelledCreature({
    name: 'Glowcap Beetle', art: 'hollow-glowcap-beetle', description: 'A beetle as big as a dog with a glowing mushroom growing from its back. They swarm out together after dark.',
    behavior: 'pack', active: 'night', level: 4, speed: 3, notice: 4.5, drops: [{ item: 'glowcap-chitin', chance: 0.5 }, { item: 'tonic', chance: 0.1 }],
  }),
  mycelid: levelledCreature({
    name: 'Mycelid Stalker', art: 'hollow-mycelid', description: 'A tall thin figure of woven mushroom threads that walks the same rounds every day, listening to the ground.',
    behavior: 'patrol', level: 5, speed: 2.2, notice: 4, tough: 1.3, drops: [{ item: 'mushroom-fibre', chance: 0.7 }],
  }),
  'rootless-king': {
    ...levelledCreature({
      name: 'Rootless King', art: 'hollow-rootless-king', description: 'A giant walking mushroom with a crown of shelf fungus. The Hush cut it off from the mycelium, and it has gone mad with the silence.',
      behavior: 'guard', level: 8, speed: 1.8, notice: 4.5, tough: 3.5, drops: [{ item: 'kings-mycelium', chance: 0.9 }, { item: 'mushroom-fibre', qty: 3, chance: 0.6 }],
    }),
    // A boss: once beaten, it takes a long while to come back.
    respawnSeconds: 900,
  },
};

/**
 * What Mushroom Hollow's creatures leave. Their own icons are painted with
 * the material icons (plan step 6); until then each shows a picture like it.
 */
const ITEMS: Record<string, ItemDef> = {
  'spore-dust': { name: 'Spore Dust', kind: 'material', art: 'item-moth-dust', description: 'A pinch of fine violet dust that glimmers in the dark. It makes you sneeze, and it makes wishes stick.', value: 7, material: { family: 'wishstuff', homes: ['mushroom-hollow'], source: 'creature', tier: 1, traits: ['shimmering'] } },
  'glowcap-chitin': { name: 'Glowcap Chitin', kind: 'material', art: 'item-crab-shell', description: 'A plate of beetle shell with a faint glow still in it. Hard enough to hammer into armour.', value: 12, material: { family: 'plate', homes: ['mushroom-hollow'], source: 'creature', tier: 2, traits: ['sturdy'] } },
  'mushroom-fibre': { name: 'Mushroom Fibre', kind: 'material', art: 'item-ancient-linen', description: 'A hank of tough pale threads from a mycelid. Spun and woven, it makes a cloth that never rots.', value: 11, material: { family: 'fibre', homes: ['mushroom-hollow'], source: 'creature', tier: 1, traits: ['supple'] } },
  'kings-mycelium': { name: 'King\'s Mycelium', kind: 'material', art: 'item-heartwood', rarity: 'rare', description: 'A knot of living threads from the Rootless King\'s heart. It still reaches for the ground. Only a master could work it.', value: 60, material: { family: 'herb', homes: ['mushroom-hollow'], source: 'boss', tier: 3, traits: ['shimmering'] } },
};

const QUESTS: Record<string, QuestDef> = {
  'hollow-stalkers': {
    title: 'The Silent Stalkers',
    giver: 'mother-morel',
    offer: 'The mycelids used to carry news through the ground for us. Since the Hush came they only walk and listen, and they strike at anyone in their way. Rest five of them, and let the threads grow back.',
    waiting: 'The stalkers walk their rounds among the tall caps. Five of them.',
    thanks: 'I can hear the ground again, a little. Take these threads; you will find a use for them.',
    goal: { kind: 'defeat', creature: 'mycelid', count: 5 },
    reward: { xp: 160, gold: 60, items: [{ item: 'mushroom-fibre', qty: 3 }, { item: 'tonic', qty: 2 }] },
  },
};

/** How Mushroom Hollow is laid out: groves of giant mushrooms thick as a forest, with still pools between. */
function layout(map: RegionMap, c: number): void {
  scatter(map, (x, y) => {
    if (valueNoise(x, y, map.seed, 10) < 0.12) return Tile.Water;
    if (rand2(x, y, map.seed + 4) < 0.01) return Tile.Rock;
    if (valueNoise(x, y, map.seed + 2, 6) > 0.45 && rand2(x, y, map.seed + 1) < 0.6) return Tile.Tree;
    return Tile.Ground;
  });
  disc(map, c, c, 6, Tile.Ground);
  // The Rootless King's ring to the west, with a trail out to it.
  const ring = { x: 36, y: c + 10 };
  disc(map, ring.x, ring.y, 8, Tile.Ground);
  road(map, ring.x + 6, ring.y, c - 6, c);
  map.npcs.push({ id: 'mother-morel', name: 'Mother Morel', asset: 'hollow-mother-morel', x: c - 2.5, y: c + 3.5 });
  creatures(map, 'spore-puff', 'Spore Puff', 'hollow-spore-puff', 32);
  creatures(map, 'glowcap-beetle', 'Glowcap Beetle', 'hollow-glowcap-beetle', 24);
  creatures(map, 'mycelid', 'Mycelid Stalker', 'hollow-mycelid', 24);
  creatures(map, 'walking-mushroom', 'Walking Mushroom', 'woods-mushroom', 16);
  creatures(map, 'lantern-moth', 'Lantern Moth', 'sanctum-lantern-moth', 16);
  map.creatures.push({ kind: 'rootless-king', name: 'Rootless King', asset: 'hollow-rootless-king', x: ring.x + 0.5, y: ring.y + 0.5 });
  // The road east meets the Woods' west road, along Old Bramble's cottage lane.
  map.gates = { east: WOODS_WEST_GATE(c) };
  map.spawn = { x: c, y: c + 1 };
}

/** Mushroom Hollow: its creatures, finds, people, quest and layout. */
export const MUSHROOM_HOLLOW: HomeLand = {
  biome: 'mushroom-hollow',
  layout,
  creatures: CREATURES,
  items: ITEMS,
  people: {
    'mother-morel': {
      name: 'Mother Morel',
      greeting: 'Hush now, and listen. Can you hear the ground talking? No? It used to. Come, sit under my cap, and I will tell you what it said.',
      shop: { sells: [{ item: 'tonic', price: 10 }, ...toolOffers('woodcarving')], teaches: [], buys: true, masters: ['woodcarving'] },
    },
  },
  quests: QUESTS,
};
