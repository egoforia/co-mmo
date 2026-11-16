import {
  ABILITIES,
  CALLINGS,
  CREATURES,
  DAMAGE_EFFECTS,
  ITEMS,
  RACES,
  TICK_RATE,
  Tile,
  callingStats,
  levelledCreature,
  maxEnergy,
  maxHp,
  regionDef,
  startCharacter,
  type CallingId,
  type Character,
  type ServerMessage,
} from '@co-mmo/shared';
import { Region, type Connection } from './region.ts';

// The balance test (docs/combat.md step 7, docs/callings-build-plan.md step
// 11): real fights in a real region on tiles, so reach, line of sight,
// crowds about a player, flanking and free swings all count. Each Calling
// at a level, with its main weapon and every free point in its primary (no
// people's lift, no other gear), fights creatures of its level made the way
// land creatures are (lands.ts levelledCreature). The fighter stands still,
// strikes whenever it can and uses its damage skills as they come ready.

/** Who fights what. */
export type Scene = 'solo' | 'crowd' | 'pair' | 'steady';

/** What a scene is, in words for the report. */
export const SCENES: Record<Scene, string> = {
  solo: 'alone against one creature',
  crowd: 'alone against three',
  pair: 'two of the Calling against one tough creature (twice the health)',
  steady: 'alone against a training post that never hurts (ten times the health)',
};

/** Health a scene's creature has, as a multiple of a land creature's. */
const HEALTH: Record<Scene, number> = { solo: 1, crowd: 1, pair: 2, steady: 10 };

/** How a fight went. */
export interface FightResult {
  calling: CallingId;
  level: number;
  scene: Scene;
  /** The creatures all fell before the fighters did. */
  won: boolean;
  /** How long it lasted, in seconds (the time limit when nobody fell). */
  seconds: number;
  /** Share of their health the fighters lost (all of it when they fell), 0 to 1. */
  hpLost: number;
  /** Damage the fighters dealt each second, from their first blow to the end. */
  dps: number;
}

/** A fight stops after this long, in seconds. */
const LIMIT = 120;
/** Where the fight takes place: open ground cleared about a spot in this land. */
const LAND = 'woods';

/** A seeded random, so every run of the test fights the same fights. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A level `level` fighter of a Calling, with its main weapon. */
function fighter(calling: CallingId, level: number): Character {
  const c = startCharacter('ursine', calling);
  c.level = level;
  const stats = callingStats('ursine', calling, level);
  // No people's lift: Callings are compared on their own.
  for (const [k, v] of Object.entries(RACES.ursine.lift)) stats[k as keyof typeof stats] -= v ?? 0;
  stats[CALLINGS[calling].primary] += level - 1;
  c.stats = stats;
  c.freePoints = 0;
  const family = CALLINGS[calling].weapons[0]!;
  const item = `balance-${family}`;
  ITEMS[item] ??= { name: `Plain ${family}`, kind: 'equipment', art: 'x', description: '', slot: 'weapon', weapon: family };
  c.equipment.weapon = item;
  c.hp = maxHp(c);
  c.energy = maxEnergy(c);
  return c;
}

/**
 * The creature kind for a level and scene, made like the land's. A pair's
 * has twice the health; the steady scene's has ten times, so a short
 * fight's opening volley and last overkill blow don't sway the rate.
 */
function foeKind(level: number, scene: Scene): string {
  const kind = `balance-foe-${level}-${scene}`;
  if (!CREATURES[kind]) {
    const def = levelledCreature({ name: 'Training Foe', art: 'x', description: '', size: 'medium', behavior: 'chase', level, speed: 3, notice: 12, drops: [] });
    CREATURES[kind] = { ...def, hp: def.hp * HEALTH[scene] };
  }
  return kind;
}

const quiet = (): Connection & { messages: ServerMessage[] } => {
  const messages: ServerMessage[] = [];
  return { messages, send: (m) => messages.push(m), close() {} };
};

/** One fight, start to finish. */
export function fight(calling: CallingId, level: number, scene: Scene, seed = 1): FightResult {
  const clock = { now: 1_000_000_000 };
  const region = new Region(regionDef(LAND)!, undefined, () => clock.now, seeded(seed));
  const map = region.map;
  // Everyone else in the land goes far off, and the ground about the spot is cleared.
  for (const id of region.creatureIds()) region.placeCreature(id, 2.5, 2.5);
  const cx = Math.floor(map.width / 2) + 20;
  const cy = Math.floor(map.height / 2) + 20;
  for (let y = cy - 10; y <= cy + 10; y++) for (let x = cx - 10; x <= cx + 10; x++) map.tiles[y * map.width + x] = Tile.Ground;
  map.npcs.length = 0;

  const ids = scene === 'pair' ? ['a', 'b'] : ['a'];
  const ranged = ['ranger', 'wishweaver'].includes(calling);
  const conns = ids.map(() => quiet());
  ids.forEach((id, i) => {
    region.join({ id, name: id, color: 0xffffff, role: 'player' }, conns[i]!, { x: null, y: null }, fighter(calling, level));
  });
  const kind = foeKind(level, scene);
  const count = scene === 'crowd' ? 3 : 1;
  // The creature starts a few tiles off (more for those who shoot), and walks up.
  const off = ranged ? 5 : 2;
  region.placePlayer('a', cx + 0.5, cy + 0.5);
  if (scene === 'pair') region.placePlayer('b', cx + 0.5, cy + 2.5);
  region.addCreatures(kind, Array.from({ length: count }, (_, i) => ({ x: cx + off + 0.5, y: cy + i - (count > 1 ? 1 : 0) + (scene === 'pair' ? 1 : 0) + 0.5 })));
  const foes = region.creatureIds().filter((id) => id.includes(kind));
  const startHp = ids.map((id) => region.character(id)!.hp);
  const foeHp = foes.reduce((n, id) => n + region.creature(id)!.hp, 0);
  const skills = (id: string) => region.character(id)!.abilities.filter((a) => ABILITIES[a] && DAMAGE_EFFECTS.includes(ABILITIES[a]!.effect));

  let ticks = 0;
  const alive = (id: string) => region.creature(id)?.alive;
  const standing = (id: string) => (region.character(id)?.hp ?? 0) > 0;
  let dealt = 0;
  let firstHit: number | undefined;
  const seen = conns.map(() => 0);
  while (ticks < LIMIT * TICK_RATE && foes.some(alive) && ids.some(standing)) {
    for (const id of ids) {
      if (!standing(id)) continue;
      const target = foes.find(alive);
      // Strike when ready (the server says no otherwise), and use each damage skill as it comes ready.
      region.handle(id, { t: 'attack', ...(target ? { target } : {}) });
      for (const a of skills(id)) region.handle(id, { t: 'ability', ability: a, ...(target ? { target } : {}) });
    }
    clock.now += 1000 / TICK_RATE;
    region.tick();
    // The training post never hurts: its taps are healed at once, so the fight runs its whole length.
    if (scene === 'steady') ids.forEach((id, i) => (region.character(id)!.hp = startHp[i]!));
    // Blows the fighters landed this tick (each fighter is sent every hit near them, so count one fighter's view).
    const c = conns[0]!;
    for (; seen[0]! < c.messages.length; seen[0]!++) {
      const m = c.messages[seen[0]!]!;
      if (m.t !== 'hit' || !ids.includes(m.by)) continue;
      dealt += m.amount;
      firstHit ??= ticks;
    }
    ticks++;
  }
  const seconds = ticks / TICK_RATE;
  // Damage each second from the first blow, so a shot fired while a creature walks up counts as quick as one at arm's length.
  const fighting = Math.max(1, ticks - (firstHit ?? 0)) / TICK_RATE;
  const won = !foes.some(alive);
  // Rising a level from the fight's XP heals: health lost never counts below none.
  const lost = ids.reduce((n, id, i) => n + Math.max(0, startHp[i]! - Math.max(0, region.character(id)?.hp ?? 0)) / startHp[i]!, 0) / ids.length;
  return { calling, level, scene, won, seconds, hpLost: Math.min(1, lost), dps: Math.min(dealt, foeHp) / fighting };
}

/** Every Calling at each level in each scene. */
export function balanceTable(levels = [1, 10, 20], scenes: Scene[] = ['solo', 'crowd', 'pair', 'steady']): FightResult[] {
  const out: FightResult[] = [];
  for (const scene of scenes) for (const level of levels) for (const calling of Object.keys(CALLINGS) as CallingId[]) out.push(fight(calling, level, scene));
  return out;
}

/** The results as Markdown tables, one per scene and level. */
export function balanceReport(results: FightResult[]): string {
  const lines: string[] = [];
  const groups = new Map<string, FightResult[]>();
  for (const r of results) {
    const key = `${r.scene}|${r.level}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, rows] of groups) {
    const [scene, level] = key.split('|') as [Scene, string];
    lines.push(`### Level ${level}, ${SCENES[scene]}`, '', '| Calling | Won | Seconds | Health lost | Damage/s |', '| --- | --- | --- | --- | --- |');
    // A fight won in a blink has no rate worth reading.
    for (const r of rows) lines.push(`| ${CALLINGS[r.calling].name} | ${r.won ? 'yes' : 'no'} | ${r.seconds.toFixed(1)} | ${Math.round(r.hpLost * 100)}% | ${r.seconds < 0.5 ? 'one volley' : r.dps.toFixed(1)} |`);
    lines.push('');
  }
  return lines.join('\n');
}

/** The Callings whose job is damage, held to one another's steady damage. */
export const DAMAGE_CALLINGS: CallingId[] = ['duelist', 'ranger', 'wishweaver'];
/** How far apart their steady damage may be: the most at most 15% over the least. */
export const DAMAGE_SPREAD = 1.15;

/**
 * What the balance pass promised (docs/balance.md), in words: an empty list
 * when it holds. The damage Callings stay within DAMAGE_SPREAD of each other
 * against the training post at levels 10 and 20, and a crowd of three of
 * their level still beats every Calling there. Level 1 fights are over too
 * quickly to say much, so they are only read.
 */
export function balanceProblems(results: FightResult[]): string[] {
  const problems: string[] = [];
  for (const level of [10, 20]) {
    const steady = results.filter((r) => r.scene === 'steady' && r.level === level && DAMAGE_CALLINGS.includes(r.calling));
    if (steady.length === DAMAGE_CALLINGS.length) {
      const most = steady.reduce((a, b) => (b.dps > a.dps ? b : a));
      const least = steady.reduce((a, b) => (b.dps < a.dps ? b : a));
      if (most.dps > least.dps * DAMAGE_SPREAD) {
        problems.push(`At level ${level} the ${CALLINGS[most.calling].name} deals ${Math.round((most.dps / least.dps - 1) * 100)}% more steady damage than the ${CALLINGS[least.calling].name} (at most ${Math.round((DAMAGE_SPREAD - 1) * 100)}%).`);
      }
    }
    for (const r of results.filter((r) => r.scene === 'crowd' && r.level === level && r.won)) {
      problems.push(`At level ${level} a ${CALLINGS[r.calling].name} beat a crowd of three alone; crowds should stay deadly.`);
    }
  }
  return problems;
}
