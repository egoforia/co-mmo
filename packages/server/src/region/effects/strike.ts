import { aimAt, hitWith, type Effect } from './types.ts';

/** A blow of the weapon at the chosen creature in reach, or the nearest. */
export const strike: Effect = {
  ready: (kit, cast) => (aimAt(kit, cast) ? undefined : 'Nothing in reach to strike.'),
  run: (kit, cast) => hitWith(kit, cast, cast.target!),
};

/** Something flung at one creature further off. */
export const bolt: Effect = {
  ready: (kit, cast) => (aimAt(kit, cast) ? undefined : `No creature within ${cast.a.range} steps.`),
  run: (kit, cast) => hitWith(kit, cast, cast.target!),
};
