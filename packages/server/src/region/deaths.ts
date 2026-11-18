import { PLAYER_BODY_MS, deathWords, deathXpFor, loseXp, rollDeathDrops } from '@co-mmo/shared';
import type { Body, PlayerState, RegionState, SavedBody } from './state.ts';

/**
 * What a death costs (combat decisions, step 3, shared `death.ts`). It is
 * paid when a Fallen player wakes at the shrine, not when a friend raises
 * them: XP and maybe a level, all their gold, and now and then worn gear or
 * the whole bag. What drops lies on their body where they fell for an hour,
 * saved in the store so a restart keeps it.
 */
export class Deaths {
  constructor(private readonly s: RegionState) {}

  /** Takes the price of dying from a player who is about to wake at the shrine. */
  die(p: PlayerState): void {
    const c = p.character;
    const xp = deathXpFor(c);
    const levels = loseXp(c, xp);
    const drops = rollDeathDrops(c, this.s.random);
    p.dirty = true;
    if (drops.length) {
      const now = this.s.now();
      const body: Body = {
        id: `pb-${p.info.id}-${now}`,
        kind: 'player',
        def: { name: `body of ${p.info.name}`, art: '' },
        owner: { id: p.info.id, name: p.info.name, ...(c.race ? { race: c.race } : {}) },
        x: p.x,
        y: p.y,
        floor: p.floor ?? 0,
        until: now + PLAYER_BODY_MS,
        finders: [],
        loot: drops,
      };
      this.s.bodies.push(body);
      this.s.bodyChanged(body);
    }
    if (levels) this.s.hooks.journal?.(`${p.info.name} fell back to level ${c.level}.`, p.info.id);
    this.s.notice(p, deathWords(xp, levels, drops));
  }

  /** Lays the player bodies the store kept for this region (or cell) back where they were. */
  restore(saved: SavedBody[]): void {
    const now = this.s.now();
    for (const b of saved) {
      if (b.until <= now || !b.loot.length || this.s.bodies.some((x) => x.id === b.id)) continue;
      this.s.bodies.push({ id: b.id, kind: 'player', def: { name: `body of ${b.owner.name}`, art: '' }, owner: { ...b.owner }, x: b.x, y: b.y, floor: b.floor, until: b.until, finders: [], loot: b.loot.map((s) => ({ ...s })) });
    }
  }
}
