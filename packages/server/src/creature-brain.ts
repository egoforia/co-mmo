import { TICK_RATE, awake, collides, noticeScale, type CreatureDef, type CreatureMood, type RegionMap, type Status, type Weather } from '@co-mmo/shared';
import { addThreat, chooseTarget } from './threat.ts';
import { canReach, goTo, moveAway, moveToward, wander, type Walker } from './walkers.ts';

// How creatures behave, one tick at a time: sleeping out of their hours,
// noticing players (less in the dark and the fog, more if they carry a
// light), fighting, running when hurt or timid, walking patrol rounds and
// roaming in packs. The region owns the creatures and the players; this
// decides what each creature does next. Creatures only notice and strike
// those on their own floor; one chasing someone follows them up or down
// stairs (never a ladder) while they stay within its leash. Who it fights
// is chosen by threat (threat.ts).

type Spot = { x: number; y: number };

/** Creatures stroll at this speed (tiles per second) within this many tiles of home. */
const WANDER_SPEED = 1.5;
const WANDER_RADIUS = 4;
/** A chasing creature gives up this far from home and walks back. */
export const LEASH = 8;
/** Creatures strike from this close. */
export const CREATURE_REACH = 1.2;
/** Pack creatures this close to one another roam and hunt together. */
export const PACK_RADIUS = 6;
/** A frightened creature runs for at most this long before heading home. */
const FLEE_MS = 4000;
/** How far a patrol's rounds go from its spot, in tiles. */
const PATROL_RADIUS = 3;

/** At what share of its health each behaviour turns and runs; timid creatures always do. */
const FLEE_AT: Partial<Record<CreatureDef['behavior'], number>> = { wander: 0.3, pack: 0.2, timid: Infinity };

export interface Creature extends Walker {
  id: string;
  kind: string;
  def: CreatureDef;
  hp: number;
  /** The player it is fighting. */
  aggro: string | null;
  /** Who has threatened it while it fights, by player id (threat.ts); cleared when it gives up. */
  threat: Record<string, number>;
  returning: boolean;
  lastAttack: number;
  /** Epoch ms when a defeated creature comes back; null while alive. */
  respawnAt: number | null;
  /** The player it is running from, until `fleeUntil`. */
  fleeing: string | null;
  fleeUntil: number;
  /** Out of its hours and resting at home. */
  asleep: boolean;
  /** A patrol's rounds about its spot, and which corner it walks to next. */
  route?: Spot[];
  leg: number;
  /** Running statuses (region/statuses.ts) and when a new stun can take again. */
  statuses: Status[];
  stunImmuneUntil?: number;
  /** Share of its speed its statuses allow this tick (paceOf); full when missing. */
  pace?: number;
}

/** A player as creatures see them. */
export interface Prey {
  id: string;
  x: number;
  y: number;
  floor: number;
  alive: boolean;
  /** Carrying something that burns or glows, so easy to see in the dark. */
  lit: boolean;
}

/** What a creature's world holds this tick. */
export interface Habitat {
  map: RegionMap;
  now: number;
  tick: number;
  random: () => number;
  /** Where the day is (sky.ts dayPhase) and the region's weather. */
  phase: number;
  weather: Weather;
  players: Prey[];
  /** Every creature in the region, the thinking one too. */
  creatures: Creature[];
  /** The creature strikes this player (the region deals the damage). */
  hurt(c: Creature, playerId: string): void;
}

/** A new live creature of a kind, at its home spot. */
export function makeCreature(id: string, kind: string, def: CreatureDef, x: number, y: number, random: () => number, floor = 0): Creature {
  return {
    id, kind, def, x, y, floor, home: { x, y, floor }, hp: def.hp, target: null, rest: Math.floor(random() * TICK_RATE * 3),
    aggro: null, threat: {}, returning: false, lastAttack: 0, respawnAt: null, fleeing: null, fleeUntil: 0, asleep: false, leg: 0, statuses: [],
  };
}

/** Creature behaviour for one tick: respawn, sleep, notice, fight, run, walk home or roam. */
export function think(c: Creature, h: Habitat): void {
  if (c.respawnAt !== null) {
    if (h.now < c.respawnAt) return;
    Object.assign(c, { respawnAt: null, statuses: [], hp: c.def.hp, x: c.home.x, y: c.home.y, floor: c.home.floor, target: null, returning: false, aggro: null, threat: {}, fleeing: null, asleep: false });
    return;
  }
  const up = awake(c.def.active, h.phase);
  if (up && !c.aggro && !c.fleeing && !c.returning) notice(c, h);
  if (c.fleeing) return run(c, h);
  if (c.aggro) return fight(c, h);
  if (c.returning) {
    if (goTo(h.map, c, c.home, speedOf(c)) || (c.floor === c.home.floor && h.tick % (TICK_RATE * 5) === 0)) {
      c.returning = false;
      c.hp = c.def.hp;
    }
    return;
  }
  if (!up) return sleep(c, h);
  c.asleep = false;
  if (c.def.behavior === 'patrol') return patrol(c, h);
  if (c.def.behavior === 'pack') {
    const leader = packLeader(c, h.creatures);
    if (leader !== c) return wander(h.map, c, WANDER_SPEED * (c.pace ?? 1) * 1.2, 2.5, h.random, leader);
  }
  wander(h.map, c, WANDER_SPEED * (c.pace ?? 1), WANDER_RADIUS, h.random);
}

/** How fast it moves when in a hurry, as its statuses allow (Slowed, Rooted). */
function speedOf(c: Creature): number {
  return c.def.speed * (c.pace ?? 1);
}

/**
 * Someone struck, healed against or taunted it: it wakes and fights, or runs
 * if it is timid or badly hurt; a pack joins in. One already fighting keeps
 * its target until threat (threat.ts) turns it.
 */
export function provoke(c: Creature, playerId: string, h: Pick<Habitat, 'creatures' | 'now'>): void {
  c.asleep = false;
  addThreat(c, playerId, 0);
  if (shouldFlee(c)) return flee(c, playerId, h.now);
  if (c.aggro) return;
  c.aggro = playerId;
  c.returning = false;
  c.target = null;
  if (c.def.behavior === 'pack') rally(c, playerId, h.creatures);
}

/** Stops fighting or running and walks home, forgetting who threatened it. */
export function giveUp(c: Creature): void {
  c.aggro = null;
  c.threat = {};
  c.fleeing = null;
  c.returning = true;
  c.target = null;
}

/**
 * A player fell or left: off its list. It turns to whoever has the most
 * threat of those still standing, or gives up when nobody is.
 */
export function forget(c: Creature, playerId: string, standing: (id: string) => boolean, now: number): void {
  delete c.threat[playerId];
  if (c.fleeing === playerId) return giveUp(c);
  if (c.aggro !== playerId) return;
  c.aggro = null;
  c.aggro = chooseTarget(c, standing, now);
  if (!c.aggro) giveUp(c);
}

/** What players see it doing, when it is more than going about its business. */
export function mood(c: Creature): CreatureMood | undefined {
  if (c.fleeing) return 'fleeing';
  if (c.asleep) return 'asleep';
  return undefined;
}

/** Looks for someone within its notice range, as far as the hour, the weather and their light allow. */
function notice(c: Creature, h: Habitat): void {
  const def = c.def;
  if (def.behavior === 'wander' || def.notice <= 0) return;
  const from = def.behavior === 'guard' ? c.home : c;
  for (const p of h.players) {
    if (!p.alive || p.floor !== c.floor || Math.hypot(p.x - from.x, p.y - from.y) > def.notice * noticeScale(def.active, h.phase, h.weather, p.lit)) continue;
    if (def.behavior === 'timid') return flee(c, p.id, h.now);
    c.aggro = p.id;
    addThreat(c, p.id, 0);
    c.asleep = false;
    if (def.behavior === 'pack') rally(c, p.id, h.creatures);
    return;
  }
}

function fight(c: Creature, h: Habitat): void {
  const standing = (id: string) => h.players.some((x) => x.id === id && x.alive);
  c.aggro = chooseTarget(c, standing, h.now);
  const p = h.players.find((x) => x.id === c.aggro);
  if (!p || Math.hypot(c.x - c.home.x, c.y - c.home.y) > LEASH) return giveUp(c);
  if (shouldFlee(c)) return flee(c, p.id, h.now);
  // Gone up or down: after them by the stairs, or give up if only a ladder leads there.
  if (p.floor !== c.floor) {
    if (!canReach(h.map, c, p)) return giveUp(c);
    goTo(h.map, c, p, speedOf(c));
    return;
  }
  const d = Math.hypot(p.x - c.x, p.y - c.y);
  if (d > CREATURE_REACH * 0.8) moveToward(h.map, c, p.x, p.y, speedOf(c));
  if (d <= CREATURE_REACH && h.now - c.lastAttack >= c.def.cooldown * 1000) {
    c.lastAttack = h.now;
    h.hurt(c, p.id);
  }
}

/** Runs from whoever frightened it until it is safe, then heads home. */
function run(c: Creature, h: Habitat): void {
  const p = h.players.find((x) => x.id === c.fleeing);
  const safe = !p || !p.alive || p.floor !== c.floor || Math.hypot(p.x - c.x, p.y - c.y) > c.def.notice + 6;
  if (safe || h.now > c.fleeUntil || Math.hypot(c.x - c.home.x, c.y - c.home.y) > LEASH * 1.5) return giveUp(c);
  moveAway(h.map, c, p.x, p.y, speedOf(c) * 1.1);
}

/** Out of its hours: walks home and sleeps there. */
function sleep(c: Creature, h: Habitat): void {
  c.target = null;
  const away = c.floor !== c.home.floor || Math.hypot(c.x - c.home.x, c.y - c.home.y) > 0.5;
  // One that cannot find its way home (no stairs back) sleeps where it is.
  if (away && canReach(h.map, c, c.home) && !goTo(h.map, c, c.home, WANDER_SPEED * (c.pace ?? 1))) return;
  c.asleep = true;
}

/** Walks rounds about its spot, corner to corner, pausing at each. */
function patrol(c: Creature, h: Habitat): void {
  c.route ??= rounds(c, h);
  if (c.route.length < 2) return wander(h.map, c, WANDER_SPEED * (c.pace ?? 1), WANDER_RADIUS, h.random);
  if (c.rest-- > 0) return;
  const to = c.route[c.leg % c.route.length]!;
  const before = { x: c.x, y: c.y };
  // A creature that cannot get round the corner (something stands in the way) tries the next one.
  if (moveToward(h.map, c, to.x, to.y, WANDER_SPEED * (c.pace ?? 1)) || (c.x === before.x && c.y === before.y)) {
    c.leg = (c.leg + 1) % c.route.length;
    c.rest = Math.floor(TICK_RATE / 2);
  }
}

/** Four corners about its spot that it can stand on, turned a little differently for each creature. */
function rounds(c: Creature, h: Habitat): Spot[] {
  const turn = h.random() * Math.PI / 2;
  const corners: Spot[] = [];
  for (let i = 0; i < 4; i++) {
    const a = turn + (i * Math.PI) / 2;
    const s = { x: c.home.x + Math.cos(a) * PATROL_RADIUS, y: c.home.y + Math.sin(a) * PATROL_RADIUS };
    if (s.x > 0.5 && s.y > 0.5 && s.x < h.map.width - 0.5 && s.y < h.map.height - 0.5 && !collides(h.map, s.x, s.y, c.floor)) corners.push(s);
  }
  return corners;
}

function shouldFlee(c: Creature): boolean {
  const at = FLEE_AT[c.def.behavior] ?? 0;
  return c.hp > 0 && c.hp / c.def.hp <= at;
}

function flee(c: Creature, playerId: string, now: number): void {
  Object.assign(c, { fleeing: playerId, fleeUntil: now + FLEE_MS, aggro: null, returning: false, target: null, asleep: false });
}

/** Others of its pack close by join the hunt. */
function rally(c: Creature, playerId: string, creatures: Creature[]): void {
  for (const k of creatures) {
    if (k === c || k.kind !== c.kind || k.floor !== c.floor || k.respawnAt !== null || k.aggro || k.fleeing) continue;
    if (Math.hypot(k.x - c.x, k.y - c.y) > PACK_RADIUS) continue;
    Object.assign(k, { aggro: playerId, asleep: false, returning: false, target: null });
    addThreat(k, playerId, 0);
  }
}

/** The pack member the others roam after: the first of its kind whose home is near this one's. */
function packLeader(c: Creature, creatures: Creature[]): Creature {
  for (const k of creatures) {
    if (k.kind !== c.kind || k.respawnAt !== null || k.home.floor !== c.home.floor) continue;
    if (Math.hypot(k.home.x - c.home.x, k.home.y - c.home.y) <= PACK_RADIUS) return k;
  }
  return c;
}
