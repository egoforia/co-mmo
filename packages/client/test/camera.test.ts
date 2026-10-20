import { afterEach, describe, expect, it } from 'vitest';
import { chooseCamera } from '../src/camera.ts';
import { ISOMETRIC, PROJECTION, TOP_DOWN } from '../src/projection.ts';

/** A browser's storage holding `saved`, for the camera choice to read. */
function storage(saved: Record<string, string>): void {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => saved[k] ?? null };
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('choosing the camera', () => {
  it('is isometric for every player, Steward and Owner', () => {
    storage({});
    for (const role of ['player', 'steward', 'owner'] as const) {
      expect(chooseCamera(role)).toBe(true);
      expect(PROJECTION).toBe(ISOMETRIC);
    }
  });

  it('shows the old top-down view only to the Owner who switched it on in this browser', () => {
    storage({ 'co-mmo.camera': 'top-down' });
    expect(chooseCamera('player')).toBe(true);
    expect(PROJECTION).toBe(ISOMETRIC);
    expect(chooseCamera('owner')).toBe(false);
    expect(PROJECTION).toBe(TOP_DOWN);
    expect(chooseCamera('steward')).toBe(true);
    expect(PROJECTION).toBe(ISOMETRIC);
  });

  it('stays isometric when this browser blocks storage', () => {
    expect(chooseCamera('owner')).toBe(true);
    expect(PROJECTION).toBe(ISOMETRIC);
  });
});
