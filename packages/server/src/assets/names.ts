import { BUILDING_STYLES } from '@co-mmo/shared';
import { ANCHORS } from './anchors.ts';
import { BIOME_KIT } from './kit.ts';

/**
 * A picture sent along with a request, in words, for God's View: "Mara",
 * "Old Bramble's cottage: outside". Falls back to its art id.
 */
export function pictureName(id: string): string {
  const known = ANCHORS.find((a) => a.id === id) ?? BIOME_KIT.find((a) => a.id === id);
  if (known?.name) return known.name;
  const style = Object.values(BUILDING_STYLES).find((s) => id.startsWith(`${s.id}-`));
  if (style) {
    const part = id.slice(style.id.length + 1).replace(/^furniture-/, '').replace(/-/g, ' ');
    return `${style.name}: ${part === 'exterior' ? 'outside' : part}`;
  }
  return id;
}
