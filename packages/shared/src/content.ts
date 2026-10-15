// Wished content: what the God's wish compiler produces, the checks it must
// pass, and how a granted wish becomes ordinary game data. Wishes are data
// the engine already understands (design doc, "How wishes become
// mechanics", layer 1), never code.

import { BIOMES, type BiomeId } from './biomes.ts';
import { RECIPES } from './kit.ts';
import { WISHED_REGIONS, type RegionDef } from './world.ts';
import { hashString } from './random.ts';
import {
  ABILITIES,
  CREATURES,
  EQUIP_SLOTS,
  ITEMS,
  NPC_GREETINGS,
  RARITIES,
  equipmentBonus,
  type AbilityDef,
  type AbilityEffect,
  type Behavior,
  type CreatureDef,
  type EquipSlot,
  type InventorySlot,
  type ItemDef,
  type Rarity,
  type Stats,
} from './rpg.ts';

export type WishTier = 'minor' | 'moderate' | 'major' | 'engine' | 'refused';

/** How a wished thing should look; becomes an image prompt, or a tinted placeholder. */
export interface WishLook {
  /** The one feature you would recognise it by. */
  hook: string;
  /** Body and shape in a sentence. */
  body: string;
  /** Main colour as #rrggbb; tints the placeholder until the art is painted. */
  color: string;
  mood: string;
}

export interface ItemWish {
  kind: 'item';
  name: string;
  description: string;
  /** consumable items heal; trinkets and materials are kept; the rest are worn in that slot. */
  itemKind: 'consumable' | 'material' | 'trinket' | EquipSlot;
  heal?: number;
  /** Equipment: how rare it is (Common to Rare for wishes) and which stat it helps. */
  rarity?: Rarity;
  focus?: keyof Stats;
  look: WishLook;
}

/** A new way to make something from materials (design doc, Crafting: new recipes can be wished). */
export interface RecipeWish {
  kind: 'recipe';
  name: string;
  description: string;
  /** Existing item ids and how many of each it takes. */
  materials: InventorySlot[];
  /** The existing item it makes, and how many. */
  result: InventorySlot;
}

/** A new ability, taught by a scroll that appears in the wisher's bag. */
export interface AbilityWish {
  kind: 'ability';
  name: string;
  description: string;
  effect: AbilityEffect;
  /** How the scroll looks. */
  look: WishLook;
}

export interface CreatureWish {
  kind: 'creature';
  name: string;
  description: string;
  behavior: Behavior;
  level: number;
  /** How many appear around the wisher. */
  count: number;
  /** Existing item ids it may drop. */
  drops?: string[];
  look: WishLook;
}

export interface NpcWish {
  kind: 'npc';
  name: string;
  description: string;
  /** What they say when spoken to. */
  greeting: string;
  look: WishLook;
}

/**
 * A player's own look, described in words when the character is created:
 * their first, free wish (design doc, Characters and progression).
 */
export interface PlayerLookWish {
  kind: 'player';
  /** The player's name. */
  name: string;
  /** Their words, as written. */
  description: string;
  look: WishLook;
}

/** A creature a wished region brings: one that already exists, or a new one. */
export type RegionCreature =
  | { existing: string; count: number }
  | (Omit<CreatureWish, 'kind' | 'level'> & { existing?: undefined });

/**
 * A new region beyond the world's edge (design doc, World structure: new
 * regions are added at the world's edges when players wish for them). Its
 * biome, danger, how wild it is, its creatures and its one person are data;
 * the layout is generated from them, the same on server and client.
 */
export interface RegionWish {
  kind: 'region';
  name: string;
  description: string;
  biome: BiomeId;
  /** 1 to 6: wished creatures there are this level. */
  danger: number;
  /** How thick each grows, 0 (none) to 3. */
  trees: number;
  rocks: number;
  water: number;
  creatures: RegionCreature[];
  npc?: Omit<NpcWish, 'kind'>;
}

export type WishDefinition = ItemWish | CreatureWish | NpcWish | PlayerLookWish | RecipeWish | AbilityWish | RegionWish;

/** Wished things that have one picture of their own (not recipes or regions). */
export type PicturedWish = Exclude<WishDefinition, RecipeWish | RegionWish>;

/** An item a scripted rule brings with it (fish for fishing, a rod). */
export type RuleItem = Omit<ItemWish, 'kind'>;

/**
 * A scripted rule: a new verb for the world (design doc, How wishes become
 * mechanics, layer 2). The script runs on the server in a sandbox; players
 * only ever see its name, how to play it and its items.
 */
export interface RuleWish {
  kind: 'rule';
  name: string;
  description: string;
  /** One line telling players how to use it ("Press E beside water while holding a Fishing Rod"). */
  howTo: string;
  /** Its own items, by short key; the script refers to them by that key. */
  items: Record<string, RuleItem>;
  /** Event script; stripped from what players receive. */
  script?: string;
}

export type Definition = WishDefinition | RuleWish;

/** pending and approved are for major and engine wishes, which people build. */
export type WishStatus = 'granted' | 'pending' | 'approved' | 'rejected' | 'rolled-back';

/** One entry in the content log, as every player sees it. */
export interface ContentEntry {
  id: string;
  wisher: { id: string; name: string };
  regionId: string;
  at: number;
  tier: WishTier;
  title: string;
  summary: string;
  status: WishStatus;
  favor: number;
  definition?: Definition;
  /** Where creatures and NPCs were placed. */
  placements?: { x: number; y: number }[];
  /** A wished region's square on the world grid. */
  cell?: { x: number; y: number };
  /** Painted art, once generated: a URL path. Until then a tinted placeholder is drawn. */
  art?: string;
  /** Painted art for the things a rule or region brings (items, creatures, its person), by id. */
  itemArt?: Record<string, string>;
  /** A wished region's biome kit (ground, water, trees, rocks), by art id, once painted. */
  kitArt?: Record<string, string>;
  /** Where the wish stands now, worked out by the server from its status, draft, test run and rule. */
  progress?: WishProgress;
}

/**
 * Where a wish stands, in four plain states (plus closed for rejected or
 * undone wishes): the God working on it, waiting for a person, stuck on an
 * error, or done.
 */
export type WishProgressState = 'in-progress' | 'needs-input' | 'error' | 'done' | 'closed';

export interface WishProgress {
  state: WishProgressState;
  /** A few words, e.g. "Waiting for a Steward". */
  label: string;
  /** Why, or what happens next. */
  detail?: string;
  /** Where to follow it: the pull request or issue a coding agent works on. */
  link?: string;
}

/**
 * An Engine wish (or a Major wish the God could not script) being built as
 * a code change (design doc, Building Engine wishes automatically):
 * queued, being built on a GitHub issue, waiting for the Owner's review of
 * the pull request, merged and waiting for the Updates tab, then live. It
 * can fail, be closed by the Owner, or be split into smaller wishes.
 */
export type BuildState = 'queued' | 'building' | 'review' | 'merged' | 'live' | 'failed' | 'closed' | 'split';

export interface BuildTrack {
  state: BuildState;
  /** When it entered this state. */
  at: number;
  /** The Owner's approval note, handed to the coding agent. */
  note?: string;
  /** The Owner allowed changes to sign-in, roles, the budget, keys and the sandbox. */
  allowCore?: boolean;
  issue?: { number: number; url: string };
  pr?: { number: number; url: string };
  /** The merge commit, so the server can tell when it is running it. */
  sha?: string;
  /** Why it failed, was closed or split, or why it still waits in the queue. */
  message?: string;
  /** A queued build that only a person can unblock (GitHub not connected yet). */
  held?: boolean;
  /** When the latest try started (its issue opened). */
  startedAt?: number;
  /** Tries so far (each opens a new issue). */
  tries?: number;
  /** The wisher heard that it went live. */
  told?: boolean;
}

/** The parts of a content record (beyond the entry) that decide its progress. */
export interface WishTrack {
  build?: BuildTrack;
  draft?: { state: 'drafting' | 'ready' | 'failed' | 'impossible'; message?: string };
  test?: { passed: boolean; errors: string[]; summary: string[] };
  rule?: { paused: boolean; reason?: string };
}

export function wishProgress(entry: Pick<ContentEntry, 'status' | 'tier' | 'definition'> & WishTrack): WishProgress {
  const { status, draft, test, rule, build } = entry;
  if (status === 'rejected') return { state: 'closed', label: 'Not approved' };
  if (status === 'rolled-back') return { state: 'closed', label: 'Undone' };
  if (build) {
    const built = buildProgress(status, build);
    if (built) return built;
  }
  if (status === 'granted') {
    if (rule?.paused) {
      const reason = rule.reason ?? '';
      return reason.startsWith('Paused by')
        ? { state: 'needs-input', label: 'Paused', detail: `${reason} A Steward can resume it in God's View.` }
        : { state: 'error', label: 'Stopped itself', detail: `${reason} A Steward can resume or roll it back in God's View.` };
    }
    return { state: 'done', label: entry.definition?.kind === 'rule' ? 'Live' : 'Done' };
  }
  if (status === 'approved') {
    return { state: 'needs-input', label: 'Approved, waiting to be built', detail: 'The God cannot build this alone yet; a person has to add it to the game.' };
  }
  // Pending.
  if (entry.tier === 'engine') return { state: 'needs-input', label: 'Waiting for the Owner', detail: 'Engine wishes change the game itself and need the Owner to approve them.' };
  if (entry.tier !== 'major') return { state: 'needs-input', label: 'Waiting for a Steward' };
  if (!draft) return { state: 'needs-input', label: 'Waiting for a Steward', detail: 'No rule drafted yet. A Steward can ask the God to draft one.' };
  if (draft.state === 'drafting') return { state: 'in-progress', label: 'The God is drafting a rule', detail: 'It is written, then put through a test run.' };
  if (draft.state === 'failed') return { state: 'error', label: 'Drafting failed', detail: `${draft.message ?? 'Unknown error.'} A Steward can ask the God to try again.` };
  // A drafted rule that failed its test run, even if a later try gave up.
  if (test && !test.passed) {
    return { state: 'error', label: 'Test run failed', detail: `${test.errors[0] ?? test.summary[0] ?? 'The drafted rule did not pass.'} A Steward can ask the God to revise it.` };
  }
  if (draft.state === 'impossible') return { state: 'needs-input', label: 'Waiting for a Steward', detail: `The God cannot make this a scripted rule: ${draft.message ?? ''}`.trim() };
  return { state: 'needs-input', label: 'Ready, waiting for a Steward', detail: 'The rule passed its test run and waits for approval.' };
}

/** Where a code-change wish stands; undefined hands back to the usual steps. */
function buildProgress(status: WishStatus, b: BuildTrack): WishProgress | undefined {
  const link = b.pr?.url ?? b.issue?.url;
  const withLink = (p: WishProgress): WishProgress => (link ? { ...p, link } : p);
  switch (b.state) {
    case 'live':
      return { state: 'done', label: 'Live' };
    case 'split':
      return { state: 'closed', label: 'Split into smaller wishes', detail: b.message };
    case 'closed':
      return status === 'pending'
        ? withLink({ state: 'needs-input', label: 'Waiting for the Owner', detail: `The pull request was closed${b.message ? `: ${b.message}` : '.'} Approve it to build again, or reject it.` })
        : undefined;
    case 'queued':
      return b.held
        ? { state: 'needs-input', label: 'Queued to be built', detail: b.message ?? 'Waiting for the Owner to connect GitHub.' }
        : { state: 'in-progress', label: 'Queued to be built', detail: b.message ?? 'It is built when the wishes before it are done.' };
    case 'building':
      return withLink({ state: 'in-progress', label: 'Being built', detail: 'A coding agent is writing the change and its tests.' });
    case 'review':
      return withLink({ state: 'needs-input', label: "Waiting for the Owner's review", detail: 'The change passed its checks. The Owner merges it, asks for changes, or closes it.' });
    case 'merged':
      return withLink({ state: 'in-progress', label: 'Updating', detail: "Merged. It goes live when God's View's Updates tab pulls main and restarts the game." });
    case 'failed':
      return withLink({ state: 'error', label: 'Build failed', detail: `${b.message ?? 'The coding agent gave up.'} The Owner can try again or reject it.` });
  }
}

/** The wish card a player confirms before anything is built. */
export interface WishCard {
  id: string;
  tier: WishTier;
  title: string;
  summary: string;
  /** Favor it costs; 0 for wishes that wait for review. */
  cost: number;
  /** Where it will appear. */
  where: string;
  /** False when it waits for a Steward or the Owner instead of appearing now. */
  instant: boolean;
}

export const WISH_COSTS: Record<WishTier, number> = { minor: 2, moderate: 6, major: 0, engine: 0, refused: 0 };
export const MAX_WISHED_LEVEL = 6;
export const MAX_WISHED_COUNT = 5;
export const MAX_WISHED_HEAL = 50;
export const MAX_RULE_ITEMS = 6;
export const MAX_SCRIPT_LENGTH = 8000;
/** Wished equipment is at most this rare; Epic and Legendary things are earned, not wished. */
export const MAX_WISHED_RARITY: Rarity = 'rare';
export const MAX_RECIPE_MATERIALS = 4;
/** A region is the biggest wish the God grants at once, and costs more than one creature. */
export const REGION_WISH_COST = 12;
/** Kinds of creature a wished region may bring, and how many of each at most. */
export const MAX_REGION_CREATURE_KINDS = 2;
export const MAX_REGION_CREATURES = 6;
export const MAX_RECIPE_RESULT = 3;

/** The tier a buildable wish costs: things for your bag are minor, the rest moderate. */
export function contentTier(def: WishDefinition): 'minor' | 'moderate' {
  return def.kind === 'item' || def.kind === 'recipe' ? 'minor' : 'moderate';
}

/** Favor a buildable wish costs: its tier's price, more for a whole region. */
export function wishCost(def: WishDefinition): number {
  return def.kind === 'region' ? REGION_WISH_COST : WISH_COSTS[contentTier(def)];
}

/** The id of the i-th new creature a wished region brings. */
export function regionCreatureId(entryId: string, i: number): string {
  return `${entryId}-c${i}`;
}

/** The id of the person a wished region brings. */
export function regionNpcId(entryId: string): string {
  return `${entryId}-npc`;
}

/** Things a region wish brings that each have a picture, by id. */
export function regionPictures(entryId: string, def: RegionWish): { id: string; def: CreatureWish | NpcWish }[] {
  const pictures: { id: string; def: CreatureWish | NpcWish }[] = [];
  def.creatures.forEach((c, i) => {
    if (c.existing === undefined) pictures.push({ id: regionCreatureId(entryId, i), def: { kind: 'creature', ...c, level: def.danger } });
  });
  if (def.npc) pictures.push({ id: regionNpcId(entryId), def: { kind: 'npc', ...def.npc } });
  return pictures;
}

/**
 * The region a granted region wish adds, laid out from its definition. Its
 * exits are worked out by the world from where it sits.
 */
export function regionFromWish(entry: Pick<ContentEntry, 'id' | 'wisher' | 'cell' | 'definition'>): RegionDef | undefined {
  const d = entry.definition;
  if (d?.kind !== 'region' || !entry.cell) return undefined;
  return {
    id: entry.id,
    name: d.name,
    biome: d.biome,
    seed: hashString(entry.id) % 100_000,
    at: { ...entry.cell },
    exits: {},
    wild: {
      danger: d.danger,
      trees: d.trees,
      rocks: d.rocks,
      water: d.water,
      creatures: d.creatures.map((c, i) => {
        if (c.existing !== undefined) {
          const known = CREATURES[c.existing];
          return { kind: c.existing, name: known?.name ?? c.existing, asset: known?.art ?? c.existing, count: c.count };
        }
        const id = regionCreatureId(entry.id, i);
        return { kind: id, name: c.name, asset: wishArtKey(id), count: c.count };
      }),
      ...(d.npc ? { npc: { id: regionNpcId(entry.id), name: d.npc.name, asset: wishArtKey(regionNpcId(entry.id)) } } : {}),
      wisher: entry.wisher.name,
    },
  };
}

/** The built-in picture each equipment slot is drawn with until its own is painted. */
const SLOT_ART: Record<EquipSlot, string> = { weapon: 'item-wooden-sword', head: 'item-mushroom-hat', body: 'item-traveller-coat', charm: 'item-scarab-charm' };

/** The art key a wished thing is drawn with. */
export function wishArtKey(id: string): string {
  return `wished-${id}`;
}

/** A rule item's id: the wish's id and the item's key. */
export function ruleItemId(entryId: string, key: string): string {
  return `${entryId}-${key}`;
}

/** Built-in art drawn (tinted) until a wish's own art is painted. */
export function placeholderArt(def: WishDefinition | RuleItem): string {
  const itemArt = (kind: ItemWish['itemKind']) => kind === 'consumable' ? 'item-tonic' : (SLOT_ART as Record<string, string>)[kind] ?? 'item-goat-horn';
  if (!('kind' in def)) return itemArt(def.itemKind);
  if (def.kind === 'item') return itemArt(def.itemKind);
  if (def.kind === 'ability' || def.kind === 'recipe') return 'item-scroll';
  if (def.kind === 'npc') return 'sanctum-pilgrim';
  if (def.kind === 'player') return 'player-mara';
  if (def.kind === 'region') return 'sanctum-shrine';
  return def.behavior === 'chase' ? 'desert-scarab' : def.behavior === 'guard' ? 'shore-crab-knight' : 'woods-mushroom';
}

/**
 * Checks a compiled wish against the schema and the balance limits, and
 * returns a cleaned copy: lengths trimmed, numbers clamped, unknown drops
 * dropped. Throws with a message the God can relay when it cannot be fixed.
 */
export function validateDefinition(raw: unknown): WishDefinition {
  const d = (raw ?? {}) as Record<string, unknown>;
  const name = text(d.name, 40);
  const description = text(d.description, 240);
  if (!name) throw new WishError('It needs a name.');
  if (d.kind === 'recipe') return validateRecipe(name, description, d);
  const look = cleanLook(d.look);
  if (d.kind === 'item') {
    const slot = EQUIP_SLOTS.find((s) => s === d.itemKind);
    const itemKind = d.itemKind === 'consumable' || d.itemKind === 'material' ? d.itemKind : slot ?? 'trinket';
    const heal = itemKind === 'consumable' ? clamp(Math.round(Number(d.heal) || 20), 5, MAX_WISHED_HEAL) : undefined;
    if (!slot) return { kind: 'item', name, description, itemKind, ...(heal ? { heal } : {}), look };
    const rarity = RARITIES.slice(0, RARITIES.indexOf(MAX_WISHED_RARITY) + 1).find((r) => r === d.rarity) ?? 'common';
    const focus = (['might', 'agility', 'wit', 'spirit'] as const).find((k) => k === d.focus);
    return { kind: 'item', name, description, itemKind, rarity, ...(focus ? { focus } : {}), look };
  }
  if (d.kind === 'ability') {
    const effect: AbilityEffect = d.effect === 'bolt' || d.effect === 'heal' ? d.effect : 'strike';
    return { kind: 'ability', name, description, effect, look };
  }
  if (d.kind === 'creature') {
    const behavior: Behavior = d.behavior === 'guard' || d.behavior === 'chase' ? d.behavior : 'wander';
    const drops = Array.isArray(d.drops)
      ? d.drops.filter((i): i is string => typeof i === 'string' && !!ITEMS[i] && !ITEMS[i]!.bound).slice(0, 3)
      : [];
    return {
      kind: 'creature',
      name,
      description,
      behavior,
      level: clamp(Math.round(Number(d.level) || 1), 1, MAX_WISHED_LEVEL),
      count: clamp(Math.round(Number(d.count) || 3), 1, MAX_WISHED_COUNT),
      drops,
      look,
    };
  }
  if (d.kind === 'npc') {
    const greeting = text(d.greeting, 280) || `Hello, traveller. I am ${name}.`;
    return { kind: 'npc', name, description, greeting, look };
  }
  if (d.kind === 'region') return validateRegion(name, description, d);
  throw new WishError('The God can only make items, creatures, people, recipes, abilities and new regions so far.');
}

/**
 * A region needs a biome (there is only one Sanctum), a danger level and at
 * least one kind of creature; a person is optional. New creatures are as
 * strong as the region is dangerous.
 */
function validateRegion(name: string, description: string, d: Record<string, unknown>): RegionWish {
  const biome = (Object.keys(BIOMES) as BiomeId[]).find((b) => b === d.biome && b !== 'sanctum');
  if (!biome) throw new WishError('A new region needs a land to be: meadows, woods, mushrooms, shore, snow, embers, desert, swamp or sky ruins.');
  const danger = clamp(Math.round(Number(d.danger) || 1), 1, MAX_WISHED_LEVEL);
  const level = (v: unknown, fallback: number) => clamp(Math.round(Number(v ?? fallback)), 0, 3);
  const creatures: RegionCreature[] = [];
  for (const raw of Array.isArray(d.creatures) ? d.creatures : []) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const count = clamp(Math.round(Number(c.count) || 4), 1, MAX_REGION_CREATURES);
    if (typeof c.existing === 'string') {
      if (CREATURES[c.existing] && !creatures.some((x) => x.existing === c.existing)) creatures.push({ existing: c.existing, count });
    } else {
      try {
        const { kind: _k, level: _l, ...made } = validateDefinition({ ...c, kind: 'creature', level: danger }) as CreatureWish;
        creatures.push({ ...made, count });
      } catch (err) {
        if (!(err instanceof WishError)) throw err;
      }
    }
    if (creatures.length >= MAX_REGION_CREATURE_KINDS) break;
  }
  if (!creatures.length) throw new WishError('A new region needs at least one kind of creature to live there.');
  let npc: RegionWish['npc'];
  if (d.npc && typeof d.npc === 'object') {
    try {
      const { kind: _k, ...person } = validateDefinition({ ...(d.npc as object), kind: 'npc' }) as NpcWish;
      npc = person;
    } catch (err) {
      if (!(err instanceof WishError)) throw err;
    }
  }
  return {
    kind: 'region',
    name,
    description,
    biome,
    danger,
    trees: level(d.trees, 2),
    rocks: level(d.rocks, 1),
    water: level(d.water, 1),
    creatures,
    ...(npc ? { npc } : {}),
  };
}

/** A recipe must use things that exist, and give back no more than it takes. */
function validateRecipe(name: string, description: string, d: Record<string, unknown>): RecipeWish {
  const tradable = (id: unknown): id is string => typeof id === 'string' && !!ITEMS[id] && !ITEMS[id]!.bound;
  const materials: InventorySlot[] = [];
  for (const m of Array.isArray(d.materials) ? d.materials : []) {
    const slot = (m ?? {}) as Record<string, unknown>;
    if (!tradable(slot.item) || materials.some((x) => x.item === slot.item)) continue;
    materials.push({ item: slot.item, qty: clamp(Math.round(Number(slot.qty) || 1), 1, 10) });
    if (materials.length >= MAX_RECIPE_MATERIALS) break;
  }
  const r = (d.result ?? {}) as Record<string, unknown>;
  if (!materials.length) throw new WishError('A recipe needs materials that exist in the world.');
  if (!tradable(r.item)) throw new WishError('A recipe has to make something that exists in the world.');
  if (materials.some((m) => m.item === r.item)) throw new WishError('A recipe cannot use what it makes.');
  const taken = materials.reduce((sum, m) => sum + m.qty, 0);
  const qty = clamp(Math.round(Number(r.qty) || 1), 1, Math.min(MAX_RECIPE_RESULT, taken));
  return { kind: 'recipe', name, description, materials, result: { item: r.item, qty } };
}

/**
 * Checks a compiled rule: its name, how to play it, up to six items and a
 * script of bounded length. The script itself is checked by running it in
 * the sandbox (server/src/rules.ts), not here.
 */
export function validateRule(raw: unknown): RuleWish {
  const d = (raw ?? {}) as Record<string, unknown>;
  const name = text(d.name, 40);
  if (!name) throw new WishError('The rule needs a name.');
  const script = typeof d.script === 'string' ? d.script.trim() : '';
  if (!script) throw new WishError('The rule has no script.');
  if (script.length > MAX_SCRIPT_LENGTH) throw new WishError(`The script is longer than ${MAX_SCRIPT_LENGTH} characters.`);
  const items: Record<string, RuleItem> = {};
  const rawItems = d.items && typeof d.items === 'object' ? (d.items as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(rawItems).slice(0, MAX_RULE_ITEMS)) {
    const k = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
    if (!k) continue;
    const { kind: _k, ...item } = validateDefinition({ ...(value as object), kind: 'item' }) as ItemWish;
    items[k] = item;
  }
  return {
    kind: 'rule',
    name,
    description: text(d.description, 300),
    howTo: text(d.howTo, 200) || 'Ask the Stewards how it works.',
    items,
    script,
  };
}

export class WishError extends Error {}

/** Stats for a wished creature come from its level, never from the wish itself. */
export function creatureFromWish(id: string, w: CreatureWish): CreatureDef {
  const l = w.level;
  return {
    name: w.name,
    art: wishArtKey(id),
    description: w.description,
    behavior: w.behavior,
    level: l,
    hp: 14 + l * 8,
    damage: Math.round(2 + l * 1.5),
    cooldown: 1.3,
    speed: w.behavior === 'chase' ? 2.8 : 2.2,
    notice: w.behavior === 'chase' ? 4 : w.behavior === 'guard' ? 2.5 : 0,
    xp: 5 + l * 4,
    gold: [0, l * 2],
    drops: (w.drops ?? []).map((item) => ({ item, chance: 0.25 })),
    respawnSeconds: 25,
  };
}

export function itemFromWish(id: string, w: ItemWish | RuleItem): ItemDef {
  const slot = EQUIP_SLOTS.find((s) => s === w.itemKind);
  if (slot) {
    const rarity = w.rarity ?? 'common';
    return {
      name: w.name,
      kind: 'equipment',
      art: wishArtKey(id),
      description: w.description,
      slot,
      rarity,
      bonus: equipmentBonus(slot, rarity, w.focus),
      value: 10 * (RARITIES.indexOf(rarity) + 1),
    };
  }
  return {
    name: w.name,
    kind: w.itemKind === 'consumable' ? 'consumable' : 'material',
    art: wishArtKey(id),
    description: w.description,
    ...(w.heal ? { heal: w.heal } : {}),
  };
}

/** Numbers for a wished ability come from its effect, a little below the built-in ones. */
export function abilityFromWish(w: AbilityWish): AbilityDef {
  const base = { name: w.name, description: w.description, effect: w.effect };
  if (w.effect === 'bolt') return { ...base, energy: 6, cooldown: 3, range: 5, base: 2, stat: 'wit', factor: 1.3 };
  if (w.effect === 'heal') return { ...base, energy: 10, cooldown: 12, range: 0, base: 6, stat: 'spirit', factor: 2.5 };
  return { ...base, energy: 8, cooldown: 6, range: 1.8, base: 3, stat: 'might', factor: 1.3 };
}

/** The scroll a wished ability comes on; it shares the wish's id. */
export function scrollFromWish(id: string, w: AbilityWish): ItemDef {
  return {
    name: `Scroll of ${w.name}`,
    kind: 'scroll',
    art: wishArtKey(id),
    description: `Read it to learn ${w.name}: ${w.description}`.slice(0, 280),
    teaches: id,
    rarity: 'uncommon',
    value: 20,
  };
}

/** Who wished each thing into the world, by item, creature, person, recipe or ability id. */
const WISHERS = new Map<string, string>();

/** The player who wished for this thing, if anyone (for Creator XP). */
export function wisherOf(id: string): string | undefined {
  return WISHERS.get(id);
}

/**
 * Registers a granted wish's definitions with the shared registries, so the
 * server's rules and the client's screens treat it like built-in content.
 */
export function applyContent(entry: ContentEntry): void {
  const d = entry.definition;
  if (!d) return;
  if (entry.status !== 'granted') return removeContent(entry);
  if (d.kind === 'player') return;
  WISHERS.set(entry.id, entry.wisher.id);
  if (d.kind === 'rule') {
    for (const [key, item] of Object.entries(d.items)) {
      ITEMS[ruleItemId(entry.id, key)] = itemFromWish(ruleItemId(entry.id, key), item);
      WISHERS.set(ruleItemId(entry.id, key), entry.wisher.id);
    }
  } else if (d.kind === 'item') ITEMS[entry.id] = itemFromWish(entry.id, d);
  else if (d.kind === 'creature') CREATURES[entry.id] = creatureFromWish(entry.id, d);
  else if (d.kind === 'npc') NPC_GREETINGS[entry.id] = d.greeting;
  else if (d.kind === 'recipe') RECIPES[entry.id] = { name: d.name, materials: d.materials, result: d.result, wit: 0 };
  else if (d.kind === 'ability') {
    ABILITIES[entry.id] = abilityFromWish(d);
    ITEMS[entry.id] = scrollFromWish(entry.id, d);
  } else if (d.kind === 'region') {
    for (const picture of regionPictures(entry.id, d)) {
      if (picture.def.kind === 'creature') CREATURES[picture.id] = creatureFromWish(picture.id, picture.def);
      else NPC_GREETINGS[picture.id] = picture.def.greeting;
      WISHERS.set(picture.id, entry.wisher.id);
    }
    const region = regionFromWish(entry);
    if (region) WISHED_REGIONS.set(entry.id, region);
  }
}

export function removeContent(entry: ContentEntry): void {
  if (entry.definition?.kind === 'rule') {
    for (const key of Object.keys(entry.definition.items)) {
      delete ITEMS[ruleItemId(entry.id, key)];
      WISHERS.delete(ruleItemId(entry.id, key));
    }
  }
  if (entry.definition?.kind === 'region') {
    for (const picture of regionPictures(entry.id, entry.definition)) {
      delete CREATURES[picture.id];
      delete NPC_GREETINGS[picture.id];
      WISHERS.delete(picture.id);
    }
    WISHED_REGIONS.delete(entry.id);
  }
  delete ITEMS[entry.id];
  delete CREATURES[entry.id];
  delete NPC_GREETINGS[entry.id];
  delete RECIPES[entry.id];
  delete ABILITIES[entry.id];
  WISHERS.delete(entry.id);
}

export const MAX_LOOK_LENGTH = 300;

/** Colour words a look may mention, for the placeholder tint until it is painted. */
const LOOK_COLORS: [RegExp, string][] = [
  [/\b(crimson|scarlet|red)\b/, '#b13e53'],
  [/\b(orange|amber|copper)\b/, '#ef7d57'],
  [/\b(gold|golden|yellow|blond|blonde)\b/, '#e8c170'],
  [/\b(green|emerald|moss)\b/, '#38b764'],
  [/\b(teal|turquoise)\b/, '#257179'],
  [/\b(blue|azure|navy|sapphire)\b/, '#3b5dc9'],
  [/\b(purple|violet|lilac|plum)\b/, '#8a4fa8'],
  [/\b(pink|rose)\b/, '#e58fb5'],
  [/\b(brown|leather|chestnut)\b/, '#8b5a3c'],
  [/\b(white|silver|pale)\b/, '#d8dce6'],
  [/\b(black|dark|shadow)\b/, '#3a3550'],
  [/\b(grey|gray|ash)\b/, '#8a8aa0'],
];

/**
 * Turns a player's own words about how they look into their look wish.
 * Throws a WishError with a friendly message when there is nothing to draw.
 */
export function lookFromWords(name: string, raw: string): PlayerLookWish {
  const description = text(raw, MAX_LOOK_LENGTH);
  if (description.length < 3) throw new WishError('Tell the God a little about how you look.');
  const lower = description.toLowerCase();
  const color = LOOK_COLORS.find(([re]) => re.test(lower))?.[1] ?? '#c8a2c8';
  const first = description.split(/[.!?;]/)[0]!.trim();
  return {
    kind: 'player',
    name: text(name, 40),
    description,
    look: { hook: first.slice(0, 120) || description.slice(0, 120), body: `An adventurer: ${description}`.slice(0, 200), color, mood: 'warm and adventurous' },
  };
}

function cleanLook(raw: unknown): WishLook {
  const l = (raw ?? {}) as Record<string, unknown>;
  const color = typeof l.color === 'string' && /^#[0-9a-f]{6}$/i.test(l.color) ? l.color.toLowerCase() : '#c8a2c8';
  return {
    hook: text(l.hook, 120) || 'a striking silhouette',
    body: text(l.body, 200) || 'small and rounded',
    color,
    mood: text(l.mood, 60) || 'whimsical',
  };
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
