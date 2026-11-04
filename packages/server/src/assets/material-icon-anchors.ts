import { ITEMS } from '@co-mmo/shared';
import type { TieredAsset } from './skill-anchors.ts';

// The materials' and unique pieces' own icons (gather and craft plan, step
// 6): every one that still shows a stand-in, an icon like it borrowed from
// another item.
// Each is painted the first time from the Art tab beside its stand-in, so
// it matches the launch icons (home-land-art.ts says at what size); the bag
// shows the stand-in until then.

/** One icon per material or unique piece that has none of its own yet, by its art id (`item-<id>`). */
export function materialIconAnchors(): TieredAsset[] {
  return Object.entries(ITEMS)
    .filter(([, d]) => (d.kind === 'material' || d.unique) && d.standIn && d.art !== d.standIn)
    .map(([, d]) => ({
      id: d.art, name: d.name, kind: 'item' as const, biome: 'any' as const, references: [d.standIn!],
      silhouetteHook: d.description,
      body: d.unique ? 'a single legendary piece of gear shown on its own, filling most of the square' : 'a single material shown on its own, filling most of the square',
      materials: [d.material?.family ?? d.slot ?? 'material'],
      colors: { main: 'the colours its description gives' },
      details: [], mood: 'useful, worth picking up', extra: { category: d.unique ? 'unique gear' : 'material', rarity: d.unique ? (d.rarity === 'legendary' ? 'Legendary' : 'Epic') : d.material?.tier === 3 ? 'Rare' : d.material?.tier === 2 ? 'Uncommon' : 'Common' },
    }));
}
