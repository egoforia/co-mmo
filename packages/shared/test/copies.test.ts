import { describe, expect, it } from 'vitest';
import {
  ITEMS,
  QUALITY_MAX,
  QUALITY_MIN,
  RECIPES,
  addItem,
  buy,
  copyBase,
  copyId,
  copyWords,
  craft,
  craftQuality,
  crafted,
  discover,
  isClientMessage,
  isCopyId,
  newCharacter,
  parseCopy,
  shopMade,
  validateDefinition,
  type CopyInfo,
} from '../src/index.ts';

const info = (over: Partial<CopyInfo> = {}): CopyInfo => ({ of: 'wooden-sword', quality: 110, maker: { kind: 'player', name: 'Mara' }, ...over });

describe('crafted copies', () => {
  it('say everything about themselves in their id, and read back the same', () => {
    const full = info({ maker: { kind: 'player', name: 'Ilyá of the Hollow ~ 2' }, people: 'cervid', trait: 'supple', material: 'mushroom-fibre' });
    const id = copyId(full, 'abc123');
    expect(isCopyId(id)).toBe(true);
    expect(copyBase(id)).toBe('wooden-sword');
    expect(id.split('~')).toHaveLength(8);
    expect(parseCopy(id)).toEqual(full);
    expect(parseCopy(copyId(info({ maker: { kind: 'npc', name: 'Marina the Trader' } }), 'x'))).toEqual(info({ maker: { kind: 'npc', name: 'Marina the Trader' } }));
  });

  it('refuses ids that are not well made', () => {
    expect(parseCopy('wooden-sword')).toBeUndefined();
    expect(parseCopy('wooden-sword~c~100~pMara~~~')).toBeUndefined();
    expect(parseCopy('wooden-sword~c~500~pMara~~~~n')).toBeUndefined();
    expect(parseCopy('wooden-sword~x~100~pMara~~~~n')).toBeUndefined();
    expect(ITEMS['wooden-sword~c~500~pMara~~~~n']).toBeUndefined();
    // Only gear is made into copies.
    expect(ITEMS[copyId(info({ of: 'tonic' }), 'n')]).toBeUndefined();
    expect(ITEMS[copyId(info({ of: 'no-such-thing' }), 'n')]).toBeUndefined();
  });

  it('have their base item, with the bonus and value sized by quality', () => {
    const better = ITEMS[copyId(info({ quality: 130 }), 'a')]!;
    expect(better).toMatchObject({ name: 'Wooden Sword', slot: 'weapon', bonus: { attack: 3 }, value: 20, copy: { quality: 130 } });
    // A poor copy keeps at least 1 of each bonus it has.
    const poor = ITEMS[copyId(info({ quality: 80 }), 'b')]!;
    expect(poor.bonus).toEqual({ attack: 2 });
    expect(poor.value).toBe(12);
    expect('wooden-sword~c~100~pMara~~~~n' in ITEMS).toBe(true);
    // Copies are not listed with the items.
    expect(Object.keys(ITEMS).some(isCopyId)).toBe(false);
    expect(copyWords(better)).toBe('Tailored by Mara. Quality 130%.');
    expect(copyWords(ITEMS['wooden-sword'])).toBe('');
  });

  it('are made by shops at standard quality and by players by their Wit', () => {
    const c = newCharacter();
    c.gold = 100;
    expect(buy(c, 'marina', 'wooden-sword', shopMade('Marina', () => 0.5))).toBeUndefined();
    const sword = c.inventory.find((s) => isCopyId(s.item))!;
    expect(ITEMS[sword.item]!.copy).toMatchObject({ quality: 100, maker: { kind: 'npc', name: 'Marina' } });
    // What a shop sells that is not gear still stacks.
    buy(c, 'marina', 'tonic', shopMade('Marina', () => 0.5));
    expect(c.inventory.some((s) => s.item === 'tonic')).toBe(true);

    const r = RECIPES['shell-mail']!;
    expect(craftQuality(r.wit, r, () => 0.5)).toBe(100);
    expect(craftQuality(r.wit + 100, r, () => 0.5)).toBe(QUALITY_MAX);
    expect(craftQuality(r.wit - 20, r, () => 0)).toBe(QUALITY_MIN);
    c.stats.wit = 20;
    c.race = 'lutran';
    addItem(c, 'crab-shell', 5);
    expect(craft(c, 'shell-mail', crafted(c, 'Mara', 'shell-mail', () => 0.5))).toBeUndefined();
    const mail = c.inventory.find((s) => copyBase(s.item) === 'shell-mail')!;
    expect(ITEMS[mail.item]!.copy).toMatchObject({ maker: { kind: 'player', name: 'Mara' }, people: 'lutran', material: 'crab-shell' });
  });

  it('count as their base item in what you have found', () => {
    const c = newCharacter();
    discover(c, copyId(info(), 'n'));
    expect(c.discovered).toContain('wooden-sword');
    expect(c.discovered.some(isCopyId)).toBe(false);
  });

  it('can never be wished into being', () => {
    const forged = copyId(info({ quality: 130 }), 'n');
    const creature = validateDefinition({ kind: 'creature', name: 'Forger', description: 'x', behavior: 'timid', drops: [forged, 'tonic'] });
    expect(JSON.stringify(creature)).not.toContain('~');
  });
});

describe('crafted copy ids', () => {
  it('always fit in a message, however long the names', () => {
    const long = copyId({ of: 'a'.repeat(36), quality: 100, maker: { kind: 'player', name: '漢'.repeat(30) }, people: 'scorpid', trait: 'shimmering', material: 'b'.repeat(36) }, 'abc123');
    expect(long.length).toBeLessThanOrEqual(200);
    expect(parseCopy(long)!.maker.name).toBe('漢'.repeat(5));
    expect(isClientMessage({ t: 'use', item: long })).toBe(true);
  });
});
