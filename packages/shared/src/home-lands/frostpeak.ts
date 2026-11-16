import type { CreatureDef, ItemDef, QuestDef } from '../rpg.ts';
import { levelledCreature } from '../lands.ts';
import { rand2, valueNoise } from '../random.ts';
import { CATHEDRAL_SIZE, SANCTUM_NORTH_GATE, Tile, building, creatures, disc, placer, road, scatter, type RegionMap } from '../world.ts';
import { addStairs, addStorey, setOn } from '../floors.ts';
import type { HomeLand } from './types.ts';
import { toolOffers } from '../crafts.ts';
import { furnitureArt } from '../buildings.ts';

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
    name: 'Crag Ram', art: 'frostpeak-crag-ram', size: 'medium', description: 'A shaggy mountain ram with curled stone-grey horns. It guards its patch of cliff and charges anyone who comes too near.',
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

/** How Frostpeak is laid out: Mount Zephyr on the western third, and snowfields broken by rock ridges, pine groves, and frozen lakes to the east. */
function layout(map: RegionMap, c: number): void {
  // Helpers to connect abutting storeys with an open 2-tile doorway through their perimeter walls
  const connectVertical = (map: RegionMap, floor: number, topStorey: { x: number; y: number; width: number; height: number; open?: boolean }, bottomStorey: { x: number; y: number; width: number; height: number; open?: boolean }, cx: number) => {
    const y1 = topStorey.y + topStorey.height - 1;
    const y2 = bottomStorey.y;
    const fullOpen = Boolean(topStorey.open && bottomStorey.open && topStorey.x === bottomStorey.x && topStorey.width === bottomStorey.width);
    const startX = fullOpen ? topStorey.x + 1 : Math.max(topStorey.x + 1, bottomStorey.x + 1, cx - 1);
    const endX = fullOpen ? topStorey.x + topStorey.width - 2 : Math.min(topStorey.x + topStorey.width - 2, bottomStorey.x + bottomStorey.width - 2, cx + 2);
    for (let x = startX; x <= endX; x++) {
      setOn(map, floor, x, y1, Tile.Floor);
      setOn(map, floor, x, y2, Tile.Floor);
    }
  };

  const connectHorizontal = (map: RegionMap, floor: number, leftStorey: { x: number; y: number; width: number; height: number }, rightStorey: { x: number; y: number; width: number; height: number }, cy: number) => {
    const x1 = leftStorey.x + leftStorey.width - 1;
    const x2 = rightStorey.x;
    const startY = Math.max(leftStorey.y + 1, rightStorey.y + 1, cy - 1);
    const endY = Math.min(leftStorey.y + leftStorey.height - 2, rightStorey.y + rightStorey.height - 2, cy + 2);
    for (let y = startY; y <= endY; y++) {
      setOn(map, floor, x1, y, Tile.Floor);
      setOn(map, floor, x2, y, Tile.Floor);
    }
  };

  scatter(map, (x, y) => {
    // Mount Zephyr occupies the western 34% of the region (x <= 88, 22,528 tiles)
    if (x <= 88) {
      // The sheer eastern cliff face of Mount Zephyr, broken by the mountain pass at y = 120
      if (x >= 82 && x <= 86 && Math.abs(y - 120) > 6) return Tile.Rock;
      // High mountain ridges and living marble peaks
      if (valueNoise(x, y, map.seed + 4, 9) > 0.40 || rand2(x, y, map.seed + 5) < 0.08) return Tile.Rock;
      // Alpine frosted pines in sheltered mountain clefts
      if (rand2(x, y, map.seed + 1) < 0.04) return Tile.Tree;
      return Tile.Ground;
    }

    // Eastern Frostpeak: snowfields, frozen lakes, pine groves
    if (valueNoise(x, y, map.seed, 11) < 0.15) return Tile.Water;
    if (valueNoise(x, y, map.seed + 4, 9) > 0.74 || rand2(x, y, map.seed + 5) < 0.012) return Tile.Rock;
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
  // Mount Zephyr: Mountain Pass, Whiteledge, and The Eyrie
  // -------------------------------------------------------------

  // 1. Mountain Pass through the eastern cliffs, flanked by monumental beacon braziers:
  disc(map, 84, 120, 6, Tile.Ground);
  road(map, c, c, 84, 120);
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'beacon-brazier'), x: 81.5, y: 116.5, footprint: { width: 1.5, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'beacon-brazier'), x: 81.5, y: 123.5, footprint: { width: 1.5, height: 1 } });

  // 2. Sculpted mountain road ascending into Whiteledge Town:
  road(map, 84, 120, 56, 120);

  // 3. Whiteledge Town Plaza (Floor 0):
  disc(map, 56, 120, 16, Tile.Ground);
  disc(map, 48, 128, 8, Tile.Ground);
  disc(map, 64, 112, 8, Tile.Ground);
  disc(map, 64, 128, 8, Tile.Ground);

  // Frozen mountain chasm stream running beneath the Viaduct Bridge (y = 102..114, spanning under and west of the bridge):
  for (let y = 102; y <= 114; y++) {
    for (let x = 24; x <= 48; x++) {
      map.tiles[y * map.width + x] = Tile.Water;
    }
  }

  // Talon-Mason Kaen's workshop (10x6 marble building)
  const masonShop = building(map, 48, 128, 10, 6, 'frostpeak-whiteledge-house');
  map.buildings.push(masonShop);
  road(map, 56, 120, masonShop.door.x, masonShop.door.y + 1);

  // Whiteledge Weaving House (10x6 marble building)
  const weavingHouse = building(map, 64, 112, 10, 6, 'frostpeak-whiteledge-house');
  map.buildings.push(weavingHouse);
  road(map, 56, 120, weavingHouse.door.x, weavingHouse.door.y + 1);

  // Whiteledge Delver's Shelter (10x6 marble building)
  const delversLodge = building(map, 64, 128, 10, 6, 'frostpeak-whiteledge-house');
  map.buildings.push(delversLodge);
  road(map, 56, 120, delversLodge.door.x, delversLodge.door.y + 1);

  // Furnish Whiteledge workshops and homes
  const putMason = placer(map, 'frostpeak-whiteledge-house', masonShop.x + 1, masonShop.y + 1);
  putMason('mason-bench', 1.5, 1, 2, 1);
  putMason('mountain-hearth', 5.5, 1, 2, 1);

  const putWeave = placer(map, 'frostpeak-whiteledge-house', weavingHouse.x + 1, weavingHouse.y + 1);
  putWeave('loom', 1.5, 1, 2.5, 1);
  putWeave('fur-bed', 5.5, 1, 2, 1);

  const putLodge = placer(map, 'frostpeak-whiteledge-house', delversLodge.x + 1, delversLodge.y + 1);
  putLodge('mountain-hearth', 1.5, 1, 2, 1);
  putLodge('fur-bed', 5.5, 1, 2, 1);

  map.npcs.push({ id: 'kaen', name: 'Talon-Mason Kaen', asset: 'frostpeak-kaen', x: 56.5, y: 119.5 });

  // 4. Switchback mountain road to The Eyrie Forecourt:
  road(map, 56, 120, 43, 95);
  disc(map, 43, 95, 12, Tile.Ground);

  // The Eyrie of the First Watch: Monumental base on Floor 0 (18x12)
  const eyrieLeft = 34;
  const eyrieTop = 82;
  const eyrie = building(map, eyrieLeft, eyrieTop, CATHEDRAL_SIZE.width, CATHEDRAL_SIZE.height, 'frostpeak-eyrie');
  map.buildings.push(eyrie);
  road(map, 43, 95, eyrie.door.x, eyrie.door.y + 1);

  // Furnish The Eyrie Great Hall on Floor 0
  const putEyrie = placer(map, 'frostpeak-eyrie', eyrie.x + 1, eyrie.y + 1);
  putEyrie('wind-throne', 7, 2, 2, 1);
  putEyrie('silver-brazier', 2, 2, 1, 1);
  putEyrie('silver-brazier', 13, 2, 1, 1);
  putEyrie('astrolabe-pedestal', 2, 7, 2, 1);
  putEyrie('falcon-perch', 13, 4, 1.5, 1);

  // Eyrie Forecourt, Chasm Gorge & Whiteledge Cliff Terraces:
  // Monumental Tunnel Portals, Falcon Relief Friezes, Ice Cascades, Cantilever Decks, Beacon Braziers, and Viaduct Arches
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'tunnel-portal'), x: 39.5, y: 94.5, footprint: { width: 2, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'falcon-frieze'), x: 35.5, y: 94.5, footprint: { width: 2, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'falcon-frieze'), x: 49.5, y: 94.5, footprint: { width: 2, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'silver-brazier'), x: 37.5, y: 94.5, footprint: { width: 1, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'silver-brazier'), x: 46.5, y: 94.5, footprint: { width: 1, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'beacon-brazier'), x: 34.5, y: 96.5, footprint: { width: 1.5, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'beacon-brazier'), x: 51.5, y: 96.5, footprint: { width: 1.5, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'viaduct-arch'), x: 39.5, y: 105, footprint: { width: 2, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'viaduct-arch'), x: 39.5, y: 111, footprint: { width: 2, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'viaduct-arch'), x: 46, y: 106, footprint: { width: 2, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'viaduct-arch'), x: 46, y: 111, footprint: { width: 2, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'ice-cascade'), x: 35.5, y: 105.5, footprint: { width: 2, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'ice-cascade'), x: 47, y: 103.5, footprint: { width: 2, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-whiteledge-house', 'cantilever-deck'), x: 45, y: 125, footprint: { width: 2, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-whiteledge-house', 'cantilever-deck'), x: 61, y: 110, footprint: { width: 2, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'falcon-frieze'), x: 45, y: 129, footprint: { width: 2, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'beacon-brazier'), x: 53.5, y: 117.5, footprint: { width: 1.5, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'silver-brazier'), x: 60.5, y: 117.5, footprint: { width: 1, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'tunnel-portal'), x: 42, y: 138.5, footprint: { width: 2, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'falcon-frieze'), x: 36, y: 138.5, footprint: { width: 2, height: 1 } });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'falcon-frieze'), x: 48, y: 138.5, footprint: { width: 2, height: 1 } });

  // -------------------------------------------------------------
  // Storeys and Mountain Tunnels: Floors +1 to +8 and -1 to -4
  // -------------------------------------------------------------

  // Floor +1: Grand Portico, North Scriptorium, South Bastion, West Vista, and Tunnels
  const f1Central = addStorey(map, { x: 34, y: 82, width: 18, height: 11 }, 1, eyrie.style, undefined, true);
  const f1North = addStorey(map, { x: 34, y: 34, width: 18, height: 28 }, 1, eyrie.style, undefined, true);
  const f1TunnelN = addStorey(map, { x: 34, y: 62, width: 18, height: 20 }, 1, eyrie.style, undefined, true);
  const f1South = addStorey(map, { x: 32, y: 121, width: 24, height: 5 }, 1, eyrie.style, undefined, true);
  const f1SouthWest = addStorey(map, { x: 32, y: 126, width: 14, height: 10 }, 1, eyrie.style, undefined, true);
  const f1TunnelS = addStorey(map, { x: 34, y: 115, width: 12, height: 6 }, 1, eyrie.style, undefined, true);
  const f1West = addStorey(map, { x: 18, y: 83, width: 10, height: 10 }, 1, eyrie.style, undefined, true);
  const f1TunnelW = addStorey(map, { x: 28, y: 85, width: 6, height: 6 }, 1, eyrie.style, undefined, true);

  connectVertical(map, 1, f1North, f1TunnelN, 42);
  connectVertical(map, 1, f1TunnelN, f1Central, 42);
  connectVertical(map, 1, f1TunnelS, f1South, 39);
  connectVertical(map, 1, f1South, f1SouthWest, 38);
  connectHorizontal(map, 1, f1West, f1TunnelW, 87);
  connectHorizontal(map, 1, f1TunnelW, f1Central, 87);

  // Floor +2: The Loom-Terraces, North Falconer's Sky-Roost, South Feather-Cache, West Cloud Terrace, and Open Viaduct Bridge
  const f2Central = addStorey(map, { x: 34, y: 82, width: 17, height: 10 }, 2, eyrie.style, undefined, true);
  const f2North = addStorey(map, { x: 34, y: 34, width: 17, height: 27 }, 2, eyrie.style, undefined, true);
  const f2TunnelN = addStorey(map, { x: 34, y: 61, width: 17, height: 21 }, 2, eyrie.style, undefined, true);
  const f2South = addStorey(map, { x: 32, y: 121, width: 24, height: 5 }, 2, eyrie.style, undefined, true);
  const f2SouthWest = addStorey(map, { x: 32, y: 126, width: 14, height: 10 }, 2, eyrie.style, undefined, true);
  const f2TunnelS = addStorey(map, { x: 40, y: 92, width: 6, height: 29 }, 2, eyrie.style, undefined, true);
  const f2West = addStorey(map, { x: 18, y: 83, width: 10, height: 10 }, 2, eyrie.style, undefined, true);
  const f2TunnelW = addStorey(map, { x: 28, y: 85, width: 6, height: 6 }, 2, eyrie.style, undefined, true);

  // Viaduct Bridge Stone Balustrades along open bridge flanks (Floor 2)
  for (const by of [98, 104, 110, 116]) {
    map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'stone-balustrade'), x: 40.5, y: by, footprint: { width: 1, height: 1 }, floor: 2 });
    map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'stone-balustrade'), x: 45.5, y: by, footprint: { width: 1, height: 1 }, floor: 2 });
  }

  // High Terrace Stone Balustrades along open summit observation deck (Floor 7)
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'stone-balustrade'), x: 39.5, y: 90.5, footprint: { width: 1, height: 1 }, floor: 7 });
  map.landmarks.push({ asset: furnitureArt('frostpeak-eyrie', 'stone-balustrade'), x: 46.5, y: 90.5, footprint: { width: 1, height: 1 }, floor: 7 });

  connectVertical(map, 2, f2North, f2TunnelN, 42);
  connectVertical(map, 2, f2TunnelN, f2Central, 42);
  connectVertical(map, 2, f2Central, f2TunnelS, 42);
  connectVertical(map, 2, f2TunnelS, f2South, 42);
  connectVertical(map, 2, f2South, f2SouthWest, 38);
  connectHorizontal(map, 2, f2West, f2TunnelW, 87);
  connectHorizontal(map, 2, f2TunnelW, f2Central, 87);

  // Floor +3: Wind-Scriptorium, North Draft Sanctuary, South Observation Deck, and Tunnels
  const f3Central = addStorey(map, { x: 35, y: 83, width: 16, height: 9 }, 3, eyrie.style, undefined, true);
  const f3North = addStorey(map, { x: 35, y: 35, width: 16, height: 25 }, 3, eyrie.style, undefined, true);
  const f3TunnelN = addStorey(map, { x: 35, y: 60, width: 16, height: 23 }, 3, eyrie.style, undefined, true);
  const f3South = addStorey(map, { x: 32, y: 121, width: 24, height: 5 }, 3, eyrie.style, undefined, true);
  const f3SouthWest = addStorey(map, { x: 33, y: 126, width: 13, height: 10 }, 3, eyrie.style, undefined, true);

  connectVertical(map, 3, f3North, f3TunnelN, 42);
  connectVertical(map, 3, f3TunnelN, f3Central, 42);
  connectVertical(map, 3, f3South, f3SouthWest, 38);

  // Floor +4: Steaming Marble Baths, Cold Plunge, Mist Terrace, and Tunnels (open)
  const f4Central = addStorey(map, { x: 36, y: 84, width: 14, height: 8 }, 4, eyrie.style, undefined, true);
  const f4North = addStorey(map, { x: 36, y: 36, width: 14, height: 23 }, 4, eyrie.style, undefined, true);
  const f4TunnelN = addStorey(map, { x: 36, y: 59, width: 14, height: 25 }, 4, eyrie.style, undefined, true);
  const f4South = addStorey(map, { x: 34, y: 122, width: 12, height: 8 }, 4, eyrie.style, undefined, true);

  connectVertical(map, 4, f4North, f4TunnelN, 42);
  connectVertical(map, 4, f4TunnelN, f4Central, 42);

  // Floor +5: Master Falconer's Roost, North High Aerie, and Ridge Tunnel (open)
  const f5Central = addStorey(map, { x: 37, y: 84, width: 12, height: 8 }, 5, eyrie.style, undefined, true);
  const f5North = addStorey(map, { x: 37, y: 37, width: 12, height: 21 }, 5, eyrie.style, undefined, true);
  const f5TunnelN = addStorey(map, { x: 37, y: 58, width: 12, height: 26 }, 5, eyrie.style, undefined, true);

  connectVertical(map, 5, f5North, f5TunnelN, 42);
  connectVertical(map, 5, f5TunnelN, f5Central, 42);

  // Floor +6: High Council Chamber, Elder's Open Solarium Terrace, and Council Tunnel
  const f6Central = addStorey(map, { x: 38, y: 85, width: 10, height: 6 }, 6, eyrie.style, undefined, true);
  const f6North = addStorey(map, { x: 38, y: 38, width: 10, height: 19 }, 6, eyrie.style, undefined, true);
  const f6TunnelN = addStorey(map, { x: 38, y: 57, width: 10, height: 28 }, 6, eyrie.style, undefined, true);

  connectVertical(map, 6, f6North, f6TunnelN, 42);
  connectVertical(map, 6, f6TunnelN, f6Central, 42);

  // Floor +7: Belfry of Zephyrs, North Lookout Bastion, and Belfry Bridge (open)
  const f7Central = addStorey(map, { x: 39, y: 85, width: 8, height: 6 }, 7, eyrie.style, undefined, true);
  const f7North = addStorey(map, { x: 39, y: 39, width: 8, height: 17 }, 7, eyrie.style, undefined, true);
  const f7TunnelN = addStorey(map, { x: 39, y: 56, width: 8, height: 29 }, 7, eyrie.style, undefined, true);

  connectVertical(map, 7, f7North, f7TunnelN, 42);
  connectVertical(map, 7, f7TunnelN, f7Central, 42);

  // Floor +8: The Crown of the Wind (open summit peak)
  addStorey(map, { x: 39, y: 85, width: 8, height: 6 }, 8, eyrie.style, undefined, true);

  // Subterranean Depths (-1 to -4): The Sunken Drafts
  // Floor -1: Upper Silver Veins, North Lode, South Ore Depot, and Mine Tunnels
  const sub1Central = addStorey(map, { x: 30, y: 78, width: 28, height: 18 }, -1, 'frostpeak-sunken-drafts');
  const sub1North = addStorey(map, { x: 30, y: 30, width: 24, height: 16 }, -1, 'frostpeak-sunken-drafts');
  const sub1TunnelN = addStorey(map, { x: 38, y: 46, width: 8, height: 32 }, -1, 'frostpeak-sunken-drafts');
  const sub1South = addStorey(map, { x: 30, y: 126, width: 24, height: 16 }, -1, 'frostpeak-sunken-drafts');
  const sub1TunnelS = addStorey(map, { x: 38, y: 96, width: 8, height: 30 }, -1, 'frostpeak-sunken-drafts');

  connectVertical(map, -1, sub1North, sub1TunnelN, 41);
  connectVertical(map, -1, sub1TunnelN, sub1Central, 41);
  connectVertical(map, -1, sub1Central, sub1TunnelS, 41);
  connectVertical(map, -1, sub1TunnelS, sub1South, 41);

  // Floor -2: Whispering Tunnels, North Den, South Stalker Lair, and Tunnels
  const sub2Central = addStorey(map, { x: 29, y: 77, width: 30, height: 20 }, -2, 'frostpeak-sunken-drafts');
  const sub2North = addStorey(map, { x: 29, y: 29, width: 26, height: 16 }, -2, 'frostpeak-sunken-drafts');
  const sub2TunnelN = addStorey(map, { x: 38, y: 45, width: 8, height: 32 }, -2, 'frostpeak-sunken-drafts');
  const sub2South = addStorey(map, { x: 29, y: 127, width: 26, height: 16 }, -2, 'frostpeak-sunken-drafts');
  const sub2TunnelS = addStorey(map, { x: 38, y: 97, width: 8, height: 30 }, -2, 'frostpeak-sunken-drafts');

  connectVertical(map, -2, sub2North, sub2TunnelN, 41);
  connectVertical(map, -2, sub2TunnelN, sub2Central, 41);
  connectVertical(map, -2, sub2Central, sub2TunnelS, 41);
  connectVertical(map, -2, sub2TunnelS, sub2South, 41);

  // Floor -3: Crypt of the First Watchers, North Tomb Vault, South Sarcophagus Hall, and Tunnels
  const sub3Central = addStorey(map, { x: 30, y: 78, width: 28, height: 18 }, -3, 'frostpeak-sunken-drafts');
  const sub3North = addStorey(map, { x: 30, y: 30, width: 24, height: 16 }, -3, 'frostpeak-sunken-drafts');
  const sub3TunnelN = addStorey(map, { x: 38, y: 46, width: 8, height: 32 }, -3, 'frostpeak-sunken-drafts');
  const sub3South = addStorey(map, { x: 30, y: 126, width: 24, height: 16 }, -3, 'frostpeak-sunken-drafts');
  const sub3TunnelS = addStorey(map, { x: 38, y: 96, width: 8, height: 30 }, -3, 'frostpeak-sunken-drafts');

  connectVertical(map, -3, sub3North, sub3TunnelN, 41);
  connectVertical(map, -3, sub3TunnelN, sub3Central, 41);
  connectVertical(map, -3, sub3Central, sub3TunnelS, 41);
  connectVertical(map, -3, sub3TunnelS, sub3South, 41);

  // Floor -4: The Hoarfrost Well, North Deep Cavern, South Frost Sump, and Glacial Tunnels
  const sub4Central = addStorey(map, { x: 31, y: 79, width: 26, height: 16 }, -4, 'frostpeak-sunken-drafts');
  const sub4North = addStorey(map, { x: 31, y: 31, width: 22, height: 14 }, -4, 'frostpeak-sunken-drafts');
  const sub4TunnelN = addStorey(map, { x: 38, y: 45, width: 8, height: 34 }, -4, 'frostpeak-sunken-drafts');
  const sub4South = addStorey(map, { x: 31, y: 125, width: 22, height: 14 }, -4, 'frostpeak-sunken-drafts');
  const sub4TunnelS = addStorey(map, { x: 38, y: 95, width: 8, height: 30 }, -4, 'frostpeak-sunken-drafts');

  connectVertical(map, -4, sub4North, sub4TunnelN, 41);
  connectVertical(map, -4, sub4TunnelN, sub4Central, 41);
  connectVertical(map, -4, sub4Central, sub4TunnelS, 41);
  connectVertical(map, -4, sub4TunnelS, sub4South, 41);

  // -------------------------------------------------------------
  // Subterranean Cavern & Mixed Chamber Details (Floors -1 to -4 & +1)
  // -------------------------------------------------------------
  const putFloorProp = (style: string, key: string, x: number, y: number, width: number, height: number, floor: number) =>
    map.landmarks.push({ asset: furnitureArt(style, key), x, y, footprint: { width, height }, floor });

  // Mixed Marble & Living Stone Chamber Details on Floor +1 (Grand Portico, North Scriptorium, South Bastion, West Vista)
  putFloorProp('frostpeak-whiteledge-house', 'mason-bench', 37, 84, 2, 1, 1);
  putFloorProp('frostpeak-whiteledge-house', 'mountain-hearth', 49, 84, 2, 1, 1);
  putFloorProp('frostpeak-sunken-drafts', 'marble-rubble', 37, 91, 1.5, 1, 1);
  putFloorProp('frostpeak-sunken-drafts', 'marble-rubble', 36, 130, 1.5, 1, 1);
  putFloorProp('frostpeak-eyrie', 'falcon-frieze', 43, 84, 2, 1, 1);
  putFloorProp('frostpeak-eyrie', 'silver-brazier', 36, 37, 1, 1, 1);
  putFloorProp('frostpeak-eyrie', 'astrolabe-pedestal', 47, 37, 2, 1, 1);
  putFloorProp('frostpeak-eyrie', 'beacon-brazier', 35, 60, 1.5, 1, 1);
  putFloorProp('frostpeak-eyrie', 'beacon-brazier', 49, 60, 1.5, 1, 1);
  putFloorProp('frostpeak-whiteledge-house', 'cantilever-deck', 51, 124.5, 2, 1, 1);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 48.5, 124.5, 1, 1, 1);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 53.5, 124.5, 1, 1, 1);
  putFloorProp('frostpeak-whiteledge-house', 'cantilever-deck', 21, 86, 2, 1, 1);
  putFloorProp('frostpeak-eyrie', 'ice-cascade', 21, 91, 2, 1, 1);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 19.5, 91.5, 1, 1, 1);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 25.5, 91.5, 1, 1, 1);

  // Floor +2 (Loom-Terraces, North Falconer's Sky-Roost, South Feather-Cache, West Cloud Terrace, Open Viaduct Bridge):
  putFloorProp('frostpeak-whiteledge-house', 'loom', 37.5, 84.5, 2.5, 1, 2);
  putFloorProp('frostpeak-whiteledge-house', 'mountain-hearth', 48, 90, 2, 1, 2);
  putFloorProp('frostpeak-eyrie', 'falcon-perch', 36, 37, 1.5, 1, 2);
  putFloorProp('frostpeak-eyrie', 'falcon-perch', 46, 37, 1.5, 1, 2);
  putFloorProp('frostpeak-eyrie', 'silver-brazier', 35, 59, 1, 1, 2);
  putFloorProp('frostpeak-eyrie', 'silver-brazier', 48, 59, 1, 1, 2);
  putFloorProp('frostpeak-eyrie', 'beacon-brazier', 40.5, 96, 1.5, 1, 2);
  putFloorProp('frostpeak-eyrie', 'beacon-brazier', 45.5, 119, 1.5, 1, 2);
  putFloorProp('frostpeak-whiteledge-house', 'cantilever-deck', 50, 124.5, 2, 1, 2);
  putFloorProp('frostpeak-eyrie', 'falcon-frieze', 46, 124.5, 2, 1, 2);
  putFloorProp('frostpeak-whiteledge-house', 'cantilever-deck', 21, 86, 2, 1, 2);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 19.5, 91.5, 1, 1, 2);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 25.5, 91.5, 1, 1, 2);

  // Floor +3 (Wind-Scriptorium, North Draft Sanctuary, South Observation Deck):
  putFloorProp('frostpeak-eyrie', 'astrolabe-pedestal', 38, 85, 2, 1, 3);
  putFloorProp('frostpeak-eyrie', 'falcon-frieze', 43, 85, 2, 1, 3);
  putFloorProp('frostpeak-eyrie', 'silver-brazier', 48, 85, 1, 1, 3);
  putFloorProp('frostpeak-eyrie', 'astrolabe-pedestal', 37, 38, 2, 1, 3);
  putFloorProp('frostpeak-eyrie', 'silver-brazier', 45, 38, 1, 1, 3);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 36.5, 58.5, 1, 1, 3);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 47.5, 58.5, 1, 1, 3);
  putFloorProp('frostpeak-whiteledge-house', 'mason-bench', 37, 128, 2, 1, 3);
  putFloorProp('frostpeak-eyrie', 'beacon-brazier', 49, 124, 1.5, 1, 3);

  // Floor +4 (Steaming Marble Baths, Cold Plunge, Mist Terrace — open):
  putFloorProp('frostpeak-eyrie', 'silver-brazier', 38.5, 86, 1, 1, 4);
  putFloorProp('frostpeak-eyrie', 'silver-brazier', 47.5, 86, 1, 1, 4);
  putFloorProp('frostpeak-eyrie', 'ice-cascade', 37, 40, 2, 1, 4);
  putFloorProp('frostpeak-eyrie', 'beacon-brazier', 45, 40, 1.5, 1, 4);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 36.5, 57.5, 1, 1, 4);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 47.5, 57.5, 1, 1, 4);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 36.5, 128.5, 1, 1, 4);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 43.5, 128.5, 1, 1, 4);

  // Floor +5 (Master Falconer's Roost & North High Aerie — open):
  putFloorProp('frostpeak-eyrie', 'falcon-perch', 39, 86, 1.5, 1, 5);
  putFloorProp('frostpeak-eyrie', 'falcon-perch', 46, 86, 1.5, 1, 5);
  putFloorProp('frostpeak-eyrie', 'falcon-perch', 38, 44, 1.5, 1, 5);
  putFloorProp('frostpeak-eyrie', 'beacon-brazier', 44, 44, 1.5, 1, 5);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 37.5, 56.5, 1, 1, 5);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 46.5, 56.5, 1, 1, 5);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 37.5, 90.5, 1, 1, 5);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 46.5, 90.5, 1, 1, 5);

  // Floor +6 (High Council Chamber & Elder's Open Solarium Terrace — Scene 1 Floor 6+ Ground View):
  putFloorProp('frostpeak-eyrie', 'wind-throne', 43, 86.5, 2, 1, 6);
  putFloorProp('frostpeak-eyrie', 'falcon-frieze', 39.5, 86.5, 2, 1, 6);
  putFloorProp('frostpeak-eyrie', 'silver-brazier', 46.5, 86.5, 1, 1, 6);
  putFloorProp('frostpeak-eyrie', 'astrolabe-pedestal', 40.5, 53, 2, 1, 6);
  putFloorProp('frostpeak-eyrie', 'silver-brazier', 45.5, 53, 1, 1, 6);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 39.5, 55.5, 1, 1, 6);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 46.5, 55.5, 1, 1, 6);

  // Floor +7 (Belfry of Zephyrs & North Lookout Bastion — open):
  putFloorProp('frostpeak-eyrie', 'astrolabe-pedestal', 41, 86.5, 2, 1, 7);
  putFloorProp('frostpeak-eyrie', 'silver-brazier', 45.5, 86.5, 1, 1, 7);
  putFloorProp('frostpeak-eyrie', 'beacon-brazier', 43, 42, 1.5, 1, 7);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 40.5, 44.5, 1, 1, 7);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 45.5, 44.5, 1, 1, 7);

  // Floor +8 (The Crown of the Wind — open summit peak):
  putFloorProp('frostpeak-eyrie', 'beacon-brazier', 40.5, 86.5, 1.5, 1, 8);
  putFloorProp('frostpeak-eyrie', 'falcon-perch', 45.5, 86.5, 1.5, 1, 8);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 40.5, 89.5, 1, 1, 8);
  putFloorProp('frostpeak-eyrie', 'stone-balustrade', 45.5, 89.5, 1, 1, 8);

  // Floor -1 (Upper Silver Veins, North Lode, South Ore Depot):
  putFloorProp('frostpeak-sunken-drafts', 'mining-rig', 34, 81, 2, 1, -1);
  putFloorProp('frostpeak-sunken-drafts', 'mine-rail-crossing', 42, 81, 2, 1, -1);
  putFloorProp('frostpeak-sunken-drafts', 'mine-rail-crossing', 42, 93, 2, 1, -1);
  putFloorProp('frostpeak-sunken-drafts', 'ore-cart', 34, 93, 2, 1, -1);
  putFloorProp('frostpeak-sunken-drafts', 'stalactite-watchpost', 54, 81, 2, 1, -1);
  putFloorProp('frostpeak-sunken-drafts', 'marble-rubble', 54, 93, 1.5, 1, -1);
  putFloorProp('frostpeak-sunken-drafts', 'ore-cart', 34, 34, 2, 1, -1);
  putFloorProp('frostpeak-sunken-drafts', 'mine-rail-crossing', 42, 41, 2, 1, -1);
  putFloorProp('frostpeak-sunken-drafts', 'stalagmite-cluster', 49, 34, 1.5, 1, -1);
  putFloorProp('frostpeak-sunken-drafts', 'mining-rig', 34, 130, 2, 1, -1);
  putFloorProp('frostpeak-sunken-drafts', 'ore-cart', 49, 130, 2, 1, -1);
  putFloorProp('frostpeak-sunken-drafts', 'marble-rubble', 42, 138, 1.5, 1, -1);

  // Floor -2 (Whispering Tunnels, North Den, South Stalker Lair):
  putFloorProp('frostpeak-sunken-drafts', 'stalactite-watchpost', 32, 80, 2, 1, -2);
  putFloorProp('frostpeak-sunken-drafts', 'stalactite-watchpost', 55, 80, 2, 1, -2);
  putFloorProp('frostpeak-sunken-drafts', 'mine-rail-crossing', 42, 80, 2, 1, -2);
  putFloorProp('frostpeak-sunken-drafts', 'mine-rail-crossing', 42, 94, 2, 1, -2);
  putFloorProp('frostpeak-sunken-drafts', 'stalagmite-cluster', 32, 94, 1.5, 1, -2);
  putFloorProp('frostpeak-sunken-drafts', 'marble-rubble', 55, 94, 1.5, 1, -2);
  putFloorProp('frostpeak-sunken-drafts', 'stalagmite-cluster', 33, 33, 1.5, 1, -2);
  putFloorProp('frostpeak-sunken-drafts', 'stalactite-watchpost', 50, 33, 2, 1, -2);
  putFloorProp('frostpeak-sunken-drafts', 'mine-rail-crossing', 42, 132, 2, 1, -2);
  putFloorProp('frostpeak-sunken-drafts', 'ore-cart', 50, 138, 2, 1, -2);

  // Floor -3 (Crypt of the First Watchers, North Tomb Vault, South Sarcophagus Hall):
  putFloorProp('frostpeak-sunken-drafts', 'relic-sarcophagus', 34, 81, 2.5, 1, -3);
  putFloorProp('frostpeak-sunken-drafts', 'relic-sarcophagus', 53, 81, 2.5, 1, -3);
  putFloorProp('frostpeak-sunken-drafts', 'stalactite-watchpost', 34, 93, 2, 1, -3);
  putFloorProp('frostpeak-sunken-drafts', 'marble-rubble', 53, 93, 1.5, 1, -3);
  putFloorProp('frostpeak-sunken-drafts', 'relic-sarcophagus', 42, 34, 2.5, 1, -3);
  putFloorProp('frostpeak-sunken-drafts', 'marble-rubble', 34, 41, 1.5, 1, -3);
  putFloorProp('frostpeak-sunken-drafts', 'relic-sarcophagus', 42, 136, 2.5, 1, -3);
  putFloorProp('frostpeak-sunken-drafts', 'stalagmite-cluster', 49, 130, 1.5, 1, -3);

  // Floor -4 (The Hoarfrost Well, North Deep Cavern, South Frost Sump):
  putFloorProp('frostpeak-sunken-drafts', 'stalagmite-cluster', 34, 82, 1.5, 1, -4);
  putFloorProp('frostpeak-sunken-drafts', 'stalagmite-cluster', 53, 82, 1.5, 1, -4);
  putFloorProp('frostpeak-sunken-drafts', 'stalactite-watchpost', 34, 92, 2, 1, -4);
  putFloorProp('frostpeak-sunken-drafts', 'mine-rail-crossing', 43, 92, 2, 1, -4);
  putFloorProp('frostpeak-sunken-drafts', 'relic-sarcophagus', 53, 92, 2.5, 1, -4);
  putFloorProp('frostpeak-sunken-drafts', 'stalagmite-cluster', 34, 35, 1.5, 1, -4);
  putFloorProp('frostpeak-sunken-drafts', 'stalagmite-cluster', 49, 35, 1.5, 1, -4);
  putFloorProp('frostpeak-sunken-drafts', 'stalactite-watchpost', 42, 132, 2, 1, -4);

  // -------------------------------------------------------------
  // Stairways and Ladders (Connecting all 13 Levels)
  // -------------------------------------------------------------

  // Above Ground (+1 to +8):
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 2, y: eyrieTop + 3, width: 2, height: 1, from: 0, names: { lower: 'Marble Hall', upper: 'Grand Portico' } });
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 14, y: eyrieTop + 3, width: 2, height: 1, from: 1, names: { lower: 'Grand Portico', upper: 'Loom-Terraces' } });
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 3, y: eyrieTop + 6, width: 2, height: 1, from: 2, names: { lower: 'Loom-Terraces', upper: 'Wind-Scriptorium' } });
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 13, y: eyrieTop + 6, width: 2, height: 1, from: 3, names: { lower: 'Wind-Scriptorium', upper: 'Steaming Marble Baths' } });
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 4, y: eyrieTop + 5, width: 2, height: 1, from: 4, names: { lower: 'Steaming Marble Baths', upper: "Master Falconer's Roost" } });
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 12, y: eyrieTop + 5, width: 2, height: 1, from: 5, names: { lower: "Master Falconer's Roost", upper: 'High Council Chamber' } });
  addStairs(map, { kind: 'ladder', x: eyrieLeft + 6, y: eyrieTop + 5, width: 1, height: 1, from: 6, names: { lower: 'High Council Chamber', upper: 'Belfry of Zephyrs' } });
  addStairs(map, { kind: 'ladder', x: eyrieLeft + 10, y: eyrieTop + 5, width: 1, height: 1, from: 7, names: { lower: 'Belfry of Zephyrs', upper: 'The Crown of the Wind' } });

  // Subterranean (-1 to -4):
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 14, y: eyrieTop + 8, width: 2, height: 1, from: -1, names: { lower: 'Upper Silver Veins', upper: 'Marble Hall' } });
  addStairs(map, { kind: 'stairs', x: eyrieLeft - 1, y: eyrieTop + 4, width: 2, height: 1, from: -2, names: { lower: 'Whispering Tunnels', upper: 'Upper Silver Veins' } });
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 10, y: eyrieTop + 10, width: 2, height: 1, from: -3, names: { lower: 'Crypt of the First Watchers', upper: 'Whispering Tunnels' } });
  addStairs(map, { kind: 'stairs', x: eyrieLeft + 2, y: eyrieTop + 2, width: 2, height: 1, from: -4, names: { lower: 'The Hoarfrost Well', upper: 'Crypt of the First Watchers' } });

  // Eyrie NPCs
  map.npcs.push({ id: 'kip', name: 'Kip the Spelunker', asset: 'frostpeak-kip', x: 43.5, y: 86.5, floor: -1 });
  map.npcs.push({ id: 'sula', name: 'Sula the Feather-Weaver', asset: 'frostpeak-sula', x: 42.5, y: 88.5, floor: 2 });
  map.npcs.push({ id: 'aurius', name: 'Elder Aurius the Keen', asset: 'frostpeak-aurius', x: 42.5, y: 87.5, floor: 6 });
  map.npcs.push({ id: 'vail', name: 'Watcher Vail', asset: 'frostpeak-vail', x: 42.5, y: 87.5, floor: 8 });

  // Subterranean Monsters: distributed across central halls, north chambers, south caverns, and connecting tunnels
  // Floor -1 (Upper Silver Veins):
  map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: 40.5, y: 85.5, floor: -1 });
  map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: 45.5, y: 85.5, floor: -1 });
  map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: 39.5, y: 87.5, floor: -1 });
  map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: 45.5, y: 88.5, floor: -1 });
  map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: 41.5, y: 90.5, floor: -1 });

  // Floor -2 (Whispering Tunnels):
  map.creatures.push({ kind: 'rime-stalker', name: 'Rime Stalker', asset: 'frostpeak-rime-stalker', x: 40.5, y: 85.5, floor: -2 });
  map.creatures.push({ kind: 'rime-stalker', name: 'Rime Stalker', asset: 'frostpeak-rime-stalker', x: 45.5, y: 85.5, floor: -2 });
  map.creatures.push({ kind: 'rime-stalker', name: 'Rime Stalker', asset: 'frostpeak-rime-stalker', x: 39.5, y: 87.5, floor: -2 });
  map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: 45.5, y: 88.5, floor: -2 });
  map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: 41.5, y: 90.5, floor: -2 });

  // Floor -3 (Crypt of the First Watchers):
  map.creatures.push({ kind: 'deep-matriarch', name: 'Deep Crag Matriarch', asset: 'frostpeak-deep-matriarch', x: 40.5, y: 85.5, floor: -3 });
  map.creatures.push({ kind: 'deep-matriarch', name: 'Deep Crag Matriarch', asset: 'frostpeak-deep-matriarch', x: 45.5, y: 85.5, floor: -3 });
  map.creatures.push({ kind: 'deep-matriarch', name: 'Deep Crag Matriarch', asset: 'frostpeak-deep-matriarch', x: 39.5, y: 87.5, floor: -3 });
  map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: 45.5, y: 88.5, floor: -3 });
  map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: 41.5, y: 90.5, floor: -3 });

  // Floor -4 (The Hoarfrost Well):
  map.creatures.push({ kind: 'rime-stalker', name: 'Rime Stalker', asset: 'frostpeak-rime-stalker', x: 40.5, y: 85.5, floor: -4 });
  map.creatures.push({ kind: 'rime-stalker', name: 'Rime Stalker', asset: 'frostpeak-rime-stalker', x: 45.5, y: 85.5, floor: -4 });
  map.creatures.push({ kind: 'rime-stalker', name: 'Rime Stalker', asset: 'frostpeak-rime-stalker', x: 39.5, y: 87.5, floor: -4 });
  map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: 45.5, y: 88.5, floor: -4 });
  map.creatures.push({ kind: 'ice-wisp', name: 'Ice Wisp', asset: 'frostpeak-ice-wisp', x: 41.5, y: 90.5, floor: -4 });

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
      shop: { sells: [{ item: 'tonic', price: 11 }, ...toolOffers('smithing')], teaches: [], buys: true },
    },
    kip: {
      name: 'Kip the Spelunker',
      greeting: 'Keep your footing! The wind pulls up from the depths like a living breath. Four floors down, there is a whole forgotten world waiting.',
      shop: { sells: [{ item: 'tonic', price: 11 }, ...toolOffers('smithing')], teaches: [], buys: true },
    },
    sula: {
      name: 'Sula the Feather-Weaver',
      greeting: 'Welcome to the Loom-Terraces. The high wind sings through the warp, and mountain wool remembers the snow.',
      shop: { sells: [{ item: 'tonic', price: 11 }, ...toolOffers('tailoring'), ...toolOffers('fletching')], teaches: [], buys: true },
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
