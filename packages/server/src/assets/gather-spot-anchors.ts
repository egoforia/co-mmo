import { SPOTS } from '@co-mmo/shared';
import type { TieredAsset } from './skill-anchors.ts';

// The gathering spots' pictures (gather and craft plan, step 5), described
// for the painter: a bush, a vein or a pile standing on one tile, painted
// beside the kit's rocks and trees so it sits in the land. None ships with
// the game: each is painted the first time from the Art tab (home-land-art.ts
// says at what size), and until then the game shows its material's icon.

/** How each spot looks, by spot kind: its shape, what it is made of, and its colours. */
const LOOKS: Record<string, { hook: string; materials: string[]; colors: [main: string, secondary: string, accent: string] }> = {
  'sanctum-sage': { hook: 'a low round bush of silver-green sage leaves with tiny purple flowers', materials: ['leaves', 'flowers'], colors: ['silver green', 'soft olive', 'lavender'] },
  'sanctum-copper': { hook: 'a knee-high grey boulder streaked with green and shining copper', materials: ['stone', 'copper'], colors: ['warm grey', 'verdigris green', 'bright copper'] },
  'sanctum-branch': { hook: 'a fallen oak branch lying in the clover with a few acorns', materials: ['oak wood', 'leaves'], colors: ['honey brown', 'clover green', 'acorn tan'] },
  'sanctum-flax': { hook: 'a small patch of tall flax stems with sky-blue flowers', materials: ['flax stems', 'flowers'], colors: ['straw green', 'sky blue', 'cream'] },
  'woods-mushrooms': { hook: 'a fairy ring of red-capped mushrooms in moss', materials: ['mushrooms', 'moss'], colors: ['mushroom red', 'moss green', 'white spots'] },
  'woods-stump': { hook: 'an old broad oak stump with a dark heartwood centre showing', materials: ['old wood', 'bark'], colors: ['dark bark brown', 'deep red heartwood', 'moss green'] },
  'woods-iron': { hook: 'a mossy rock split open showing rusty red-brown iron', materials: ['stone', 'iron ore'], colors: ['mossy grey', 'rust red', 'moss green'] },
  'woods-moss': { hook: 'a soft mound of thick glowing green moss over roots', materials: ['moss', 'roots'], colors: ['deep green', 'pale glow green', 'root brown'] },
  'shore-driftwood': { hook: 'a small pile of sea-bleached driftwood on sand', materials: ['driftwood', 'sand'], colors: ['bleached grey', 'sand gold', 'seaweed green'] },
  'shore-tide-pool': { hook: 'a small rock pool with a half-open pearl shell inside', materials: ['rock', 'sea water', 'shell'], colors: ['wet slate', 'turquoise water', 'pearl white'] },
  'shore-cotton': { hook: 'a dune plant with fluffy white cotton bolls', materials: ['dune grass', 'cotton'], colors: ['dune green', 'sand gold', 'cotton white'] },
  'shore-shells': { hook: 'a bed of orange crab shells half buried in wet sand', materials: ['shells', 'sand'], colors: ['coral orange', 'wet sand', 'turquoise'] },
  'desert-cotton': { hook: 'a dry desert bush with puffs of white cotton', materials: ['dry twigs', 'cotton'], colors: ['dust olive', 'sand ochre', 'cotton white'] },
  'desert-amber': { hook: 'a sandstone ledge with golden drops of amber seeping from it', materials: ['sandstone', 'amber'], colors: ['sandstone pink', 'amber gold', 'sun white'] },
  'desert-gold': { hook: 'a sand-scoured boulder with bright veins of gold', materials: ['stone', 'gold'], colors: ['sun-bleached tan', 'gold', 'deep shadow brown'] },
  'desert-acacia': { hook: 'a small twisted dry acacia with a few broken branches', materials: ['hard wood', 'thorns'], colors: ['grey-brown wood', 'sand ochre', 'dusty green'] },
  'frostpeak-pine': { hook: 'a young snow-dusted pine with a fallen bough at its foot', materials: ['pine', 'snow'], colors: ['dark pine green', 'snow white', 'resin amber'] },
  'frostpeak-ice': { hook: 'a cluster of pale blue ice crystals jutting from the snow', materials: ['ice', 'snow'], colors: ['pale ice blue', 'deep cold blue', 'white sparkle'] },
  'frostpeak-silver': { hook: 'a frosted grey rock with bright silver veins', materials: ['stone', 'silver'], colors: ['slate grey', 'bright silver', 'frost blue'] },
  'frostpeak-snowbell': { hook: 'a patch of small white bell flowers poking through snow', materials: ['flowers', 'snow'], colors: ['snow white', 'pale green', 'icy blue'] },
  'hollow-mycelium': { hook: 'a pale web of mushroom threads spread over a rotting log', materials: ['mycelium', 'old wood'], colors: ['pale cream', 'violet soil', 'soft glow'] },
  'hollow-shelf': { hook: 'a stump with wide shelf fungus growing in steps', materials: ['fungus', 'wood'], colors: ['tan fungus', 'dark violet', 'pale orange'] },
  'hollow-amethyst': { hook: 'a split stone geode full of violet crystals', materials: ['stone', 'amethyst'], colors: ['dark violet', 'bright amethyst', 'soft glow'] },
  'hollow-truffle': { hook: 'a little dug hollow in violet soil with black knobbly truffles', materials: ['soil', 'truffles'], colors: ['violet soil', 'truffle black', 'moss green'] },
};

/** One picture per kind of spot, by its art id (`spot-<kind>`). */
export const GATHER_SPOT_ANCHORS: TieredAsset[] = Object.entries(SPOTS).map(([kind, def]) => {
  const look = LOOKS[kind] ?? { hook: def.name.toLowerCase(), materials: [], colors: ['', '', ''] as [string, string, string] };
  return {
    id: def.art, name: def.name, kind: 'prop', biome: def.biome, references: ['woods-mushroom'],
    silhouetteHook: look.hook,
    body: 'a small thing standing on one ground tile, about knee high, seen from the isometric camera', materials: look.materials,
    colors: { main: look.colors[0], secondary: look.colors[1], accent: look.colors[2] },
    details: ['sits on the ground with a soft shadow'], mood: 'inviting, worth a closer look', extra: { category: 'gathering spot' },
  };
});
