import { addBonus, canLean, peopleLean, traitBonus } from './fashion.ts';
import { MATERIAL_TRAITS, type MaterialTrait } from './material-traits.ts';
import { RACES, isRace, type RaceId } from './races.ts';
import { ITEMS, RARITIES, bonusText, resolveCopiesWith, type Bonus, type ItemDef, type Rarity, type Stats } from './rpg.ts';

// Crafted copies (gather and craft plan, step 3). Every copy of a piece of
// gear looks the same, but a crafted one is its own copy: who made it
// ("Tailored by"), how well (quality, which sizes its bonus), and what the
// fashion plan adds on top (the maker's people, the main material's trait).
//
// A copy is an item id that carries all of that, `<base>~c~<quality>~...`, so
// bags, equipment, trades, shops, saves and every server and browser handle it
// as any other item without being told about it: ITEMS works its ItemDef out
// from the id. Materials, tonics and scrolls keep stacking under their own ids;
// gear held from before copies is a standard copy with no maker.

/** Quality is a percentage of the base item's bonus and value. */
export const QUALITY_MIN = 80;
export const QUALITY_MAX = 130;
export const QUALITY_STANDARD = 100;

/** What a copy carries beyond its base item. */
export interface CopyInfo {
  /** The base item it is a copy of. */
  of: string;
  /** 80 to 130: the share of the base item's bonus and value it has. */
  quality: number;
  /** Who made it: a player or a shopkeeper. */
  maker: { kind: 'player' | 'npc'; name: string };
  /** The maker's people, which sets the attribute lean (Region fashion plan). */
  people?: RaceId;
  /** Which of the people's two lifted attributes the maker gave the larger share; the first when not said. */
  lean?: keyof Stats;
  /** The main material's trait (Region fashion plan). */
  trait?: MaterialTrait;
  /** The main material used, by item id. */
  material?: string;
  /** A unique piece once worn: bound to its wearer, never traded or sold. */
  bound?: true;
}

const MARK = '~';
const TAG = 'c';
/** The tag of a unique piece that has been worn and is bound. */
const BOUND_TAG = 'b';
/** From this quality a copy is one rarity finer than its base item (common to uncommon, rare to epic). */
export const FINER_QUALITY = 115;
const PARTS = 8;

/** True when an id names a crafted copy. */
export function isCopyId(id: string): boolean {
  return id.includes(MARK);
}

/** The base item of a copy, or the id itself for anything else. */
export function copyBase(id: string): string {
  const at = id.indexOf(MARK);
  return at < 0 ? id : id.slice(0, at);
}

/** Only gear is made into copies; everything else stacks. */
export function makesCopies(def: ItemDef | undefined): boolean {
  return def?.kind === 'equipment';
}

/** Keeps a name to letters, digits and dashes, other characters as `.xx` bytes, so it never holds the mark. */
function encode(s: string): string {
  let out = '';
  for (const ch of s) {
    if (/[A-Za-z0-9-]/.test(ch)) out += ch;
    else for (const b of new TextEncoder().encode(ch)) out += `.${b.toString(16).padStart(2, '0')}`;
  }
  return out;
}

function decode(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '.') {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(s.charCodeAt(i));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Keeps a quality inside the limits, as a whole number. */
export function clampQuality(q: number): number {
  return Math.max(QUALITY_MIN, Math.min(QUALITY_MAX, Math.round(Number.isFinite(q) ? q : QUALITY_STANDARD)));
}

/** Longest a maker's name may take in an id, so every copy id fits a message (protocol.ts). */
const MAX_MAKER = 48;

/** A maker's name for an id: whole characters, cut to fit. */
function makerPart(name: string): string {
  let out = '';
  for (const ch of name.slice(0, 24)) {
    const next = out + encode(ch);
    if (next.length > MAX_MAKER) break;
    out = next;
  }
  return out;
}

/** The id of a new copy; `nonce` keeps two copies made alike apart. */
export function copyId(info: CopyInfo, nonce: string): string {
  const maker = `${info.maker.kind === 'npc' ? 'n' : 'p'}${makerPart(info.maker.name)}`;
  // The people part is "<people>" or "<people>-<leading attribute>" when the maker chose their second one.
  const people = info.people ? `${info.people}${info.lean && canLean(info.people, info.lean) && info.lean !== peopleLeanDefault(info.people) ? `-${info.lean}` : ''}` : '';
  return [copyBase(info.of), info.bound ? BOUND_TAG : TAG, clampQuality(info.quality), maker, people, info.trait ?? '', info.material ? copyBase(info.material) : '', nonce.replace(/[^a-z0-9]/g, '')].join(MARK);
}

/** A new copy's id, with a random nonce. */
export function newCopy(info: CopyInfo, random: () => number = Math.random): string {
  const nonce = Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0');
  return copyId(info, nonce);
}

/** What a copy's id says, or undefined when it is not a well-formed copy. */
export function parseCopy(id: string): CopyInfo | undefined {
  const p = id.split(MARK);
  if (p.length !== PARTS || (p[1] !== TAG && p[1] !== BOUND_TAG)) return undefined;
  const [of, , quality, maker, peoplePart, trait, material] = p as [string, string, string, string, string, string, string];
  const [people, lean] = peoplePart.split('-');
  const q = Number(quality);
  if (!of || !Number.isInteger(q) || q !== clampQuality(q) || !/^[np]/.test(maker)) return undefined;
  return {
    of,
    quality: q,
    maker: { kind: maker[0] === 'n' ? 'npc' : 'player', name: decode(maker.slice(1)) },
    ...(isRace(people) ? { people, ...(canLean(people, lean) ? { lean } : {}) } : {}),
    ...(MATERIAL_TRAITS.includes(trait as MaterialTrait) ? { trait: trait as MaterialTrait } : {}),
    ...(material ? { material } : {}),
    ...(p[1] === BOUND_TAG ? { bound: true as const } : {}),
  };
}

function peopleLeanDefault(people: RaceId): keyof Stats {
  return Object.keys(RACES[people].lift)[0] as keyof Stats;
}

/** A bonus scaled by quality; each part that was there stays at least 1. */
function scaled(bonus: Bonus | undefined, quality: number): Bonus | undefined {
  if (!bonus) return undefined;
  const out: Bonus = {};
  for (const [k, v] of Object.entries(bonus) as [keyof Bonus, number][]) out[k] = v > 0 ? Math.max(1, Math.round((v * quality) / 100)) : v;
  return out;
}

const made = new Map<string, { base: ItemDef; def: ItemDef }>();

/** A copy's ItemDef, worked out from its base item and its id; undefined when the id or base is no good. */
export function copyDef(items: Record<string, ItemDef>, id: string): ItemDef | undefined {
  const info = parseCopy(id);
  const base = info && Object.hasOwn(items, info.of) ? items[info.of] : undefined;
  if (!info || !base || !makesCopies(base)) return undefined;
  const kept = made.get(id);
  if (kept?.base === base) return kept.def;
  const rarity = info.quality >= FINER_QUALITY ? RARITIES[Math.min(RARITIES.length - 1, RARITIES.indexOf(base.rarity ?? 'common') + 1)] : base.rarity;
  const parts = copyParts(base.bonus, info, rarity ?? 'common');
  const bonus = parts.length ? parts.reduce<Bonus>((sum, part) => addBonus(sum, part.bonus), {}) : undefined;
  const def: ItemDef = {
    ...base,
    ...(bonus ? { bonus } : {}),
    ...(base.value ? { value: Math.max(1, Math.round((base.value * info.quality) / 100)) } : {}),
    ...(rarity ? { rarity } : {}),
    ...(info.bound ? { bound: true } : {}),
    copy: info,
  };
  if (made.size > 20_000) made.clear();
  made.set(id, { base, def });
  return def;
}

resolveCopiesWith(copyDef);

/** One part of a copy's bonus and where it comes from, for its card. */
export interface BonusPart {
  /** Like "Quality 112%", "Ursine maker" or "Warm (Thorn Wolf Pelt)". */
  from: string;
  bonus: Bonus;
}

/**
 * Where a copy's bonus comes from (Region fashion plan, F2): its base item
 * scaled by quality, the maker's people lean and the main material's trait,
 * the last two sized by the copy's rarity.
 */
export function copyParts(base: Bonus | undefined, info: CopyInfo, rarity: Rarity): BonusPart[] {
  const parts: BonusPart[] = [];
  const quality = scaled(base, info.quality);
  if (quality && Object.keys(quality).length) parts.push({ from: `Quality ${info.quality}%`, bonus: quality });
  if (info.people) parts.push({ from: `${RACES[info.people].name} maker`, bonus: peopleLean(info.people, rarity, info.lean) });
  if (info.trait) {
    const material = info.material ? ITEMS[info.material]?.name : undefined;
    parts.push({ from: `${info.trait[0]!.toUpperCase()}${info.trait.slice(1)}${material ? ` (${material})` : ''}`, bonus: traitBonus(info.trait, rarity) });
  }
  return parts;
}

/**
 * A piece of gear in plain words for its card, like "Tailored by Marina.
 * Quality 112%. Quality 112%: +7 armour. Lutran maker: +1 Might." Gear from
 * before copies, loot and quest rewards is "Tailored by unknown".
 */
export function copyWords(def: ItemDef | undefined): string {
  if (!def || !makesCopies(def)) return '';
  const c = def.copy;
  if (!c) return 'Tailored by unknown.';
  const binding = c.bound ? ' Bound to you.' : def.unique ? ' One of a kind: it binds to whoever first wears it.' : '';
  const base = Object.hasOwn(ITEMS, c.of) ? ITEMS[c.of] : undefined;
  const parts = copyParts(base?.bonus, c, def.rarity ?? 'common').filter((p) => bonusText(p.bonus));
  const sources = parts.length > 1 ? ` ${parts.map((p) => `${p.from}: ${bonusText(p.bonus)}.`).join(' ')}` : '';
  return `Tailored by ${c.maker.name}. Quality ${c.quality}%.${sources}${binding}`;
}

/**
 * Before a piece is worn: a unique piece binds to its wearer, so the copy in
 * the bag becomes its bound copy. Returns the id to wear.
 */
export function bindOnWear(c: { inventory: { item: string; qty: number }[] }, item: string): string {
  const def = ITEMS[item];
  const info = def?.copy;
  if (!def?.unique || !info || info.bound) return item;
  const p = item.split(MARK);
  p[1] = BOUND_TAG;
  const bound = p.join(MARK);
  const slot = c.inventory.find((s) => s.item === item);
  if (slot) slot.item = bound;
  return bound;
}

/** Copies of one base item in a bag, for counting what a shop or recipe sees. */
export function copiesOf(inventory: { item: string; qty: number }[], base: string): string[] {
  return inventory.filter((s) => copyBase(s.item) === base && s.item !== base).map((s) => s.item);
}

/** True when an id is a copy that ITEMS can work out. */
export function knownCopy(id: string): boolean {
  return isCopyId(id) && Boolean(ITEMS[id]);
}
