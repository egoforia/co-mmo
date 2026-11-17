import { STATUSES, collides, isSafe, statusOf, type MonsterSkill } from '@co-mmo/shared';
import { damageOf, provoke, type Creature } from '../creature-brain.ts';
import type { MonsterBlow } from './minds.ts';
import type { PlayerState, RegionState } from './state.ts';
import { afflictCreature, afflictPlayer } from './statuses.ts';

// Monsters' skills (combat decisions, step 7): each is one of the players'
// sixteen effects, with plain numbers from the monster's data. The brain
// (creature-brain.ts) picks a skill that is ready on its attack beat; this
// does what the skill says to the region.

/** What a skill needs from the region: its players and creatures, and the way a creature's blow lands. */
export interface SkillWorld {
  s: RegionState;
  hurt(p: PlayerState, c: Creature, now: number, blow: MonsterBlow): void;
  hidden(p: PlayerState, now: number): boolean;
}

/** Tiles round the target an area or a trap covers, and how far a call to kin carries, when the skill does not say. */
const AREA_RADIUS = 2;
const TAUNT_RADIUS = 4;
const SUMMON_RADIUS = 10;
/** A heal goes to a monster under this share of its health. */
const HURT_SHARE = 0.7;
/** How wide a line skill is, either side of its middle, in tiles. */
const LINE_HALF_WIDTH = 0.75;

/** Uses a monster's skill on its target, a player. False when there was nothing to do, so it is not spent. */
export function useMonsterSkill(w: SkillWorld, c: Creature, skill: MonsterSkill, target: PlayerState, now: number): boolean {
  const s = w.s;
  const hit = (ps: PlayerState[]) => {
    const type = skill.type ?? (skill.effect === 'bolt' ? 'arcane' : 'physical');
    // A worn weapon adds to its physical blows, as a player's does.
    const amount = skill.power + (type === 'physical' ? damageOf(c, now) - c.def.damage : 0);
    for (const p of ps) {
      w.hurt(p, c, now, { amount, type, close: skill.effect === 'strike' || skill.effect === 'dash' });
      if (skill.status && STATUSES[skill.status].harmful && p.character.hp > 0) afflictPlayer(s, p, skill.status, skill.seconds, { by: c.id, amount: skill.power / 4 });
    }
    tell(ps);
    return ps.length > 0;
  };
  const tell = (ps: PlayerState[]) => {
    for (const p of ps) s.notice(p, `The ${c.def.name} uses ${skill.name}!`);
  };
  const open = (x: number, y: number) => !collides(s.map, x, y) && !isSafe(s.map, x, y);
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  const d = Math.hypot(dx, dy) || 1;
  switch (skill.effect) {
    case 'strike':
    case 'bolt':
      return hit([target]);
    case 'area':
      return hit(rivals(w, c, now).filter((p) => Math.hypot(p.x - target.x, p.y - target.y) <= (skill.radius ?? AREA_RADIUS) + 0.5));
    case 'cone':
      // Everyone in front of it, a quarter turn wide, within its reach.
      return hit(rivals(w, c, now).filter((p) => {
        const px = p.x - c.x;
        const py = p.y - c.y;
        const r = Math.hypot(px, py);
        return r <= skill.range + 0.5 && (r < 0.5 || (px * dx + py * dy) / (r * d) >= Math.SQRT1_2);
      }));
    case 'line':
      return hit(rivals(w, c, now).filter((p) => {
        const along = ((p.x - c.x) * dx + (p.y - c.y) * dy) / d;
        const aside = Math.abs((p.x - c.x) * dy - (p.y - c.y) * dx) / d;
        return along >= 0 && along <= skill.range + 0.5 && aside <= LINE_HALF_WIDTH;
      }));
    case 'dash': {
      // It leaps to the tile before its target, then strikes: never into a wall or a safe area.
      const x = target.x - dx / d;
      const y = target.y - dy / d;
      if (d > 1.5) {
        if (!open(x, y)) return false;
        Object.assign(c, { x, y });
        delete c.to;
      }
      return hit([target]);
    }
    case 'blink': {
      // Away from its target, a few tiles off: a ranged monster keeping its distance.
      const far = Math.max(2, skill.range);
      const x = c.x - (dx / d) * far;
      const y = c.y - (dy / d) * far;
      if (!open(x, y)) return false;
      Object.assign(c, { x, y });
      delete c.to;
      tell([target]);
      return true;
    }
    case 'heal': {
      const kin = s.creatures.filter((k) => k.respawnAt === null && k.floor === c.floor && Math.hypot(k.x - c.x, k.y - c.y) <= Math.max(skill.range, skill.radius ?? 0) + 0.5 && k.hp < k.def.hp * HURT_SHARE);
      const worst = kin.sort((a, b) => a.hp / a.def.hp - b.hp / b.def.hp)[0];
      if (!worst) return false;
      worst.hp = Math.min(worst.def.hp, worst.hp + skill.power);
      tell([target]);
      return true;
    }
    case 'shield':
      if (statusOf(c, 'shielded', now)) return false;
      afflictCreature(s, c, 'shielded', skill.seconds, { amount: skill.power });
      tell([target]);
      return true;
    case 'stance':
      if (statusOf(c, 'guarded', now)) return false;
      afflictCreature(s, c, 'guarded', skill.seconds ?? 6, { amount: Math.min(60, skill.power) });
      tell([target]);
      return true;
    case 'buff':
      if (c.empowered && c.empowered.until > now) return false;
      c.empowered = { amount: skill.power, until: now + (skill.seconds ?? 6) * 1000 };
      tell([target]);
      return true;
    case 'debuff':
      if (!afflictPlayer(s, target, skill.status ?? 'slowed', skill.seconds, { by: c.id, amount: skill.power })) return false;
      tell([target]);
      return true;
    case 'trap':
      afflictPlayer(s, target, 'rooted', skill.seconds, { by: c.id });
      return hit([target]);
    case 'taunt':
    case 'summon': {
      // A war cry calls every idle monster near it; a summons calls its own kind from farther round.
      const reach = skill.radius ?? (skill.effect === 'taunt' ? TAUNT_RADIUS : SUMMON_RADIUS);
      const called = s.creatures.filter((k) => k !== c && k.respawnAt === null && !k.aggro && !k.fleeing && k.floor === c.floor && (skill.effect === 'taunt' || k.kind === c.kind) && Math.hypot(k.x - c.x, k.y - c.y) <= reach);
      if (!called.length) return false;
      for (const k of called) provoke(k, target.info.id, { creatures: s.creatures, now });
      tell([target]);
      return true;
    }
    case 'cleanse': {
      const before = c.statuses.length;
      c.statuses = c.statuses.filter((x) => !STATUSES[x.id].harmful);
      if (c.statuses.length === before) return false;
      tell([target]);
      return true;
    }
  }
  return false;
}

/** Players a monster's area skill may hit: standing, on its floor, out of safe areas and not Hidden. */
function rivals(w: SkillWorld, c: Creature, now: number): PlayerState[] {
  return [...w.s.players.values()].filter((p) => p.character.hp > 0 && p.floor === c.floor && !isSafe(w.s.map, p.x, p.y) && !w.hidden(p, now));
}
