import {
  ABILITIES,
  maxEnergy,
  maxHp,
  statusOf,
  type EntityInspection,
} from '@co-mmo/shared';
import { SWITCH_AT } from '../threat.ts';
import type { Creature } from '../creature-brain.ts';
import type { Region } from '../region.ts';
import type { PlayerState } from './state.ts';

/**
 * Extracts live mechanical and runtime inspection state for any entity in the region (Tool 4).
 * Accessible to Stewards and Owner. Zero runtime allocation when not inspecting.
 */
export function inspectEntity(region: Region, kind: 'player' | 'creature', id: string): EntityInspection | undefined {
  const s = region.state;
  const now = s.now();

  if (kind === 'player') {
    const p = s.players.get(id);
    if (!p) return undefined;
    return inspectPlayer(region, p, now);
  }

  const c = s.creatures.find((cr) => cr.id === id);
  if (!c) return undefined;
  return inspectCreature(region, c, now);
}

function inspectPlayer(region: Region, p: PlayerState, now: number): EntityInspection {
  const ch = p.character;
  const statuses = p.statuses
    .filter((st) => st.until > now)
    .map((st) => ({
      id: st.id,
      secondsLeft: Math.max(0, Math.round((st.until - now) / 100) / 10),
      ...(st.by !== undefined ? { by: st.by } : {}),
      ...(st.amount !== undefined ? { amount: st.amount } : {}),
    }));

  const cooldowns = ch.abilities.map((abilityId) => {
    const readyAt = p.readyAt.get(abilityId) ?? 0;
    const secondsLeft = Math.max(0, Math.round((readyAt - now) / 100) / 10);
    const name = ABILITIES[abilityId]?.name ?? abilityId;
    return { ability: abilityId, name, secondsLeft };
  });

  const g = region.gaugeSystem.of(p);
  let gauge: EntityInspection['gauge'];
  if (g) {
    const isWeave = g.id === 'weave';
    gauge = {
      calling: ch.calling ?? '',
      pips: g.pips,
      max: isWeave ? 3 : 5,
      ...(isWeave
        ? {
            threads: {
              ember: g.thread === 'ember' ? g.pips : 0,
              tide: g.thread === 'tide' ? g.pips : 0,
              gale: g.thread === 'gale' ? g.pips : 0,
            },
            woven: g.pips >= 3,
          }
        : {}),
    };
  }

  return {
    id: p.info.id,
    kind: 'player',
    name: p.info.name,
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
    floor: p.floor ?? 0,
    hp: Math.ceil(ch.hp),
    maxHp: maxHp(ch),
    energy: Math.floor(ch.energy),
    maxEnergy: maxEnergy(ch),
    alive: ch.hp > 0,
    targetId: p.targetId ?? null,
    statuses,
    cooldowns,
    ...(gauge ? { gauge } : {}),
  };
}

function inspectCreature(region: Region, c: Creature, now: number): EntityInspection {
  const s = region.state;
  const statuses = c.statuses
    .filter((st) => st.until > now)
    .map((st) => ({
      id: st.id,
      secondsLeft: Math.max(0, Math.round((st.until - now) / 100) / 10),
      ...(st.by !== undefined ? { by: st.by } : {}),
      ...(st.amount !== undefined ? { amount: st.amount } : {}),
    }));

  const tauntedBy = statusOf(c, 'taunted', now)?.by ?? null;
  const targetId = c.aggro ?? null;
  const currentTargetThreat = targetId ? (c.threat[targetId] ?? 0) : 0;
  const switchThreshold = currentTargetThreat > 0 ? Math.round(currentTargetThreat * SWITCH_AT * 10) / 10 : 0;

  const entries = Object.entries(c.threat)
    .map(([playerId, amount]) => {
      const pl = s.players.get(playerId);
      return {
        playerId,
        playerName: pl?.info.name ?? playerId,
        amount: Math.round(amount * 10) / 10,
        isTarget: playerId === targetId,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  let brainState = 'wander';
  if (c.respawnAt !== null) brainState = 'dead';
  else if (c.asleep) brainState = 'sleep';
  else if (c.fleeing) brainState = 'flee';
  else if (c.aggro) brainState = 'chase';
  else if (c.returning) brainState = 'guard';
  else if (c.def.behavior === 'patrol') brainState = 'patrol';

  const lastAttackSecondsAgo = c.lastAttack > 0 ? Math.max(0, Math.round((now - c.lastAttack) / 100) / 10) : 0;

  const rest = c.def.cooldown * 1000;
  const readyAt = c.lastAttack > 0 ? c.lastAttack + rest : 0;
  const attackCooldownLeft = Math.max(0, Math.round((readyAt - now) / 100) / 10);

  return {
    id: c.id,
    kind: 'creature',
    name: c.def.name,
    x: Math.round(c.x * 10) / 10,
    y: Math.round(c.y * 10) / 10,
    floor: c.floor ?? 0,
    hp: Math.ceil(c.hp),
    maxHp: c.def.hp,
    energy: 0,
    maxEnergy: 0,
    alive: c.respawnAt === null,
    targetId,
    statuses,
    threat: {
      targetId,
      tauntedBy,
      switchThreshold,
      entries,
    },
    brain: {
      state: brainState,
      leashX: c.home.x,
      leashY: c.home.y,
      pace: c.pace ?? 1,
      lastAttackSecondsAgo,
    },
    cooldowns: [{ ability: 'attack', name: 'Attack', secondsLeft: attackCooldownLeft }],
  };
}
