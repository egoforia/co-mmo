import { describe, expect, it } from 'vitest';
import { isClientMessage, nearestPaletteColor, validateName, PALETTE } from '../src/index.ts';

describe('isClientMessage', () => {
  it('accepts well-formed messages', () => {
    expect(isClientMessage({ t: 'input', seq: 1, dx: -1, dy: 0 })).toBe(true);
    expect(isClientMessage({ t: 'chat', channel: 'world', text: 'hi' })).toBe(true);
  });

  it('rejects anything a cheater could abuse', () => {
    expect(isClientMessage({ t: 'input', seq: 1, dx: 5, dy: 0 })).toBe(false);
    expect(isClientMessage({ t: 'input', seq: 1.5, dx: 0, dy: 0 })).toBe(false);
    expect(isClientMessage({ t: 'chat', channel: 'admin', text: 'hi' })).toBe(false);
    expect(isClientMessage(null)).toBe(false);
  });
});

describe('validateName', () => {
  it('accepts normal names and rejects odd ones', () => {
    expect(validateName('Mara')).toBeNull();
    expect(validateName("Ilya O'Brien")).toBeNull();
    expect(validateName('x')).not.toBeNull();
    expect(validateName('<script>')).not.toBeNull();
    expect(validateName('a'.repeat(21))).not.toBeNull();
  });
});

describe('palette', () => {
  it('has 32 colours and snaps to the nearest one', () => {
    expect(PALETTE).toHaveLength(32);
    expect(nearestPaletteColor(0xff0080)).toBe(0xff0044);
    expect(nearestPaletteColor(0xfefefe)).toBe(0xffffff);
  });
});
