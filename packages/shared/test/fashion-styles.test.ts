import { describe, expect, it } from 'vitest';
import {
  GARMENTS,
  GARMENT_RECIPES,
  GARMENT_SLOTS,
  ITEMS,
  REGION_STYLES,
  SHOPS,
  STYLES,
  copyId,
  dodgeChance,
  fullStyles,
  gearBonus,
  materialHomes,
  newCharacter,
  recipeTier,
  statusLength,
  styleGarments,
  styleWords,
  EVERYWHERE_REGION,
} from '../src/index.ts';

describe('region styles', () => {
  it('give every region four common garments, one a slot, made from its own materials', () => {
    expect(Object.keys(REGION_STYLES).sort()).toEqual(['barkwarden', 'pearlcoat', 'pilgrim', 'sporeweave', 'sunwrap', 'windfelt']);
    for (const [id, style] of Object.entries(REGION_STYLES)) {
      const common = styleGarments(id).filter((g) => ITEMS[g]!.rarity === 'common');
      expect(common.map((g) => ITEMS[g]!.slot).sort()).toEqual([...GARMENT_SLOTS].sort());
      for (const g of common) {
        const r = GARMENT_RECIPES[g]!;
        expect(recipeTier(r)).toBe('common');
        for (const m of r.materials) {
          expect(ITEMS[m.item], m.item).toBeDefined();
          const homes = materialHomes(m.item);
          expect(homes.includes(style.region) || homes.includes(EVERYWHERE_REGION), `${g}: ${m.item}`).toBe(true);
        }
      }
    }
  });

  it('have about eight rare garments that mix regions, and three unique pieces', () => {
    const rare = Object.entries(GARMENTS).filter(([, d]) => d.rarity === 'rare');
    expect(rare).toHaveLength(8);
    for (const [id] of rare) expect(recipeTier(GARMENT_RECIPES[id]!)).toBe('rare');
    expect(Object.values(ITEMS).filter((d) => d.unique && d.style)).toHaveLength(3);
  });

  it('paint every garment its own picture, showing a stand-in until then', () => {
    for (const [id, d] of Object.entries(GARMENTS)) {
      expect(d.art).toBe(`item-${id}`);
      expect(d.standIn).toMatch(/^item-/);
    }
  });

  it('are sold at home by their tailor', () => {
    for (const [id, style] of Object.entries(REGION_STYLES)) {
      const sold = SHOPS[style.tailor]!.sells.map((s) => s.item);
      for (const g of styleGarments(id).filter((g) => ITEMS[g]!.rarity === 'common')) expect(sold, `${style.tailor} sells ${g}`).toContain(g);
    }
  });

  it('give their full-style bonus for three pieces worn, anywhere, copies included', () => {
    const c = newCharacter();
    const plain = dodgeChance(c);
    const made = (of: string) => copyId({ of, quality: 100, maker: { kind: 'player', name: 'Ysa' } }, 'n');
    c.equipment = { head: made('windfelt-hood'), body: made('windfelt-tunic') };
    expect(fullStyles(c)).toEqual([]);
    c.equipment.cloak = made('windfelt-cloak');
    expect(fullStyles(c)).toEqual(['windfelt']);
    expect(dodgeChance(c)).toBeCloseTo(plain + 0.03);
    // A charm is not a garment: it never counts.
    expect(gearBonus({ equipment: { head: 'barkwarden-helm', body: 'barkwarden-coat', feet: 'barkwarden-boots' } }, 'armor')).toBe(2 + 6 + 1 + STYLES.barkwarden!.bonus.armor!);
  });

  it('shorten harmful statuses in a full Sunwrap style', () => {
    expect(statusLength('poisoned', 10, 0, 10)).toBe(9000);
    expect(statusLength('evasive', 10, 0, 10)).toBe(10000);
  });

  it('say their style and bonus on the card', () => {
    expect(styleWords(ITEMS['windfelt-cloak'], () => 'Frostpeak')).toBe('Windfelt style, from Frostpeak. Three pieces worn: +3% dodge.');
  });
});
