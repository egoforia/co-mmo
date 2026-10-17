import type { AssetDescription } from './style.ts';

/**
 * The launch lands' new set pieces, creatures, people and treasures (shared
 * places.ts and lands.ts), and the plank bridge where roads cross water.
 * Each is painted beside an approved anchor of its land, so it matches.
 */
export const LAND_ANCHORS: (AssetDescription & { id: string; references?: string[] })[] = [
  // Shared
  {
    id: 'bridge-planks', name: 'Plank bridge', kind: 'tile', biome: 'any', references: ['woods-path', 'sanctum-pond'],
    silhouetteHook: 'weathered wooden planks laid side by side, seen from straight above', body: 'flat walkable deck of planks running left to right, filling the whole tile',
    materials: ['old wood', 'iron nails'], colors: { main: 'warm honey brown', secondary: 'grey weathered wood', accent: 'dark iron nail heads' },
    details: ['thin dark gaps between planks', 'a few knots'], mood: 'sturdy, inviting',
  },

  // The Sanctum
  {
    id: 'sanctum-standing-stones', name: 'Ring of standing stones', kind: 'set-piece', biome: 'sanctum', references: ['sanctum-shrine'],
    silhouetteHook: 'a half circle of tall rough grey standing stones with glowing violet runes, one fallen stone across two others',
    body: 'five stones each twice a person\'s height, wide low arrangement', materials: ['granite', 'moss', 'rune light'],
    colors: { main: 'blue-grey stone', secondary: 'clover green moss', accent: 'violet rune glow' }, details: ['wildflowers at their feet', 'small floating light motes'], mood: 'ancient, mysterious',
  },
  {
    id: 'sanctum-fountain', name: 'Fountain of the Pilgrims', kind: 'set-piece', biome: 'sanctum', references: ['sanctum-shrine'],
    silhouetteHook: 'a round white marble fountain with a small statue of a robed pilgrim pouring water from a jar',
    body: 'low round basin about as wide as two people, the statue in the middle', materials: ['white marble', 'clear water', 'gold'],
    colors: { main: 'cream white', secondary: 'sky blue water', accent: 'pale gold trim' }, details: ['coins glinting in the water', 'rose petals floating'], mood: 'peaceful, welcoming',
  },
  {
    id: 'sanctum-bell-tower', name: 'Old bell tower', kind: 'set-piece', biome: 'sanctum', references: ['sanctum-shrine'],
    silhouetteHook: 'a tall slender ruined stone bell tower with a great bronze bell hanging in its open top',
    body: 'narrow square tower about five people tall, crumbling at one corner', materials: ['pale stone', 'bronze', 'ivy'],
    colors: { main: 'cream stone', secondary: 'green copper bell', accent: 'warm lantern gold' }, details: ['ivy climbing up', 'glowing moths around the bell'], mood: 'lonely, beautiful',
  },
  {
    id: 'sanctum-lantern-moth', name: 'Lantern Moth', kind: 'monster', biome: 'sanctum', references: ['sanctum-pilgrim'],
    silhouetteHook: 'a fluffy moth as big as a cat whose round belly glows like a paper lantern',
    body: 'round fuzzy body, four wide soft wings, feathery antennae, big dark gentle eyes', materials: ['fuzz', 'wing dust'],
    colors: { main: 'cream white', secondary: 'pale lilac wings', accent: 'warm golden belly glow' }, details: ['sparkling dust falling from the wings'], mood: 'gentle, shy', extra: { threat: 'harmless', movement: 'flutter' },
  },
  {
    id: 'sanctum-bell-keeper', name: 'Brother Tolle', kind: 'npc', biome: 'sanctum', references: ['sanctum-pilgrim'],
    silhouetteHook: 'a round little monk with a big bronze hand bell held against his chest',
    body: 'small, 3 heads tall, bald head with a white fringe, cheerful face, empty other hand', materials: ['brown wool robe', 'rope belt', 'bronze'],
    colors: { main: 'chestnut brown', secondary: 'cream', accent: 'bronze' }, details: ['a ring of keys on his belt', 'sandals'], mood: 'jolly, kind', extra: { role: 'temple bell keeper' },
  },

  // Whispering Woods
  {
    id: 'woods-fairy-ring', name: 'Fairy ring', kind: 'set-piece', biome: 'whispering-woods', references: ['woods-tree-house'],
    silhouetteHook: 'a wide ring of tall glowing teal and pink mushrooms around a patch of soft moss',
    body: 'low wide circle of mushrooms, some as tall as a child', materials: ['mushroom', 'moss', 'fairy light'],
    colors: { main: 'teal', secondary: 'soft pink', accent: 'firefly yellow sparkles' }, details: ['tiny lights dancing in the middle'], mood: 'magical, playful',
  },
  {
    id: 'woods-fallen-giant', name: 'Fallen giant tree', kind: 'set-piece', biome: 'whispering-woods', references: ['woods-tree-house'],
    silhouetteHook: 'an enormous fallen hollow tree trunk lying on its side, so big you could walk inside it',
    body: 'very long and wide log lying left to right, torn roots at one end', materials: ['bark', 'moss', 'ferns'],
    colors: { main: 'bark brown', secondary: 'deep teal-green moss', accent: 'russet mushrooms' }, details: ['ferns growing along the top', 'a dark hollow at one end'], mood: 'ancient, quiet',
  },
  {
    id: 'woods-castle-gate', name: 'Mossgate ruin', kind: 'set-piece', biome: 'whispering-woods', references: ['woods-tree-house'],
    silhouetteHook: 'a ruined stone gatehouse arch swallowed by a giant tree, roots wrapping the stones',
    body: 'broad stone arch with two broken towers, about four people tall', materials: ['grey stone', 'roots', 'moss'],
    colors: { main: 'grey-green stone', secondary: 'bark brown roots', accent: 'faded green banner' }, details: ['a rusted portcullis', 'glowing mushrooms in the cracks'], mood: 'forgotten, grand',
  },
  {
    id: 'woods-thorn-wolf', name: 'Thorn Wolf', kind: 'monster', biome: 'whispering-woods', references: ['woods-mushroom'],
    silhouetteHook: 'a lean grey wolf with a mane of curling bramble thorns down its back',
    body: 'four legs, long snout, glowing amber eyes, bushy tail', materials: ['fur', 'thorny vines'],
    colors: { main: 'slate grey', secondary: 'dark bramble green', accent: 'amber eyes' }, details: ['tiny red berries in the thorns'], mood: 'fierce, wild', extra: { threat: 'dangerous in packs', movement: 'lope' },
  },
  {
    id: 'woods-bark-golem', name: 'Bark Golem', kind: 'monster', biome: 'whispering-woods', references: ['woods-mushroom'],
    silhouetteHook: 'a hulking figure made of living bark and roots with a glowing amber knot in its chest',
    body: 'broad heavy body, long arms down to the ground, short legs, small glowing eyes', materials: ['bark', 'moss', 'stone'],
    colors: { main: 'dark bark brown', secondary: 'teal moss', accent: 'amber heart glow' }, details: ['a little bird nest on one shoulder'], mood: 'slow, mighty', extra: { threat: 'tough guardian', movement: 'heavy stomp' },
  },
  {
    id: 'woods-old-knight', name: 'Sir Alder', kind: 'npc', biome: 'whispering-woods', references: ['woods-herbalist'],
    silhouetteHook: 'an old knight in dented green-tinted armour with a long white moustache and a tattered green cape',
    body: 'tall and thin, 3 heads tall, helmet tucked under one arm, empty other hand', materials: ['steel armour', 'wool cape'],
    colors: { main: 'mossy steel', secondary: 'forest green', accent: 'gold oak-leaf crest' }, details: ['a leaf crest on the breastplate', 'patched cape'], mood: 'proud, weary, noble', extra: { role: 'last knight of Mossgate' },
  },

  // Sunlit Shore
  {
    id: 'shore-shipwreck', name: 'Shipwreck', kind: 'set-piece', biome: 'sunlit-shore', references: ['shore-lighthouse'],
    silhouetteHook: 'a big broken pirate ship lying tilted on the sand with a snapped mast and torn sails',
    body: 'long wooden hull on its side, wide and low', materials: ['old wood', 'canvas', 'rope'],
    colors: { main: 'driftwood brown', secondary: 'faded cream sails', accent: 'coral red flag' }, details: ['barnacles on the hull', 'gulls perched on the mast'], mood: 'adventurous, eerie',
  },
  {
    id: 'shore-giant-shell', name: 'Giant spiral shell', kind: 'set-piece', biome: 'sunlit-shore', references: ['shore-lighthouse'],
    silhouetteHook: 'an enormous pink spiral seashell as big as a house, half sunk in sand',
    body: 'wide spiral shell with its opening facing the viewer', materials: ['shell', 'sand'],
    colors: { main: 'coral pink', secondary: 'sand cream', accent: 'pearly white' }, details: ['tiny crabs around it', 'starfish on the side'], mood: 'wondrous, sunny',
  },
  {
    id: 'shore-tide-shrine', name: 'Tide shrine', kind: 'set-piece', biome: 'sunlit-shore', references: ['shore-lighthouse'],
    silhouetteHook: 'a small shrine of stacked white stones with a big blue glass orb held in a carved wave',
    body: 'narrow, about two people tall', materials: ['white stone', 'sea glass', 'rope'],
    colors: { main: 'white stone', secondary: 'turquoise glass', accent: 'coral offerings' }, details: ['shells and flowers left as offerings'], mood: 'calm, holy',
  },
  {
    id: 'shore-gull-raider', name: 'Gull Raider', kind: 'monster', biome: 'sunlit-shore', references: ['shore-crab-knight'],
    silhouetteHook: 'a big grey and white seagull wearing a red pirate bandana and an eye patch',
    body: 'stout bird standing on webbed feet, wings half open, mean beak', materials: ['feathers', 'cloth'],
    colors: { main: 'grey', secondary: 'white', accent: 'red bandana' }, details: ['a stolen gold coin in its beak'], mood: 'cheeky, greedy', extra: { threat: 'normal, in flocks', movement: 'hop and flap' },
  },
  {
    id: 'shore-hermit-crab', name: 'Hermit Crab', kind: 'monster', biome: 'sunlit-shore', references: ['shore-crab-knight'],
    silhouetteHook: 'a tiny shy crab peeking out of a spiral shell far too big for it',
    body: 'small orange crab, big shell on its back, nervous eyes on stalks', materials: ['shell'],
    colors: { main: 'pale turquoise shell', secondary: 'orange crab', accent: 'pink spots' }, details: ['a little seaweed on the shell'], mood: 'shy, cute', extra: { threat: 'harmless', movement: 'scuttle sideways' },
  },
  {
    id: 'shore-drowned-deckhand', name: 'Drowned Deckhand', kind: 'monster', biome: 'sunlit-shore', references: ['shore-crab-knight'],
    silhouetteHook: 'a ghostly sailor made of seaweed and knotted rope with glowing green eyes and a striped shirt',
    body: 'tall thin figure, hunched, dripping, holding a rusty boat hook', materials: ['seaweed', 'rope', 'wet cloth'],
    colors: { main: 'murky green', secondary: 'faded blue and white stripes', accent: 'ghostly green glow' }, details: ['a small crab on its shoulder'], mood: 'spooky, sad', extra: { threat: 'normal', movement: 'shamble' },
  },
  {
    id: 'shore-sea-queen', name: 'Queen Nerissa', kind: 'npc', biome: 'sunlit-shore', references: ['shore-trader'],
    silhouetteHook: 'a regal sea queen with a tall crown of coral branches and long flowing aqua hair',
    body: '3 heads tall, gown of pearly scales flowing to the ground, hands folded in front', materials: ['scale silk', 'coral', 'pearls'],
    colors: { main: 'aqua', secondary: 'pearly white', accent: 'coral red' }, details: ['a necklace of pearls', 'tiny shells in her hair'], mood: 'graceful, wise', extra: { role: 'queen of the Coral Palace' },
  },

  // Mirage Desert
  {
    id: 'desert-pyramid', name: 'Pyramid of the Sun King', kind: 'set-piece', biome: 'mirage-desert', references: ['desert-ruin'],
    silhouetteHook: 'a great stepped sandstone pyramid with a golden capstone and a dark doorway at its foot',
    body: 'wide stepped pyramid, much wider than tall', materials: ['sandstone', 'gold'],
    colors: { main: 'warm sandstone', secondary: 'dusty ochre', accent: 'shining gold capstone' }, details: ['stone lion statues by the door', 'sand drifted up the sides'], mood: 'majestic, ancient',
  },
  {
    id: 'desert-obelisk', name: 'Sun obelisk', kind: 'set-piece', biome: 'mirage-desert', references: ['desert-ruin'],
    silhouetteHook: 'a very tall narrow stone obelisk covered in carved sun symbols with a gold tip',
    body: 'thin four-sided pillar about six people tall on a square base', materials: ['red granite', 'gold'],
    colors: { main: 'rose granite', secondary: 'sand', accent: 'gold tip' }, details: ['cracks and a little sand at the base'], mood: 'proud, timeless',
  },
  {
    id: 'desert-wyrm-bones', name: 'Wyrm bones', kind: 'set-piece', biome: 'mirage-desert', references: ['desert-ruin'],
    silhouetteHook: 'the huge bleached ribcage and skull of a giant serpent half buried in the dunes',
    body: 'long line of tall curved ribs with a great horned skull at one end', materials: ['bone', 'sand'],
    colors: { main: 'bone white', secondary: 'sand gold', accent: 'faint turquoise crystals' }, details: ['sand pouring between the ribs'], mood: 'eerie, awe-inspiring',
  },
  {
    id: 'desert-dune-jackal', name: 'Dune Jackal', kind: 'monster', biome: 'mirage-desert', references: ['desert-scarab'],
    silhouetteHook: 'a lean sand-coloured jackal with huge pointed ears and a turquoise beaded collar',
    body: 'four long legs, slim body, long snout, sly eyes', materials: ['fur', 'beads'],
    colors: { main: 'sand gold', secondary: 'dark brown back stripe', accent: 'turquoise collar' }, details: ['a gold ring in one ear'], mood: 'sly, hungry', extra: { threat: 'dangerous in packs', movement: 'lope' },
  },
  {
    id: 'desert-mummy-guard', name: 'Mummy Guard', kind: 'monster', biome: 'mirage-desert', references: ['desert-scarab'],
    silhouetteHook: 'a tall mummy wrapped in old linen wearing a golden mask and holding a curved spear',
    body: 'tall stiff figure, loose bandage ends trailing', materials: ['linen', 'gold', 'bronze'],
    colors: { main: 'dusty cream linen', secondary: 'gold mask', accent: 'turquoise eyes' }, details: ['a scarab brooch on the chest'], mood: 'grim, dutiful', extra: { threat: 'normal', movement: 'stiff march' },
  },
  {
    id: 'desert-sand-wyrm', name: 'Sand Wyrm', kind: 'monster', biome: 'mirage-desert', references: ['desert-scarab'],
    silhouetteHook: 'a huge armoured sand worm rearing up out of the sand with a round mouth of teeth',
    body: 'thick segmented body, big plated head, the rest of it under the sand', materials: ['bronze-like scales', 'sand'],
    colors: { main: 'bronze', secondary: 'sand gold', accent: 'glowing orange mouth' }, details: ['sand spraying around it'], mood: 'terrifying, mighty', extra: { threat: 'very dangerous', movement: 'burrow and lunge' },
  },
  {
    id: 'desert-sultana', name: 'Sultana Zahra', kind: 'npc', biome: 'mirage-desert', references: ['desert-cactus-folk'],
    silhouetteHook: 'an elegant sultana with a tall jewelled turban with a peacock feather and flowing silk robes',
    body: '3 heads tall, confident pose, hands together in front', materials: ['silk', 'gold', 'jewels'],
    colors: { main: 'saffron', secondary: 'deep red', accent: 'turquoise jewels' }, details: ['gold bangles', 'embroidered sash'], mood: 'regal, warm', extra: { role: 'ruler of the desert palace' },
  },

  // Treasures from the new creatures, shops and quests
  item('item-moth-dust', 'Moth Dust', 'a little glass vial of softly glowing golden powder', 'vial with a cork', ['glass', 'glowing dust'], { main: 'warm gold', secondary: 'clear glass', accent: 'lilac sparkle' }, 'material', 'sanctum-lantern-moth'),
  item('item-temple-lantern', 'Temple Lantern', 'a brass temple lantern with amber glass panes and a warm flame inside', 'lantern with a carrying ring on top', ['brass', 'amber glass'], { main: 'brass', secondary: 'amber glow', accent: 'violet tassel' }, 'off-hand light', 'item-tonic'),
  item('item-wolf-pelt', 'Thorn Wolf Pelt', 'a folded grey wolf pelt with little thorns along one edge', 'folded fur', ['fur', 'thorns'], { main: 'slate grey', secondary: 'pale grey', accent: 'bramble green thorns' }, 'material', 'woods-thorn-wolf'),
  item('item-heartwood', 'Golem Heartwood', 'a knot of amber wood glowing from inside', 'chunk of wood', ['wood', 'amber light'], { main: 'bark brown', secondary: 'amber', accent: 'glow' }, 'material', 'woods-bark-golem'),
  item('item-golem-club', 'Golem Club', 'a heavy club made from a gnarled branch with moss and an amber knot', 'big club, handle at the bottom', ['wood', 'moss'], { main: 'dark bark brown', secondary: 'teal moss', accent: 'amber glow' }, 'weapon', 'woods-bark-golem'),
  item('item-gull-feather', 'Gull Feather', 'a long grey and white feather', 'single feather lying diagonally', ['feather'], { main: 'grey', secondary: 'white', accent: 'black tip' }, 'material', 'shore-gull-raider'),
  item('item-pearl', 'Pearl', 'a round shining pearl resting in an open little shell', 'small shell holding a pearl', ['pearl', 'shell'], { main: 'pearly white', secondary: 'pink shimmer', accent: 'sand' }, 'material', 'item-tonic'),
  item('item-coral-spear', 'Coral Spear', 'a spear with a shaft of driftwood and a sharp red coral head', 'long spear lying diagonally', ['coral', 'driftwood', 'rope'], { main: 'coral red', secondary: 'driftwood', accent: 'turquoise bead' }, 'weapon', 'item-crab-lance'),
  item('item-jackal-fang', 'Jackal Fang', 'a long curved fang on a turquoise cord', 'fang pendant', ['bone', 'cord'], { main: 'bone white', secondary: 'turquoise', accent: 'gold bead' }, 'material', 'desert-dune-jackal'),
  item('item-ancient-linen', 'Ancient Linen', 'a rolled bundle of old golden linen tied with a cord', 'cloth roll', ['linen', 'cord'], { main: 'dusty cream', secondary: 'faded gold', accent: 'turquoise thread' }, 'material', 'desert-mummy-guard'),
  item('item-wyrm-scale', 'Wyrm Scale', 'a large bronze-coloured scale shaped like a shield', 'single scale', ['scale'], { main: 'bronze', secondary: 'sand gold', accent: 'orange sheen' }, 'material', 'desert-sand-wyrm'),
  item('item-sunstone-amulet', 'Sunstone Amulet', 'a golden sun-shaped amulet with a glowing orange stone in the middle', 'pendant on a chain', ['gold', 'sunstone'], { main: 'gold', secondary: 'orange stone', accent: 'turquoise' }, 'charm', 'item-scarab-charm'),
  item('item-pelt-cloak', 'Thorn Pelt Cloak', 'a folded hooded grey fur cloak with a thorny collar and a wooden clasp', 'folded cloak, hood on top', ['fur', 'leather', 'wood'], { main: 'slate grey', secondary: 'brown leather', accent: 'bramble green' }, 'armour', 'item-traveller-coat'),
];

/** A treasure's description, painted beside the item style anchor and what it comes from. */
function item(
  id: string, name: string, hook: string, body: string, materials: string[],
  colors: AssetDescription['colors'], category: string, from: string,
): AssetDescription & { id: string; references: string[] } {
  return {
    id, name, kind: 'item', biome: 'any', references: ['item-tonic', from],
    silhouetteHook: hook, body, materials, colors, mood: 'treasured, inviting', extra: { category },
  };
}
