import {
  GATHER_MS,
  GATHER_RANGE,
  ITEMS,
  REGROW_MS,
  SPOTS,
  CRAFTS,
  BAG_FULL,
  addItem,
  bagRoom,
  bestTool,
  cannotGather,
  gainCraftXp,
  gatherPractice,
  gatherYield,
  growsBackWords,
  readyAt,
  setRegrow,
  spotNear,
  spotNeeds,
  wearTool,
  type GatherSpot,
} from '@co-mmo/shared';
import type { PlayerState, RegionState } from './state.ts';

/**
 * Gathering at spots (gathering.ts): pressing E beside one starts it, and a
 * moment later it gives its material, unless the player was hit or walked
 * off. Each player has their own regrow timer on each spot, kept on their
 * character (spot-states.ts), so one player never empties a spot for another
 * and a restart forgets nothing.
 */
export class Gathering {
  constructor(private readonly s: RegionState) {}

  /** Starts gathering at the spot beside the player; false when there is none, so E does something else. */
  start(p: PlayerState): boolean {
    if (p.floor) return false;
    const spot = spotNear(this.s.map.spots, p.x, p.y);
    if (!spot) return false;
    if (p.gathering || p.character.hp <= 0) return true;
    const def = SPOTS[spot.kind]!;
    const why = cannotGather(p.character, spot.kind) ?? (bagRoom(p.character, def.material) < 1 ? BAG_FULL : undefined);
    if (why) {
      this.s.notice(p, why);
      return true;
    }
    const now = this.s.now();
    const ready = readyAt(p.character, this.s.map.def.id, spot.id, now);
    if (ready !== undefined) {
      this.s.notice(p, `The ${def.name} has nothing left for you yet. It ${growsBackWords(ready, now).replace(/^Grows/, 'grows')}.`);
      return true;
    }
    const tool = bestTool(p.character, spotNeeds(spot.kind)!.craft)!;
    p.gathering = { spot: spot.id, started: now, until: now + GATHER_MS, tool: tool.id };
    p.conn.send({ t: 'gather', tool: tool.id, ms: GATHER_MS });
    this.s.notice(p, `You gather at the ${def.name}...`);
    return true;
  }

  /** Finishes gathering that is done, and stops any a hit, a fall or a walk away cut short. */
  tick(now: number): void {
    for (const p of this.s.players.values()) {
      const g = p.gathering;
      if (!g) continue;
      const spot = this.s.map.spots.find((s) => s.id === g.spot);
      if (!spot || p.floor || p.character.hp <= 0 || Math.hypot(spot.x + 0.5 - p.x, spot.y + 0.5 - p.y) > GATHER_RANGE + 0.5) {
        this.stop(p, 'You stop gathering.');
      } else if (p.lastHurt > g.started) {
        this.stop(p, 'You were hit and stopped gathering.');
      } else if (now >= g.until) {
        this.finish(p, spot, now);
      }
    }
  }

  /** Stops gathering, telling the player why. */
  stop(p: PlayerState, words?: string): void {
    if (!p.gathering) return;
    delete p.gathering;
    p.conn.send({ t: 'gather' });
    if (words) this.s.notice(p, words);
  }

  private finish(p: PlayerState, spot: GatherSpot, now: number): void {
    const def = SPOTS[spot.kind]!;
    const needs = spotNeeds(spot.kind)!;
    const ch = p.character;
    // What the bag cannot hold is left behind; with no room at all, nothing is gathered.
    const qty = addItem(ch, def.material, gatherYield(this.s.random));
    if (!qty) return this.stop(p, BAG_FULL);
    const level = gainCraftXp(ch, needs.craft, gatherPractice(spot.kind));
    const tool = bestTool(ch, needs.craft);
    const broke = tool ? wearTool(ch, tool, this.s.random) : undefined;
    setRegrow(ch, this.s.map.def.id, spot.id, now + REGROW_MS, now);
    delete p.gathering;
    p.conn.send({ t: 'gather' });
    const grew = level ? ` Your ${CRAFTS[needs.craft].name} rises to level ${level}.` : '';
    this.s.notice(p, `You gather ${qty > 1 ? `${qty} × ` : 'a '}${ITEMS[def.material]!.name}.${grew}${broke ? ` Your ${broke} wore out.` : ''}`);
    p.dirty = true;
  }
}
