// Gathering spots as you see them (spot-states.ts): Ready, Picked or Growing
// by your own timers, which come with your character. A state's own picture
// shows once it is painted; until then the spot keeps its Ready picture.
// Pictures swap only when a state changes (checked once a second), never
// every frame. Hovering a spot says when it grows back.

import Phaser from 'phaser';
import { ITEMS, SPOTS, growsBackWords, readyAt, spotState, spotStateArt, type ArtManifest, type GatherSpot, type SpotState } from '@co-mmo/shared';
import { standOnTiles } from '../kit-house-view.ts';
import type { Floor } from '../tile-stand.ts';
import { markScenery } from './park.ts';

/** One spot drawn in a land, and the state it was drawn in. */
export interface SpotView {
  region: string;
  spot: GatherSpot;
  tiles: Floor;
  state: SpotState;
  images: Phaser.GameObjects.Image[];
}

/** Your spot timers, from your character (Character.regrow). */
let timers: Record<string, number> = {};

/** Takes your spot timers from your character. */
export function setSpotTimers(regrow: Record<string, number> | undefined): void {
  timers = regrow ?? {};
}

/** The state a spot shows you now. */
export function stateOf(region: string, spot: GatherSpot, now = Date.now()): SpotState {
  return spotState(readyAt({ regrow: timers }, region, spot.id, now), now);
}

/** The picture a spot shows in a state: the state's own once painted, else its Ready picture, else its material's icon. */
export function spotArt(scene: Phaser.Scene, kind: string, state: SpotState = 'ready'): string | undefined {
  const def = SPOTS[kind];
  if (!def) return undefined;
  const own = spotStateArt(kind, state);
  if (own && scene.textures.exists(own)) return own;
  if (scene.textures.exists(def.art)) return def.art;
  const m = ITEMS[def.material];
  return [m?.art, m?.standIn].find((key) => key && scene.textures.exists(key));
}

/** Stands a spot's picture for its state on its tile, saying when it grows back while hovered. */
export function standSpot(scene: Phaser.Scene, view: SpotView, art: ArtManifest): void {
  const key = spotArt(scene, view.spot.kind, view.state);
  view.images = key ? standOnTiles(scene, key, view.tiles, art[key]?.view === 'isometric') : [];
  const name = SPOTS[view.spot.kind]?.name ?? 'Spot';
  for (const img of view.images) {
    img.setInteractive();
    img.on('pointerover', () => {
      const now = Date.now();
      img.setData('tip', `${name}: ${growsBackWords(readyAt({ regrow: timers }, view.region, view.spot.id, now), now)}`);
      scene.events.emit('spot-tip', img.getData('tip'), img);
    });
    img.on('pointerout', () => scene.events.emit('spot-tip', undefined, img));
  }
}

/**
 * Draws again the spots whose state changed since they were drawn; the new
 * pictures join the land's objects so they go when it does. Returns true when
 * any changed.
 */
export function restateSpots(scene: Phaser.Scene, views: SpotView[], objects: Phaser.GameObjects.GameObject[], art: ArtManifest, now = Date.now()): boolean {
  let changed = false;
  for (const view of views) {
    const state = stateOf(view.region, view.spot, now);
    if (state === view.state) continue;
    changed = true;
    const before = spotArt(scene, view.spot.kind, view.state);
    view.state = state;
    // The same picture in both states (the new one not painted yet): nothing to swap.
    if (before === spotArt(scene, view.spot.kind, state)) continue;
    for (const img of view.images) img.destroy();
    standSpot(scene, view, art);
    objects.push(...view.images);
    markScenery(view.images);
  }
  return changed;
}
