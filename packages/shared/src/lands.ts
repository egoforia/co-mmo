import { FLAME_LIGHT } from './light.ts';
import { CREATURES, ITEMS, NPC_GREETINGS, NPC_NAMES, QUESTS, type CreatureDef, type ItemDef, type QuestDef } from './rpg.ts';
import { RECIPES, SHOPS, type RecipeDef, type ShopDef } from './kit.ts';

// What lives in the great places of the bigger lands (places.ts): their
// creatures, the people who keep them, what can be found there and the
// quests that send players out to them. Added to the shared tables when the
// game loads, in the same shapes as the first content and as wishes.

/** Stats from a level, the way wished creatures get theirs, with a little more for the hardiest. */
function creature(def: Omit<CreatureDef, 'hp' | 'damage' | 'cooldown' | 'xp' | 'gold' | 'respawnSeconds'> & { tough?: number }): CreatureDef {
  const l = def.level;
  const tough = def.tough ?? 1;
  const { tough: _t, ...rest } = def;
  return {
    ...rest,
    hp: Math.round((14 + l * 9) * tough),
    damage: Math.round((2 + l * 1.6) * Math.sqrt(tough)),
    cooldown: 1.3,
    xp: Math.round((5 + l * 5) * tough),
    gold: [l, l * 3],
    respawnSeconds: 30,
  };
}

/** The bigger lands' creatures. */
export const LAND_CREATURES: Record<string, CreatureDef> = {
  'lantern-moth': creature({
    name: 'Lantern Moth', art: 'sanctum-lantern-moth', description: 'A soft moth as big as a cat whose belly glows like a paper lantern. It flutters away from anyone who comes close.',
    behavior: 'timid', active: 'night', level: 1, speed: 3, notice: 3.5, drops: [{ item: 'moth-dust', chance: 0.7 }],
  }),
  'thorn-wolf': creature({
    name: 'Thorn Wolf', art: 'woods-thorn-wolf', description: 'A lean wolf with a mane of bramble thorns. Thorn wolves hunt the woods by night, always together.',
    behavior: 'pack', active: 'night', level: 2, speed: 3, notice: 4.5, drops: [{ item: 'wolf-pelt', chance: 0.5 }, { item: 'tonic', chance: 0.15 }],
  }),
  'bark-golem': creature({
    name: 'Bark Golem', art: 'woods-bark-golem', description: 'A hulking figure of living bark and moss that guards the road to Mossgate Castle.',
    behavior: 'guard', level: 3, speed: 1.8, notice: 3, tough: 1.6, drops: [{ item: 'heartwood', chance: 0.6 }, { item: 'golem-club', chance: 0.08 }],
  }),
  'gull-raider': creature({
    name: 'Gull Raider', art: 'shore-gull-raider', description: 'A big grey gull in a pirate bandana that swoops in with its flock to steal from travellers.',
    behavior: 'pack', active: 'day', level: 2, speed: 3.2, notice: 4, drops: [{ item: 'gull-feather', chance: 0.6 }, { item: 'pearl', chance: 0.08 }],
  }),
  'hermit-crab': creature({
    name: 'Hermit Crab', art: 'shore-hermit-crab', description: 'A shy crab in a shell far too big for it. It scuttles off sideways at the first footstep.',
    behavior: 'timid', level: 1, speed: 2.8, notice: 3, drops: [{ item: 'crab-shell', chance: 0.4 }, { item: 'pearl', chance: 0.15 }],
  }),
  'drowned-deckhand': creature({
    name: 'Drowned Deckhand', art: 'shore-drowned-deckhand', description: 'A sailor of seaweed and old rope who still walks the rounds of a ship long sunk. It wakes when the moon is up.',
    behavior: 'patrol', active: 'night', level: 4, speed: 2.2, notice: 3.5, drops: [{ item: 'pearl', chance: 0.35 }, { item: 'coral-spear', chance: 0.08 }],
  }),
  'dune-jackal': creature({
    name: 'Dune Jackal', art: 'desert-dune-jackal', description: 'A sand-coloured jackal with a turquoise collar. They lope out of the dunes after dark and hunt in packs.',
    behavior: 'pack', active: 'night', level: 3, speed: 3.1, notice: 4.5, drops: [{ item: 'jackal-fang', chance: 0.5 }, { item: 'tonic', chance: 0.15 }],
  }),
  'mummy-guard': creature({
    name: 'Mummy Guard', art: 'desert-mummy-guard', description: 'A tall guard wrapped in old linen with a golden mask, still walking its rounds for a king long gone.',
    behavior: 'patrol', active: 'night', level: 4, speed: 2, notice: 3.5, tough: 1.3, drops: [{ item: 'ancient-linen', chance: 0.6 }, { item: 'sunstone-amulet', chance: 0.05 }],
  }),
  'sand-wyrm': creature({
    name: 'Sand Wyrm', art: 'desert-sand-wyrm', description: 'A great armoured worm that sleeps under the old bones and rises at anyone who comes too near.',
    behavior: 'guard', level: 5, speed: 2.4, notice: 4, tough: 2.5, drops: [{ item: 'wyrm-scale', chance: 0.8 }, { item: 'sunstone-amulet', chance: 0.15 }],
  }),
  'crypt-skeleton': creature({
    name: 'Crypt Skeleton', art: 'desert-mummy-guard', description: 'Restless bones awakened in the cold dark catacombs beneath the High Cathedral.',
    behavior: 'patrol', level: 3, speed: 2.1, notice: 3.5, drops: [{ item: 'ancient-bone', chance: 0.6 }, { item: 'holy-water', chance: 0.2 }],
  }),
  'chained-demon': creature({
    name: 'Chained Demon', art: 'desert-sand-wyrm', description: 'An ancient terror imprisoned in the subterranean depths by celestial runes and heavy iron chains.',
    behavior: 'guard', level: 6, speed: 1.5, notice: 4, tough: 3.0, drops: [{ item: 'demon-horn', chance: 0.8 }, { item: 'sanctum-relic', chance: 0.35 }],
  }),
};

/** What can be found in the bigger lands. */
export const LAND_ITEMS: Record<string, ItemDef> = {
  'moth-dust': { name: 'Moth Dust', kind: 'material', art: 'item-moth-dust', description: 'A pinch of softly glowing powder shaken from a lantern moth\'s wings.', value: 6 },
  'temple-lantern': {
    name: 'Temple Lantern', kind: 'equipment', art: 'item-temple-lantern', slot: 'offhand', rarity: 'common', bonus: { armor: 1, spirit: 1 },
    description: 'A brass lantern from the Temple of the Hundred Bells. Carry it at night and creatures will see you coming, but so will you.', value: 20,
    light: { ...FLAME_LIGHT, color: '#ffd27a' },
  },
  'wolf-pelt': { name: 'Thorn Wolf Pelt', kind: 'material', art: 'item-wolf-pelt', description: 'A grey pelt still prickly with little thorns. Warm, once you pick them out.', value: 10 },
  heartwood: { name: 'Golem Heartwood', kind: 'material', art: 'item-heartwood', description: 'A knot of glowing amber wood from a bark golem\'s chest. It hums faintly.', value: 14 },
  'golem-club': {
    name: 'Golem Club', kind: 'equipment', art: 'item-golem-club', slot: 'weapon', rarity: 'rare', bonus: { attack: 8, might: 2 },
    description: 'A heavy club of mossy bark that still puts out a leaf now and then.', value: 70,
  },
  'gull-feather': { name: 'Gull Feather', kind: 'material', art: 'item-gull-feather', description: 'A long grey and white feather. Fletchers and hat makers want it.', value: 5 },
  pearl: { name: 'Pearl', kind: 'material', art: 'item-pearl', description: 'A round pearl with a pink shimmer. Traders pay well for it.', value: 30 },
  'coral-spear': {
    name: 'Coral Spear', kind: 'equipment', art: 'item-coral-spear', slot: 'weapon', rarity: 'rare', bonus: { attack: 7, agility: 2 },
    description: 'A spear of pink coral with a pearl set where the shaft meets the point.', value: 75,
  },
  'jackal-fang': { name: 'Jackal Fang', kind: 'material', art: 'item-jackal-fang', description: 'A long curved fang on a scrap of turquoise cord.', value: 9 },
  'ancient-linen': { name: 'Ancient Linen', kind: 'material', art: 'item-ancient-linen', description: 'A roll of old linen wrapping, faintly golden and smelling of spice.', value: 12 },
  'wyrm-scale': { name: 'Wyrm Scale', kind: 'material', art: 'item-wyrm-scale', description: 'A sand wyrm\'s scale as big as a hand, hard as bronze.', value: 25 },
  'sunstone-amulet': {
    name: 'Sunstone Amulet', kind: 'equipment', art: 'item-sunstone-amulet', slot: 'charm', rarity: 'rare', bonus: { spirit: 3, wit: 2 },
    description: 'A warm orange stone in a gold sun-shaped setting, from the tomb of the Sun King.', value: 90,
  },
  'pelt-cloak': {
    name: 'Thorn Pelt Cloak', kind: 'equipment', art: 'item-pelt-cloak', slot: 'body', rarity: 'uncommon', bonus: { armor: 4, agility: 1 },
    description: 'A hooded cloak of thorn wolf pelts, thorns picked out. It keeps the night chill off.', value: 40,
  },
  'holy-water': {
    name: 'Holy Water', kind: 'consumable', art: 'item-tonic', rarity: 'uncommon', heal: 35,
    description: 'A crystal vial of consecrated water blessed at the cathedral font. Restores 35 health.', value: 15,
  },
  'warding-incense': {
    name: 'Warding Incense', kind: 'consumable', art: 'item-tonic', rarity: 'uncommon',
    description: 'A stick of fragrant temple incense blessed by High Priest Cassian.', value: 20,
  },
  'pilgrim-bread': {
    name: 'Pilgrim Bread', kind: 'consumable', art: 'item-goat-horn', rarity: 'common', heal: 20,
    description: 'A crusty, hearty loaf baked by Mother Elena at the Pilgrim\'s Haven. Restores 20 health.', value: 5,
  },
  'ancient-bone': {
    name: 'Ancient Bone', kind: 'material', art: 'item-goat-horn', description: 'A bleached bone from the forgotten crypts below the cathedral.', value: 10,
  },
  'demon-horn': {
    name: 'Demon Horn', kind: 'material', art: 'item-goat-horn', rarity: 'rare',
    description: 'A twisted obsidian horn radiating dark abyssal heat.', value: 50,
  },
  'sanctum-relic': {
    name: 'Sanctum Relic', kind: 'equipment', art: 'item-sunstone-amulet', slot: 'charm', rarity: 'rare', bonus: { attack: 7, spirit: 5 },
    description: 'An ancient holy relic infused with celestial warding light.', value: 120,
  },
};

/** New ways to make things from the bigger lands' finds. */
export const LAND_RECIPES: Record<string, RecipeDef> = {
  'pelt-cloak': { materials: [{ item: 'wolf-pelt', qty: 4 }], result: { item: 'pelt-cloak', qty: 1 }, wit: 4 },
  'temple-lantern': { materials: [{ item: 'moth-dust', qty: 3 }, { item: 'crab-shell', qty: 1 }], result: { item: 'temple-lantern', qty: 1 }, wit: 2 },
};

/** The people of the great places. */
export const LAND_PEOPLE: Record<string, { name: string; greeting: string; shop?: ShopDef }> = {
  'brother-tolle': {
    name: 'Brother Tolle',
    greeting: 'Every bell in this temple rings for a wish someone made. Listen, and you can hear the world growing.',
    shop: { sells: [{ item: 'temple-lantern', price: 25 }, { item: 'tonic', price: 8 }], teaches: [], buys: true },
  },
  'sir-alder': { name: 'Sir Alder', greeting: 'Mossgate fell long ago, but someone must still keep the gate. I am the last knight. Perhaps you will be the next.' },
  'queen-nerissa': {
    name: 'Queen Nerissa',
    greeting: 'Welcome to my coral halls, land-walker. Pearls for news, news for pearls: that is the way of the tide.',
    shop: { sells: [{ item: 'tonic', price: 9 }], teaches: [], buys: true },
  },
  'sultana-zahra': {
    name: 'Sultana Zahra',
    greeting: 'The Mirage Palace is real enough, traveller, whatever the dunes tell you. Sit, drink, and tell me of the world beyond the sand.',
    shop: { sells: [{ item: 'tonic', price: 12 }, { item: 'scroll-firebolt', price: 45 }], teaches: [], buys: true },
  },
  'high-priest-cassian': {
    name: 'High Priest Cassian',
    greeting: 'The grace of the divine bell be upon you, child. Walk in righteousness, and the shadows shall not touch you.',
    shop: { sells: [{ item: 'holy-water', price: 15 }, { item: 'warding-incense', price: 20 }], teaches: [], buys: true },
  },
  'brother-paul': {
    name: 'Brother Paul',
    greeting: 'Welcome to the Scriptorium. Within these parchment folios lies the lore of ancient blessings.',
    shop: { sells: [{ item: 'scroll-firebolt', price: 40 }], teaches: [], buys: true },
  },
  'mother-elena': {
    name: 'Mother Elena',
    greeting: 'Welcome to the Pilgrim\'s Haven! Rest your weary feet, traveller. A bowl of hot stew and fresh bread will do you good.',
    shop: { sells: [{ item: 'pilgrim-bread', price: 5 }, { item: 'tonic', price: 8 }], teaches: [], buys: true },
  },
  'gravedigger-joshua': {
    name: 'Gravedigger Joshua',
    greeting: 'Hush now... you feel that chill in the ground? The graves behind the cathedral... something below is stirring them.',
  },
};

/** Quests that send players out to the great places. */
export const LAND_QUESTS: Record<string, QuestDef> = {
  'bell-moths': {
    title: 'Moths in the Bell Tower',
    giver: 'brother-tolle',
    offer: 'Lantern moths have nested in the old bell tower and around the standing stones. They only come out at night and they flee from anyone who comes close. Catch four of them for me; their dust makes the finest lamp oil.',
    waiting: 'Look for the soft glow after dark. Four moths.',
    thanks: 'Lovely. The bells will ring brighter for it. Take this lantern; the night is kinder to those who carry a light.',
    goal: { kind: 'defeat', creature: 'lantern-moth', count: 4 },
    reward: { xp: 40, gold: 15, items: [{ item: 'temple-lantern', qty: 1 }] },
  },
  'mossgate-golems': {
    title: 'The Gate of Mossgate',
    giver: 'sir-alder',
    offer: 'The bark golems at the old castle gate were made to guard Mossgate, and they have forgotten whom they serve. Put three of them to rest.',
    waiting: 'The golems stand by the broken gate, south of here. Three of them.',
    thanks: 'They sleep now, and the gate is open to friends again. You fought like a knight of Mossgate.',
    goal: { kind: 'defeat', creature: 'bark-golem', count: 3 },
    reward: { xp: 90, gold: 40, items: [{ item: 'tonic', qty: 3 }] },
  },
  'gull-raiders': {
    title: 'The Gull Raiders',
    giver: 'queen-nerissa',
    offer: 'The gull raiders steal pearls from my divers whenever the sun is up. Their flock gathers at the old shipwreck. Scatter five of them.',
    waiting: 'The gulls fly by day, around the shipwreck. Five of them.',
    thanks: 'My divers sing your name. Take these pearls, from the queen\'s own beds.',
    goal: { kind: 'defeat', creature: 'gull-raider', count: 5 },
    reward: { xp: 80, gold: 30, items: [{ item: 'pearl', qty: 2 }] },
  },
  'sun-king-tomb': {
    title: 'The Sun King\'s Guards',
    giver: 'sultana-zahra',
    offer: 'At night the mummy guards of the Sun King\'s tomb walk out across the sand, all the way to the pyramid. My caravans will not travel. Lay four of them to rest.',
    waiting: 'They walk only by night, at the tomb to the south-east and the great pyramid. Four of them.',
    thanks: 'The caravans will move again. The palace thanks you, and so do I.',
    goal: { kind: 'defeat', creature: 'mummy-guard', count: 4 },
    reward: { xp: 120, gold: 50, items: [{ item: 'tonic', qty: 3 }] },
  },
};

Object.assign(CREATURES, LAND_CREATURES);
Object.assign(ITEMS, LAND_ITEMS);
Object.assign(RECIPES, LAND_RECIPES);
Object.assign(QUESTS, LAND_QUESTS);
for (const [id, p] of Object.entries(LAND_PEOPLE)) {
  NPC_NAMES[id] = p.name;
  NPC_GREETINGS[id] = p.greeting;
  if (p.shop) SHOPS[id] = p.shop;
}
