// RPG rules shared by server and client: stats, levels, items, creatures and
// quests. Content here is the hand-made starting set; wishes add more later
// as data in the same shapes.

import type { Light } from './light.ts';
import { SLEEPING_ABILITIES } from './mods.ts';
import type { Active } from './sky.ts';
import type { CallingId } from './classes.ts';
import type { RaceId } from './races.ts';
import { maxEnergy, maxHp } from './rpg/attributes.ts';
import { levelUpStats } from './rpg/callings.ts';
import { WEAPON_EFFECTS, type AbilityDef } from './rpg/abilities.ts';
import type { OffhandFamily, WeaponFamily } from './weapons.ts';
import { twoHanded } from './weapons.ts';

export * from './rpg/attributes.ts';
export * from './rpg/callings.ts';
export * from './rpg/abilities.ts';
export * from './rpg/statuses.ts';

export interface Stats {
  /** Heavy weapon damage and a little health. */
  might: number;
  /** Attack speed, critical hits and dodging. */
  agility: number;
  /** Magic, Energy, shorter cooldowns and crafting. */
  wit: number;
  /** Healing, Energy and health regeneration, and Ward. */
  spirit: number;
  /** Health (the main source), Armor, and shorter harmful statuses. */
  vigor: number;
}

/** Where equipment is worn (design doc, Items: equipment slots). */
export type EquipSlot = 'weapon' | 'offhand' | 'head' | 'body' | 'charm';
export const EQUIP_SLOTS: readonly EquipSlot[] = ['weapon', 'offhand', 'head', 'body', 'charm'];
export const SLOT_NAMES: Record<EquipSlot, string> = { weapon: 'Weapon', offhand: 'Off hand', head: 'Head', body: 'Body', charm: 'Charm' };

/** Rarity from Common to Legendary (design doc, Items). */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/** What a piece of equipment adds while worn: stats, weapon damage, armour and ward. */
export type Bonus = Partial<Stats> & { attack?: number; armor?: number; ward?: number };

export interface InventorySlot {
  item: string;
  qty: number;
}

export interface QuestState {
  id: string;
  /** Kills (defeat quests) counted so far. */
  count: number;
  /** Turned in and rewarded. */
  done: boolean;
}

/** Everything about a character that is saved with the account. */
export interface Character {
  level: number;
  xp: number;
  hp: number;
  gold: number;
  /** The wish currency (design doc, The God: Favor). */
  favor: number;
  stats: Stats;
  inventory: InventorySlot[];
  quests: QuestState[];
  /** Creature kinds and item ids met so far, for the Bestiary and Armoury. */
  discovered: string[];
  /** Epoch ms until which the Weakened debuff (after dying) lasts. */
  weakenedUntil: number;
  /** Spent by abilities; comes back over time. */
  energy: number;
  /** Item ids worn, by slot. Worn items are not in the bag. */
  equipment: Partial<Record<EquipSlot, string>>;
  /** Abilities learned, in the order they fill the 1 to 4 keys. */
  abilities: string[];
  /** Creator XP: earned when others use, fight or visit what this player wished for. */
  creatorXp: number;
  creatorLevel: number;
  /** Their people (docs/races.md); missing on characters from before peoples, until they choose. */
  race?: RaceId;
  /** Their Calling (docs/classes.md); without one, levels raise all five attributes. */
  calling?: CallingId;
  /** The Path chosen after the Calling's level-10 trial. */
  path?: string;
  /** Attribute points gained by levelling and not yet placed. */
  freePoints: number;
}

/** Favor a new character starts with: enough for a first small wish or two. */
export const STARTING_FAVOR_POINTS = 10;
/** Favor earned per quest completed and per level gained. */
export const QUEST_FAVOR = 3;
export const LEVEL_FAVOR = 2;

export const STARTING_STATS: Stats = { might: 3, agility: 3, wit: 3, spirit: 3, vigor: 3 };
export const WEAKENED_MS = 30_000;
/** How long a player at 0 HP lies Fallen, where a friend may raise them, before waking at the shrine. */
export const FALLEN_MS = 10_000;
/** A player must be this close to a creature to hit it, in tiles. */
export const ATTACK_RANGE = 1.6;
/** ...and this close to an NPC to talk. */
export const TALK_RANGE = 2.2;
export const MAX_STACK = 99;

export function newCharacter(): Character {
  const c: Character = {
    level: 1,
    xp: 0,
    hp: 0,
    gold: 0,
    favor: STARTING_FAVOR_POINTS,
    stats: { ...STARTING_STATS },
    // The Bible is item number one: every character starts with it.
    inventory: [{ item: 'bible', qty: 1 }],
    quests: [],
    discovered: ['bible'],
    weakenedUntil: 0,
    energy: 0,
    equipment: {},
    abilities: [],
    creatorXp: 0,
    creatorLevel: 1,
    freePoints: 0,
  };
  c.hp = maxHp(c);
  c.energy = maxEnergy(c);
  return c;
}

/** Fills in fields added since a character was saved. */
export function upgradeCharacter(saved: Partial<Character> | undefined): Character {
  const fresh = newCharacter();
  if (!saved) return fresh;
  const c: Character = { ...fresh, ...saved, stats: { ...fresh.stats, ...saved.stats } };
  // Vigor came after Might held health: a saved character starts as tough as they were strong.
  if (saved.stats && saved.stats.vigor === undefined) c.stats.vigor = c.stats.might;
  if (!c.inventory.some((s) => s.item === 'bible')) c.inventory.unshift({ item: 'bible', qty: 1 });
  c.equipment = { ...c.equipment };
  c.abilities = [...c.abilities];
  forgetVanished(c);
  c.hp = Math.min(Math.max(1, c.hp), maxHp(c));
  c.energy = Math.min(Math.max(0, c.energy), maxEnergy(c));
  return c;
}

/** Things and abilities a rolled-back wish made are gone from every bag, body and spellbook; a switched-off wish's sleep. */
export function forgetVanished(c: Character): void {
  c.inventory = c.inventory.filter((s) => ITEMS[s.item]);
  for (const slot of EQUIP_SLOTS) {
    const worn = c.equipment[slot];
    if (!worn || ITEMS[worn]?.slot === slot) continue;
    delete c.equipment[slot];
    // Gear whose wish was switched off still exists, asleep: it goes back in the bag.
    if (ITEMS[worn]) addItem(c, worn);
  }
  c.abilities = c.abilities.filter((a) => ABILITIES[a] || SLEEPING_ABILITIES.has(a));
}

/** Stats with what the character wears added. */
export function totalStats(c: Pick<Character, 'stats'> & Partial<Pick<Character, 'equipment'>>): Stats {
  const total = { ...c.stats };
  for (const id of Object.values(c.equipment ?? {})) {
    const bonus = id ? ITEMS[id]?.bonus : undefined;
    if (!bonus) continue;
    for (const k of Object.keys(total) as (keyof Stats)[]) total[k] += bonus[k] ?? 0;
  }
  return total;
}

/** Weapon damage, armour or ward from everything worn. */
export function gearBonus(c: Partial<Pick<Character, 'equipment'>>, key: 'attack' | 'armor' | 'ward'): number {
  let sum = 0;
  for (const id of Object.values(c.equipment ?? {})) sum += (id ? ITEMS[id]?.bonus?.[key] : 0) ?? 0;
  return sum;
}

type Gear = Pick<Character, 'level' | 'stats'> & Partial<Pick<Character, 'equipment'>>;

/** XP needed to go from this level to the next. */
export function xpToNext(level: number): number {
  return Math.round(20 * level ** 1.5);
}

/** A party's tuning default, not a server limit (design doc, Social play). */
export const PARTY_SIZE = 6;
/** Each extra party member sharing a defeat adds this much to the XP shared out. */
export const PARTY_XP_BONUS = 0.2;

/**
 * XP each of `sharers` party members gets for a defeat worth `xp`: the
 * total grows a little with each member, then is split evenly, so fighting
 * together never pays less than a fair share.
 */
export function partyXp(xp: number, sharers: number): number {
  if (sharers <= 1) return xp;
  return Math.ceil((xp * (1 + PARTY_XP_BONUS * (sharers - 1))) / sharers);
}

/**
 * Adds XP, levelling up as many times as it covers. Each level raises the
 * Calling's two attributes and gives a free point (levelUpStats), and
 * restores health. Returns the number of levels gained.
 */
export function gainXp(c: Character, amount: number): number {
  c.xp += amount;
  let levels = 0;
  while (c.xp >= xpToNext(c.level)) {
    c.xp -= xpToNext(c.level);
    c.level++;
    levels++;
    levelUpStats(c);
  }
  if (levels) {
    c.hp = maxHp(c);
    c.energy = maxEnergy(c);
    c.favor += levels * LEVEL_FAVOR;
  }
  return levels;
}

export function itemCount(c: Character, item: string): number {
  return c.inventory.find((s) => s.item === item)?.qty ?? 0;
}

export function addItem(c: Character, item: string, qty = 1): void {
  const slot = c.inventory.find((s) => s.item === item);
  if (slot) slot.qty = Math.min(MAX_STACK, slot.qty + qty);
  else c.inventory.push({ item, qty: Math.min(MAX_STACK, qty) });
  discover(c, item);
}

/** Removes items; false (and no change) when there are not enough. */
export function takeItem(c: Character, item: string, qty = 1): boolean {
  const slot = c.inventory.find((s) => s.item === item);
  if (!slot || slot.qty < qty || ITEMS[item]?.bound) return false;
  slot.qty -= qty;
  if (slot.qty === 0) c.inventory.splice(c.inventory.indexOf(slot), 1);
  return true;
}

export function discover(c: Character, id: string): void {
  if (!c.discovered.includes(id)) c.discovered.push(id);
}

// --- Items -----------------------------------------------------------------

export interface ItemDef {
  name: string;
  kind: 'book' | 'consumable' | 'material' | 'equipment' | 'scroll';
  art: string;
  description: string;
  /** Cannot be dropped, sold, traded or destroyed. */
  bound?: boolean;
  /** Health restored when used. */
  heal?: number;
  /** Equipment: where it is worn, and what it adds. */
  slot?: EquipSlot;
  bonus?: Bonus;
  rarity?: Rarity;
  /** Weapons: their family, which sets speed, reach and scaling (weapons.ts). */
  weapon?: WeaponFamily;
  /** Off-hand items: shield, tome, orb or lantern. */
  offhand?: OffhandFamily;
  /** Shields: chance (0 to 0.4) to block a hit, and how much a block takes off. */
  block?: number;
  blockAmount?: number;
  /** Scrolls: the ability reading it teaches. */
  teaches?: string;
  /** What a shop pays for it is half of this, in gold. */
  value?: number;
  /** Equipment that burns or glows: the light it casts while held. */
  light?: Light;
}

export const ITEMS: Record<string, ItemDef> = {
  bible: {
    name: 'The Bible',
    kind: 'book',
    art: 'item-bible',
    bound: true,
    description: "A leather-bound tome with brass corners and the God's sigil on its cover. It holds the world's own story and rules.",
  },
  tonic: {
    name: 'Tonic',
    kind: 'consumable',
    art: 'item-tonic',
    heal: 30,
    description: 'A little stoppered bottle of something green and fizzy. Restores 30 health.',
  },
  'goat-horn': {
    name: 'Goat Horn',
    kind: 'material',
    art: 'item-goat-horn',
    description: 'A curled horn, sun-bleached and carved with old caravan marks. Traders and crafters will want it.',
    value: 12,
  },
  'mushroom-cap': {
    name: 'Mushroom Cap',
    kind: 'material',
    art: 'item-mushroom-cap',
    description: 'A springy spotted cap from a Walking Mushroom. Herbalists brew it; hatters wear it.',
    value: 2,
  },
  'crab-shell': {
    name: 'Crab Shell',
    kind: 'material',
    art: 'item-crab-shell',
    description: "A hard coral plate from a Crab Knight's back. Good for armour and lance tips.",
    value: 4,
  },
  'scarab-shell': {
    name: 'Scarab Wing Case',
    kind: 'material',
    art: 'item-scarab-shell',
    description: 'A golden wing case that never quite cools. Charm makers prize it.',
    value: 6,
  },
  'wooden-sword': {
    name: 'Wooden Sword',
    kind: 'equipment',
    art: 'item-wooden-sword',
    slot: 'weapon',
    weapon: 'sword',
    rarity: 'common',
    bonus: { attack: 2 },
    description: 'A carved practice sword with a twine grip. Better than bare hands.',
    value: 15,
  },
  'crab-lance': {
    name: 'Crab-Shell Lance',
    kind: 'equipment',
    art: 'item-crab-lance',
    slot: 'weapon',
    weapon: 'spear',
    rarity: 'uncommon',
    bonus: { attack: 5, agility: 1 },
    description: 'A driftwood lance tipped with a needle of crab shell, light and quick.',
    value: 40,
  },
  'mushroom-hat': {
    name: 'Toadstool Hat',
    kind: 'equipment',
    art: 'item-mushroom-hat',
    slot: 'head',
    rarity: 'common',
    bonus: { armor: 1, spirit: 1 },
    description: 'A floppy hat sewn from mushroom caps. It smells of rain and makes you feel calm.',
    value: 10,
  },
  'traveller-coat': {
    name: "Traveller's Coat",
    kind: 'equipment',
    art: 'item-traveller-coat',
    slot: 'body',
    rarity: 'common',
    bonus: { armor: 2 },
    description: 'A hooded wool coat with brass buttons, patched at the elbows.',
    value: 20,
  },
  'shell-mail': {
    name: 'Shell Mail',
    kind: 'equipment',
    art: 'item-shell-mail',
    slot: 'body',
    rarity: 'uncommon',
    bonus: { armor: 5, might: 1 },
    description: 'A vest of overlapping crab-shell scales. It clicks when you walk.',
    value: 45,
  },
  'scarab-charm': {
    name: 'Scarab Charm',
    kind: 'equipment',
    art: 'item-scarab-charm',
    slot: 'charm',
    rarity: 'rare',
    bonus: { agility: 2, wit: 2 },
    description: 'A golden scarab amulet on a braided cord. Luck clings to it.',
    value: 60,
  },
  'scroll-firebolt': {
    name: 'Scroll of Firebolt',
    kind: 'scroll',
    art: 'item-scroll',
    teaches: 'firebolt',
    rarity: 'uncommon',
    description: 'Read it to learn Firebolt: a spark of Wit flung at a creature up to five steps away.',
    value: 40,
  },
};

// --- Abilities ---------------------------------------------------------------

/** Abilities are learned from trainers, scrolls and quests (design doc, Characters and progression). */
export const ABILITIES: Record<string, AbilityDef> = {
  'power-strike': {
    name: 'Power Strike',
    description: 'A heavy two-handed blow at the creature in reach. Might and your weapon make it hurt.',
    effect: 'strike', energy: 8, cooldown: 6, range: 1.8, base: 4, stat: 'might', factor: 1.5,
  },
  mend: {
    name: 'Mend',
    description: 'A quiet prayer that closes wounds. Spirit makes it stronger.',
    effect: 'heal', energy: 10, cooldown: 12, range: 0, base: 8, stat: 'spirit', factor: 3,
  },
  firebolt: {
    name: 'Firebolt',
    description: 'A spark of Wit flung at a creature up to five steps away.',
    effect: 'bolt', energy: 6, cooldown: 3, range: 5, base: 3, stat: 'wit', factor: 1.5,
  },
};

/** Damage or healing an ability does for this character, before randomness. */
export function abilityAmount(c: Gear, a: AbilityDef): number {
  const amount = a.base + c.level + Math.round(totalStats(c)[a.stat] * a.factor);
  return WEAPON_EFFECTS.includes(a.effect) ? amount + gearBonus(c, 'attack') : amount;
}

/** Learns an ability; false when it is unknown or already known. */
export function learnAbility(c: Character, id: string): boolean {
  if (!ABILITIES[id] || c.abilities.includes(id)) return false;
  c.abilities.push(id);
  return true;
}

// --- Equipment ----------------------------------------------------------------

/**
 * Wears an item from the bag, putting back whatever was in its slot.
 * Returns why not, or undefined when done.
 */
export function equip(c: Character, item: string): string | undefined {
  const def = ITEMS[item];
  if (!def?.slot) return 'That is not something you can wear.';
  if (itemCount(c, item) === 0) return 'That is not in your bag.';
  takeItem(c, item);
  const old = c.equipment[def.slot];
  c.equipment[def.slot] = item;
  if (old) addItem(c, old);
  // A two-handed weapon and an off-hand item cannot be held together.
  const freed = def.slot === 'weapon' && twoHanded(item) ? 'offhand' : def.slot === 'offhand' && twoHanded(c.equipment.weapon) ? 'weapon' : undefined;
  if (freed) unequip(c, freed);
  clampVitals(c);
  return undefined;
}

/** Takes off what is worn in a slot and puts it in the bag. */
export function unequip(c: Character, slot: EquipSlot): boolean {
  const old = c.equipment[slot];
  if (!old) return false;
  delete c.equipment[slot];
  addItem(c, old);
  clampVitals(c);
  return true;
}

/** Health and Energy never stay above a maximum that gear just lowered. */
function clampVitals(c: Character): void {
  c.hp = Math.min(c.hp, maxHp(c));
  c.energy = Math.min(c.energy, maxEnergy(c));
}

/** A short line of what an item adds, e.g. "+2 damage, +1 Spirit". */
export function bonusText(bonus: Bonus | undefined): string {
  if (!bonus) return '';
  const names: Record<string, string> = { attack: 'damage', armor: 'armour', ward: 'ward', might: 'Might', agility: 'Agility', wit: 'Wit', spirit: 'Spirit', vigor: 'Vigor' };
  return Object.entries(bonus).filter(([, v]) => v).map(([k, v]) => `+${v} ${names[k] ?? k}`).join(', ');
}

/**
 * What wished equipment adds, worked out from its slot and rarity, never
 * from the wish itself. `focus` is the stat the wisher wanted it to help.
 */
export function equipmentBonus(slot: EquipSlot, rarity: Rarity, focus?: keyof Stats): Bonus {
  const tier = RARITIES.indexOf(rarity) + 1;
  // An off-hand item (a shield, a torch) guards like a hat does.
  const bonus: Bonus = slot === 'weapon' ? { attack: 1 + tier } : slot === 'charm' ? {} : { armor: tier + (slot === 'body' ? 1 : 0) };
  const stat = focus ?? (slot === 'weapon' ? 'might' : slot === 'charm' ? 'wit' : 'spirit');
  const extra = slot === 'charm' ? tier + 1 : tier - 1;
  if (extra > 0) bonus[stat] = (bonus[stat] ?? 0) + extra;
  return bonus;
}

// --- Creatures -----------------------------------------------------------

/**
 * Behaviours from the design doc's small library. `wander` creatures only
 * fight back, and run when badly hurt; `guard` creatures attack anyone close
 * to their spot; `chase` creatures go after anyone they notice; `patrol`
 * creatures walk rounds about their spot and attack anyone they meet;
 * `timid` creatures never fight and run from anyone who comes close; `pack`
 * creatures roam together and all join in when one of them hunts.
 */
export type Behavior = 'wander' | 'guard' | 'chase' | 'patrol' | 'timid' | 'pack';

/** Every behaviour, for checking wishes. */
export const BEHAVIORS: Behavior[] = ['wander', 'guard', 'chase', 'patrol', 'timid', 'pack'];

/** How close a player must come before a creature of each behaviour notices them, unless its kind says. */
export const BEHAVIOR_NOTICE: Record<Behavior, number> = { wander: 0, guard: 2.5, chase: 4, patrol: 3, timid: 3.5, pack: 4 };

export interface Drop {
  item: string;
  chance: number;
  qty?: number;
}

export interface CreatureDef {
  name: string;
  art: string;
  description: string;
  behavior: Behavior;
  level: number;
  hp: number;
  damage: number;
  /** Defence against physical hits (weapons) and arcane ones (spells); none when missing. */
  armor?: number;
  ward?: number;
  /** Seconds between its attacks. */
  cooldown: number;
  /** Tiles per second when chasing. */
  speed: number;
  /** How close a player must come before it attacks (guard, chase, patrol, pack) or runs (timid). */
  notice: number;
  /** When it is up and about; it sleeps the rest of the time (see sky.ts). Always, unless said. */
  active?: Active;
  xp: number;
  gold: [number, number];
  drops: Drop[];
  respawnSeconds: number;
}

/** A defeated creature's body stays this long, in seconds, for its finders to search. */
export const BODY_SECONDS = 300;
/** A player must be this close to a body to search it, in tiles. */
export const SEARCH_RANGE = 1.6;

/** What a creature leaves on its body: each drop on its list is rolled against its own chance. */
export function rollDrops(drops: Drop[], random: () => number): InventorySlot[] {
  const found: InventorySlot[] = [];
  for (const drop of drops) {
    if (ITEMS[drop.item] && random() < drop.chance) found.push({ item: drop.item, qty: drop.qty ?? 1 });
  }
  return found;
}

export const CREATURES: Record<string, CreatureDef> = {
  'walking-mushroom': {
    name: 'Walking Mushroom',
    art: 'woods-mushroom',
    description: 'A grumpy toadstool on stubby legs. Harmless unless you start it.',
    behavior: 'wander',
    level: 1,
    hp: 18,
    damage: 3,
    armor: 1,
    ward: 0,
    cooldown: 1.4,
    speed: 2,
    notice: 0,
    xp: 7,
    gold: [0, 2],
    drops: [{ item: 'mushroom-cap', chance: 0.6 }, { item: 'tonic', chance: 0.25 }],
    respawnSeconds: 20,
  },
  'crab-knight': {
    name: 'Crab Knight',
    art: 'shore-crab-knight',
    description: 'A crab in a plumed helm who guards its patch of sand with a needle-sharp lance.',
    behavior: 'patrol',
    level: 2,
    hp: 34,
    damage: 5,
    armor: 3,
    ward: 1,
    cooldown: 1.3,
    speed: 2.5,
    notice: 2.5,
    xp: 14,
    gold: [2, 6],
    drops: [{ item: 'crab-shell', chance: 0.5 }, { item: 'tonic', chance: 0.2 }],
    respawnSeconds: 25,
  },
  'sun-scarab': {
    name: 'Sun Scarab',
    art: 'desert-scarab',
    description: 'A golden beetle that rolls out of the dunes at anything that moves.',
    behavior: 'pack',
    active: 'day',
    level: 3,
    hp: 30,
    damage: 6,
    armor: 3,
    ward: 1,
    cooldown: 1.2,
    speed: 3,
    notice: 4,
    xp: 16,
    gold: [1, 5],
    drops: [{ item: 'scarab-shell', chance: 0.45 }, { item: 'goat-horn', chance: 0.25 }, { item: 'tonic', chance: 0.15 }],
    respawnSeconds: 25,
  },
};

// --- NPCs and quests -------------------------------------------------------

export type QuestGoal =
  | { kind: 'talk'; npc: string }
  | { kind: 'defeat'; creature: string; count: number };

export interface QuestDef {
  title: string;
  giver: string;
  /** What the giver says when offering it. */
  offer: string;
  /** Said by the giver while it is in progress. */
  waiting: string;
  /** Said when it is completed. */
  thanks: string;
  goal: QuestGoal;
  requires?: string;
  reward: { xp: number; gold: number; items?: InventorySlot[]; ability?: string };
}

export const QUESTS: Record<string, QuestDef> = {
  'meet-bramble': {
    title: 'A Walk in the Woods',
    giver: 'sister-amala',
    offer: 'Welcome, pilgrim. The God is still waking, so the world needs hands like yours. Go west into the Whispering Woods and find Old Bramble. She knows what troubles the trees.',
    waiting: 'Old Bramble lives in her cottage at the end of the road west. Walk right in, she keeps the door open.',
    thanks: 'Amala sent you? Good. I could use the help.',
    goal: { kind: 'talk', npc: 'old-bramble' },
    reward: { xp: 15, gold: 5, items: [{ item: 'tonic', qty: 2 }] },
  },
  'mushroom-trouble': {
    title: 'Mushroom Trouble',
    giver: 'old-bramble',
    requires: 'meet-bramble',
    offer: 'The walking mushrooms keep trampling my herb beds. Knock four of them back into the moss and I will make it worth your while. Press Space to strike.',
    waiting: 'Still mushrooms underfoot. Four, I said.',
    thanks: 'Ha! My herbs thank you. Let me show you how to swing properly: put your back into it. Press 1 for a Power Strike.',
    goal: { kind: 'defeat', creature: 'walking-mushroom', count: 4 },
    reward: { xp: 40, gold: 15, items: [{ item: 'tonic', qty: 2 }], ability: 'power-strike' },
  },
  'crab-tolls': {
    title: 'Crab Tolls',
    giver: 'marina',
    offer: 'Those crab knights charge a toll in pinches to anyone walking the beach. Teach three of them some manners, would you?',
    waiting: 'Mind the lances. Three crab knights.',
    thanks: 'The beach is ours again. Here, for your trouble.',
    goal: { kind: 'defeat', creature: 'crab-knight', count: 3 },
    reward: { xp: 60, gold: 25, items: [{ item: 'tonic', qty: 2 }] },
  },
  'scarab-swarm': {
    title: 'The Golden Swarm',
    giver: 'cactus-elder',
    offer: 'The sun scarabs roll at every traveller who reaches the oasis. Drive three of them off and the desert will remember you.',
    waiting: 'The scarabs still roll. Three of them.',
    thanks: 'The sand is quiet. Take this horn; it once guided caravans home.',
    goal: { kind: 'defeat', creature: 'sun-scarab', count: 3 },
    reward: { xp: 70, gold: 25, items: [{ item: 'goat-horn', qty: 1 }] },
  },
};

/** What an NPC says when there is no quest to talk about. */
export const NPC_GREETINGS: Record<string, string> = {
  'sister-amala': 'May the God hear you. Speak your wishes at the shrine, once it wakes.',
  'old-bramble': 'Mind the roots, and mind the mushrooms.',
  marina: 'Shells, salt and stories. Have a look at what I have, or show me what you found.',
  'cactus-elder': 'Slow down, traveller. The desert has time.',
  'bramble-ursine-npc': 'May the earth cradle your steps, traveller.',
  'tide-lutran-npc': 'The currents carry tales from distant shores.',
  'zephyr-falcon-npc': 'Keep your eyes to the wind and your bow strung.',
  'dune-scorpid-npc': 'Walk softly upon the sands, and fear no venom.',
  'sylvan-cervid-npc': 'Listen closely: the mycelium whispers of ancient roots.',
};

/** The quest an NPC can offer this character now, if any. */
export function questOffered(c: Character, npc: string): string | undefined {
  return Object.entries(QUESTS).find(
    ([id, q]) =>
      q.giver === npc &&
      !c.quests.some((s) => s.id === id) &&
      (!q.requires || c.quests.some((s) => s.id === q.requires && s.done)),
  )?.[0];
}

export function questComplete(state: QuestState): boolean {
  const q = QUESTS[state.id];
  if (!q || state.done) return false;
  return q.goal.kind === 'defeat' && state.count >= q.goal.count;
}

/** Gives a quest's rewards and marks it done. Returns levels gained. */
export function completeQuest(c: Character, state: QuestState): number {
  const q = QUESTS[state.id]!;
  state.done = true;
  c.gold += q.reward.gold;
  c.favor += QUEST_FAVOR;
  for (const r of q.reward.items ?? []) addItem(c, r.item, r.qty);
  if (q.reward.ability) learnAbility(c, q.reward.ability);
  return gainXp(c, q.reward.xp);
}

export function rewardText(id: string): string {
  const r = QUESTS[id]!.reward;
  const parts = [`${r.xp} XP`];
  if (r.gold) parts.push(`${r.gold} gold`);
  parts.push(`${QUEST_FAVOR} Favor`);
  for (const i of r.items ?? []) parts.push(`${i.qty > 1 ? `${i.qty} × ` : ''}${ITEMS[i.item]?.name ?? i.item}`);
  if (r.ability) parts.push(`the ${ABILITIES[r.ability]?.name ?? r.ability} ability`);
  return parts.join(', ');
}

export function questProgressText(state: QuestState): string {
  const q = QUESTS[state.id];
  if (!q) return '';
  if (q.goal.kind === 'talk') return `Talk to ${npcName(q.goal.npc)}`;
  const name = CREATURES[q.goal.creature]?.name ?? q.goal.creature;
  if (state.count >= q.goal.count) return `Return to ${npcName(q.giver)}`;
  return `Defeat ${name}s: ${state.count}/${q.goal.count}`;
}

/** NPC names as said in lines like "Walk up to ... to trade". */
export const NPC_NAMES: Record<string, string> = {
  'sister-amala': 'Sister Amala',
  'old-bramble': 'Old Bramble',
  marina: 'Marina the Trader',
  'cactus-elder': 'the Cactus Elder',
  'bramble-ursine-npc': 'Bramble Ursine',
  'tide-lutran-npc': 'Tide Lutran',
  'zephyr-falcon-npc': 'Zephyr Falcon',
  'dune-scorpid-npc': 'Dune Scorpid',
  'sylvan-cervid-npc': 'Sylvan Cervid',
};

export function npcName(id: string): string {
  return NPC_NAMES[id] ?? id;
}
