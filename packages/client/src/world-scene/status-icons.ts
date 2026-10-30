// Statuses over name tags (build plan step 10): each status's painted icon
// in a row above the tag, and the hunter's mark over the Marked. A status
// whose icon is not painted yet keeps its name in the tag instead.

import type Phaser from 'phaser';
import { MARK_ART, statusArt, type StatusId } from '@co-mmo/shared';
import { LABEL_DEPTH, T, type Avatar } from './types.ts';

/** An icon's size on screen, and the mark's. */
const ICON = T * 0.3;
const MARK = T * 0.5;

/** Shows an avatar's painted status icons, and the mark over it when Marked; rebuilt only when they change. */
export function setStatusIcons(scene: Phaser.Scene, a: Avatar, statuses: readonly StatusId[] | undefined): void {
  const keys = (statuses ?? []).map(statusArt).filter((k) => scene.textures.exists(k));
  if (statuses?.includes('marked') && scene.textures.exists(MARK_ART)) keys.push(MARK_ART);
  const wanted = keys.join(',');
  if ((a.icons?.keys ?? '') === wanted) return;
  dropStatusIcons(a);
  if (!keys.length) return;
  const images = keys.map((k) => {
    const image = scene.add.image(0, 0, k).setDepth(LABEL_DEPTH);
    return image.setScale((k === MARK_ART ? MARK : ICON) / Math.max(image.width, image.height));
  });
  a.icons = { keys: wanted, images };
}

/** Puts the icons in a row just above the name tag, and the mark above them. */
export function placeStatusIcons(a: Avatar): void {
  if (!a.icons) return;
  const row = a.icons.images.filter((i) => i.texture.key !== MARK_ART);
  const top = a.label.y - a.label.displayHeight - ICON / 2 - 2;
  row.forEach((image, i) => image.setPosition(a.label.x + (i - (row.length - 1) / 2) * (ICON + 2), top).setVisible(a.label.visible));
  const mark = a.icons.images.find((i) => i.texture.key === MARK_ART);
  mark?.setPosition(a.label.x, top - (row.length ? ICON : 0) - MARK / 2).setVisible(a.label.visible);
}

/** Takes an avatar's icons away. */
export function dropStatusIcons(a: Avatar): void {
  for (const image of a.icons?.images ?? []) image.destroy();
  delete a.icons;
}
