import type { AssetDescription } from './style.ts';

/**
 * The first reference set (Style Bible, Open decisions): the Sanctum and the
 * three launch biomes, plus players and items. Once reviewed, these images are
 * sent as references with every generation so new assets match them.
 */
export const ANCHORS: (AssetDescription & { id: string })[] = [
  // The Sanctum
  {
    id: 'sanctum-flagstones', name: 'Sanctum flagstones', kind: 'tile', biome: 'sanctum',
    silhouetteHook: 'worn pale flagstones of mixed sizes in an irregular random-laid pattern', body: 'flat ground, stones with rounded edges, all about the same scale',
    materials: ['pale stone', 'moss'], colors: { main: 'cream', secondary: 'pale gold', accent: 'clover green' },
    details: ['tufts of clover between stones', 'a few small cracks'], mood: 'peaceful, sacred',
  },
  {
    id: 'sanctum-shrine', name: 'Shrine of the God', kind: 'set-piece', biome: 'sanctum',
    silhouetteHook: 'a glowing golden orb floating above a round white pedestal',
    body: 'round stepped pedestal with carved arches, about twice a person\'s height',
    materials: ['white marble', 'gold'], colors: { main: 'cream white', secondary: 'pale gold', accent: 'soft rose' },
    details: ['rose vines climbing the steps', 'light motes around the orb'], mood: 'holy, welcoming',
  },
  {
    id: 'sanctum-pilgrim', name: 'Sister Amala', kind: 'npc', biome: 'sanctum',
    silhouetteHook: 'very tall pointed white hood with a gold ribbon',
    body: 'small, 3 heads tall, kind round face, hands folded', materials: ['linen', 'gold thread'],
    colors: { main: 'cream', secondary: 'pale gold', accent: 'rose' }, details: ['prayer beads', 'a small lantern'],
    mood: 'serene, kind', extra: { role: 'shrine keeper' },
  },
  // Whispering Woods
  {
    id: 'woods-moss', name: 'Mossy forest floor', kind: 'tile', biome: 'whispering-woods',
    silhouetteHook: 'thick soft moss with thin roots and fallen leaves scattered evenly', body: 'flat ground, no large roots',
    materials: ['moss', 'roots', 'fallen leaves'], colors: { main: 'deep teal-green', secondary: 'bark brown', accent: 'firefly yellow' },
    details: ['small ferns', 'scattered leaves'], mood: 'quiet, mysterious',
  },
  {
    id: 'woods-tree-house', name: 'Hollow tree house', kind: 'set-piece', biome: 'whispering-woods',
    silhouetteHook: 'a huge twisting tree with a round door and glowing windows in its trunk',
    body: 'enormous gnarled trunk, roots spreading wide, canopy of oversized leaves',
    materials: ['bark', 'wood', 'leaves'], colors: { main: 'bark brown', secondary: 'deep teal-green', accent: 'warm yellow window light' },
    details: ['a little wooden staircase around the trunk', 'hanging lantern', 'mushrooms at the roots'], mood: 'cosy, magical',
  },
  {
    id: 'woods-mushroom', name: 'Walking Mushroom', kind: 'monster', biome: 'whispering-woods',
    silhouetteHook: 'big floppy red-brown cap that bounces as it walks', body: 'small round stem body with stubby legs and sleepy eyes',
    materials: ['mushroom flesh'], colors: { main: 'russet', secondary: 'cream', accent: 'firefly yellow spots' },
    details: ['tiny root toes', 'spores puffing from the cap'], mood: 'grumpy, cute', extra: { threat: 'normal', movement: 'waddle' },
  },
  {
    id: 'woods-herbalist', name: 'Old Bramble', kind: 'npc', biome: 'whispering-woods',
    silhouetteHook: 'huge round backpack overflowing with herbs', body: 'stooped elder, long white beard tucked into a belt, round spectacles',
    materials: ['patched linen', 'wicker', 'leather'], colors: { main: 'bark brown', secondary: 'teal-green', accent: 'firefly yellow lantern' },
    details: ['lantern hanging from the pack', 'walking stick'], mood: 'kindly, absent-minded', extra: { role: 'herbalist' },
  },
  // Sunlit Shore
  {
    id: 'shore-sand', name: 'Shell-strewn sand', kind: 'tile', biome: 'sunlit-shore',
    silhouetteHook: 'soft cream sand with tiny shells scattered evenly', body: 'flat ground with gentle ripples',
    materials: ['sand', 'shells'], colors: { main: 'sand cream', secondary: 'warm beige', accent: 'coral pink' },
    details: ['tiny shells', 'a few grains of coral'], mood: 'bright, carefree',
  },
  {
    id: 'shore-lighthouse', name: 'Driftwood lighthouse', kind: 'set-piece', biome: 'sunlit-shore',
    silhouetteHook: 'a leaning, curvy lighthouse built of driftwood with a shell-shaped lamp room',
    body: 'tall rounded tower on rocks, slightly crooked', materials: ['driftwood', 'rope', 'shells'],
    colors: { main: 'weathered cream', secondary: 'turquoise', accent: 'coral pink' },
    details: ['rope railings', 'seagull on the roof', 'barnacles at the base'], mood: 'cheerful, breezy',
  },
  {
    id: 'shore-crab-knight', name: 'Crab Knight', kind: 'monster', biome: 'sunlit-shore',
    silhouetteHook: 'one giant claw held up like a shield', body: 'round crab body standing on back legs, tiny helmet',
    materials: ['shell', 'tin'], colors: { main: 'coral pink', secondary: 'sand cream', accent: 'turquoise plume' },
    details: ['a plume on the helmet', 'a toothpick lance'], mood: 'proud, comical', extra: { threat: 'normal', movement: 'sideways scuttle' },
  },
  {
    id: 'shore-trader', name: 'Marina the Trader', kind: 'npc', biome: 'sunlit-shore',
    silhouetteHook: 'wide straw sun hat decorated with shells', body: 'small, 3 heads tall, sun-tanned, cheerful wave',
    materials: ['straw', 'linen', 'shells'], colors: { main: 'turquoise', secondary: 'sand cream', accent: 'coral pink' },
    details: ['basket of fish', 'shell necklace'], mood: 'friendly, chatty', extra: { role: 'merchant' },
  },
  // Mirage Desert
  {
    id: 'desert-dunes', name: 'Rippled dunes', kind: 'tile', biome: 'mirage-desert',
    silhouetteHook: 'fine wind ripples in apricot sand', body: 'flat ground with small, evenly spaced ripples, no dunes or large shadows',
    materials: ['sand', 'clay'], colors: { main: 'apricot', secondary: 'ochre', accent: 'turquoise pebble' },
    details: ['faint cracked-clay specks', 'a few tiny turquoise pebbles'], mood: 'hot, still',
  },
  {
    id: 'desert-ruin', name: 'Half-buried dome', kind: 'set-piece', biome: 'mirage-desert',
    silhouetteHook: 'a sandstone dome half sunk in the sand with a huge stone face peeking out',
    body: 'rounded dome with arched doorway, sand drifting over it', materials: ['sandstone', 'turquoise tiles'],
    colors: { main: 'ochre', secondary: 'apricot', accent: 'turquoise tiles' },
    details: ['cracked mosaic', 'a palm beside it'], mood: 'ancient, mysterious',
  },
  {
    id: 'desert-scarab', name: 'Sun Scarab', kind: 'monster', biome: 'mirage-desert',
    silhouetteHook: 'a round shiny shell with a glowing sun disc on its back', body: 'chunky beetle with stubby legs',
    materials: ['chitin'], colors: { main: 'ochre', secondary: 'deep brown', accent: 'turquoise sheen' },
    details: ['little horn', 'sand trailing behind'], mood: 'stubborn, curious', extra: { threat: 'normal', movement: 'scuttle and roll' },
  },
  {
    id: 'desert-cactus-folk', name: 'Cactus Elder', kind: 'npc', biome: 'mirage-desert',
    silhouetteHook: 'a round cactus body with a single pink flower on top like a hat',
    body: 'small, 3 heads tall, round cactus person with stubby arms and a sleepy smile', materials: ['cactus', 'woven cloth'],
    colors: { main: 'sage green', secondary: 'apricot', accent: 'pink flower' }, details: ['woven poncho', 'tiny walking stick'],
    mood: 'wise, slow', extra: { role: 'elder' },
  },
  // Players and items
  {
    id: 'player-mara', name: 'Mara', kind: 'player', biome: 'any',
    silhouetteHook: 'oversized floppy wizard hat with a drooping tip',
    body: 'small, 3 heads tall, round face, cheerful stance, facing the viewer',
    materials: ['cloth', 'wood'], colors: { main: 'moss green', secondary: 'cream', accent: 'rose hat band' },
    details: ['short russet bob', 'crooked wooden staff with a leaf sprouting at the top', 'brown boots'], mood: 'curious, warm',
  },
  {
    id: 'player-ilya', name: 'Ilya', kind: 'player', biome: 'any',
    silhouetteHook: 'long red scarf trailing behind',
    body: 'small, 3 heads tall, sturdy build, confident stance, facing the viewer',
    materials: ['leather', 'iron'], colors: { main: 'slate blue', secondary: 'brown leather', accent: 'red scarf' },
    details: ['short sword at the hip', 'messy dark hair', 'round shield on the back'], mood: 'brave, playful',
  },
  {
    id: 'item-bible', name: 'The Bible', kind: 'item', biome: 'any',
    silhouetteHook: 'thick tome with a glowing gold sigil of the shrine\'s orb on the cover',
    body: 'heavy book, slightly open, seen at three-quarter view', materials: ['worn leather', 'brass', 'parchment'],
    colors: { main: 'oxblood leather', secondary: 'cream pages', accent: 'gold glow' },
    details: ['brass corners', 'rose ribbon bookmark', 'painted vines on the page edges'], mood: 'ancient, welcoming',
    extra: { category: 'trinket', rarity: 'Legendary' },
  },
  {
    id: 'item-tonic', name: 'Moonpetal Tonic', kind: 'item', biome: 'any',
    silhouetteHook: 'teardrop bottle with a curled glass stopper shaped like a petal',
    body: 'small potion bottle', materials: ['glass', 'cork', 'silver wire'],
    colors: { main: 'periwinkle liquid', secondary: 'blank cream tag tied with string', accent: 'blue glint' },
    details: ['tiny floating petal inside', 'wire wrapped around the neck'], mood: 'gentle, magical',
    extra: { category: 'potion', rarity: 'Rare' },
  },
  {
    id: 'item-goat-horn', name: 'Ember Goat Horn', kind: 'item', biome: 'any',
    silhouetteHook: 'a curling charcoal horn with a glowing orange tip',
    body: 'single spiral horn', materials: ['horn'], colors: { main: 'charcoal violet', secondary: 'rust orange', accent: 'lava gold glow' },
    details: ['soot marks', 'a tiny ember spark'], mood: 'warm, rugged', extra: { category: 'material', rarity: 'Common' },
  },
];
