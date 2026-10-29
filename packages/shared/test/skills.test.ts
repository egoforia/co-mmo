import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  CALLINGS,
  CALLING_IDS,
  HOTBAR_SIZE,
  REPLACES,
  changeCalling,
  coreSkillsFor,
  gainXp,
  newCharacter,
  readScroll,
  setHotbar,
  startCharacter,
  train,
  upgradeCharacter,
  xpToNext,
  type CallingId,
  type Character,
  type Stats,
} from '../src/index.ts';

// Core skills (docs/callings-build-plan.md, step 7a): every Calling's five
// skills match the tables on their pages, are learned as levels come, and
// reach characters saved before them. The hotbar holds known skills only.

/** One row of a Calling page's "Core skills" table, by column name. */
function coreTable(calling: CallingId): Record<string, string>[] {
  const page = readFileSync(new URL(`../../../docs/classes/${calling}.md`, import.meta.url), 'utf8');
  const section = page.split('## Core skills')[1]!.split('\n## ')[0]!;
  const rows = section.split('\n').filter((l) => l.startsWith('|')).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  const [head, , ...body] = rows;
  return body.map((cells) => Object.fromEntries(head!.map((h, i) => [h, cells[i]!])));
}

/** What a Range cell says, as the ability's range and radius in tiles. */
function rangeOf(text: string): { range: number; radius?: number } {
  const spot = /^([\d.]+) around a spot up to ([\d.]+) away/.exec(text);
  if (spot) return { range: Number(spot[2]), radius: Number(spot[1]) };
  const around = /^([\d.]+) around you/.exec(text);
  if (around) return { range: 0, radius: Number(around[1]) };
  if (text === 'Melee') return { range: 1.8 };
  const n = /([\d.]+)/.exec(text);
  return { range: n && !text.startsWith('Self') ? Number(n[1]) : 0 };
}

/** What an Amount cell says, as base + stat × factor (none when it is not that shape). */
function amountOf(text: string): { base: number; stat?: keyof Stats; factor: number } {
  const m = /^([\d.]+) \+ (\w+) × ([\d.]+)/.exec(text);
  return m ? { base: Number(m[1]), stat: m[2]!.toLowerCase() as keyof Stats, factor: Number(m[3]) } : { base: 0, factor: 0 };
}

describe('core skills', () => {
  for (const calling of CALLING_IDS) {
    it(`${CALLINGS[calling].name}: all five exist and match the page's table`, () => {
      const rows = coreTable(calling);
      expect(rows).toHaveLength(5);
      for (const { level, skill } of CALLINGS[calling].core) {
        const a = ABILITIES[skill];
        expect(a, skill).toBeDefined();
        const row = rows.find((r) => r.Skill === a!.name)!;
        expect(row, a!.name).toBeDefined();
        expect(Number(row.Level)).toBe(level);
        expect(a!.energy).toBe(Number(row.Energy));
        expect(a!.cooldown).toBe(Number(row.Cooldown));
        const { range, radius } = rangeOf(row.Range!);
        expect(a!.range, `${a!.name} range`).toBe(range);
        if (radius !== undefined) expect(a!.radius, `${a!.name} radius`).toBe(radius);
        const amount = amountOf(row.Amount!);
        expect(a!.base, `${a!.name} base`).toBe(amount.base);
        expect(a!.factor, `${a!.name} factor`).toBe(amount.factor);
        if (amount.stat) expect(a!.stat).toBe(amount.stat);
        if (row.Thread) expect(a!.thread).toBe(row.Thread.toLowerCase());
      }
    });
  }

  it('gauge spenders are finishers with the per-pip lift their pages give', () => {
    expect(ABILITIES.bulwark).toMatchObject({ finisher: true, perPip: 0.5 });
    expect(ABILITIES.whirl).toMatchObject({ finisher: true, perPip: 0.25 });
    expect(ABILITIES['aimed-shot']).toMatchObject({ finisher: true, perPip: 0.15 });
    expect(ABILITIES.toll).toMatchObject({ effect: 'heal', finisher: true });
    expect(ABILITIES['shield-bash']!.threat).toBe(3);
    expect(ABILITIES.earthbreak!.threat).toBe(2);
  });

  it('every Path is listed and ready for its skills (step 7b)', () => {
    for (const id of CALLING_IDS) for (const path of CALLINGS[id].paths) expect(path.skills.map((s) => s.level)).toEqual([10, 15, 20]);
  });
});

describe('learning core skills', () => {
  it('a new character knows their first skill, on key 1', () => {
    const c = startCharacter('ursine', 'warden');
    expect(c.abilities).toEqual(['shield-bash']);
    expect(c.hotbar).toEqual(['shield-bash', '', '', '', '', '']);
  });

  it('each skill level teaches the next, onto the next free key', () => {
    const c = startCharacter('lutran', 'wishweaver');
    gainXp(c, xpToNext(1));
    expect(c.abilities).toEqual(['ember-bolt', 'tide-lash']);
    gainXp(c, xpToNext(2));
    expect(c.abilities).toHaveLength(2);
    // Several levels at once teach all their skills.
    for (let n = 0; n < 5; n++) gainXp(c, xpToNext(c.level));
    expect(c.level).toBe(8);
    expect(c.abilities).toEqual(coreSkillsFor('wishweaver', 8));
    expect(c.hotbar).toEqual([...coreSkillsFor('wishweaver', 8), '']);
  });

  it('a skill learned when every key is full waits in the spellbook', () => {
    const c = startCharacter('ursine', 'duelist');
    c.hotbar = ['lunge', 'x', 'x', 'x', 'x', 'x'].map((a, i) => (a === 'x' ? `w${i}` : a));
    c.abilities.push('w1', 'w2', 'w3', 'w4', 'w5');
    gainXp(c, xpToNext(1));
    expect(c.abilities).toContain('riposte');
    expect(c.hotbar).not.toContain('riposte');
  });

  it('changing Calling forgets the old skills, keeps common techniques and learns the new', () => {
    const c = startCharacter('ursine', 'warden');
    for (let n = 0; n < 3; n++) gainXp(c, xpToNext(c.level));
    c.abilities.push('power-strike');
    expect(changeCalling(c, undefined, 'ranger')).toBeUndefined();
    expect(c.abilities).toEqual(['power-strike', 'aimed-shot', 'tumble', 'snare-trap']);
    expect(c.hotbar.filter(Boolean)).toEqual(['aimed-shot', 'tumble', 'snare-trap']);
  });
});

describe('characters saved before core skills', () => {
  const saved = (more: Partial<Character>) => JSON.parse(JSON.stringify({ ...newCharacter(), ...more })) as Partial<Character>;

  it('learn the skills for their level and keep their old keys in order', () => {
    const old = saved({ calling: 'warden', race: 'ursine', level: 6, abilities: ['power-strike'] });
    delete old.hotbar;
    const c = upgradeCharacter(old);
    expect(c.abilities).toEqual(['power-strike', 'shield-bash', 'challenge', 'bulwark', 'earthbreak']);
    expect(c.hotbar).toEqual(['power-strike', 'shield-bash', 'challenge', 'bulwark', 'earthbreak', '']);
  });

  it('Bellkeepers swap the old Mend for their own, Wishweavers Firebolt for Ember Bolt, on the same key', () => {
    const bell = saved({ calling: 'bellkeeper', race: 'cervid', level: 2, abilities: ['power-strike', 'mend'] });
    delete bell.hotbar;
    expect(upgradeCharacter(bell)).toMatchObject({ abilities: ['power-strike', 'bell-mend', 'chime'], hotbar: ['power-strike', 'bell-mend', 'chime', '', '', ''] });
    const weaver = saved({ calling: 'wishweaver', race: 'lutran', level: 1, abilities: ['firebolt'] });
    delete weaver.hotbar;
    expect(upgradeCharacter(weaver)).toMatchObject({ abilities: ['ember-bolt'], hotbar: ['ember-bolt', '', '', '', '', ''] });
    expect(REPLACES.wishweaver).toEqual({ firebolt: 'ember-bolt' });
  });

  it('anyone else keeps the old Mend and Firebolt as common techniques', () => {
    const c = upgradeCharacter(saved({ calling: 'duelist', race: 'scorpid', level: 1, abilities: ['mend', 'firebolt'], hotbar: ['firebolt', 'mend'] }));
    expect(c.abilities).toEqual(['mend', 'firebolt', 'lunge']);
    expect(c.hotbar).toEqual(['firebolt', 'mend', 'lunge', '', '', '']);
    expect(ABILITIES.mend).toMatchObject({ base: 8, factor: 3, cooldown: 12 });
    expect(ABILITIES['bell-mend']).toMatchObject({ name: 'Mend', base: 8, factor: 2.5, cooldown: 8 });
  });

  it('those without a Calling yet keep what they had until they choose', () => {
    const old = saved({ level: 4, abilities: ['mend'] });
    delete old.hotbar;
    delete old.freePoints;
    expect(upgradeCharacter(old)).toMatchObject({ abilities: ['mend'], hotbar: ['mend', '', '', '', '', ''] });
  });

  it('a Bellkeeper or Wishweaver is not sold the technique their skill replaces', () => {
    const bell = startCharacter('cervid', 'bellkeeper');
    bell.gold = 100;
    expect(train(bell, 'sister-amala', 'mend')).toMatch(/your own Mend/);
    expect(bell.gold).toBe(100);
    const weaver = startCharacter('lutran', 'wishweaver');
    weaver.inventory.push({ item: 'scroll-firebolt', qty: 1 });
    expect(readScroll(weaver, 'scroll-firebolt')).toMatch(/your own Ember Bolt/);
  });
});

describe('the hotbar', () => {
  it('takes known abilities on keys 1 to 6, each once', () => {
    const c = startCharacter('ursine', 'warden');
    c.abilities.push('power-strike');
    expect(setHotbar(c, ['', 'power-strike', '', '', '', 'shield-bash'])).toBeUndefined();
    expect(c.hotbar).toEqual(['', 'power-strike', '', '', '', 'shield-bash']);
    expect(setHotbar(c, ['power-strike'])).toBeUndefined();
    expect(c.hotbar).toHaveLength(HOTBAR_SIZE);
  });

  it('refuses unknown abilities, repeats and too many keys', () => {
    const c = startCharacter('ursine', 'warden');
    expect(setHotbar(c, ['whirl'])).toMatch(/abilities you know/);
    expect(setHotbar(c, ['made-up'])).toMatch(/abilities you know/);
    expect(setHotbar(c, ['shield-bash', 'shield-bash'])).toMatch(/one key/);
    expect(setHotbar(c, Array(7).fill(''))).toMatch(/Only 6/);
    expect(c.hotbar).toEqual(['shield-bash', '', '', '', '', '']);
  });
});
