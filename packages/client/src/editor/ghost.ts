import type Phaser from 'phaser';
import { CHARACTER_HEIGHT, type Outline, type RegionMap } from '@co-mmo/shared';
import type { WorldScene } from '../world-scene.ts';
import { OUTLINE_DEPTH } from './world-input.ts';

// The ghost: what a making tool would stand where the pointer is, drawn
// see-through by the game from its own painted picture before anything is
// sent, tinted nothing (a red outline says when the spot will not do). A
// thing not painted yet has no ghost, only its outline. Seen only by the
// editor.

/** How see-through the ghost is. */
const GHOST_ALPHA = 0.55;

/** The see-through picture at the pointer. */
export class Ghost {
  private image?: Phaser.GameObjects.Image;

  /** Stands the picture on a box of tiles: a piece fills the box's width, someone stands their height on it. */
  show(scene: WorldScene, map: RegionMap, box: Outline, art: string | undefined, character: boolean): void {
    if (!art || !scene.textures.exists(art)) return this.hide();
    if (!this.image || this.image.scene !== scene) {
      this.image?.destroy();
      this.image = scene.add.image(0, 0, art).setOrigin(0.5, 1).setDepth(OUTLINE_DEPTH - 1).setAlpha(GHOST_ALPHA);
    } else if (this.image.texture.key !== art) this.image.setTexture(art);
    const corners = scene.tileCorners(map, box.x, box.y, box.w, box.h);
    const bottom = corners.reduce((a, b) => (b.y > a.y ? b : a));
    const width = Math.max(...corners.map((c) => c.x)) - Math.min(...corners.map((c) => c.x));
    const middleX = (Math.max(...corners.map((c) => c.x)) + Math.min(...corners.map((c) => c.x))) / 2;
    const top = corners.reduce((a, b) => (b.y < a.y ? b : a));
    const frame = this.image.frame;
    // Someone stands in the middle of their tile; a piece's picture fills its footprint's width, its base on the front corner.
    const scale = character ? CHARACTER_HEIGHT / frame.realHeight : width / frame.realWidth;
    this.image.setScale(scale).setPosition(middleX, character ? (top.y + bottom.y) / 2 : bottom.y).setVisible(true);
  }

  hide(): void {
    this.image?.setVisible(false);
  }
}
