import { describe, expect, it } from 'vitest';
import { FLAME_LIGHT, RIM_LIGHT, glowOf, lampOn, lightOn, skyFill, sunAt } from '../src/index.ts';

const at = (hour: number) => hour / 24;
const FLAT: [number, number, number] = [0, 0, 1];
const WHITE: [number, number, number] = [1, 1, 1];

describe('the sun and moon', () => {
  it('rises on the left, stands overhead at midday and sets on the right', () => {
    expect(sunAt(at(6)).dir[0]).toBeLessThan(-0.5);
    expect(Math.abs(sunAt(at(12.5)).dir[0])).toBeLessThan(0.01);
    expect(sunAt(at(19)).dir[0]).toBeGreaterThan(0.5);
  });

  it('is warm at dawn and dusk, neutral at midday and a dim cool moon at night', () => {
    const [r, , b] = sunAt(at(19)).color;
    expect(r).toBeGreaterThan(b * 2);
    const noon = sunAt(at(12.5)).color;
    expect(noon[0]).toBeCloseTo(noon[2]);
    const moon = sunAt(at(23)).color;
    expect(moon[2]).toBeGreaterThan(moon[0]);
    expect(moon[0]).toBeLessThan(noon[0]);
  });

  it('turns smoothly through the day', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const a = sunAt(at(h));
      const b = sunAt(at(h + 0.25));
      expect(Math.abs(a.dir[0] - b.dir[0])).toBeLessThan(0.25);
      expect(Math.hypot(...a.dir)).toBeCloseTo(1);
    }
  });

  it('is hidden by clouds, which spread its light into the sky instead', () => {
    expect(sunAt(at(12.5), 'storm').color[0]).toBeLessThan(sunAt(at(12.5)).color[0]);
    expect(skyFill('storm')).toBeGreaterThan(skyFill('clear'));
  });
});

describe('light on a surface', () => {
  it('lights the side facing the sun more', () => {
    const dawn = sunAt(at(6));
    const left = lightOn([-0.7, 0, 0.7], WHITE, dawn, 0.5);
    const right = lightOn([0.7, 0, 0.7], WHITE, dawn, 0.5);
    expect(left[0]).toBeGreaterThan(right[0]);
  });

  it('is about full daylight on a flat picture at midday', () => {
    const [r] = lightOn(FLAT, WHITE, sunAt(at(12.5)), skyFill());
    expect(r).toBeGreaterThan(0.9);
    expect(r).toBeLessThan(1.1);
  });

  it('adds a rim on a character outline only', () => {
    const night = sunAt(at(23));
    const edge: [number, number, number] = [1, 0, 0];
    expect(lightOn(edge, WHITE, night, 0.5, true)[2] - lightOn(edge, WHITE, night, 0.5)[2]).toBeCloseTo(RIM_LIGHT[2]);
    expect(lightOn(FLAT, WHITE, night, 0.5, true)).toEqual(lightOn(FLAT, WHITE, night, 0.5));
  });

  it('gets a lamp only within its reach, most on the side facing it', () => {
    expect(lampOn(FLAT, 5, 0, 4, WHITE, 1)).toEqual([0, 0, 0]);
    const facing = lampOn([0.7, 0, 0.7], 1, 0, 4, WHITE, 1)[0];
    const away = lampOn([-0.7, 0, 0.7], 1, 0, 4, WHITE, 1)[0];
    expect(facing).toBeGreaterThan(away);
  });
});

describe('what glows', () => {
  it('lights fires, lanterns and shrines, not moths or spells', () => {
    expect(glowOf('temple-furniture-brazier')).toBe(FLAME_LIGHT);
    expect(glowOf('shore-furniture-ship-lantern')).toBeDefined();
    expect(glowOf('sanctum-shrine')).toBeDefined();
    expect(glowOf('sanctum-lantern-moth')).toBeUndefined();
    expect(glowOf('item-firebolt')).toBeUndefined();
    expect(glowOf('woods-oak')).toBeUndefined();
  });
});
