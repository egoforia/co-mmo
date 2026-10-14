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
  definition?: WishDefinition;
  /** Where creatures and NPCs were placed. */
  placements?: { x: number; y: number }[];
  /** Painted art, once generated: a URL path. Until then a tinted placeholder is drawn. */
  art?: string;
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

/** The art key a wished thing is drawn with. */
export function wishArtKey(id: string): string {
  return `wished-${id}`;
}

/** Built-in art drawn (tinted) until a wish's own art is painted. */
export function placeholderArt(def: WishDefinition): string {
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

export function itemFromWish(id: string, w: ItemWish): ItemDef {
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
  if (d.kind === 'item') ITEMS[entry.id] = itemFromWish(entry.id, d);
  else if (d.kind === 'creature') CREATURES[entry.id] = creatureFromWish(entry.id, d);
  else NPC_GREETINGS[entry.id] = d.greeting;
}

export function removeContent(entry: ContentEntry): void {
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
