import type { BiomeId } from './biomes.ts';
import { CRAFTS, bestTool, craftOfFamily, type CraftId, type ToolTier } from './crafts.ts';
import type { MaterialFamily, MaterialTrait } from './materials.ts';
import { RACES } from './races.ts';
import { rand2 } from './random.ts';
import { ITEMS, type Character, type ItemDef } from './rpg.ts';

// Gathering spots (gather and craft plan, step 5). A spot is a placed thing
// in a land, like a tree or a rock: a bush, an ore vein, driftwood. Walk up
// with the right tool and press E; after a moment it gives 1 to 3 of its
// material and the craft grows. Each player has their own regrow timer on
// each spot, so nobody takes a spot from anyone else. Every land of a biome
// gets that biome's spots when it is laid out (layOut in world.ts), and the
// Owner and Stewards place more with the world editor.
//
// Only types come from world.ts: it lays the spots out with placeSpots.

/** One kind of gathering spot. */
export interface SpotDef {
  name: string;
  biome: BiomeId;
  /** The material it gives, by item id. */
  material: string;
  /** Its picture once painted; until then the game shows its material's icon. */
  art: string;
}

/** A spot standing in a land, on the ground floor. */
export interface GatherSpot {
  id: string;
  kind: string;
  /** The tile it stands on. */
  x: number;
  y: number;
}

/** How long gathering takes, how close you stand, and how long a spot takes to grow back for you. */
export const GATHER_MS = 2000;
export const GATHER_RANGE = 1.6;
export const REGROW_MS = 5 * 60_000;
/** How many of each kind of spot a land of its biome gets. */
const SPOTS_PER_KIND = 12;
/** No spot stands this near the middle, where everyone arrives. */
const CLEAR_MIDDLE = 10;

const gathered = (name: string, family: MaterialFamily, home: string, tier: 1 | 2, standIn: string, description: string, trait?: MaterialTrait): ItemDef => ({
  // Its own icon (`item-<id>`, set below) once painted; until then an icon like it.
  name, kind: 'material', art: '', standIn, description, value: tier === 1 ? 6 : 14,
  material: { family, homes: [home], source: 'gathered', tier, traits: trait ? [trait] : [] },
});

/**
 * The materials only gathering gives. Each shows the icon of a material like
 * it until its own is painted (material-icon-anchors.ts on the server).
 */
export const GATHERED_MATERIALS: Record<string, ItemDef> = {
  'temple-sage': gathered('Temple Sage', 'herb', 'sanctum', 1, 'item-mushroom-cap', 'Silver-green leaves from the shrine gardens. Burned, they smell of rain and quiet.', 'warding'),
  'copper-ore': gathered('Copper Ore', 'ore', 'sanctum', 1, 'item-scarab-shell', 'A lump of green-streaked rock with copper shining through. Soft and easy to work.', 'sturdy'),
  'oak-branch': gathered('Oak Branch', 'wood', 'sanctum', 1, 'item-heartwood', 'A straight fallen branch of the old Sanctum oaks. Good for handles.'),
  flax: gathered('Flax', 'fibre', 'sanctum', 1, 'item-ancient-linen', 'A bundle of blue-flowered flax stems, ready to be spun into linen.', 'supple'),
  'iron-ore': gathered('Iron Ore', 'ore', 'woods', 2, 'item-scarab-shell', 'Heavy red-brown rock dug from under the roots. It takes a strong hand.', 'sturdy'),
  'woods-moss': gathered('Whispering Moss', 'herb', 'woods', 1, 'item-mushroom-cap', 'A soft cushion of moss that murmurs faintly when squeezed.', 'warm'),
  driftwood: gathered('Driftwood', 'wood', 'shore', 1, 'item-heartwood', 'Sea-bleached wood, light as a feather and twice as tough.', 'light'),
  'sea-cotton': gathered('Sea Cotton', 'fibre', 'shore', 1, 'item-ancient-linen', 'Fluffy white bolls from the dune plants by the tideline.', 'light'),
  'desert-cotton': gathered('Desert Cotton', 'fibre', 'desert', 1, 'item-ancient-linen', 'Sun-dried cotton from the oasis bushes, cool to wear in the heat.', 'light'),
  amber: gathered('Amber', 'gem', 'desert', 1, 'item-pearl', 'A drop of golden amber with something tiny caught inside.', 'shimmering'),
  'gold-ore': gathered('Gold Ore', 'ore', 'desert', 2, 'item-scarab-shell', 'A sand-scoured rock with veins of gold. Wards and charms love it.', 'warding'),
  'acacia-wood': gathered('Acacia Wood', 'wood', 'desert', 1, 'item-heartwood', 'Hard twisted wood from the desert acacias. It never splits.', 'sturdy'),
  'frost-pine': gathered('Frost Pine', 'wood', 'frostpeak', 1, 'item-heartwood', 'Resin-sweet pine from the high slopes. It holds warmth like a hearth.', 'warm'),
  'silver-ore': gathered('Silver Ore', 'ore', 'frostpeak', 2, 'item-scarab-shell', 'Cold bright ore from the ice caves. It wards off what walks at night.', 'warding'),
  snowbell: gathered('Snowbell', 'herb', 'frostpeak', 1, 'item-mushroom-cap', 'A white flower that rings faintly in the wind. It blooms in snow.', 'shimmering'),
  'shelf-fungus': gathered('Shelf Fungus', 'wood', 'mushroom-hollow', 1, 'item-heartwood', 'A woody shelf of fungus as hard as oak and half as heavy.', 'supple'),
  'hollow-amethyst': gathered('Hollow Amethyst', 'gem', 'mushroom-hollow', 2, 'item-pearl', 'A violet crystal grown in the dark under the caps. It hums when held.', 'shimmering'),
  'cave-truffle': gathered('Cave Truffle', 'herb', 'mushroom-hollow', 1, 'item-mushroom-cap', 'A knobbly black truffle with a smell that fills a room.', 'warm'),
};
for (const [id, def] of Object.entries(GATHERED_MATERIALS)) def.art = `item-${id}`;
Object.assign(ITEMS, GATHERED_MATERIALS);

const spot = (name: string, biome: BiomeId, material: string, id: string): [string, SpotDef] => [id, { name, biome, material, art: `spot-${id}` }];

/** Four kinds of spot for each biome the game ships with. */
export const SPOTS: Record<string, SpotDef> = Object.fromEntries([
  spot('Sage Bush', 'sanctum', 'temple-sage', 'sanctum-sage'),
  spot('Copper Vein', 'sanctum', 'copper-ore', 'sanctum-copper'),
  spot('Fallen Oak Branch', 'sanctum', 'oak-branch', 'sanctum-branch'),
  spot('Flax Patch', 'sanctum', 'flax', 'sanctum-flax'),
  spot('Mushroom Ring', 'whispering-woods', 'mushroom-cap', 'woods-mushrooms'),
  spot('Old Oak Stump', 'whispering-woods', 'heartwood', 'woods-stump'),
  spot('Iron Vein', 'whispering-woods', 'iron-ore', 'woods-iron'),
  spot('Moss Bank', 'whispering-woods', 'woods-moss', 'woods-moss'),
  spot('Driftwood Pile', 'sunlit-shore', 'driftwood', 'shore-driftwood'),
  spot('Tide Pool', 'sunlit-shore', 'pearl', 'shore-tide-pool'),
  spot('Sea Cotton', 'sunlit-shore', 'sea-cotton', 'shore-cotton'),
  spot('Shell Bed', 'sunlit-shore', 'crab-shell', 'shore-shells'),
  spot('Cotton Bush', 'mirage-desert', 'desert-cotton', 'desert-cotton'),
  spot('Amber Seam', 'mirage-desert', 'amber', 'desert-amber'),
  spot('Gold Vein', 'mirage-desert', 'gold-ore', 'desert-gold'),
  spot('Dry Acacia', 'mirage-desert', 'acacia-wood', 'desert-acacia'),
  spot('Frost Pine', 'frostpeak', 'frost-pine', 'frostpeak-pine'),
  spot('Ice Outcrop', 'frostpeak', 'ice-crystal', 'frostpeak-ice'),
  spot('Silver Vein', 'frostpeak', 'silver-ore', 'frostpeak-silver'),
  spot('Snowbell Patch', 'frostpeak', 'snowbell', 'frostpeak-snowbell'),
  spot('Mycelium Mat', 'mushroom-hollow', 'mushroom-fibre', 'hollow-mycelium'),
  spot('Shelf Fungus', 'mushroom-hollow', 'shelf-fungus', 'hollow-shelf'),
  spot('Amethyst Geode', 'mushroom-hollow', 'hollow-amethyst', 'hollow-amethyst'),
  spot('Truffle Hollow', 'mushroom-hollow', 'cave-truffle', 'hollow-truffle'),
]);

/** The craft that gathers a spot, and the tool tier it needs (its material's tier). */
export function spotNeeds(kind: string): { craft: CraftId; tier: ToolTier } | undefined {
  const def = SPOTS[kind];
  const m = def ? ITEMS[def.material]?.material : undefined;
  const craft = craftOfFamily(m?.family);
  return craft && m ? { craft, tier: m.tier as ToolTier } : undefined;
}

/** Why this character cannot gather a kind of spot, or undefined when they can. */
export function cannotGather(c: Pick<Character, 'inventory'>, kind: string): string | undefined {
  const needs = spotNeeds(kind);
  if (!needs) return 'There is nothing here to gather.';
  const tool = bestTool(c, needs.craft);
  const name = CRAFTS[needs.craft].tool.toLowerCase();
  if (!tool) return `You need a ${name} to gather here.`;
  if (tool.tier < needs.tier) return `This needs a finer ${name}.`;
  return undefined;
}

/** True when a character's people feel spots from afar (the Cervid's Mycelial Sense): they show on the mini map. */
export function sensesSpots(c: Pick<Character, 'race'>): boolean {
  return Boolean(c.race && RACES[c.race].trait === 'mycelial-sense');
}

/** How many a gathering gives: 1 to 3. */
export function gatherYield(random: () => number): number {
  return 1 + Math.floor(random() * 3);
}

/** Practice a gathering gives its craft. */
export function gatherPractice(kind: string): number {
  return 6 + 4 * (spotNeeds(kind)?.tier ?? 1);
}

/** The spot nearest a point within reach, or undefined. */
export function spotNear(spots: readonly GatherSpot[], x: number, y: number, range = GATHER_RANGE): GatherSpot | undefined {
  let best: GatherSpot | undefined;
  let bestD = range;
  for (const s of spots) {
    const d = Math.hypot(s.x + 0.5 - x, s.y + 0.5 - y);
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** Tile kinds the layout's map is made of, passed in so this file needs nothing at run time from world.ts. */
export interface SpotGround {
  width: number;
  height: number;
  seed: number;
  biome: BiomeId;
  /** True for open ground a spot may stand on. */
  open(x: number, y: number): boolean;
}

/**
 * Where a biome's spots stand in a land: open ground with open ground all
 * round, away from the middle, the same every time for the same land.
 */
export function layOutSpots(ground: SpotGround): GatherSpot[] {
  const kinds = Object.keys(SPOTS).filter((k) => SPOTS[k]!.biome === ground.biome);
  const out: GatherSpot[] = [];
  const taken = new Set<number>();
  const c = Math.floor(ground.width / 2);
  kinds.forEach((kind, k) => {
    let placed = 0;
    for (let tries = 0; tries < SPOTS_PER_KIND * 40 && placed < SPOTS_PER_KIND; tries++) {
      const x = 2 + Math.floor(rand2(tries, k, ground.seed + 71) * (ground.width - 4));
      const y = 2 + Math.floor(rand2(k, tries, ground.seed + 73) * (ground.height - 4));
      if (Math.hypot(x - c, y - c) < CLEAR_MIDDLE || taken.has(y * ground.width + x)) continue;
      let clear = true;
      for (let dy = -1; dy <= 1 && clear; dy++) for (let dx = -1; dx <= 1 && clear; dx++) clear = ground.open(x + dx, y + dy);
      if (!clear) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) taken.add((y + dy) * ground.width + x + dx);
      out.push({ id: `${kind}-${placed}`, kind, x, y });
      placed++;
    }
  });
  return out;
}
