// The Wish Workshop: wishes shaped by category instead of guessed from a
// prayer (Wish Workshop design doc). Each subcategory maps to a definition
// kind the game already checks with validateDefinition, or, for wishes
// people build, to a structured brief for the Stewards or the Owner.

import { BIOMES, type BiomeId } from './biomes.ts';
import { CREATURES, ITEMS, bonusText } from './rpg.ts';
import { chanceText, lootTable } from './loot.ts';
import { OFFHAND_FAMILIES, WEAPON_FAMILIES, WEAPON_FAMILY_IDS, type OffhandFamily } from './weapons.ts';
import {
  REGION_WISH_COST,
  WISH_COSTS,
  WishError,
  abilityFromWish,
  contentTier,
  creatureFromWish,
  itemFromWish,
  MAX_LOOK_LENGTH,
  MAX_WISHED_CHANCE,
  MAX_WISHED_DROP_QTY,
  validateDefinition,
  validateLookWish,
  wishCost,
  type WishCard,
  type WishDefinition,
  type WishTier,
} from './content.ts';

/** How a form field is filled in. `item` and `items` pick from things that exist; `materials` pairs items with amounts. */
export type WorkshopFieldKind = 'text' | 'long' | 'color' | 'choice' | 'number' | 'item' | 'items' | 'materials' | 'creature';

export interface WorkshopField {
  key: string;
  label: string;
  kind: WorkshopFieldKind;
  /** A plain example shown in the empty field. */
  hint?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  /** Longest text, in characters. */
  length?: number;
  optional?: boolean;
}

export interface WishSubcategory {
  id: string;
  name: string;
  blurb: string;
  tier: WishTier;
  /** The definition kind it becomes, or a brief for people to build ("rule" for Stewards, "engine" for the Owner). */
  makes: WishDefinition['kind'] | 'rule' | 'engine';
  /** Values the subcategory decides, such as a potion being a consumable. */
  fixed?: Record<string, string>;
  fields: WorkshopField[];
}

export interface WishCategory {
  id: string;
  name: string;
  blurb: string;
  /** A built-in picture (an approved anchor) shown on its tile. */
  picture: string;
  subs: WishSubcategory[];
}

const NAME: WorkshopField = { key: 'name', label: 'Name', kind: 'text', length: 40 };
const DESCRIPTION: WorkshopField = { key: 'description', label: 'What it is, in a sentence or two', kind: 'long', length: 240 };
/** The four parts of a look, the same ones the God fills in (WishLook). */
const LOOK: WorkshopField[] = [
  { key: 'hook', label: 'The one feature you would know it by', kind: 'text', length: 120, hint: 'a tiny paper lantern hanging from its tongue' },
  { key: 'body', label: 'Body and shape', kind: 'text', length: 200, hint: 'a round fuzzy moth the size of a cat' },
  { key: 'color', label: 'Main colour', kind: 'color' },
  { key: 'mood', label: 'Mood', kind: 'text', length: 60, hint: 'gentle, sleepy', optional: true },
];
const level = (key: string, label: string, min: number, max: number): WorkshopField => ({ key, label, kind: 'number', min, max });
const choice = (key: string, label: string, options: [string, string][], optional = false): WorkshopField =>
  ({ key, label, kind: 'choice', options: options.map(([value, l]) => ({ value, label: l })), ...(optional ? { optional } : {}) });
const brief = (key: string, label: string, hint: string, optional = false): WorkshopField =>
  ({ key, label, kind: 'long', length: 400, hint, ...(optional ? { optional } : {}) });

/** Kinds of weapon and off-hand item a wished piece of gear can be. */
const FAMILY_CHOICES: [string, string][] = [
  ...WEAPON_FAMILY_IDS.map((f) => [f, `${WEAPON_FAMILIES[f].name} (weapon)`] as [string, string]),
  ...(Object.keys(OFFHAND_FAMILIES) as OffhandFamily[]).map((f) => [f, `${OFFHAND_FAMILIES[f].name} (off hand)`] as [string, string]),
];

const BIOME_CHOICES = (Object.keys(BIOMES) as BiomeId[]).filter((b) => b !== 'sanctum').map((b) => [b, BIOMES[b].name] as [string, string]);

/** Every kind of wish the Workshop offers, in the order players see them. */
export const WISH_CATEGORIES: WishCategory[] = [
  {
    id: 'carry', name: 'Things to carry', blurb: 'Potions, keepsakes, materials and gear for your bag.', picture: 'item-tonic',
    subs: [
      { id: 'potion', name: 'Potion or food', blurb: 'Something to drink or eat that heals.', tier: 'minor', makes: 'item', fixed: { itemKind: 'consumable' },
        fields: [NAME, DESCRIPTION, level('heal', 'Health it gives back', 5, 50), ...LOOK] },
      { id: 'keepsake', name: 'Keepsake', blurb: 'A trinket to keep, show or trade.', tier: 'minor', makes: 'item', fixed: { itemKind: 'trinket' }, fields: [NAME, DESCRIPTION, ...LOOK] },
      { id: 'material', name: 'Crafting material', blurb: 'Something recipes can use.', tier: 'minor', makes: 'item', fixed: { itemKind: 'material' }, fields: [NAME, DESCRIPTION, ...LOOK] },
      { id: 'gear', name: 'Gear', blurb: 'A weapon, a shield, a hat, armour or a charm to wear.', tier: 'minor', makes: 'item',
        fields: [NAME, DESCRIPTION,
          choice('itemKind', 'Where it is worn', [['weapon', 'Weapon'], ['offhand', 'Shield or off-hand item'], ['head', 'Hat or helmet'], ['body', 'Armour or clothes'], ['charm', 'Charm']]),
          choice('rarity', 'How rare', [['common', 'Common'], ['uncommon', 'Uncommon'], ['rare', 'Rare']]),
          choice('family', 'What kind of weapon or off-hand item', FAMILY_CHOICES, true),
          choice('focus', 'The stat it helps', [['might', 'Might'], ['agility', 'Agility'], ['wit', 'Wit'], ['spirit', 'Spirit'], ['vigor', 'Vigor']], true),
          ...LOOK] },
    ],
  },
  {
    id: 'know', name: 'Know-how', blurb: 'New recipes and abilities.', picture: 'item-scroll',
    subs: [
      { id: 'recipe', name: 'Recipe', blurb: 'A new way to make something everyone can use.', tier: 'minor', makes: 'recipe',
        fields: [NAME, DESCRIPTION, { key: 'materials', label: 'What it takes', kind: 'materials' }, { key: 'result', label: 'What it makes', kind: 'item' }, level('qty', 'How many it makes', 1, 3)] },
      { id: 'ability', name: 'Ability', blurb: 'A new power, written on a scroll for your bag.', tier: 'moderate', makes: 'ability',
        fields: [NAME, DESCRIPTION, choice('effect', 'What it does', [['strike', 'A heavy blow at a creature in reach'], ['bolt', 'Hits a creature up to five steps away'], ['heal', 'Mends the one who uses it']]), ...LOOK] },
    ],
  },
  {
    id: 'living', name: 'Living things', blurb: 'Creatures to meet and people to talk to.', picture: 'woods-mushroom',
    subs: [
      { id: 'creature', name: 'Creature', blurb: 'A few of them appear near you.', tier: 'moderate', makes: 'creature',
        fields: [NAME, DESCRIPTION,
          choice('behavior', 'How it acts', [['wander', 'Wanders, fights back'], ['guard', 'Guards its spot'], ['chase', 'Hunts anyone it sees'],
            ['patrol', 'Walks rounds and attacks anyone it meets'], ['timid', 'Shy: runs from anyone close'], ['pack', 'Roams and hunts in packs']]),
          choice('active', 'When it is about', [['always', 'Day and night'], ['day', 'By day, asleep at night'], ['night', 'By night, asleep by day']], true),
          level('level', 'Level', 1, 6), level('count', 'How many', 1, 5),
          { key: 'drops', label: 'What it may drop', kind: 'items', optional: true }, ...LOOK] },
      { id: 'loot', name: 'Creature loot', blurb: 'Something a creature of the world may drop when it is defeated.', tier: 'moderate', makes: 'loot',
        fields: [{ key: 'creature', label: 'Which creature', kind: 'creature' },
          { key: 'drops', label: 'What it may drop', kind: 'items' },
          level('chance', 'How often, in 100 defeats', 5, MAX_WISHED_CHANCE * 100), level('qty', 'How many at a time', 1, MAX_WISHED_DROP_QTY)] },
      { id: 'person', name: 'Person', blurb: 'Someone who stands beside you and talks.', tier: 'moderate', makes: 'npc',
        fields: [NAME, DESCRIPTION, { key: 'greeting', label: 'What they say when spoken to', kind: 'long', length: 280 }, ...LOOK] },
      { id: 'look', name: 'Your look', blurb: 'Change how you look. Your new picture replaces the old one.', tier: 'minor', makes: 'player',
        fields: [{ key: 'description', label: 'How you look, in your own words', kind: 'long', length: MAX_LOOK_LENGTH, hint: 'a tall fox-eared ranger in a moss-green cloak' }, ...LOOK] },
    ],
  },
  {
    id: 'play', name: 'Ways to play', blurb: 'New things to do, built as rules the Stewards check.', picture: 'shore-crab-knight',
    subs: [
      { id: 'gathering', name: 'Gathering', blurb: 'Fishing, foraging, mining: something you do beside water, trees or rocks.', tier: 'major', makes: 'rule',
        fields: [NAME, brief('what', 'What you do', 'cast a line into the water'), choice('where', 'Beside', [['water', 'Water'], ['tree', 'Trees'], ['rock', 'Rocks']]), brief('reward', 'What you get', 'small fish often, a golden carp rarely'), brief('often', 'How often', 'once a minute', true)] },
      { id: 'item-magic', name: 'Item magic', blurb: 'Using an item does something new.', tier: 'major', makes: 'rule',
        fields: [NAME, brief('item', 'The item', 'a seashell'), brief('what', 'What using it does', 'it whistles and a gull brings you a fish')] },
      { id: 'hunting', name: 'Hunting rewards', blurb: 'Something happens when creatures are defeated.', tier: 'major', makes: 'rule',
        fields: [NAME, brief('which', 'Which creatures', 'sun scarabs'), brief('reward', 'The reward', 'sometimes a scarab gem')] },
      { id: 'gifts', name: 'Gifts and greetings', blurb: 'Something that happens when you arrive somewhere, or every so often.', tier: 'major', makes: 'rule',
        fields: [NAME, brief('when', 'When', 'the first time each day you enter the Shore'), brief('what', 'What happens', 'the trader gives you a shell')] },
    ],
  },
  {
    id: 'places', name: 'Places', blurb: 'New lands at the edge of the world, and buildings.', picture: 'shore-lighthouse',
    subs: [
      { id: 'region', name: 'New region', blurb: 'A whole land beyond the edge of the world nearest you.', tier: 'moderate', makes: 'region',
        fields: [NAME, DESCRIPTION, choice('biome', 'What kind of land', BIOME_CHOICES), level('danger', 'How dangerous', 1, 6),
          level('trees', 'Trees (0 to 3)', 0, 3), level('rocks', 'Rocks (0 to 3)', 0, 3), level('water', 'Water (0 to 3)', 0, 3),
          { key: 'creature', label: 'A creature that lives there', kind: 'creature' },
          { key: 'creatureName', label: 'Or a new creature: its name', kind: 'text', length: 40, optional: true },
          { key: 'creatureHook', label: 'The new creature: the one feature you would know it by', kind: 'text', length: 120, optional: true },
          { key: 'npcName', label: 'Someone who lives there (optional): their name', kind: 'text', length: 40, optional: true },
          { key: 'npcGreeting', label: 'What they say', kind: 'text', length: 280, optional: true }] },
      { id: 'building', name: 'Building', blurb: 'A house, shop or tower you can walk into, built by the coding agent.', tier: 'engine', makes: 'engine',
        fields: [NAME, brief('where', 'Where it stands', 'by the pond in the Sanctum'), brief('outside', 'How it looks outside', 'a crooked stone cottage with a mossy roof'),
          brief('inside', 'How it looks inside', 'one warm room with a hearth'), brief('furniture', 'Furniture', 'a bed, a table, a herb rack', true)] },
    ],
  },
  {
    id: 'change', name: 'Change the game', blurb: 'Something the game cannot do yet, built as a code change the Owner reviews.', picture: 'sanctum-shrine',
    subs: [
      { id: 'screen', name: 'A new screen or control', blurb: 'A window, a button, a key, a map.', tier: 'engine', makes: 'engine',
        fields: [NAME, brief('what', 'What you want to do', 'see a map of every region'), brief('where', 'Where in the game', 'press M anywhere'), brief('why', 'Why it would help', 'it is easy to get lost', true)] },
      { id: 'world', name: 'How the world works', blurb: 'Weather, day and night, swimming, mounts.', tier: 'engine', makes: 'engine',
        fields: [NAME, brief('what', 'What changes', 'rain falls in the Woods now and then'), brief('example', 'An example', 'mushrooms grow faster while it rains', true)] },
    ],
  },
];

/** A subcategory by its category and id. */
export function wishSubcategory(category: string, sub: string): WishSubcategory | undefined {
  return WISH_CATEGORIES.find((c) => c.id === category)?.subs.find((s) => s.id === sub);
}

/** What a player has written so far, field by field. */
export type DraftFields = Record<string, unknown>;

/** A wish being shaped in the Workshop. */
export interface WishDraft {
  category: string;
  sub: string;
  fields: DraftFields;
  /** When it was last changed. */
  at: number;
  /** The wish card it was sent as; the draft goes once that card is confirmed. */
  card?: string;
  /** Fields the player wrote themselves; the God never changes them. */
  locked?: string[];
  /** The talk with the God about this draft, oldest first. */
  chat?: WorkshopLine[];
  /** Quick answers the God offered to its last question. */
  choices?: string[];
  /** A sample painted for this draft (when the Owner allows samples); used as the final art if the prompt is unchanged. */
  sample?: DraftSample;
}

/** A picture painted for a draft before it was sent. */
export interface DraftSample {
  /** The exact prompt it was painted from. */
  prompt: string;
  /** Where the picture is served. */
  url: string;
  at: number;
  /** How it was painted, kept for the wish's record if the sample becomes its art. */
  references: string[];
  note?: string;
  provider: string;
  model: string;
  usd: number;
}

/** One line of the Workshop talk. */
export interface WorkshopLine {
  who: 'you' | 'god';
  text: string;
}

/** Lines of Workshop talk kept with a draft (and remembered by the God). */
export const MAX_WORKSHOP_LINES = 12;
/** Quick answers the God may offer at once. */
export const MAX_CHOICES = 3;

/** What a draft makes once its fields are read: a definition for the God to grant, or a brief for people to build. */
export interface CheckedDraft {
  tier: WishTier;
  /** What its subcategory makes, so an unfinished draft can still be priced. */
  makes?: WishSubcategory['makes'];
  title: string;
  summary: string;
  definition?: WishDefinition;
  /** For wishes people build: the brief, one "Label: answer" line per field. */
  brief?: string[];
  /** Things to fix before it can be sent, in plain words. */
  problems: string[];
}

/** The longest any single field may be, in characters (a long answer or a list). */
export const MAX_FIELD_LENGTH = 400;

/**
 * Reads a draft into what it would make and what is still missing. Never
 * throws: a definition the game would refuse becomes a problem to show.
 * `who` is the player's name, which a new look is painted under.
 */
export function checkDraft(draft: Pick<WishDraft, 'category' | 'sub' | 'fields'>, who = 'You'): CheckedDraft {
  const sub = wishSubcategory(draft.category, draft.sub);
  const checked = readDraft(draft, who);
  return sub ? { ...checked, makes: sub.makes } : checked;
}

function readDraft(draft: Pick<WishDraft, 'category' | 'sub' | 'fields'>, who: string): CheckedDraft {
  const sub = wishSubcategory(draft.category, draft.sub);
  if (!sub) return { tier: 'refused', title: '', summary: '', problems: ['Pick what kind of wish this is.'] };
  const f = draft.fields;
  const problems: string[] = [];
  for (const field of sub.fields) {
    // A colour is asked for, not assumed: the picker's starting colour would otherwise override the player's words.
    if (field.optional || field.kind === 'number' || field.kind === 'items') continue;
    // A region may bring a new creature instead of one that exists.
    if (field.kind === 'creature' && str(f.creatureName)) continue;
    if (field.kind === 'materials' ? !materials(f[field.key]).length : !str(f[field.key])) problems.push(missing(field));
  }
  const title = sub.makes === 'player' ? 'Your new look' : str(f.name) || sub.name;
  if (sub.makes === 'rule' || sub.makes === 'engine') {
    const lines = sub.fields.filter((x) => x.key !== 'name' && str(f[x.key])).map((x) => `${x.label}: ${str(f[x.key])}`);
    const first = sub.fields.find((x) => x.key !== 'name' && str(f[x.key]));
    const summary = `${sub.name}: ${first ? str(f[first.key]) : title}`.slice(0, 240);
    return { tier: sub.tier, title, summary, brief: [`${sub.name}: ${title}`, ...lines], problems };
  }
  if (problems.length) return { tier: sub.tier, title, summary: str(f.description), problems };
  try {
    const raw = rawDefinition(sub, f);
    const definition = sub.makes === 'player' ? validateLookWish({ ...raw, name: who }) : validateDefinition(raw);
    return { tier: contentTier(definition), title: definition.kind === 'player' ? title : definition.name, summary: definition.description || definition.name, definition, problems };
  } catch (err) {
    if (!(err instanceof WishError)) throw err;
    return { tier: sub.tier, title, summary: str(f.description), problems: [err.message] };
  }
}

/** Favor a checked draft costs to grant; wishes people build are free to ask. */
export function draftCost(checked: CheckedDraft): number {
  if (checked.definition) return wishCost(checked.definition);
  return checked.makes === 'region' ? REGION_WISH_COST : WISH_COSTS[checked.tier];
}

/** The raw definition a draft describes, before validateDefinition cleans it. */
function rawDefinition(sub: WishSubcategory, f: DraftFields): Record<string, unknown> {
  const base = { kind: sub.makes, name: str(f.name), description: str(f.description), ...sub.fixed };
  const look = { hook: str(f.hook), body: str(f.body), color: str(f.color), mood: str(f.mood) };
  switch (sub.makes) {
    case 'item': return { ...base, itemKind: sub.fixed?.itemKind ?? str(f.itemKind), heal: num(f.heal), rarity: str(f.rarity), focus: str(f.focus), family: str(f.family), look };
    case 'recipe': return { ...base, materials: materials(f.materials), result: { item: str(f.result), qty: num(f.qty) ?? 1 } };
    case 'ability': return { ...base, effect: str(f.effect), look };
    case 'creature': return { ...base, behavior: str(f.behavior), active: str(f.active), level: num(f.level), count: num(f.count), drops: list(f.drops), look };
    case 'npc': return { ...base, greeting: str(f.greeting), look };
    case 'loot': return { ...base, creature: str(f.creature), drops: list(f.drops).map((item) => ({ item, chance: (num(f.chance) ?? 25) / 100, qty: num(f.qty) ?? 1 })) };
    case 'player': return { ...base, look };
    case 'region': {
      const creature = str(f.creatureName)
        ? { name: str(f.creatureName), description: `${str(f.creatureName)}, living in ${str(f.name)}.`, behavior: 'wander', look: { hook: str(f.creatureHook) } }
        : { existing: str(f.creature) };
      const npc = str(f.npcName) ? { name: str(f.npcName), description: `${str(f.npcName)} of ${str(f.name)}.`, greeting: str(f.npcGreeting) } : undefined;
      return { ...base, biome: str(f.biome), danger: num(f.danger), trees: num(f.trees), rocks: num(f.rocks), water: num(f.water), creatures: [creature], ...(npc ? { npc } : {}) };
    }
    default: return base;
  }
}

function missing(field: WorkshopField): string {
  if (field.key === 'name') return 'Give it a name.';
  if (field.key === 'hook') return 'Describe the one feature you would know it by.';
  if (field.key === 'body') return 'Describe its body and shape.';
  if (field.kind === 'color') return 'Choose its main colour.';
  if (field.kind === 'choice' || field.kind === 'item' || field.kind === 'creature') return `Choose ${lower(field.label)}.`;
  if (field.kind === 'materials') return 'Add at least one thing the recipe takes.';
  return `Fill in "${field.label}".`;
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Cleans what a client sent for a draft's fields: only the subcategory's own
 * fields, text trimmed to length, lists bounded. The server keeps only this.
 */
export function cleanDraftFields(sub: WishSubcategory, raw: unknown): DraftFields {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: DraftFields = {};
  for (const field of sub.fields) {
    const v = r[field.key];
    if (v === undefined || v === null || v === '') continue;
    if (field.kind === 'materials') out[field.key] = materials(v);
    else if (field.kind === 'items') out[field.key] = list(v);
    else if (field.kind === 'number') {
      const n = num(v);
      if (n !== undefined) out[field.key] = Math.min(field.max ?? n, Math.max(field.min ?? n, n));
    } else if (field.kind === 'choice') {
      if (field.options?.some((o) => o.value === v)) out[field.key] = v;
    } else if (typeof v === 'string') out[field.key] = v.replace(/\s+/g, ' ').trim().slice(0, field.length ?? 64);
  }
  return out;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 64).slice(0, 3) : [];
}

function materials(v: unknown): { item: string; qty: number }[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((m) => {
    const slot = (m ?? {}) as Record<string, unknown>;
    return typeof slot.item === 'string' && slot.item && slot.item.length <= 64 ? [{ item: slot.item, qty: Math.min(10, Math.max(1, num(slot.qty) ?? 1)) }] : [];
  }).slice(0, 4);
}

/** Keeps only lock names that are fields of the subcategory. */
export function cleanLocks(sub: WishSubcategory, raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const keys = new Set(sub.fields.map((f) => f.key));
  return [...new Set(raw.filter((k): k is string => typeof k === 'string' && keys.has(k)))];
}

/**
 * Applies fields the God suggested to a draft: cleaned like the player's own,
 * and never touching a locked field. Returns the new fields and which changed.
 */
export function mergeGodFields(sub: WishSubcategory, fields: DraftFields, patch: unknown, locked: string[] = []): { fields: DraftFields; changed: string[] } {
  const clean = cleanDraftFields(sub, patch);
  const out = { ...fields };
  const changed: string[] = [];
  for (const [key, value] of Object.entries(clean)) {
    if (locked.includes(key) || JSON.stringify(out[key]) === JSON.stringify(value)) continue;
    out[key] = value;
    changed.push(key);
  }
  return { fields: out, changed };
}

/** Whether a draft field is still empty. */
export function fieldEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * The Workshop subcategory a finished wish belongs to, and its fields, so a
 * wish offered in Talk can be shaped further in the Workshop.
 */
export function draftFromDefinition(def: WishDefinition): { category: string; sub: string; fields: DraftFields } | undefined {
  const look = 'look' in def && def.look ? { hook: def.look.hook, body: def.look.body, color: def.look.color, mood: def.look.mood } : {};
  const base = { name: def.name, description: def.description, ...look };
  const pick = (category: string, subId: string, fields: Record<string, unknown>) => {
    const sub = wishSubcategory(category, subId);
    return sub ? { category, sub: subId, fields: cleanDraftFields(sub, { ...base, ...fields }) } : undefined;
  };
  switch (def.kind) {
    case 'item': {
      const kind = def.itemKind;
      if (kind === 'consumable') return pick('carry', 'potion', { heal: def.heal });
      if (kind === 'trinket') return pick('carry', 'keepsake', {});
      if (kind === 'material') return pick('carry', 'material', {});
      return pick('carry', 'gear', { itemKind: kind, rarity: def.rarity, focus: def.focus, family: def.family });
    }
    case 'recipe': return pick('know', 'recipe', { materials: def.materials, result: def.result.item, qty: def.result.qty });
    case 'ability': return pick('know', 'ability', { effect: def.effect });
    case 'creature': return pick('living', 'creature', { behavior: def.behavior, active: def.active ?? 'always', level: def.level, count: def.count, drops: def.drops });
    case 'npc': return pick('living', 'person', { greeting: def.greeting });
    case 'loot': return pick('living', 'loot', { creature: def.creature, drops: def.drops.map((d) => d.item), chance: Math.round((def.drops[0]?.chance ?? 0.25) * 100), qty: def.drops[0]?.qty ?? 1 });
    case 'player': return pick('living', 'look', {});
    case 'region': {
      const first = def.creatures[0];
      const creature = first?.existing !== undefined ? { creature: first.existing } : { creatureName: first?.name, creatureHook: first?.look?.hook };
      const npc = def.npc ? { npcName: def.npc.name, npcGreeting: def.npc.greeting } : {};
      return pick('places', 'region', { biome: def.biome, danger: def.danger, trees: def.trees, rocks: def.rocks, water: def.water, ...creature, ...npc });
    }
    default: return undefined;
  }
}

// --- Previews ------------------------------------------------------------------

/** One picture the image model would paint, exactly as it would be asked. */
export interface PicturePreview {
  /** What the picture is of, e.g. "Lantern Moth" or "Frostpeak ground (painted once for every Frostpeak region)". */
  label: string;
  /** Text the provider sends between the reference images and the prompt, when it adds any. */
  note?: string;
  prompt: string;
  /** Built-in anchors sent as style references; the client shows them from art/<id>.png. */
  references: string[];
}

export interface ArtPreview {
  /** The image model chosen in God's View, or null when none is. */
  model: string | null;
  /** About what one picture costs, US dollars, when known. */
  usdEach?: number;
  /** Why it would not be painted now, if so. */
  notice?: string;
  /** The built-in picture it wears until its own is painted. */
  placeholder: string;
  pictures: PicturePreview[];
  /** The player's own words, to tell apart from the Style Bible's in the prompt. */
  mine: string[];
  /** Painting a sample now, when the Owner has switched samples on. */
  sample?: SamplePreview;
}

/** Whether a sample can be painted for this draft, and the one already painted. */
export interface SamplePreview {
  /** Favor a sample costs. */
  favor: number;
  /** Why a sample cannot be painted now, in plain words. */
  blocked?: string;
  /** The sample painted for this draft, if any. */
  url?: string;
  /** Whether the painted sample still matches the prompt, so it becomes the final art. */
  current?: boolean;
}

/** Everything the Workshop shows about a draft before it is sent. Worked out by the server. */
export interface DraftPreview {
  card: Omit<WishCard, 'id'>;
  /** The numbers the world sets, which the player does not choose. */
  world: string[];
  /** For wishes people build: what happens after sending. */
  plan?: string[];
  art?: ArtPreview;
}

/** A draft as the Workshop shows it: the draft, what is missing, and the preview. */
export interface DraftView {
  draft: WishDraft;
  problems: string[];
  preview: DraftPreview;
}

/** Plain lines about what happens to a wish people build, once it is sent. */
export function reviewPlan(tier: WishTier): string[] {
  if (tier === 'engine') {
    return [
      'The Owner reads this brief and decides.',
      'If approved, a coding agent builds it as a change to the game, with tests.',
      'The Owner reviews that change, and it arrives with the next game update.',
    ];
  }
  return [
    'The Stewards read this brief, and the God drafts a scripted rule from it.',
    'The rule is tried in a copy of the world before a Steward can approve it.',
    'Its items are painted once it goes live.',
  ];
}

/** The numbers a granted wish gets from the world's own rules, never from the wish. */
export function worldLines(def: WishDefinition): string[] {
  const named = (id: string) => ITEMS[id]?.name ?? id;
  switch (def.kind) {
    case 'item': {
      const item = itemFromWish('preview', def);
      if (item.kind === 'equipment') return [`${cap(item.rarity ?? 'common')} ${item.slot}: ${bonusText(item.bonus) || 'no bonus'}.`, `Sells for about ${item.value} gold.`];
      if (item.heal) return [`Heals ${item.heal} health when used.`];
      return ['Kept in your bag; it can be traded or sold.'];
    }
    case 'recipe':
      return [`Takes ${def.materials.map((m) => `${m.qty} ${named(m.item)}`).join(', ')}; makes ${def.result.qty} ${named(def.result.item)}.`, 'Everyone can make it from the crafting book (C).'];
    case 'ability': {
      const a = abilityFromWish(def);
      const reach = a.effect === 'heal' ? 'Mends you' : a.effect === 'bolt' ? `Reaches ${a.range} steps` : 'Strikes a creature in reach';
      return [`${reach}: power ${a.base} plus ${a.factor} times your ${cap(a.stat)}.`, `Costs ${a.energy} Energy, then rests ${a.cooldown} seconds.`];
    }
    case 'creature': {
      const c = creatureFromWish('preview', def);
      const drops = def.drops?.length ? ` May drop ${def.drops.map(named).join(', ')} (1 in 4 each).` : '';
      return [`${def.count} appear near you. Each has ${c.hp} health and hits for ${c.damage}.`, `Defeating one gives ${c.xp} XP and up to ${c.gold[1]} gold.${drops}`];
    }
    case 'npc':
      return [`Stands beside you and greets anyone who talks to them: "${def.greeting}"`];
    case 'region': {
      const kinds = def.creatures.map((c) => (c.existing !== undefined ? CREATURES[c.existing]?.name ?? c.existing : c.name));
      return [
        `A ${BIOMES[def.biome].name} land, danger ${def.danger}: new creatures there are level ${def.danger}.`,
        `Home to ${kinds.join(' and ')}${def.npc ? `, and ${def.npc.name}` : ''}. A road joins it to the world.`,
      ];
    }
    case 'player':
      return ['Your look, painted from your words.'];
    case 'loot': {
      const creature = CREATURES[def.creature]?.name ?? def.creature;
      const now = lootTable(def.creature).filter((l) => !def.drops.some((d) => d.item === l.item));
      return [
        ...def.drops.map((d) => `Every ${creature} may drop ${(d.qty ?? 1) > 1 ? `${d.qty} × ` : ''}${named(d.item)} (${chanceText(d.chance)} of the time).`),
        now.length ? `It keeps what it drops now: ${now.map((l) => named(l.item)).join(', ')}.` : 'It dropped nothing before.',
        'Anyone can take what is left on its body.',
      ];
    }
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
