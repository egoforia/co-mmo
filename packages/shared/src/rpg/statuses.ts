// Statuses: timed effects on players and creatures (docs/attributes.md,
// Statuses). The server keeps each one's timer list; these rules say how
// long a status lasts, how it stacks, and what it stops someone doing, so
// the client can show and predict the same. Re-exported from rpg.ts.

/** Every status there is. Weakened is kept on the character (`weakenedUntil`) and shown with the rest. */
export type StatusId =
  | 'slowed'
  | 'rooted'
  | 'stunned'
  | 'silenced'
  | 'burning'
  | 'bleeding'
  | 'poisoned'
  | 'marked'
  | 'taunted'
  | 'shielded'
  | 'guarded'
  | 'evasive'
  | 'poised'
  | 'hallowed'
  | 'hidden'
  | 'unyielding'
  | 'graced'
  | 'knelled'
  | 'weakened';

/** What a status is called, whether it harms (Vigor shortens those), and its usual length. */
export interface StatusInfo {
  name: string;
  harmful: boolean;
  /** Its length in seconds when the skill that gives it does not say. */
  seconds: number;
  description: string;
}

/** The statuses, with their names and usual lengths (docs/attributes.md, Statuses). */
export const STATUSES: Record<StatusId, StatusInfo> = {
  slowed: { name: 'Slowed', harmful: true, seconds: 3, description: 'Moves a third slower.' },
  rooted: { name: 'Rooted', harmful: true, seconds: 2.5, description: 'Cannot move, but can still fight.' },
  stunned: { name: 'Stunned', harmful: true, seconds: 1, description: 'Cannot act.' },
  silenced: { name: 'Silenced', harmful: true, seconds: 3, description: 'Cannot use special attacks.' },
  burning: { name: 'Burning', harmful: true, seconds: 4, description: 'Takes arcane damage each second.' },
  bleeding: { name: 'Bleeding', harmful: true, seconds: 6, description: 'Takes damage each second that armour does not stop.' },
  poisoned: { name: 'Poisoned', harmful: true, seconds: 6, description: 'Takes damage each second, and heals do less.' },
  marked: { name: 'Marked', harmful: true, seconds: 8, description: 'Takes more damage from whoever marked it and their party.' },
  taunted: { name: 'Taunted', harmful: true, seconds: 4, description: 'Must fight whoever taunted it.' },
  shielded: { name: 'Shielded', harmful: false, seconds: 6, description: 'A shield takes damage before health does.' },
  guarded: { name: 'Guarded', harmful: false, seconds: 6, description: 'Takes less damage from every blow.' },
  evasive: { name: 'Evasive', harmful: false, seconds: 2, description: 'Dodges blows far more often.' },
  poised: { name: 'Poised', harmful: false, seconds: 1.5, description: 'Turns aside the next blow up close and strikes back.' },
  hallowed: { name: 'Hallowed', harmful: false, seconds: 2, description: 'No new ailment can take hold.' },
  hidden: { name: 'Hidden', harmful: false, seconds: 2, description: 'Creatures cannot see or strike you.' },
  unyielding: { name: 'Unyielding', harmful: false, seconds: 8, description: 'Health cannot drop below 1.' },
  graced: { name: 'Graced', harmful: false, seconds: 10, description: 'Heals a little each second.' },
  knelled: { name: 'Knelled', harmful: true, seconds: 8, description: 'Deals less damage, takes more, and heals whoever strikes it.' },
  weakened: { name: 'Weakened', harmful: true, seconds: 30, description: 'Deals half damage after waking at the shrine.' },
};

/** Statuses that hurt each second, and the share of the hit that gave them dealt each second. */
export const DAMAGE_STATUSES: readonly StatusId[] = ['burning', 'bleeding', 'poisoned'];
export const DOT_SHARE = 0.25;
/** Slowed walkers move at this share of their speed. */
export const SLOW_PACE = 0.65;
/** A stun never lasts longer than this, and no one can be stunned again this long after one. */
export const MAX_STUN_MS = 2000;
export const STUN_IMMUNE_MS = 6000;
/** Marked creatures take this much more from the one who marked them and their party. */
export const MARK_BONUS = 0.12;
/** Heals on the Poisoned do this share of their amount. */
export const POISONED_HEALING = 0.7;
/** Extra dodge chance while Evasive (a Duelist's Sidestep). */
export const EVASIVE_DODGE = 0.3;
/** Statuses only Calling skills give: wished abilities never carry them. */
export const SKILL_STATUSES: readonly StatusId[] = ['guarded', 'evasive', 'poised', 'hallowed'];
/** Statuses only Path skills give (skills/*-paths.ts): wished abilities never carry them. */
export const PATH_STATUSES: readonly StatusId[] = ['hidden', 'unyielding', 'graced', 'knelled'];

/** One running status: when it ends, who gave it, and its strength (damage per second, or what a shield has left). */
export interface Status {
  id: StatusId;
  /** Epoch ms when it wears off. */
  until: number;
  /** The player who gave it (a mark's or taunt's owner, who a burn's damage is credited to). */
  by?: string;
  amount?: number;
  /** Damage statuses: epoch ms of their next tick. */
  nextTick?: number;
}

/** Anyone statuses can land on: a timer list, and the end of their stun immunity. */
export interface Afflicted {
  statuses: Status[];
  /** Epoch ms until which a new stun does nothing. */
  stunImmuneUntil?: number;
}

/** A status as its bearer sees it in their snapshot: whole seconds left. */
export interface StatusView {
  id: StatusId;
  left: number;
}

/**
 * How long a status lasts on someone, in ms: harmful ones are shortened by
 * Vigor (× 100 / (100 + 3 × Vigor), docs/attributes.md), and a stun is
 * never longer than MAX_STUN_MS.
 */
export function statusLength(id: StatusId, seconds: number, vigor = 0): number {
  let ms = seconds * 1000;
  if (STATUSES[id].harmful) ms *= 100 / (100 + 3 * Math.max(0, vigor));
  if (id === 'stunned') ms = Math.min(ms, MAX_STUN_MS);
  return Math.round(ms);
}

/** The running status of this kind, if there is one. */
export function statusOf(a: Afflicted, id: StatusId, now: number): Status | undefined {
  return a.statuses.find((s) => s.id === id && s.until > now);
}

/**
 * Puts a status on someone for `ms`. The same status again keeps the longer
 * time and the stronger amount rather than stacking. A stun does nothing
 * while they are immune, and leaves them immune for STUN_IMMUNE_MS after it
 * ends. Nothing harmful takes while Hallowed. Returns false when it did not take.
 */
export function afflict(a: Afflicted, id: StatusId, ms: number, now: number, from: { by?: string; amount?: number } = {}): boolean {
  if (ms <= 0) return false;
  if (STATUSES[id].harmful && statusOf(a, 'hallowed', now)) return false;
  if (id === 'stunned') {
    if (now < (a.stunImmuneUntil ?? 0)) return false;
    a.stunImmuneUntil = now + ms + STUN_IMMUNE_MS;
  }
  const until = now + ms;
  const old = a.statuses.find((s) => s.id === id);
  if (old && old.until > now) {
    old.until = Math.max(old.until, until);
    if (from.amount !== undefined) old.amount = Math.max(old.amount ?? 0, from.amount);
    if (from.by) old.by = from.by;
    return true;
  }
  if (old) a.statuses.splice(a.statuses.indexOf(old), 1);
  a.statuses.push({ id, until, ...(from.by ? { by: from.by } : {}), ...(from.amount !== undefined ? { amount: from.amount } : {}), ...(DAMAGE_STATUSES.includes(id) ? { nextTick: now + 1000 } : {}) });
  return true;
}

/** Takes away every harmful status (a cleanse); returns how many went. */
export function cleanse(a: Afflicted): number {
  const before = a.statuses.length;
  a.statuses = a.statuses.filter((s) => !STATUSES[s.id].harmful);
  return before - a.statuses.length;
}

/** Drops statuses that have worn off. */
export function expireStatuses(a: Afflicted, now: number): void {
  if (a.statuses.some((s) => s.until <= now)) a.statuses = a.statuses.filter((s) => s.until > now);
}

/** How fast someone may move, as a share of their speed: none while Rooted or Stunned, less while Slowed. */
export function paceOf(a: Afflicted, now: number): number {
  return paceFor(a.statuses.filter((s) => s.until > now).map((s) => s.id));
}

/** The pace these statuses allow; the browser predicts its own steps with it from the snapshot. */
export function paceFor(ids: readonly StatusId[]): number {
  if (ids.includes('rooted') || ids.includes('stunned')) return 0;
  return ids.includes('slowed') ? SLOW_PACE : 1;
}

/** Statuses in words: "Slowed, Marked"; a name tag uses them for statuses whose icons are not painted yet (statusTag). */
export function statusWords(ids: readonly StatusId[] | undefined): string {
  return (ids ?? []).map((id) => STATUSES[id].name).join(', ');
}

/** False while Stunned: no attacks, abilities or steps. */
export function canAct(a: Afflicted, now: number): boolean {
  return !statusOf(a, 'stunned', now);
}

/**
 * A shield takes damage first: returns what is left over for health, and
 * wears the shield down (it breaks when nothing is left).
 */
export function absorb(a: Afflicted, amount: number, now: number): number {
  const shield = statusOf(a, 'shielded', now);
  if (!shield || amount <= 0) return amount;
  const took = Math.min(shield.amount ?? 0, amount);
  shield.amount = (shield.amount ?? 0) - took;
  if (shield.amount <= 0) a.statuses.splice(a.statuses.indexOf(shield), 1);
  return amount - took;
}

/** The running statuses' ids, for others to see; Weakened joins them while `weakenedUntil` runs. */
export function statusIds(a: Afflicted, now: number, weakenedUntil = 0): StatusId[] {
  const ids = a.statuses.filter((s) => s.until > now).map((s) => s.id);
  return now < weakenedUntil ? [...ids, 'weakened'] : ids;
}

/** The running statuses with whole seconds left, for their bearer. */
export function statusViews(a: Afflicted, now: number, weakenedUntil = 0): StatusView[] {
  const views = a.statuses.filter((s) => s.until > now).map((s) => ({ id: s.id, left: Math.ceil((s.until - now) / 1000) }));
  return now < weakenedUntil ? [...views, { id: 'weakened', left: Math.ceil((weakenedUntil - now) / 1000) }] : views;
}
