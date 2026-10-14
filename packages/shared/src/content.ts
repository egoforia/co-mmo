// Wished content: what the God's wish compiler produces, the checks it must
// pass, and how a granted wish becomes ordinary game data. Wishes are data
// the engine already understands (design doc, "How wishes become
// mechanics", layer 1), never code.

import { CREATURES, ITEMS, NPC_GREETINGS, type Behavior, type CreatureDef, type ItemDef } from './rpg.ts';

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
  /** consumable items heal; trinkets and materials are kept. */
  itemKind: 'consumable' | 'material' | 'trinket';
  heal?: number;
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

export type WishDefinition = ItemWish | CreatureWish | NpcWish;

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
  /** Painted art, once generated: a URL path. Until then a tinted placeholder is drawn. */
  art?: string;
  /** Painted art for a rule's items, by item id. */
  itemArt?: Record<string, string>;
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
}

/** The parts of a content record (beyond the entry) that decide its progress. */
export interface WishTrack {
  draft?: { state: 'drafting' | 'ready' | 'failed' | 'impossible'; message?: string };
  test?: { passed: boolean; errors: string[]; summary: string[] };
  rule?: { paused: boolean; reason?: string };
}

export function wishProgress(entry: Pick<ContentEntry, 'status' | 'tier' | 'definition'> & WishTrack): WishProgress {
  const { status, draft, test, rule } = entry;
  if (status === 'rejected') return { state: 'closed', label: 'Not approved' };
  if (status === 'rolled-back') return { state: 'closed', label: 'Undone' };
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
  if (!('kind' in def)) return 'itemKind' in def && def.itemKind === 'consumable' ? 'item-tonic' : 'item-goat-horn';
  if (def.kind === 'item') return def.itemKind === 'consumable' ? 'item-tonic' : 'item-goat-horn';
  if (def.kind === 'npc') return 'sanctum-pilgrim';
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
  const look = cleanLook(d.look);
  if (d.kind === 'item') {
    const itemKind = d.itemKind === 'consumable' || d.itemKind === 'material' ? d.itemKind : 'trinket';
    const heal = itemKind === 'consumable' ? clamp(Math.round(Number(d.heal) || 20), 5, MAX_WISHED_HEAL) : undefined;
    return { kind: 'item', name, description, itemKind, ...(heal ? { heal } : {}), look };
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
  throw new WishError('The God can only make items, creatures and people so far.');
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
  return {
    name: w.name,
    kind: w.itemKind === 'consumable' ? 'consumable' : 'material',
    art: wishArtKey(id),
    description: w.description,
    ...(w.heal ? { heal: w.heal } : {}),
  };
}

/**
 * Registers a granted wish's definitions with the shared registries, so the
 * server's rules and the client's screens treat it like built-in content.
 */
export function applyContent(entry: ContentEntry): void {
  const d = entry.definition;
  if (!d) return;
  if (entry.status !== 'granted') return removeContent(entry);
  if (d.kind === 'rule') {
    for (const [key, item] of Object.entries(d.items)) ITEMS[ruleItemId(entry.id, key)] = itemFromWish(ruleItemId(entry.id, key), item);
  } else if (d.kind === 'item') ITEMS[entry.id] = itemFromWish(entry.id, d);
  else if (d.kind === 'creature') CREATURES[entry.id] = creatureFromWish(entry.id, d);
  else NPC_GREETINGS[entry.id] = d.greeting;
}

export function removeContent(entry: ContentEntry): void {
  if (entry.definition?.kind === 'rule') for (const key of Object.keys(entry.definition.items)) delete ITEMS[ruleItemId(entry.id, key)];
  delete ITEMS[entry.id];
  delete CREATURES[entry.id];
  delete NPC_GREETINGS[entry.id];
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
