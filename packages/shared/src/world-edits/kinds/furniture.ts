import { BUILDING_STYLES, furnitureArt } from '../../buildings.ts';
import { blockOn } from '../../floors.ts';
import type { Landmark } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { floorOf } from '../tiles.ts';
import { MAX_FOOTPRINT } from '../types.ts';

/** Every building style's furniture, by its art id: name and footprint. */
function furniture(): Map<string, { name: string; width: number; depth: number }> {
  const all = new Map<string, { name: string; width: number; depth: number }>();
  for (const style of Object.values(BUILDING_STYLES)) {
    for (const [key, f] of Object.entries(style.furniture)) all.set(furnitureArt(style.id, key), { name: `${style.name}: ${f.name}`, width: Math.max(1, Math.round(f.width)), depth: f.depth ?? 1 });
  }
  return all;
}

/** A building style's piece of furniture, on any floor. */
export const FURNITURE: EditKind<'furniture'> = {
  kind: 'furniture',
  name: 'Furniture',
  hint: 'Click a tile to stand a piece of furniture with its front left corner there. It blocks the tiles it stands on unless it can be walked through.',
  pointer: 'click',
  onFloors: true,
  fields: [
    { key: 'asset', label: 'Piece', type: 'choice', choices: () => [...furniture()].map(([id, f]) => ({ id, name: f.name })).sort((a, b) => a.name.localeCompare(b.name)) },
    { key: 'walkable', label: 'Can be walked through', type: 'flag', default: false },
  ],
  shape: '{"kind":"furniture","asset":"<style>-furniture-<key>","at":[x,y],"footprint":[2,1]}',
  outline(_map, { at }, v) {
    const f = furniture().get(String(v.asset));
    const [w, h] = [f?.width ?? 1, f?.depth ?? 1];
    return [{ x: at[0], y: at[1] - h + 1, w, h }];
  },
  make(use, v) {
    const f = furniture().get(String(v.asset));
    const [w, h] = [f?.width ?? 1, f?.depth ?? 1];
    // The picture's bottom centre, so its footprint's front left tile is the one clicked.
    return { kind: 'furniture', asset: String(v.asset), at: [use.at[0] + w / 2, use.at[1] + 1], footprint: [w, h], ...(v.walkable ? { walkable: true } : {}) };
  },
  check(map, edit) {
    if (!furniture().has(edit.asset)) return 'There is no furniture of that kind.';
    const [w, h] = Array.isArray(edit.footprint) ? edit.footprint : [NaN, NaN];
    if (![w, h].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_FOOTPRINT)) return `A footprint is 1 to ${MAX_FOOTPRINT} tiles a side.`;
    const [x, y] = Array.isArray(edit.at) ? edit.at : [NaN, NaN];
    return [x, y].every(Number.isFinite) && x - w / 2 >= 0 && y - h >= 0 && x + w / 2 <= map.width && y <= map.height ? undefined : 'It would stand off the edge of this land.';
  },
  apply(map, edit) {
    const floor = floorOf(edit);
    const landmark: Landmark = { asset: edit.asset, x: edit.at[0], y: edit.at[1], footprint: { width: edit.footprint[0], height: edit.footprint[1] }, floor };
    map.landmarks.push(landmark);
    if (!edit.walkable) blockOn(map, floor, landmark.x, landmark.y, edit.footprint[0], edit.footprint[1]);
    return true;
  },
  keep: (d) => ({ kind: 'furniture', asset: d.asset, at: d.at, footprint: d.footprint, ...(d.walkable ? { walkable: true } : {}) }),
  words: (e) => `${furniture().get(e.asset)?.name ?? 'Furniture'} at ${e.at.join(', ')}`,
};
