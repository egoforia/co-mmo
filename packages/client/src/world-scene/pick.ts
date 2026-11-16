// Finding a live monster under the pointer, for the world editor: a click on
// a monster as it wanders picks its home, which is what the editor changes.

import Phaser from 'phaser';
import { monsterHome, type RegionMap, type TilePoint } from '@co-mmo/shared';
import type { Remote } from './types.ts';

/**
 * The home of the shown monster drawn under a point of the screen, nearest
 * the front first, in whichever drawn land it lives; undefined when there is
 * none or its home is not one of the land's own.
 */
export function monsterHomeUnder(
  camera: Phaser.Cameras.Scene2D.Camera,
  creatures: ReadonlyMap<string, Remote>,
  lands: Iterable<[string, { map: RegionMap }]>,
  screenX: number,
  screenY: number,
): { region: string; map: RegionMap; at: TilePoint; level: number } | undefined {
  const point = camera.getWorldPoint(screenX, screenY);
  const under = [...creatures].filter(([, a]) => a.body.visible && a.body.getBounds().contains(point.x, point.y)).sort(([, a], [, b]) => b.body.depth - a.body.depth);
  const drawn = [...lands];
  for (const [id] of under) {
    for (const [region, { map }] of drawn) {
      const home = monsterHome(map, region, id);
      if (home) return { region, map, ...home };
    }
  }
  return undefined;
}
