import { SAFE_IN, SAFE_OUT, absorb, afterArmor, armor, dodgeChance, isSafe, tilesFor, ward } from '@co-mmo/shared';
import type { Blow } from './effects/index.ts';
import type { Paths } from './paths/index.ts';
import type { PlayerState, RegionState } from './state.ts';

/** How long one player attacking another is not told again that they are under attack. */
const WARNED_MS = 15_000;

/**
 * Players fighting players (combat decisions, step 5, PvP version 1). Out of
 * safe areas any player may hurt another with the same attacks and skills,
 * reach, Armor and Ward as against a monster; nothing special is added.
 * Party members cannot hurt each other: one must leave the party first, and
 * the party is told at once (world.ts). A plain attack hits a player only
 * when they are the chosen target; area skills hit every rival they cover.
 */
export class Pvp {
  private readonly warned = new Map<string, number>();

  constructor(
    private readonly s: RegionState,
    private readonly paths: Paths,
  ) {}

  /** Why `p` may not hurt `v`, in words, or undefined when they may. */
  why(p: PlayerState, v: PlayerState): string | undefined {
    const now = this.s.now();
    if (v === p || v.character.hp <= 0 || v.floor !== p.floor || this.paths.hidden(v, now)) return 'Nothing in reach to strike.';
    if ((this.s.hooks.party?.(p.info.id) ?? [p.info.id]).includes(v.info.id)) return `${v.info.name} is in your party. Leave the party first to fight them.`;
    if (isSafe(this.s.map, p.x, p.y) || isSafe(this.s.map, v.x, v.y)) return 'No one can be hurt in a safe area.';
    return undefined;
  }

  /** The player chosen as target, when they are a rival within `range` (tiles, like a weapon's reach). */
  rivalInReach(p: PlayerState, range: number, id?: string): PlayerState | undefined {
    const v = id ? this.s.players.get(id) : undefined;
    if (!v || this.why(p, v)) return undefined;
    return Math.max(Math.abs(v.x - p.x), Math.abs(v.y - p.y)) <= tilesFor(range) + 0.5 ? v : undefined;
  }

  /** Rivals within `range` of a point that `p` may hurt: for skills that cover an area. */
  rivalsNear(p: PlayerState, at: { x: number; y: number }, range: number): PlayerState[] {
    return [...this.s.players.values()].filter((v) => !this.why(p, v) && Math.max(Math.abs(v.x - at.x), Math.abs(v.y - at.y)) <= range + 0.5);
  }

  /**
   * Hurts a rival as a monster's blow would hurt them: Agility may dodge a
   * physical hit, a shield takes it first, then Armor softens physical hits
   * and Ward arcane ones, unless the blow pierces. Halved while the attacker
   * is Weakened. Falling to it is the usual Fallen and death.
   */
  hurt(p: PlayerState, v: PlayerState, raw: number, how: Blow): void {
    const now = this.s.now();
    if (this.why(p, v)) return;
    v.lastHurt = now;
    this.warn(p, v, now);
    if (how.type !== 'arcane' && this.s.random() < dodgeChance(v.character)) {
      this.s.broadcastNear(v, { t: 'hit', by: p.info.id, target: v.info.id, amount: 0, defeated: false, damage: how.type });
      return;
    }
    const weakened = now < p.character.weakenedUntil ? 0.5 : 1;
    const defence = how.pierce ? 0 : how.type === 'arcane' ? ward(v.character) : armor(v.character);
    const amount = afterArmor(absorb(v, raw * weakened, now), defence);
    v.character.hp = Math.max(0, v.character.hp - amount);
    v.dirty = true;
    const defeated = v.character.hp === 0;
    this.s.broadcastNear(v, { t: 'hit', by: p.info.id, target: v.info.id, amount, defeated, damage: how.type, ...(how.ability ? { ability: how.ability } : {}), ...(how.ranged ? { ranged: true } : {}) });
    if (defeated) this.s.hooks.journal?.(`${p.info.name} struck down ${v.info.name} in ${this.s.map.def.name}.`, v.info.id);
  }

  /** Tells someone they are under attack, once in a while. */
  private warn(p: PlayerState, v: PlayerState, now: number): void {
    const key = `${p.info.id}>${v.info.id}`;
    if (now - (this.warned.get(key) ?? -Infinity) < WARNED_MS) return;
    this.warned.set(key, now);
    this.s.notice(v, `${p.info.name} attacks you!`);
  }

  /** Tells players when they step into or out of a safe area. */
  tick(): void {
    for (const p of this.s.players.values()) {
      const safe = isSafe(this.s.map, p.x, p.y);
      if (p.safe === undefined) p.safe = safe;
      else if (p.safe !== safe) {
        p.safe = safe;
        this.s.notice(p, safe ? SAFE_IN : SAFE_OUT);
      }
    }
  }
}
