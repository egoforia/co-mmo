import type { MaterialFamily } from './materials.ts';
import type { RaceId } from './races.ts';
import { ITEMS, addItem, itemCount, takeItem, type Character, type ItemDef } from './rpg.ts';

// Crafts, levels and tools (gather and craft plan, step 4). Seven crafts, each
// with a level from 1 to 20 that grows by doing it. Anyone can practise any
// craft up to level 10; levels 11 to 20, tier 3 materials and the best
// quality need one of a player's two masteries, chosen from that craft's
// master. A people starts ahead in its home crafts. Every craft needs its
// tool in the bag, and tools wear out now and then.
//
// Only types come from materials.ts: it reads the world map, which reads
// the lands, which read the recipes in kit.ts, which read this file.

/** The seven crafts. */
export type CraftId = 'woodcarving' | 'leatherwork' | 'tailoring' | 'smithing' | 'fletching' | 'herbalism' | 'jewellery';
export const CRAFT_IDS: readonly CraftId[] = ['woodcarving', 'leatherwork', 'tailoring', 'smithing', 'fletching', 'herbalism', 'jewellery'];

/** What a craft works, its tool and which peoples call it home. */
export interface CraftDef {
  name: string;
  /** The material families it works; wishstuff belongs to none yet. */
  families: MaterialFamily[];
  /** Its tool's name, like "Axe". */
  tool: string;
  /** Peoples who start ahead in it. */
  peoples: RaceId[];
  /** The shipped icon its tools show until their own picture is painted. */
  standIn: string;
}

/** The seven crafts (the plan's table). Bone and horn are carved, so they go with wood. */
export const CRAFTS: Record<CraftId, CraftDef> = {
  woodcarving: { name: 'Woodcarving', families: ['wood', 'bone'], tool: 'Axe', peoples: ['ursine', 'cervid'], standIn: 'held-axe' },
  leatherwork: { name: 'Leatherwork', families: ['hide'], tool: 'Skinning Knife', peoples: ['ursine'], standIn: 'held-sword' },
  tailoring: { name: 'Tailoring', families: ['fibre'], tool: 'Shears', peoples: ['scorpid', 'falcon'], standIn: 'held-twin-blades' },
  smithing: { name: 'Smithing', families: ['ore', 'plate'], tool: 'Pick', peoples: ['scorpid', 'lutran'], standIn: 'held-hammer' },
  fletching: { name: 'Fletching', families: ['feather'], tool: 'Fletching Knife', peoples: ['falcon'], standIn: 'held-bow' },
  herbalism: { name: 'Herbalism', families: ['herb'], tool: 'Sickle', peoples: ['cervid'], standIn: 'held-sword' },
  jewellery: { name: 'Jewellery', families: ['gem'], tool: 'Pliers', peoples: ['lutran'], standIn: 'item-scarab-charm' },
};

/** Levels: everyone starts at 1, a home craft at 3; past 10 needs a mastery. */
export const CRAFT_START_LEVEL = 1;
export const HOME_CRAFT_LEVEL = 3;
export const OPEN_CRAFT_LEVEL = 10;
export const MAX_CRAFT_LEVEL = 20;
/** How many crafts a player may master. */
export const MAX_MASTERIES = 2;
/** Gold to give up a mastery for another; the old craft drops back to level 10. The game is meant to be harsh. */
export const MASTERY_CHANGE_GOLD = 300;
/** Extra quality a home craft gives. */
export const HOME_CRAFT_QUALITY = 10;
/** Best quality without a mastery in the craft (copies.ts allows up to 130). */
export const UNMASTERED_QUALITY_MAX = 115;

/** A tool's tier: 1 works anything, higher tiers make finer things. */
export type ToolTier = 1 | 2 | 3;
export const TOOL_TIERS: readonly ToolTier[] = [1, 2, 3];
const TOOL_TIER_NAMES: Record<ToolTier, string> = { 1: '', 2: 'Fine ', 3: 'Master\'s ' };
const TOOL_VALUE: Record<ToolTier, number> = { 1: 20, 2: 120, 3: 400 };
/** Chance a tool wears out each time it is used: it lasts about 50, 100 or 200 uses. */
const TOOL_WEAR: Record<ToolTier, number> = { 1: 0.02, 2: 0.01, 3: 0.005 };

/** How far along a craft a player is. */
export interface CraftProgress {
  level: number;
  /** Toward the next level. */
  xp: number;
}

/** True for a craft id. */
export function isCraft(v: unknown): v is CraftId {
  return CRAFT_IDS.includes(v as CraftId);
}

/** The craft that works a material family, or undefined (wishstuff). */
export function craftOfFamily(family: MaterialFamily | undefined): CraftId | undefined {
  return family ? CRAFT_IDS.find((k) => CRAFTS[k].families.includes(family)) : undefined;
}

/** True when the character's people call this craft home. */
export function isHomeCraft(c: Pick<Character, 'race'>, craft: CraftId): boolean {
  return Boolean(c.race && CRAFTS[craft].peoples.includes(c.race));
}

/** True when the character has mastered this craft. */
export function isMastered(c: Pick<Character, 'masteries'>, craft: CraftId): boolean {
  return Boolean(c.masteries?.includes(craft));
}

/** A character's level in a craft. */
export function craftLevel(c: Pick<Character, 'race' | 'crafts'>, craft: CraftId): number {
  return c.crafts?.[craft]?.level ?? (isHomeCraft(c, craft) ? HOME_CRAFT_LEVEL : CRAFT_START_LEVEL);
}

/** The highest level a character can reach in a craft now. */
export function craftLevelCap(c: Pick<Character, 'masteries'>, craft: CraftId): number {
  return isMastered(c, craft) ? MAX_CRAFT_LEVEL : OPEN_CRAFT_LEVEL;
}

/** Practice needed to go from this level to the next. */
export function craftXpToNext(level: number): number {
  return 20 + 10 * level;
}

/** Adds practice to a craft; returns the new level when it rose, else undefined. Nothing grows past the cap. */
export function gainCraftXp(c: Character, craft: CraftId, xp: number): number | undefined {
  const cap = craftLevelCap(c, craft);
  const p = { level: craftLevel(c, craft), xp: c.crafts?.[craft]?.xp ?? 0 };
  const before = p.level;
  if (p.level >= cap) return undefined;
  p.xp += Math.max(0, Math.round(xp));
  while (p.level < cap && p.xp >= craftXpToNext(p.level)) {
    p.xp -= craftXpToNext(p.level);
    p.level++;
  }
  if (p.level >= cap) p.xp = 0;
  c.crafts = { ...c.crafts, [craft]: p };
  return p.level > before ? p.level : undefined;
}

/**
 * Takes up a mastery, or gives up `replace` for it. The first two are free;
 * changing costs gold, and the old craft drops back to level 10. Returns why not.
 */
export function chooseMastery(c: Character, craft: CraftId, replace?: CraftId): string | undefined {
  const name = CRAFTS[craft].name;
  const held = c.masteries ?? [];
  if (held.includes(craft)) return `You are already a master of ${name}.`;
  if (!replace) {
    if (held.length >= MAX_MASTERIES) return `You have mastered ${held.map((k) => CRAFTS[k].name).join(' and ')} already. Give one up to master ${name}.`;
    c.masteries = [...held, craft];
    return undefined;
  }
  if (!held.includes(replace)) return `You are not a master of ${CRAFTS[replace].name}.`;
  if (c.gold < MASTERY_CHANGE_GOLD) return `Changing a mastery costs ${MASTERY_CHANGE_GOLD} gold; you have ${c.gold}.`;
  c.gold -= MASTERY_CHANGE_GOLD;
  c.masteries = held.map((k) => (k === replace ? craft : k));
  const old = c.crafts?.[replace];
  const level = Math.min(craftLevel(c, replace), OPEN_CRAFT_LEVEL);
  c.crafts = { ...c.crafts, [replace]: { level, xp: old && old.level <= OPEN_CRAFT_LEVEL ? old.xp : 0 } };
  return undefined;
}

// --- Tools ------------------------------------------------------------------------

/** A tool's item id, like "tool-smithing-1". */
export function toolId(craft: CraftId, tier: ToolTier): string {
  return `tool-${craft}-${tier}`;
}

/** Every tool, three tiers a craft. One picture per tool for now; each tier can have its own later. */
export const TOOLS: Record<string, ItemDef> = Object.fromEntries(CRAFT_IDS.flatMap((craft) => TOOL_TIERS.map((tier): [string, ItemDef] => [toolId(craft, tier), {
  name: `${TOOL_TIER_NAMES[tier]}${CRAFTS[craft].tool}`,
  kind: 'tool',
  art: `item-tool-${craft}`,
  standIn: CRAFTS[craft].standIn,
  description: `A ${CRAFTS[craft].name.toLowerCase()} tool${tier > 1 ? ' of finer make' : ''}. Keep it in your bag to work and gather ${CRAFTS[craft].families.join(' and ')}. It wears out in time.`,
  value: TOOL_VALUE[tier],
  tool: { craft, tier },
}])));
Object.assign(ITEMS, TOOLS);

/** The best tool for a craft in the bag: its id and tier, or undefined. */
export function bestTool(c: Pick<Character, 'inventory'>, craft: CraftId): { id: string; tier: ToolTier } | undefined {
  for (const tier of [...TOOL_TIERS].reverse()) {
    const id = toolId(craft, tier);
    if (itemCount(c as Character, id) > 0) return { id, tier };
  }
  return undefined;
}

/** Uses a tool once: now and then it wears out and is gone. Returns its name when it broke. */
export function wearTool(c: Character, tool: { id: string; tier: ToolTier }, random: () => number): string | undefined {
  if (random() >= TOOL_WEAR[tool.tier]) return undefined;
  takeItem(c, tool.id);
  return ITEMS[tool.id]?.name;
}

/** What a craft's master sells: its common and fine tools. Master's tools are only ever crafted. */
export function toolOffers(craft: CraftId): { item: string; price: number }[] {
  return [{ item: toolId(craft, 1), price: 25 }, { item: toolId(craft, 2), price: 150 }];
}

/** A tool in plain words for its card, like "Smithing tool, tier 2." */
export function toolWords(def: ItemDef | undefined): string {
  const t = def?.tool;
  return t ? `${CRAFTS[t.craft].name} tool, tier ${t.tier}.` : '';
}

/**
 * The free first tool of each home craft, given once when a character has a
 * people. Returns the tools given, empty when there was nothing to give.
 */
export function giveHomeTools(c: Character): string[] {
  if (!c.race || c.homeTools) return [];
  c.homeTools = true;
  const given = CRAFT_IDS.filter((k) => isHomeCraft(c, k)).map((k) => toolId(k, 1));
  for (const id of given) addItem(c, id);
  return given;
}
