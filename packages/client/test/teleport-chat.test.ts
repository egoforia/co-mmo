import { describe, expect, it } from 'vitest';
import { readChat } from '../src/ui.ts';

describe('/teleport and /tp chat command parsing', () => {
  it('parses coordinate pair in current region', () => {
    expect(readChat('say', '/teleport 128 109')).toEqual({
      t: 'teleport',
      x: 128,
      y: 109,
    });
    expect(readChat('say', '/tp 128 109')).toEqual({
      t: 'teleport',
      x: 128,
      y: 109,
    });
    expect(readChat('say', '/teleport 128, 109')).toEqual({
      t: 'teleport',
      x: 128,
      y: 109,
    });
  });

  it('parses coordinates with floor', () => {
    expect(readChat('say', '/teleport 128 109 -1')).toEqual({
      t: 'teleport',
      x: 128,
      y: 109,
      floor: -1,
    });
    expect(readChat('say', '/tp 128 109 2')).toEqual({
      t: 'teleport',
      x: 128,
      y: 109,
      floor: 2,
    });
  });

  it('parses target region only', () => {
    expect(readChat('say', '/teleport woods')).toEqual({
      t: 'teleport',
      region: 'woods',
    });
    expect(readChat('say', '/tp sunlit shore')).toEqual({
      t: 'teleport',
      region: 'sunlit shore',
    });
  });

  it('parses target region with coordinates and floor', () => {
    expect(readChat('say', '/teleport woods 100 120')).toEqual({
      t: 'teleport',
      region: 'woods',
      x: 100,
      y: 120,
    });
    expect(readChat('say', '/teleport sanctum 128 109 -2')).toEqual({
      t: 'teleport',
      region: 'sanctum',
      x: 128,
      y: 109,
      floor: -2,
    });
  });

  it('returns problem on missing or incomplete coordinates', () => {
    expect(readChat('say', '/teleport')).toMatchObject({
      t: 'problem',
    });
    expect(readChat('say', '/tp 128')).toMatchObject({
      t: 'problem',
      text: 'Please provide both X and Y coordinates: /teleport <x> <y> [floor]',
    });
  });
});
