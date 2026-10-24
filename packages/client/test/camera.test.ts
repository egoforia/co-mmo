import { describe, expect, it } from 'vitest';
import { chooseCamera } from '../src/camera.ts';
import { ISOMETRIC, PROJECTION } from '../src/projection.ts';

describe('choosing the camera', () => {
  it('is isometric for every player, Steward and Owner', () => {
    for (const role of ['player', 'steward', 'owner'] as const) {
      expect(chooseCamera(role)).toBe(true);
      expect(PROJECTION).toBe(ISOMETRIC);
    }
  });
});
