import type { TieredAsset } from './skill-anchors.ts';

// Frostpeak's and Mushroom Hollow's creatures and people (gather and craft
// plan, step 1), described for the painter. None ships with the game: each is
// painted the first time from the Art tab (home-land-art.ts says at what size).

/** The two lands' creatures and people, each painted beside an approved anchor so it matches. */
export const HOME_LAND_ANCHORS: TieredAsset[] = [
  // Frostpeak
  {
    id: 'frostpeak-snow-hare', name: 'Snow Hare', kind: 'monster', biome: 'frostpeak', tier: 'small', references: ['woods-mushroom', 'zephyr-falcon'],
    silhouetteHook: 'a round fluffy white hare with ears as long as its body, mid-hop',
    body: 'small round body, big hind feet, short puff tail, dark shiny eyes', materials: ['thick winter fur'],
    colors: { main: 'snow white', secondary: 'pale blue-grey shadow', accent: 'soft pink nose and ear insides' },
    details: ['a little snow on its back'], mood: 'shy, quick', extra: { threat: 'harmless', movement: 'hop' },
  },
  {
    id: 'frostpeak-crag-ram', name: 'Crag Ram', kind: 'monster', biome: 'frostpeak', tier: 'medium', references: ['woods-mushroom', 'shore-crab-knight'],
    silhouetteHook: 'a shaggy mountain ram with huge curled stone-grey horns, head lowered to charge',
    body: 'four sturdy legs, thick grey fleece, broad chest, small hooves', materials: ['wool', 'horn'],
    colors: { main: 'warm grey fleece', secondary: 'slate horn', accent: 'icy blue eyes' },
    details: ['icicles in its fleece', 'a frosty breath puff'], mood: 'stubborn, fierce', extra: { threat: 'charges anyone who comes close', movement: 'trot' },
  },
  {
    id: 'frostpeak-ice-wisp', name: 'Ice Wisp', kind: 'monster', biome: 'frostpeak', tier: 'small', references: ['sanctum-lantern-moth'],
    silhouetteHook: 'a floating knot of cold blue light around a jagged heart of ice, trailing frosty wisps',
    body: 'no legs, a hovering glowing shape about as big as a child, two small pale eyes', materials: ['ice', 'cold light'],
    colors: { main: 'pale ice blue', secondary: 'deep cold blue', accent: 'white sparkles' },
    details: ['tiny snowflakes falling from it'], mood: 'eerie, cold', extra: { threat: 'dangerous at night', movement: 'drift' },
  },
  {
    id: 'frostpeak-hoarfrost-roc', name: 'Hoarfrost Roc', kind: 'monster', biome: 'frostpeak', tier: 'colossal', references: ['zephyr-falcon', 'desert-sand-wyrm'],
    silhouetteHook: 'an enormous white bird of prey with frost-rimed wings half spread, standing on its nest',
    body: 'great hooked beak, powerful talons, long tail feathers, a crest of icy plumes', materials: ['feathers', 'frost', 'ice'],
    colors: { main: 'frost white', secondary: 'pale silver-blue', accent: 'gold eyes and beak' },
    details: ['icicles hanging from its wing edges', 'a faded old guardian band on one leg'], mood: 'majestic, lost', extra: { threat: 'a boss, very dangerous', movement: 'stalks and beats its wings' },
  },
  {
    id: 'frostpeak-ysolde', name: 'Ysolde', kind: 'npc', biome: 'frostpeak', references: ['zephyr-falcon'],
    silhouetteHook: 'an old Falcon elder wrapped in a thick felt cloak, leaning on a tall carved staff topped with a feather',
    body: 'a tall lean falconfolk woman, grey-speckled feathers, sharp kind eyes, empty other hand', materials: ['felt', 'mountain wool', 'carved wood'],
    colors: { main: 'slate grey-blue felt', secondary: 'cream wool', accent: 'falcon yellow' },
    details: ['a string of ice-blue beads', 'snow on her shoulders'], mood: 'watchful, warm', extra: { role: 'Falcon elder of Frostpeak' },
  },
  // Mushroom Hollow
  {
    id: 'hollow-spore-puff', name: 'Spore Puff', kind: 'monster', biome: 'mushroom-hollow', tier: 'small', references: ['woods-mushroom'],
    silhouetteHook: 'a round lilac puffball on two stubby legs, a little cloud of spores puffing from its top',
    body: 'round soft body, tiny legs, two sleepy dot eyes', materials: ['puffball skin', 'spores'],
    colors: { main: 'lilac', secondary: 'dusty plum', accent: 'cyan glowing spores' },
    details: ['a few spores floating around it'], mood: 'shy, silly', extra: { threat: 'harmless', movement: 'waddle' },
  },
  {
    id: 'hollow-glowcap-beetle', name: 'Glowcap Beetle', kind: 'monster', biome: 'mushroom-hollow', tier: 'small', references: ['desert-scarab', 'woods-mushroom'],
    silhouetteHook: 'a beetle as big as a dog with a glowing magenta mushroom growing from its shell',
    body: 'six legs, round shiny shell, short horn, the mushroom cap on its back', materials: ['chitin', 'mushroom'],
    colors: { main: 'deep violet shell', secondary: 'magenta cap', accent: 'cyan glow' },
    details: ['glowing spots on the cap'], mood: 'busy, menacing', extra: { threat: 'dangerous in swarms', movement: 'scuttle' },
  },
  {
    id: 'hollow-mycelid', name: 'Mycelid Stalker', kind: 'monster', biome: 'mushroom-hollow', tier: 'high', references: ['woods-bark-golem', 'woods-mushroom'],
    silhouetteHook: 'a tall thin figure of woven pale mushroom threads with a small cap for a head',
    body: 'long thin arms and legs of twisted threads, no face but two faint glowing eyes', materials: ['mycelium threads', 'mushroom'],
    colors: { main: 'pale cream threads', secondary: 'dusky violet', accent: 'cyan eyes' },
    details: ['loose threads trailing from its feet'], mood: 'silent, unsettling', extra: { threat: 'strikes anyone in its way', movement: 'long slow strides' },
  },
  {
    id: 'hollow-rootless-king', name: 'Rootless King', kind: 'monster', biome: 'mushroom-hollow', tier: 'colossal', references: ['woods-mushroom', 'woods-bark-golem'],
    silhouetteHook: 'a giant walking mushroom with a broad cracked cap and a crown of shelf fungus, torn roots dangling under it',
    body: 'a huge stalk body with two thick arms, roots for feet, a sad furious face under the cap', materials: ['mushroom flesh', 'shelf fungus', 'roots'],
    colors: { main: 'rose magenta cap', secondary: 'cream stalk', accent: 'cyan glow fading in the cracks' },
    details: ['broken threads hanging from its roots', 'spores drifting off its crown'], mood: 'tragic, wrathful', extra: { threat: 'a boss, very dangerous', movement: 'lumbers' },
  },
  {
    id: 'hollow-mother-morel', name: 'Mother Morel', kind: 'npc', biome: 'mushroom-hollow', references: ['sylvan-cervid'],
    silhouetteHook: 'an old Cervid wise woman with velvet antlers hung with tiny mushrooms, carrying a woven basket',
    body: 'a small stooped deerfolk woman, soft brown fur, gentle eyes, the basket in one hand, the other empty', materials: ['woven mushroom cloth', 'basket', 'velvet antlers'],
    colors: { main: 'mossy brown robe', secondary: 'lilac shawl', accent: 'cyan glowing mushrooms' },
    details: ['a pair of round spectacles', 'spores in her shawl'], mood: 'gentle, wise', extra: { role: 'Cervid elder of Mushroom Hollow' },
  },
];
