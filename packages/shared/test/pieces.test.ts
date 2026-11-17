import { describe, expect, it } from 'vitest';
import {
  ITEMS,
  bindOnWear,
  copyBase,
  copyId,
  copyWords,
  foundCopy,
  isClientMessage,
  newCharacter,
  ownPieces,
  parseCopy,
  pieceKey,
  unbindCopy,
  upgradeCharacter,
  type Character,
} from '../src/index.ts';

// Every piece of gear its own (combat decisions, step 2).

const unique = Object.keys(ITEMS).find((id) => ITEMS[id]!.unique)!;

describe('pieces of gear', () => {
  it('splits gear given by its base id into pieces of its own, and leaves other things stacked', () => {
    const pieces = ownPieces([{ item: 'wooden-sword', qty: 2 }, { item: 'tonic', qty: 3 }]);
    expect(pieces).toHaveLength(3);
    const [a, b, tonic] = pieces;
    expect(copyBase(a!.item)).toBe('wooden-sword');
    expect(copyBase(b!.item)).toBe('wooden-sword');
    expect(a!.item).not.toBe(b!.item);
    expect(tonic).toEqual({ item: 'tonic', qty: 3 });
    // A found piece has no known maker.
    expect(parseCopy(a!.item)!.maker.kind).toBe('world');
    expect(copyWords(ITEMS[a!.item])).toMatch(/^Tailored by unknown\. Quality 100%\./);
  });

  it('turns gear saved by its base id into pieces, worn or carried', () => {
    const c = upgradeCharacter({ ...newCharacter(), inventory: [{ item: 'bible', qty: 1 }, { item: 'wooden-sword', qty: 2 }], equipment: { head: 'mushroom-hat' } } as Partial<Character>);
    const swords = c.inventory.filter((s) => copyBase(s.item) === 'wooden-sword');
    expect(swords).toHaveLength(2);
    expect(swords.every((s) => s.qty === 1)).toBe(true);
    expect(copyBase(c.equipment.head!)).toBe('mushroom-hat');
    expect(c.equipment.head).not.toBe('mushroom-hat');
    // Upgrading again changes nothing.
    expect(upgradeCharacter(c).inventory).toEqual(c.inventory);
  });

  it('a bound piece that loses its binding stays the same piece and never binds again', () => {
    const piece = foundCopy(unique);
    const bag = { inventory: [{ item: piece, qty: 1 }] };
    const bound = bindOnWear(bag, piece);
    expect(ITEMS[bound]!.bound).toBe(true);
    expect(copyWords(ITEMS[bound])).toMatch(/Bound to you\./);
    const loose = unbindCopy(bound);
    expect(ITEMS[loose]!.bound).toBeUndefined();
    expect(parseCopy(loose)!.unbound).toBe(true);
    expect(copyWords(ITEMS[loose])).toMatch(/No longer bound\./);
    expect(bindOnWear({ inventory: [{ item: loose, qty: 1 }] }, loose)).toBe(loose);
    // Its history follows it through every form.
    expect(new Set([pieceKey(piece), pieceKey(bound), pieceKey(loose)]).size).toBe(1);
    // Anything not bound is left as it is.
    expect(unbindCopy(piece)).toBe(piece);
    expect(unbindCopy('tonic')).toBe('tonic');
  });

  it('keeps a piece id short enough for a message', () => {
    const id = copyId({ of: 'wooden-sword', quality: 100, maker: { kind: 'world', name: '' } }, 'abc123');
    expect(isClientMessage({ t: 'history', items: [id] })).toBe(true);
    expect(isClientMessage({ t: 'history', items: Array.from({ length: 41 }, () => id) })).toBe(false);
  });
});
