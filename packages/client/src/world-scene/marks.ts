// What skills leave in the world (snapshot `marks`): traps and hallowed
// ground on the ground, an Echo floating on a friend, the spirit hawk and the
// Sandstorm double standing like creatures. Each shows its painted picture,
// or nothing until that is painted (build plan step 10).

import type Phaser from 'phaser';
import { CHARACTER_HEIGHT, ECHO_ART, HALLOWED_ART, SAND_DOUBLE_ART, SPIRIT_HAWK_ART, TRAP_ART, type WorldMark } from '@co-mmo/shared';
import { litFigure } from '../lights.ts';
import { T } from './types.ts';

/** Where a point in our region is drawn, and how deep. */
export type ToScreen = (x: number, y: number, floor: number) => { x: number; y: number; depth: number };

/** How each kind of mark sits: lying on the ground, floating on someone, or standing like a creature. */
const LOOKS: Record<string, { origin: [number, number]; width?: number; rise?: number; depth: number; alpha?: number }> = {
  [TRAP_ART]: { origin: [0.5, 0.5], width: T, depth: -3 },
  [HALLOWED_ART]: { origin: [0.5, 0.5], width: T * 3, depth: -4, alpha: 0.8 },
  [ECHO_ART]: { origin: [0.5, 0.5], width: T * 0.8, rise: CHARACTER_HEIGHT * 0.55, depth: 1, alpha: 0.85 },
  [SPIRIT_HAWK_ART]: { origin: [0.5, 0.97], rise: T * 0.3, depth: 0 },
  [SAND_DOUBLE_ART]: { origin: [0.5, 0.97], depth: 0, alpha: 0.9 },
};

/** The marks shown now, by id. */
export class Marks {
  private readonly shown = new Map<string, Phaser.GameObjects.Image>();

  constructor(private readonly scene: Phaser.Scene) {}

  /** Shows the marks the snapshot names whose pictures are painted; the rest go. */
  sync(marks: WorldMark[] | undefined, toScreen: ToScreen): void {
    const seen = new Set<string>();
    for (const m of marks ?? []) {
      if (!this.scene.textures.exists(m.asset)) continue;
      seen.add(m.id);
      const look = LOOKS[m.asset] ?? { origin: [0.5, 0.97] as [number, number], depth: 0 };
      const at = toScreen(m.x, m.y, m.floor ?? 0);
      const y = at.y - (look.rise ?? 0);
      let image = this.shown.get(m.id);
      if (!image || image.texture.key !== m.asset) {
        image?.destroy();
        image = litFigure(this.scene, this.scene.add.image(at.x, y, m.asset)).setOrigin(...look.origin).setAlpha(look.alpha ?? 1);
        if (look.width) image.setScale(look.width / image.width);
        this.shown.set(m.id, image);
      } else {
        // A hawk follows its friend between snapshots rather than hopping.
        this.scene.tweens.add({ targets: image, x: at.x, y, duration: 100 });
      }
      image.setDepth(at.depth + look.depth);
    }
    for (const [id, image] of this.shown) {
      if (seen.has(id)) continue;
      image.destroy();
      this.shown.delete(id);
    }
  }

  /** Clears every mark, as when we change region. */
  clear(): void {
    for (const image of this.shown.values()) image.destroy();
    this.shown.clear();
  }
}
