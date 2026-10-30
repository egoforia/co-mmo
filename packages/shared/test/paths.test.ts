import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  CALLINGS,
  CALLING_IDS,
  ITEMS,
  LAND_PEOPLE,
  NPC_NAMES,
  PATH_MENTORS,
  PATH_SKILLS,
  PATH_SKILLS_BY_CALLING,
  QUESTS,
  SANCTUM_MENTORS,
  SKILL_NUMBERS_KEPT,
  TRIAL_QUESTS,
  WISHED_AILMENTS,
  WishError,
  addItem,
  applySkillLook,
  callingWishesLeft,
  chooseCalling,
  choosePath,
  completeQuest,
  gainXp,
  isClientMessage,
  knowsPassive,
  pathChoices,
  pathProblem,
  questComplete,
  questOffered,
  questTurnIn,
  skillName,
  startCharacter,
  trialPassed,
  validateSkillLookWish,
  xpToNext,
  type CallingId,
  type Character,
  type Stats,
} from '../src/index.ts';

// Build plan step 7b: the Path skills, choosing a Path after the trial, and
// the Calling Wish.

/** A character of this Calling raised to `level` by XP, as play would. */
function reach(calling: CallingId, level: number): Character {
  const c = startCharacter('ursine', calling);
  while (c.level < level) gainXp(c, xpToNext(c.level));
  return c;
}

/** Hands in the Calling's trial as if its goal were met. */
function passTrial(c: Character): void {
  const id = TRIAL_QUESTS[c.calling!];
  const goal = QUESTS[id]!.goal;
  const state = { id, count: goal.kind === 'defeat' ? goal.count : 0, done: false };
  c.quests.push(state);
  if (goal.kind === 'gather') for (const i of goal.items) addItem(c, i.item, i.qty);
  completeQuest(c, state);
}

// --- The Paths tables in docs/classes/*.md ---------------------------------------

const STAT_NAMES: Record<string, keyof Stats> = { Might: 'might', Agility: 'agility', Wit: 'wit', Spirit: 'spirit', Vigor: 'vigor' };

interface DocRow {
  name: string;
  thread?: string;
  level: number;
  effect: string;
  energy: string;
  cooldown: string;
  range: string;
  amount: string;
  what: string;
}

/** The rows of a Calling page's two Paths tables, first Path first. */
function docRows(calling: CallingId): DocRow[] {
  const page = readFileSync(resolve(import.meta.dirname, `../../../docs/classes/${calling}.md`), 'utf8');
  const section = page.slice(page.indexOf('## Paths'), page.indexOf('## How to play'));
  const rows: DocRow[] = [];
  let header: string[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((s) => s.trim());
    if (cells[0] === 'Skill') header = cells;
    else if (!cells[0]!.startsWith('---')) {
      const col = (name: string) => cells[header.indexOf(name)] ?? '';
      rows.push({
        name: col('Skill'), thread: header.includes('Thread') ? col('Thread') : undefined, level: Number(col('Level')),
        effect: col('Effect'), energy: col('Energy'), cooldown: col('Cooldown'), range: col('Range'), amount: col('Amount'), what: col('What it does'),
      });
    }
  }
  return rows;
}

/** Effects the page names one way and the kit builds another (a spin of timed area hits, not an Energy-draining stance). */
const KIT_EFFECT: Record<string, string> = { 'dune-tempest': 'area' };

describe('Path skills', () => {
  for (const calling of CALLING_IDS) {
    it(`${CALLINGS[calling].name}: every Path skill matches the Paths tables in docs/classes/${calling}.md`, () => {
      const rows = docRows(calling);
      const ids = CALLINGS[calling].paths.flatMap((p) => p.skills.map((s) => s.skill));
      expect(rows).toHaveLength(6);
      expect(Object.keys(PATH_SKILLS_BY_CALLING[calling]).sort()).toEqual([...ids].sort());
      rows.forEach((row, i) => {
        const id = ids[i]!;
        const skill = PATH_SKILLS[id]!;
        const where = `${row.name} (${id})`;
        expect(skill.level, where).toBe(row.level);
        expect(CALLINGS[calling].paths.flatMap((p) => p.skills).find((s) => s.skill === id)!.level, where).toBe(row.level);
        if (row.effect === 'passive') {
          expect(skill.passive?.name, where).toBe(row.name);
          expect(skill.ability, where).toBeUndefined();
          expect(ABILITIES[id], where).toBeUndefined();
          return;
        }
        const a = skill.ability!;
        expect(a.name, where).toBe(row.name);
        expect(ABILITIES[id], where).toBe(a);
        expect(a.effect, where).toBe(KIT_EFFECT[id] ?? row.effect.split(/[ (]/)[0]);
        expect(a.energy, where).toBe(Number.parseFloat(row.energy));
        if (row.energy.includes('per second')) expect(a.effect, where).toBe('stance');
        expect(a.cooldown, where).toBe(Number(row.cooldown));
        // Range: "Self", "Melee", "6", "3 around a spot up to 6 away", "2 around you", "Leap 5, hits 2 around landing".
        const spot = row.range.match(/^([\d.]+) around a spot up to ([\d.]+) away/);
        const around = row.range.match(/^([\d.]+) around you/);
        const leap = row.range.match(/^Leap ([\d.]+), hits ([\d.]+) around landing/);
        if (spot) expect([a.radius, a.range], where).toEqual([Number(spot[1]), Number(spot[2])]);
        else if (around) expect([a.radius, a.range], where).toEqual([Number(around[1]), 0]);
        else if (leap) expect([a.range, a.radius], where).toEqual([Number(leap[1]), Number(leap[2])]);
        else if (row.range === 'Melee') expect(a.range, where).toBeLessThanOrEqual(2);
        else if (/^(Self|Beside you)$/.test(row.range)) expect(a.range, where).toBe(0);
        else expect(a.range, where).toBe(Number.parseFloat(row.range));
        // Amount: "8 + Might × 1.5", "Vigor × 0.5 Armor", "Weapon hit × 0.6", "Weapon hit + 50%", "30% max HP", or none.
        const full = row.amount.match(/^([\d.]+) \+ (\w+) × ([\d.]+)/);
        const bare = row.amount.match(/^(Might|Agility|Wit|Spirit|Vigor) × ([\d.]+)/);
        const weapon = row.amount.match(/^Weapon hit (?:× ([\d.]+)|\+ (\d+)%)/);
        const share = row.amount.match(/^(\d+)% max HP/);
        if (full) expect([a.base, a.stat, a.factor], where).toEqual([Number(full[1]), STAT_NAMES[full[2]!], Number(full[3])]);
        else if (bare) expect([a.base, a.stat, a.factor], where).toEqual([0, STAT_NAMES[bare[1]!], Number(bare[2])]);
        else expect([a.base, a.factor], where).toEqual([0, 0]);
        if (weapon) expect(skill.numbers?.weapon, where).toBe(weapon[1] ? Number(weapon[1]) : 1 + Number(weapon[2]) / 100);
        if (share) expect(skill.numbers?.share, where).toBe(Number(share[1]) / 100);
        // Finishers: "(finisher)", or "+25% damage per pip" in what it does.
        const perPip = row.what.match(/\+(\d+)%(?: damage)? per (?:Focus )?pip/);
        if (perPip || row.effect.includes('finisher')) expect(a.finisher, where).toBe(true);
        if (perPip) expect(a.perPip, where).toBe(Number(perPip[1]) / 100);
        // Statuses named in what it does, and seconds where the page gives them.
        for (const [word, status] of [['Stuns', 'stunned'], ['Burning', 'burning'], ['Silences', 'silenced'], ['Slowing', 'slowed'], ['slow everything', 'slowed']] as const) {
          if (row.what.includes(word)) expect(a.status, where).toBe(status);
        }
        if (row.thread !== undefined) expect(a.thread ?? '', where).toBe(row.thread === 'All three' ? '' : row.thread.toLowerCase());
      });
    });
  }

  it('Path statuses are never wished onto abilities', () => {
    for (const s of ['hidden', 'unyielding', 'graced', 'knelled'] as const) expect(WISHED_AILMENTS).not.toContain(s);
  });
});

// --- Choosing a Path ---------------------------------------------------------------

describe('choosing a Path', () => {
  it('cannot be chosen before level 10, even with the trial done', () => {
    const c = reach('warden', 9);
    passTrial(c);
    expect(pathProblem(c, 'oakheart')).toMatch(/level 10/);
    expect(choosePath(c, 'oakheart')).toMatch(/level 10/);
    expect(c.path).toBeUndefined();
  });

  it('cannot be chosen before the trial', () => {
    const c = reach('duelist', 10);
    expect(trialPassed(c)).toBe(false);
    expect(choosePath(c, 'sunblade')).toMatch(/trial/);
    expect(pathChoices(c, PATH_MENTORS.duelist)).toBeUndefined();
    expect(c.path).toBeUndefined();
  });

  it('is one of the Calling\'s own two Paths, and teaches its first skill at once', () => {
    const c = reach('ranger', 10);
    passTrial(c);
    expect(choosePath(c, 'oakheart')).toMatch(/not a Path of the Rangers/);
    expect(pathChoices(c, PATH_MENTORS.ranger)!.map((p) => p.id)).toEqual(['windeye', 'wildkin']);
    expect(choosePath(c, 'wildkin')).toBeUndefined();
    expect(c.path).toBe('wildkin');
    expect(c.abilities).toContain('call-companion');
  });

  it('changing Path later costs 50 gold a level and swaps the skills', () => {
    const c = reach('bellkeeper', 20);
    passTrial(c);
    choosePath(c, 'dawnbell');
    expect(c.abilities).toEqual(expect.arrayContaining(['grace', 'great-bell-of-waking']));
    c.gold = 999;
    expect(choosePath(c, 'dirgebell')).toMatch(/1000 gold/);
    c.gold = 1000;
    expect(choosePath(c, 'dirgebell')).toBeUndefined();
    expect(c.gold).toBe(0);
    expect(c.abilities).not.toContain('grace');
    expect(c.abilities).toEqual(expect.arrayContaining(['knell', 'final-knell']));
    expect(knowsPassive(c, 'iron-psalm')).toBe(true);
    expect(knowsPassive(c, 'overtone')).toBe(false);
  });

  it('is cleared, with its skills, when the Calling changes', () => {
    const c = reach('warden', 10);
    passTrial(c);
    choosePath(c, 'stonefist');
    const before = c.abilities.length;
    // Changing Calling by wish runs chooseCalling.
    chooseCalling(c, 'ursine', 'duelist');
    expect(c.path).toBeUndefined();
    expect(c.abilities).not.toContain('quake-leap');
    expect(c.abilities.length).toBe(before - 1);
    expect(trialPassed(c)).toBe(false);
  });
});

describe('Path skills are learned at 10, 15 and 20', () => {
  for (const calling of CALLING_IDS) {
    for (const path of CALLINGS[calling].paths) {
      it(`${path.name}`, () => {
        const c = reach(calling, 10);
        passTrial(c);
        choosePath(c, path.id);
        const [active, passive, great] = path.skills.map((s) => s.skill) as [string, string, string];
        expect(c.abilities).toContain(active);
        expect(knowsPassive(c, passive)).toBe(false);
        while (c.level < 14) gainXp(c, xpToNext(c.level));
        expect(knowsPassive(c, passive)).toBe(false);
        gainXp(c, xpToNext(c.level));
        expect(c.level).toBe(15);
        expect(knowsPassive(c, passive)).toBe(true);
        expect(c.abilities).not.toContain(passive);
        expect(c.abilities).not.toContain(great);
        while (c.level < 20) gainXp(c, xpToNext(c.level));
        expect(c.abilities).toContain(great);
      });
    }
  }
});

// --- The trials --------------------------------------------------------------------

describe('the trials', () => {
  for (const calling of CALLING_IDS) {
    it(`${CALLINGS[calling].name}: ${QUESTS[TRIAL_QUESTS[calling]]!.title} is given at 10 by the Sanctum mentor and can be finished at the Path mentor`, () => {
      const id = TRIAL_QUESTS[calling];
      const q = QUESTS[id]!;
      expect(q.giver).toBe(SANCTUM_MENTORS[calling]);
      expect(questTurnIn(id)).toBe(PATH_MENTORS[calling]);
      expect(NPC_NAMES[q.giver]).toBe(CALLINGS[calling].mentor);
      // Not before level 10, and only to its own Calling.
      expect(questOffered(reach(calling, 9), q.giver)).toBeUndefined();
      const other = CALLING_IDS.find((x) => x !== calling)!;
      expect(questOffered(reach(other, 10), q.giver)).not.toBe(id);
      const c = reach(calling, 10);
      expect(questOffered(c, q.giver)).toBe(id);
      const state = { id, count: 0, done: false };
      c.quests.push(state);
      expect(questComplete(state, c)).toBe(false);
      if (q.goal.kind === 'defeat') state.count = q.goal.count;
      if (q.goal.kind === 'gather') for (const i of q.goal.items) addItem(c, i.item, i.qty);
      expect(questComplete(state, c)).toBe(true);
      completeQuest(c, state);
      if (q.goal.kind === 'gather') for (const i of q.goal.items) expect(c.inventory.some((s) => s.item === i.item)).toBe(false);
      expect(trialPassed(c)).toBe(true);
      expect(pathChoices(c, PATH_MENTORS[calling])).toHaveLength(2);
    });
  }

  it('the Path mentors are Sir Alder, Sultana Zahra, Queen Nerissa and Brother Tolle, with Zephyr Falcon standing in for the Windkeeper', () => {
    for (const calling of ['warden', 'duelist', 'wishweaver', 'bellkeeper'] as const) {
      expect(LAND_PEOPLE[PATH_MENTORS[calling]]?.pathMentor).toBe(calling);
      expect(LAND_PEOPLE[PATH_MENTORS[calling]]?.name).toBe(CALLINGS[calling].pathMentor);
    }
    expect(PATH_MENTORS.ranger).toBe(SANCTUM_MENTORS.ranger);
  });

  it('the Wishweaver trial gathers things the shore really has', () => {
    const goal = QUESTS[TRIAL_QUESTS.wishweaver]!.goal;
    expect(goal.kind).toBe('gather');
    if (goal.kind === 'gather') for (const i of goal.items) expect(ITEMS[i.item]).toBeDefined();
  });

  it('choosing a Path is a message the server accepts', () => {
    expect(isClientMessage({ t: 'choosePath', npc: 'sir-alder', path: 'oakheart' })).toBe(true);
    expect(isClientMessage({ t: 'choosePath', npc: 'sir-alder' })).toBe(false);
  });
});

// --- The Calling Wish --------------------------------------------------------------

describe('the Calling Wish', () => {
  const fireflies = { kind: 'skill', skill: 'piercing-arrow', name: 'Firefly Arrow', description: 'A swarm of fireflies that streams down the line.', look: { hook: 'fireflies', body: 'a glowing stream', color: '#e8c170', mood: 'gentle' } };

  it('is granted once at level 10 and again at 20', () => {
    expect(callingWishesLeft(reach('ranger', 9))).toBe(0);
    expect(callingWishesLeft(reach('ranger', 10))).toBe(1);
    expect(callingWishesLeft(reach('ranger', 19))).toBe(1);
    expect(callingWishesLeft(reach('ranger', 20))).toBe(2);
  });

  it('gives a skill a new name and look, and keeps its numbers', () => {
    const c = reach('ranger', 10);
    passTrial(c);
    choosePath(c, 'windeye');
    const before = { ...ABILITIES['piercing-arrow']! };
    const def = validateSkillLookWish(fireflies, c);
    expect(def).toMatchObject({ kind: 'skill', skill: 'piercing-arrow', name: 'Firefly Arrow' });
    expect(applySkillLook(c, def, 'wish-1')).toBe(true);
    expect(skillName(c, 'piercing-arrow')).toBe('Firefly Arrow');
    expect(ABILITIES['piercing-arrow']).toEqual(before);
    expect(callingWishesLeft(c)).toBe(0);
    // Spent until level 20.
    expect(() => validateSkillLookWish(fireflies, c)).toThrow(/level 20/);
    expect(applySkillLook(c, def, 'wish-2')).toBe(false);
  });

  it('refuses any change to the numbers', () => {
    const c = reach('ranger', 10);
    passTrial(c);
    choosePath(c, 'windeye');
    for (const more of [{ base: 99 }, { energy: 0 }, { cooldown: 1 }, { effect: 'area' }, { damage: 50 }]) {
      expect(() => validateSkillLookWish({ ...fireflies, ...more }, c)).toThrow(WishError);
      expect(() => validateSkillLookWish({ ...fireflies, ...more }, c)).toThrow(SKILL_NUMBERS_KEPT);
    }
  });

  it('only reshapes a skill the wisher knows', () => {
    const c = reach('ranger', 10);
    expect(() => validateSkillLookWish({ ...fireflies, skill: 'starfall' }, c)).toThrow(/skills you know/);
  });
});
