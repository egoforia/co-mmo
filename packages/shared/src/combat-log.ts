/**
 * Combat log hit trace structures for game loop debugging.
 * Captures mathematical breakdowns of attacks, ability strikes, rolls, mitigations,
 * damage scaling factors, and threat additions.
 */

export interface CombatHitTrace {
  id: string;
  at: number;
  tick: number;
  region: string;
  attacker: {
    id: string;
    name: string;
    kind: 'player' | 'creature';
    calling?: string;
  };
  target: {
    id: string;
    name: string;
    kind: 'player' | 'creature';
  };
  action: {
    id: string;
    name: string;
    kind: 'attack' | 'ability' | 'status';
  };
  damageType: 'physical' | 'arcane';
  pierce: boolean;
  rolls: {
    variance: number;
    dodge?: { chance: number; rolled: number; dodged: boolean };
    crit?: { chance: number; rolled: number; crit: boolean; multiplier: number };
    stagger?: { chance: number; rolled: number; staggered: boolean };
    block?: { chance: number; rolled: number; blocked: boolean; amount: number };
  };
  factors: {
    base: number;
    power: number;
    raw: number;
    weakenedFactor?: number;
    markedFactor?: number;
    wovenFactor?: number;
    gaugeFactor?: number;
  };
  mitigation: {
    shieldAbsorb: number;
    defenseStat: number; // Armor or Ward
    afterDefense: number;
  };
  finalAmount: number;
  defeated: boolean;
  threat?: {
    added: number;
    newTotal: number;
  };
}

/** Formats a combat hit trace as a concise human-readable sentence. */
export function formatCombatHit(trace: CombatHitTrace): string {
  const { attacker, target, action, finalAmount, damageType, rolls, defeated } = trace;
  if (rolls.dodge?.dodged) {
    return `${target.name} dodged ${attacker.name}'s ${action.name}.`;
  }
  const crit = rolls.crit?.crit ? ' (Critical!)' : '';
  const block = rolls.block?.blocked ? ` [blocked ${rolls.block.amount}]` : '';
  const defeat = defeated ? ` — ${target.name} was defeated!` : '';
  return `${attacker.name} hit ${target.name} with ${action.name} for ${finalAmount} ${damageType} damage${crit}${block}.${defeat}`;
}
