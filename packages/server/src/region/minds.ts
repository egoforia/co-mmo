import {
  afterArmor,
  gearBonus,
  TALK_RANGE,
  TICK_RATE,
  TICK_SECONDS,
  collides,
  outsideSide,
} from '@co-mmo/shared';
import type { Creature, PlayerState, RegionState, Townsperson, Walker } from './state.ts';

/** Creatures stroll at this speed (tiles per second) within this many tiles of home. */
const WANDER_SPEED = 1.5;
const WANDER_RADIUS = 4;
/** NPCs stroll more slowly, and stay closer to their spot so players can find them. */
const STROLL_SPEED = 1;
const STROLL_RADIUS = 2.5;
/** A chasing creature gives up this far from home and walks back. */
const LEASH = 8;
/** Creatures strike from this close. */
const CREATURE_REACH = 1.2;

/**
 * How creatures and NPCs behave each tick: creatures respawn, notice
 * players, fight, give up and walk home; NPCs stroll and stop to talk.
 */
export class Minds {
  constructor(
    private readonly s: RegionState,
  ) {}

  /** Creature behaviour for one tick: respawn, fight, walk home or wander. */
  think(c: Creature, now: number): void {
    if (c.respawnAt !== null) {
      if (now < c.respawnAt) return;
      Object.assign(c, { respawnAt: null, hp: c.def.hp, x: c.home.x, y: c.home.y, target: null, returning: false, aggro: null });
      return;
    }
    if (!c.aggro && !c.returning && c.def.behavior !== 'wander') {
      const from = c.def.behavior === 'guard' ? c.home : c;
      for (const p of this.s.players.values()) {
        if (p.character.hp > 0 && Math.hypot(p.x - from.x, p.y - from.y) <= c.def.notice) {
          c.aggro = p.info.id;
          break;
        }
      }
    }
    if (c.aggro) {
      const p = this.s.players.get(c.aggro);
      if (!p || p.character.hp <= 0 || Math.hypot(c.x - c.home.x, c.y - c.home.y) > LEASH) return this.giveUp(c);
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d > CREATURE_REACH * 0.8) this.moveToward(c, p.x, p.y, c.def.speed);
      if (d <= CREATURE_REACH && now - c.lastAttack >= c.def.cooldown * 1000) {
        c.lastAttack = now;
        this.hurt(p, c, now);
      }
      return;
    }
    if (c.returning) {
      if (this.moveToward(c, c.home.x, c.home.y, c.def.speed) || this.s.tickCount % (TICK_RATE * 5) === 0) {
        c.returning = false;
        c.hp = c.def.hp;
      }
      return;
    }
    this.wander(c, WANDER_SPEED, WANDER_RADIUS);
  }

  /** NPCs stroll about their spot, but stand still while someone is close enough to talk. */
  stroll(n: Townsperson): void {
    for (const p of this.s.players.values()) {
      if (p.character.hp > 0 && Math.hypot(p.x - n.x, p.y - n.y) <= TALK_RANGE) {
        n.target = null;
        n.rest = TICK_RATE;
        return;
      }
    }
    this.wander(n, STROLL_SPEED, STROLL_RADIUS);
  }

  /** A creature stops fighting and walks home. */
  giveUp(c: Creature): void {
    c.aggro = null;
    c.returning = true;
    c.target = null;
  }

  private hurt(p: PlayerState, c: Creature, now: number): void {
    const amount = afterArmor(c.def.damage * (0.8 + this.s.random() * 0.4), gearBonus(p.character, 'armor'));
    p.character.hp = Math.max(0, p.character.hp - amount);
    p.lastHurt = now;
    const defeated = p.character.hp === 0;
    this.s.broadcastNear(p, { t: 'hit', by: c.id, target: p.info.id, amount, defeated });
    if (defeated) this.giveUp(c);
  }

  /** Steps toward a point, sliding along walls. True once it arrives. */
  private moveToward(c: Walker, tx: number, ty: number, speed: number): boolean {
    const dx = tx - c.x;
    const dy = ty - c.y;
    const dist = Math.hypot(dx, dy);
    const len = speed * TICK_SECONDS;
    if (dist <= len) {
      if (!collides(this.s.map, tx, ty)) {
        c.x = tx;
        c.y = ty;
      }
      return true;
    }
    const nx = c.x + (dx / dist) * len;
    const ny = c.y + (dy / dist) * len;
    if (!collides(this.s.map, nx, c.y)) c.x = nx;
    if (!collides(this.s.map, c.x, ny)) c.y = ny;
    return false;
  }

  /** Creatures and NPCs stroll between spots near home, resting in between. */
  private wander(c: Walker, speed: number, radius: number): void {
    if (!c.target) {
      if (c.rest-- > 0) return;
      for (let tries = 0; tries < 5 && !c.target; tries++) {
        const angle = this.s.random() * Math.PI * 2;
        const dist = 1 + this.s.random() * (radius - 1);
        const t = { x: c.home.x + Math.cos(angle) * dist, y: c.home.y + Math.sin(angle) * dist };
        if (!outsideSide(this.s.map, t.x, t.y) && !collides(this.s.map, t.x, t.y)) c.target = t;
      }
      if (!c.target) c.rest = TICK_RATE;
      return;
    }
    const before = { x: c.x, y: c.y };
    if (this.moveToward(c, c.target.x, c.target.y, speed)) {
      c.target = null;
      c.rest = Math.floor(TICK_RATE * (1 + this.s.random() * 3));
    } else if (c.x === before.x && c.y === before.y) {
      c.target = null;
      c.rest = TICK_RATE;
    }
  }
}
