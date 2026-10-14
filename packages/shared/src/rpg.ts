// RPG rules shared by server and client: stats, levels, items, creatures and
// quests. Content here is the hand-made starting set; wishes add more later
// as data in the same shapes.

export interface Stats {
  /** Melee damage and health. */
  might: number;
  /** Attack speed. */
  agility: number;
  /** Magic and crafting (used once abilities arrive). */
  wit: number;
  /** Health regeneration. */
  spirit: number;
}

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
}

/** Favor a new character starts with: enough for a first small wish or two. */
export const STARTING_FAVOR_POINTS = 10;
/** Favor earned per quest completed and per level gained. */
export const QUEST_FAVOR = 3;
export const LEVEL_FAVOR = 2;

export const STARTING_STATS: Stats = { might: 3, agility: 3, wit: 3, spirit: 3 };
export const WEAKENED_MS = 30_000;
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
  };
  c.hp = maxHp(c);
  return c;
}

/** Fills in fields added since a character was saved. */
export function upgradeCharacter(saved: Partial<Character> | undefined): Character {
  const fresh = newCharacter();
  if (!saved) return fresh;
  const c: Character = { ...fresh, ...saved, stats: { ...fresh.stats, ...saved.stats } };
  if (!c.inventory.some((s) => s.item === 'bible')) c.inventory.unshift({ item: 'bible', qty: 1 });
  // Things a rolled-back wish made are gone from every bag.
  c.inventory = c.inventory.filter((s) => ITEMS[s.item]);
  c.hp = Math.min(Math.max(1, c.hp), maxHp(c));
  return c;
}

export function maxHp(c: Pick<Character, 'level' | 'stats'>): number {
  return 20 + c.level * 10 + c.stats.might * 2;
}

/** XP needed to go from this level to the next. */
export function xpToNext(level: number): number {
  return Math.round(20 * level ** 1.5);
}

/** Damage before randomness and debuffs. */
export function attackPower(c: Pick<Character, 'level' | 'stats'>): number {
  return 3 + c.stats.might + c.level;
}

/** Seconds between attacks. */
export function attackCooldown(c: Pick<Character, 'stats'>): number {
  return Math.max(0.35, 0.8 - c.stats.agility * 0.03);
}

/** Health regained per second once out of combat. */
export function regenPerSecond(c: Pick<Character, 'stats'>): number {
  return 1 + c.stats.spirit * 0.25;
}

/**
 * Adds XP, levelling up as many times as it covers. Each level raises every
 * stat by one and restores health. Returns the number of levels gained.
 */
export function gainXp(c: Character, amount: number): number {
  c.xp += amount;
  let levels = 0;
  while (c.xp >= xpToNext(c.level)) {
    c.xp -= xpToNext(c.level);
    c.level++;
    levels++;
    for (const k of Object.keys(c.stats) as (keyof Stats)[]) c.stats[k]++;
  }
  if (levels) {
    c.hp = maxHp(c);
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
  kind: 'book' | 'consumable' | 'material';
  art: string;
  description: string;
  /** Cannot be dropped, sold or destroyed. */
  bound?: boolean;
  /** Health restored when used. */
  heal?: number;
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
  },
};

// --- Creatures -----------------------------------------------------------

/**
 * Behaviours from the design doc's small library. `wander` creatures only
 * fight back; `guard` creatures attack anyone close to their spot; `chase`
 * creatures go after anyone they notice.
 */
export type Behavior = 'wander' | 'guard' | 'chase';

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
  /** Seconds between its attacks. */
  cooldown: number;
  /** Tiles per second when chasing. */
  speed: number;
  /** How close a player must come before it attacks (guard, chase). */
  notice: number;
  xp: number;
  gold: [number, number];
  drops: Drop[];
  respawnSeconds: number;
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
    cooldown: 1.4,
    speed: 2,
    notice: 0,
    xp: 7,
    gold: [0, 2],
    drops: [{ item: 'tonic', chance: 0.35 }],
    respawnSeconds: 20,
  },
  'crab-knight': {
    name: 'Crab Knight',
    art: 'shore-crab-knight',
    description: 'A crab in a plumed helm who guards its patch of sand with a needle-sharp lance.',
    behavior: 'guard',
    level: 2,
    hp: 34,
    damage: 5,
    cooldown: 1.3,
    speed: 2.5,
    notice: 2.5,
    xp: 14,
    gold: [2, 6],
    drops: [{ item: 'tonic', chance: 0.25 }],
    respawnSeconds: 25,
  },
  'sun-scarab': {
    name: 'Sun Scarab',
    art: 'desert-scarab',
    description: 'A golden beetle that rolls out of the dunes at anything that moves.',
    behavior: 'chase',
    level: 3,
    hp: 30,
    damage: 6,
    cooldown: 1.2,
    speed: 3,
    notice: 4,
    xp: 16,
    gold: [1, 5],
    drops: [{ item: 'goat-horn', chance: 0.3 }, { item: 'tonic', chance: 0.15 }],
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
  reward: { xp: number; gold: number; items?: InventorySlot[] };
}

export const QUESTS: Record<string, QuestDef> = {
  'meet-bramble': {
    title: 'A Walk in the Woods',
    giver: 'sister-amala',
    offer: 'Welcome, pilgrim. The God is still waking, so the world needs hands like yours. Go west into the Whispering Woods and find Old Bramble. She knows what troubles the trees.',
    waiting: 'Old Bramble lives by the great tree house, west along the road.',
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
    thanks: 'Ha! My herbs thank you. Take these.',
    goal: { kind: 'defeat', creature: 'walking-mushroom', count: 4 },
    reward: { xp: 40, gold: 15, items: [{ item: 'tonic', qty: 2 }] },
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
  marina: 'Shells, salt and stories. Nothing for sale yet, but come back soon.',
  'cactus-elder': 'Slow down, traveller. The desert has time.',
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
  return gainXp(c, q.reward.xp);
}

export function rewardText(id: string): string {
  const r = QUESTS[id]!.reward;
  const parts = [`${r.xp} XP`];
  if (r.gold) parts.push(`${r.gold} gold`);
  parts.push(`${QUEST_FAVOR} Favor`);
  for (const i of r.items ?? []) parts.push(`${i.qty > 1 ? `${i.qty} × ` : ''}${ITEMS[i.item]?.name ?? i.item}`);
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

const NPC_NAMES: Record<string, string> = {
  'sister-amala': 'Sister Amala',
  'old-bramble': 'Old Bramble',
  marina: 'Marina the Trader',
  'cactus-elder': 'the Cactus Elder',
};

export function npcName(id: string): string {
  return NPC_NAMES[id] ?? id;
}
