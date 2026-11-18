import { describe, expect, it } from 'vitest';
import { DEATH_DROP_CHANCE, deathRisk, deathRiskWords, deathXpFor, newCharacter, setGold } from '../src/index.ts';

// The bag's "If you fall here" line, from the numbers a death uses.

describe('the risk of falling', () => {
  it('names the XP, all the gold, the worn pieces and the bag', () => {
    const c = newCharacter();
    c.level = 5;
    setGold(c, 340);
    c.equipment.weapon = 'wooden-sword';
    const r = deathRisk(c, false);
    expect(r).toMatchObject({ gold: 340, worn: 1, xp: deathXpFor(c), chance: DEATH_DROP_CHANCE });
    expect(deathRiskWords(r)).toBe(`If you fall here: you lose ${r.xp} XP and all 340 gold. Chance to drop: each worn piece 15%, the bag with all in it 15%.`);
  });

  it('leaves out gold and worn pieces when there are none', () => {
    const words = deathRiskWords(deathRisk(newCharacter(), false));
    expect(words).not.toContain('gold');
    expect(words).not.toContain('worn');
  });

  it('says a safe area is safe', () => {
    expect(deathRiskWords(deathRisk(newCharacter(), true))).toBe('Safe here: no one can hurt you.');
  });
});
