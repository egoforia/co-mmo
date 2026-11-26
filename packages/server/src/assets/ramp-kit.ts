import { RAMP_ARTS } from '@co-mmo/shared';
import type { KitAsset } from './kit.ts';
import { SPRITE_FRAMING } from './style.ts';

// Ramp pictures (shared floors/ramps.ts): one per look (stone, wood, earth),
// length (2 or 3 tiles) and way (rising away from the camera or toward it),
// 12 in all. A ramp climbing west or east shows the same picture mirrored,
// as buildings may be. Each is painted standing on its tiles, 1 across and
// its length deep, so the game stands it on them like a set piece. A land
// may have its own (ramp-<biome>-<look>-<length>-<way>), which wins. Nothing
// is painted until the Owner asks in the Art tab, where each shows its
// prompt and price first; until then a ramp shows only its label.

type Look = Pick<KitAsset, 'silhouetteHook' | 'body' | 'materials' | 'colors' | 'details' | 'mood'>;

const LOOKS: Record<string, { name: string; look: Look }> = {
  stone: {
    name: 'Stone ramp',
    look: {
      silhouetteHook: 'a sloping ramp of fitted pale stone slabs, worn smooth in the middle, with a low stone kerb along each side',
      body: 'a straight solid ramp one tile wide, its sides walled in stone down to the ground',
      materials: ['pale stone', 'mortar'], colors: { main: 'warm pale grey stone', secondary: 'cool lavender-grey kerb stones', accent: 'a few tufts of moss in the joints' },
      details: ['shallow ridges across the slope for grip', 'chipped corners'], mood: 'sturdy, old',
    },
  },
  wood: {
    name: 'Wooden ramp',
    look: {
      silhouetteHook: 'a sloping ramp of thick wooden planks laid across two heavy beams, with cleats nailed across for footing',
      body: 'a straight solid ramp one tile wide, closed in with boards down its sides to the ground',
      materials: ['weathered wood', 'iron nails'], colors: { main: 'honey brown wood', secondary: 'dark brown side boards', accent: 'rusty nail heads' },
      details: ['cleats across the planks', 'a worn path down the middle'], mood: 'handmade, sturdy',
    },
  },
  earth: {
    name: 'Earth ramp',
    look: {
      silhouetteHook: 'a sloping ramp of packed earth held by a few half-buried rough stones and timber edging',
      body: 'a straight solid bank one tile wide, its sides sloping earth with roots and pebbles',
      materials: ['packed earth', 'rough stones', 'timber'], colors: { main: 'warm umber earth', secondary: 'grey rough stones', accent: 'short green grass tufts' },
      details: ['footprints worn into the slope', 'a few pebbles'], mood: 'rustic, trodden',
    },
  },
};

/** How a ramp picture is framed: which end is low, which end is high. */
function framing(length: number, way: 'away' | 'toward'): string {
  const rise = way === 'away'
    ? 'Its low end is at the front corner, nearest the viewer, and it rises steadily toward the right corner, away from the viewer, where its high end is a full storey above the ground.'
    : 'Its high end is at the front corner, nearest the viewer, a full storey above the ground, and it slopes steadily down toward the right corner, away from the viewer, where its low end meets the ground.';
  return [
    `A straight ramp ${length} tiles long and one tile wide, seen from the isometric camera.`,
    rise,
    'The top of the high end is flat and level, ready to meet a floor above. Its sides are solid down to the ground: no gap under it, no railing, no stairs or steps.',
    'Nothing else: no wall, floor or building behind it.',
    // The usual framing too: it is cut out of its background like any prop.
    SPRITE_FRAMING,
  ].join('\n');
}

/** Every ramp picture the Art tab lists. */
export const RAMP_KIT: KitAsset[] = RAMP_ARTS.map((r): KitAsset => ({
  id: r.id,
  name: `${LOOKS[r.look]!.name}, ${r.length} long, rising ${r.way === 'away' ? 'away' : 'toward you'}`,
  kind: 'prop',
  biome: 'any',
  framing: framing(r.length, r.way),
  ...LOOKS[r.look]!.look,
}));

/** The box a ramp picture is fitted to before it is painted standing on its tiles. */
export function rampBox(id: string): { width: number; height: number } | undefined {
  return RAMP_KIT.some((a) => a.id === id) ? { width: 192, height: 224 } : undefined;
}
