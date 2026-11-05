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
  {
    id: 'frostpeak-rime-stalker', name: 'Rime Stalker', kind: 'monster', biome: 'frostpeak', tier: 'medium', references: ['zephyr-falcon', 'woods-thorn-wolf'],
    silhouetteHook: 'a sleek quadrupedal predator made of razor-sharp ice crystals and white rime, stalking low',
    body: 'four feline legs with ice-shard claws, crystalline spinal crest, glowing blue slit eyes', materials: ['ice', 'permafrost', 'crystal'],
    colors: { main: 'pale glacial blue', secondary: 'deep indigo ice', accent: 'white frost highlights' },
    details: ['frost fog rolling from its breath', 'faceted crystalline tail'], mood: 'predatory, silent', extra: { threat: 'fast and strikes from shadows', movement: 'prowl' },
  },
  {
    id: 'frostpeak-deep-matriarch', name: 'Deep Crag Matriarch', kind: 'monster', biome: 'frostpeak', tier: 'high', references: ['frostpeak-crag-ram'],
    silhouetteHook: 'an enormous shaggy subterranean ram with sweeping silver-veined curled horns and a frosted stone hide',
    body: 'massive muscular build, thick woolly dreadlocks, heavy slate-grey hooves', materials: ['stone-wool', 'silver', 'slate horn'],
    colors: { main: 'charcoal slate wool', secondary: 'shining silver horn veins', accent: 'amber eyes' },
    details: ['crystals encrusted in its horns', 'silver dust around its hooves'], mood: 'territorial, ancient', extra: { threat: 'subterranean brute', movement: 'heavy charge' },
  },
  {
    id: 'frostpeak-kaen', name: 'Talon-Mason Kaen', kind: 'npc', biome: 'frostpeak', references: ['zephyr-falcon'],
    silhouetteHook: 'a burly falconfolk mason in a heavy leather apron, holding a silver chisel and heavy stone mallet',
    body: 'broad-shouldered raptor beastfolk, dust-dusted slate pinions, keen focused expression', materials: ['hardened leather', 'silver steel', 'white marble dust'],
    colors: { main: 'marble white dust', secondary: 'tan apron', accent: 'silver chisel' },
    details: ['stone dust in his feathers', 'leather pouch of precision carving chisels'], mood: 'stoic, craftsman', extra: { role: 'Master mason of Whiteledge' },
  },
  {
    id: 'frostpeak-kip', name: 'Kip the Spelunker', kind: 'npc', biome: 'frostpeak', references: ['zephyr-falcon'],
    silhouetteHook: 'a young, agile falconfolk delver wearing a strapped miner harness and climbing spikes, holding a frost-lantern',
    body: 'lean birdfolk scout, goggles pushed up onto forehead, rope coils across chest', materials: ['climbing leather', 'brass lantern', 'coiled hemp'],
    colors: { main: 'rust brown leather', secondary: 'brass lantern glow', accent: 'falcon gold' },
    details: ['chalk marks on talons', 'a pickaxe slung across the back'], mood: 'eager, reckless', extra: { role: 'Cave explorer and delve guide' },
  },
  {
    id: 'frostpeak-sula', name: 'Sula the Feather-Weaver', kind: 'npc', biome: 'frostpeak', references: ['zephyr-falcon'],
    silhouetteHook: 'an elegant falconfolk artisan in a layered wool-and-plume mantle, holding a bone shuttle needle',
    body: 'graceful posture, slender wings tucked into embroidered sleeves, spectacles tied with silk cord', materials: ['mountain wool', 'woven plumes', 'bone'],
    colors: { main: 'cream fleece', secondary: 'pale sky-blue embroidery', accent: 'golden silk threads' },
    details: ['skeins of wool tucked at her sash', 'silver hair needles'], mood: 'focused, artistic', extra: { role: 'Master weaver of Mount Zephyr' },
  },
  {
    id: 'frostpeak-aurius', name: 'Elder Aurius the Keen', kind: 'npc', biome: 'frostpeak', references: ['zephyr-falcon'],
    silhouetteHook: 'a stately Falcon elder holding a tall staff crowned with an ancient brass wind-dial and celestial astrolabe',
    body: 'long silver-tipped flight feathers, regal carriage, deep hooded mantle of First Watch crests', materials: ['deep navy wool', 'polished brass', 'mother-of-pearl'],
    colors: { main: 'deep midnight navy', secondary: 'polished brass', accent: 'white crest' },
    details: ['wind-tassels flowing from his staff', 'inlaid star maps along his hem'], mood: 'wise, vigilant', extra: { role: 'High council elder of the Eyrie' },
  },
  {
    id: 'frostpeak-vail', name: 'Watcher Vail', kind: 'npc', biome: 'frostpeak', references: ['zephyr-falcon'],
    silhouetteHook: 'a wind-battered Falcon sentry standing at a high precipice wrapped in a tattered sentinel cloak, holding a longbow',
    body: 'lean weathered stance, feathers ruffled by high winds, sharp eyes scanning northern drifts', materials: ['wind-hardened wool', 'yew bow', 'silver watchman band'],
    colors: { main: 'storm grey', secondary: 'frost white', accent: 'falcon yellow eyes' },
    details: ['a silver brazier smoking at his side', 'quiver with roc-feathered arrows'], mood: 'solitary, unwavering', extra: { role: 'Sentinel of the Crown' },
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
