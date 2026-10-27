// Weapon families (docs/classes.md#weapons): the family sets a weapon's
// speed, reach, scaling and extra; the item sets its damage and bonuses.
// Slower families scale harder, so damage per second evens out.

import { ITEMS, RARITIES, type Character, type CreatureDef, type ItemDef, type Rarity, type Stats } from './rpg.ts';

/** The fourteen weapon families. */
export type WeaponFamily =
  | 'hammer' | 'axe' | 'spear'
  | 'sword' | 'twin-blades' | 'greatsword'
  | 'bow' | 'sling' | 'javelins'
  | 'staff' | 'wand'
  | 'bell-mace' | 'censer' | 'hand-bell';

/** Off-hand families: what a shield, tome, orb or lantern is. */
export type OffhandFamily = 'shield' | 'tome' | 'orb' | 'lantern';

/** Physical hits are softened by Armor, arcane ones by Ward. */
export type DamageType = 'physical' | 'arcane';

/** The Callings that train weapons (docs/classes.md). */
export type CallingId = 'warden' | 'duelist' | 'ranger' | 'wishweaver' | 'bellkeeper';

export interface WeaponFamilyDef {
  name: string;
  /** The Calling trained in it. */
  calling: CallingId;
  hands: 1 | 2;
  /** Seconds between attacks before Agility. */
  speed: number;
  /** How far it hits, in tiles. */
  reach: number;
  /** Fires at range rather than striking in reach. */
  ranged?: boolean;
  /** Damage the family adds to the item's own. */
  damage: number;
  /** Damage per point of each attribute. */
  scale: Partial<Stats>;
  damageType: DamageType;
  /** Heavy weapons can stagger (speed 1.1 s or slower). */
  heavy?: boolean;
  /** Added critical hit chance. */
  crit?: number;
  /** Creatures one swing can hit. */
  targets?: number;
  /** Hits everything within this many tiles of the target. */
  splash?: number;
  /** Extras that need statuses or ally heals (build plan steps 4 and 5); data only until then. */
  bleed?: number;
  slow?: number;
  allyHeal?: number;
  /** How big it shows in the hand, as a multiple of HELD_SIZE. */
  held: number;
  /** A line about what is special, for the bag and the Bible. */
  extra: string;
}

/** Every weapon family, from docs/classes.md#weapons. */
export const WEAPON_FAMILIES: Record<WeaponFamily, WeaponFamilyDef> = {
  hammer: { name: 'Hammer', calling: 'warden', hands: 1, speed: 1.2, reach: 1.6, damage: 4, scale: { might: 0.7, vigor: 0.3 }, damageType: 'physical', heavy: true, held: 1, extra: 'Heavy: can stagger' },
  axe: { name: 'Axe', calling: 'warden', hands: 1, speed: 1.0, reach: 1.6, damage: 3, scale: { might: 0.6, vigor: 0.2 }, damageType: 'physical', bleed: 0.1, held: 1, extra: 'Can cause Bleeding' },
  spear: { name: 'Spear', calling: 'warden', hands: 1, speed: 1.1, reach: 2.2, damage: 3, scale: { might: 0.55, vigor: 0.3 }, damageType: 'physical', heavy: true, held: 1.25, extra: 'Long reach; heavy' },
  sword: { name: 'Sword', calling: 'duelist', hands: 1, speed: 0.8, reach: 1.6, damage: 3, scale: { might: 0.6, agility: 0.5 }, damageType: 'physical', held: 1, extra: 'The all-rounder' },
  'twin-blades': { name: 'Twin blades', calling: 'duelist', hands: 2, speed: 0.55, reach: 1.4, damage: 2, scale: { agility: 0.5, might: 0.25 }, damageType: 'physical', crit: 0.05, held: 0.8, extra: '+5% critical hits' },
  greatsword: { name: 'Greatsword', calling: 'duelist', hands: 2, speed: 1.3, reach: 2.0, damage: 6, scale: { might: 1.1, agility: 0.3 }, damageType: 'physical', heavy: true, targets: 2, held: 1.3, extra: 'Heavy; hits up to two creatures' },
  bow: { name: 'Bow', calling: 'ranger', hands: 2, speed: 1.0, reach: 6, ranged: true, damage: 3, scale: { agility: 0.8, wit: 0.3 }, damageType: 'physical', held: 1.1, extra: 'Long range' },
  sling: { name: 'Sling', calling: 'ranger', hands: 1, speed: 0.7, reach: 5, ranged: true, damage: 2, scale: { agility: 0.5, wit: 0.2 }, damageType: 'physical', held: 0.7, extra: 'Off hand stays free' },
  javelins: { name: 'Javelins', calling: 'ranger', hands: 1, speed: 1.3, reach: 4.5, ranged: true, damage: 5, scale: { agility: 0.9, wit: 0.3 }, damageType: 'physical', heavy: true, slow: 0.2, held: 1.1, extra: 'Slows the creature hit' },
  staff: { name: 'Staff', calling: 'wishweaver', hands: 2, speed: 1.1, reach: 5, ranged: true, damage: 3, scale: { wit: 0.8, spirit: 0.2 }, damageType: 'arcane', held: 1.25, extra: 'Arcane bolt' },
  wand: { name: 'Wand', calling: 'wishweaver', hands: 1, speed: 0.8, reach: 5.5, ranged: true, damage: 2, scale: { wit: 0.55, spirit: 0.1 }, damageType: 'arcane', held: 0.6, extra: 'Arcane bolt; off hand stays free' },
  'bell-mace': { name: 'Bell-mace', calling: 'bellkeeper', hands: 1, speed: 1.1, reach: 1.6, damage: 3, scale: { spirit: 0.45, vigor: 0.25 }, damageType: 'physical', heavy: true, allyHeal: 0.3, held: 1, extra: 'Each hit heals the most hurt ally nearby' },
  censer: { name: 'Censer', calling: 'bellkeeper', hands: 2, speed: 1.0, reach: 2.5, damage: 2, scale: { spirit: 0.4, vigor: 0.15 }, damageType: 'arcane', splash: 1, held: 1, extra: 'Arcane; hits everything close to the target' },
  'hand-bell': { name: 'Hand bell', calling: 'bellkeeper', hands: 1, speed: 0.9, reach: 4, ranged: true, damage: 2, scale: { spirit: 0.4, vigor: 0.1 }, damageType: 'arcane', held: 0.6, extra: 'Arcane ranged chime' },
};

/** Bare hands: what you strike with when no weapon is worn. */
export const FISTS: WeaponFamilyDef = {
  name: 'Bare hands', calling: 'duelist', hands: 1, speed: 0.8, reach: 1.6, damage: 2, scale: { might: 0.6, agility: 0.2 }, damageType: 'physical', held: 1, extra: '',
};

/** Off-hand families and the Callings trained in them. */
export const OFFHAND_FAMILIES: Record<OffhandFamily, { name: string; callings: CallingId[] }> = {
  shield: { name: 'Shield', callings: ['warden', 'bellkeeper'] },
  tome: { name: 'Tome', callings: ['wishweaver'] },
  orb: { name: 'Orb', callings: ['wishweaver'] },
  lantern: { name: 'Lantern', callings: ['bellkeeper'] },
};

/** Armor and Ward from a level (docs/attributes.md#defence); `tough` trades ward for armour, `undead` armour for ward. */
export function creatureDefence(level: number, kind?: 'tough' | 'undead'): Pick<CreatureDef, 'armor' | 'ward'> {
  if (kind === 'tough') return { armor: Math.round(level * 1.5), ward: Math.round(level / 4) };
  if (kind === 'undead') return { armor: Math.round(level / 2), ward: level };
  return { armor: level, ward: Math.round(level / 2) };
}

/** Words that mark a wished creature as undead, which wears more ward than armour. */
export const UNDEAD_WORDS = /\b(undead|skeletons?|skeletal|zombies?|ghosts?|ghouls?|wraiths?|mummy|mummies|liches?|revenants?|spectres?|specters?|drowned)\b/i;

/** Every weapon family id, for checking wishes. */
export const WEAPON_FAMILY_IDS = Object.keys(WEAPON_FAMILIES) as WeaponFamily[];

/** Untrained weapons deal this share of their damage, and their extra does not work. */
export const UNTRAINED_DAMAGE = 0.7;

/** Who can be trained: anyone with or (until step 2 of the Callings build) without a Calling. */
type Trainee = { calling?: string | null };

/**
 * Whether a character is trained in this family. A character with no Calling
 * yet (everyone before Callings arrive) counts as trained in everything.
 */
export function trainedIn(c: Trainee, family: WeaponFamily | OffhandFamily): boolean {
  if (!c.calling) return true;
  if (family in OFFHAND_FAMILIES) return OFFHAND_FAMILIES[family as OffhandFamily].callings.includes(c.calling as CallingId);
  return WEAPON_FAMILIES[family as WeaponFamily].calling === c.calling;
}

type Wielder = Partial<Pick<Character, 'equipment'>> & Trainee;

/** The family of the weapon worn, or bare hands. */
export function wieldedFamily(c: Partial<Pick<Character, 'equipment'>>): WeaponFamilyDef {
  const id = c.equipment?.weapon;
  const family = id ? ITEMS[id]?.weapon : undefined;
  return family ? WEAPON_FAMILIES[family] : FISTS;
}

/** True when the weapon worn is one the character is trained in (bare hands always are). */
export function wieldsTrained(c: Wielder): boolean {
  const id = c.equipment?.weapon;
  const family = id ? ITEMS[id]?.weapon : undefined;
  return !family || trainedIn(c, family);
}

/** The shield worn and its numbers, when it is one the character is trained in. */
export function trainedShield(c: Wielder): Pick<ItemDef, 'block' | 'blockAmount'> | undefined {
  const id = c.equipment?.offhand;
  const def = id ? ITEMS[id] : undefined;
  if (!def?.block || (def.offhand && !trainedIn(c, def.offhand))) return undefined;
  return def;
}

/** A short line about a weapon's or off-hand item's kind, e.g. "Bow, both hands, reach 6"; empty for other things. */
export function familyText(def: Pick<ItemDef, 'weapon' | 'offhand' | 'block' | 'blockAmount'> | undefined): string {
  if (def?.weapon) {
    const f = WEAPON_FAMILIES[def.weapon];
    return `${f.name}, ${f.hands === 2 ? 'both hands' : 'one hand'}, reach ${f.reach}${f.damageType === 'arcane' ? ', arcane' : ''}`;
  }
  if (def?.offhand) return def.block ? `Shield, blocks ${Math.round(def.block * 100)}% of hits by ${def.blockAmount ?? 0}` : OFFHAND_FAMILIES[def.offhand].name;
  return '';
}

/** True when the item is a weapon held in both hands. */
export function twoHanded(item: string | undefined): boolean {
  const family = item ? ITEMS[item]?.weapon : undefined;
  return !!family && WEAPON_FAMILIES[family].hands === 2;
}

/** A wished shield's block chance and amount, from its rarity. */
export function shieldBlock(rarity: Rarity): Pick<ItemDef, 'block' | 'blockAmount'> {
  const tier = RARITIES.indexOf(rarity) + 1;
  return { block: Math.round((0.1 + tier * 0.05) * 100) / 100, blockAmount: tier * 2 };
}

// Words that name each family, most specific first ("greatsword" before
// "sword", "bell-mace" before "mace"; a plain "bell" only when nothing else is named).
const FAMILY_WORDS: [RegExp, WeaponFamily | OffhandFamily][] = [
  [/\b(great ?sword|claymore|zweihander)s?\b/, 'greatsword'],
  [/\b(twin|paired|dual) ?(blades?|daggers?|knives|swords?)\b|\bdaggers\b/, 'twin-blades'],
  [/\bbell[- ]?mace\b/, 'bell-mace'],
  [/\bcenser|thurible\b/, 'censer'],
  [/\bjavelins?\b/, 'javelins'],
  [/\bslings?\b/, 'sling'],
  [/\b(long|short)?bows?\b/, 'bow'],
  [/\bwands?\b|\brods?\b/, 'wand'],
  [/\bstaff|staves|stave\b/, 'staff'],
  [/\b(spear|lance|pike|halberd|trident|glaive)s?\b/, 'spear'],
  [/\b(axe|hatchet|cleaver)s?\b/, 'axe'],
  [/\b(hammer|mace|club|maul|cudgel)s?\b/, 'hammer'],
  [/\b(sword|sabre|saber|rapier|scimitar|blade|cutlass|dagger|knife)s?\b/, 'sword'],
  [/\b(hand ?bell|bell)s?\b/, 'hand-bell'],
  [/\b(shield|buckler|targe)s?\b/, 'shield'],
  [/\b(tome|book|grimoire)s?\b/, 'tome'],
  [/\b(orb|sphere|crystal ball)s?\b/, 'orb'],
  [/\b(lantern|lamp|torch)e?s?\b/, 'lantern'],
];

/** The weapon family words name, e.g. "Coral Spear" is a spear; undefined when none do. */
export function familyFromWords(words: string): WeaponFamily | undefined {
  const lower = words.toLowerCase();
  for (const [re, family] of FAMILY_WORDS) if (family in WEAPON_FAMILIES && re.test(lower)) return family as WeaponFamily;
  return undefined;
}

/** The off-hand family words name, e.g. "Oak Buckler" is a shield. */
export function offhandFromWords(words: string): OffhandFamily | undefined {
  const lower = words.toLowerCase();
  for (const [re, family] of FAMILY_WORDS) if (family in OFFHAND_FAMILIES && re.test(lower)) return family as OffhandFamily;
  return undefined;
}
