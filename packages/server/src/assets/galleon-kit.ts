import { GALLEON_MOD, GALLEON_PIECES, modOn } from '@co-mmo/shared';
import type { KitAsset } from './kit.ts';

// The Sunken Galleon Dungeon's pieces (wish #273, shared galleon.ts): the
// deck planks, hull and hull face its decks are drawn in, and the props that
// stand about them. Nothing is painted until the Owner asks in the Art tab,
// where each piece shows its prompt and price first.

/** Shore pictures sent along so the galleon matches the shore and its old wreck. */
const SHORE = ['shore-shipwreck', 'shore-rock'];

type Look = Pick<KitAsset, 'silhouetteHook' | 'body' | 'materials' | 'colors' | 'details' | 'mood'>;

/** What each prop looks like, by its picture id. */
const PROP_LOOKS: Record<string, Look> = {
  'galleon-cannon': {
    silhouetteHook: 'an old rusted iron ship cannon on a cracked wooden carriage with small wheels', body: 'long low cannon, wider than tall, barrel pointing right',
    materials: ['rusted iron', 'old wood'], colors: { main: 'rust brown', secondary: 'dark weathered wood', accent: 'sea green barnacles' }, details: ['a few cannonballs', 'barnacles on the barrel'], mood: 'forgotten, menacing',
  },
  'galleon-barrel': {
    silhouetteHook: 'an old wooden ship barrel with iron hoops, crusted with barnacles and a strand of seaweed', body: 'upright barrel, a little taller than wide',
    materials: ['wood', 'iron hoops', 'barnacles'], colors: { main: 'dark wet wood brown', secondary: 'rusty iron', accent: 'kelp green' }, details: ['barnacles', 'seaweed'], mood: 'damp, weathered',
  },
  'galleon-mast': {
    silhouetteHook: 'the snapped stump of a thick ship mast with splintered top, ropes and a torn sail scrap hanging', body: 'thick upright wooden stump, taller than wide',
    materials: ['old wood', 'rope', 'canvas'], colors: { main: 'weathered brown wood', secondary: 'rope tan', accent: 'faded cream canvas' }, details: ['splinters', 'iron bands'], mood: 'broken, eerie',
  },
  'galleon-wheel': {
    silhouetteHook: "a ship's steering wheel of dark wood with brass hub on a short wooden stand, one spoke broken", body: 'upright wheel on a stand, about as wide as tall',
    materials: ['dark wood', 'brass'], colors: { main: 'dark wood brown', secondary: 'tarnished brass', accent: 'sea green verdigris' }, details: ['a broken spoke', 'a coil of rope at its foot'], mood: 'abandoned',
  },
  'galleon-lantern': {
    silhouetteHook: 'a brass ship lantern hanging from a short iron hook post, a pale ghostly green flame inside', body: 'slim post, taller than wide, the lantern near the top',
    materials: ['brass', 'glass', 'iron'], colors: { main: 'tarnished brass', secondary: 'dark iron', accent: 'pale ghostly green flame' }, details: ['dripping water', 'a little seaweed'], mood: 'haunting, watchful',
  },
  'galleon-chest': {
    silhouetteHook: "a heavy iron-bound captain's chest, lid open, overflowing with gold coins and pearls", body: 'low wide chest, wider than tall',
    materials: ['dark wood', 'iron', 'gold'], colors: { main: 'dark wood brown', secondary: 'black iron', accent: 'bright gold' }, details: ['spilled coins', 'a pearl necklace'], mood: 'tempting, guarded',
  },
};

/** The galleon's pieces: its tiles first, then its props. */
export const GALLEON_KIT: KitAsset[] = [
  {
    id: 'galleon-deck', name: 'Galleon deck planks', kind: 'tile', biome: 'sunlit-shore',
    silhouetteHook: 'old salt-bleached ship deck planks running left to right, with drifts of sand in the gaps', body: 'flat wooden deck seen from above, planks spread evenly',
    materials: ['old wood', 'sand', 'iron nails'], colors: { main: 'weathered grey-brown wood', secondary: 'golden sand', accent: 'rusty nail heads' },
    details: ['nail heads', 'sand in the gaps'], mood: 'abandoned, salty',
  },
  {
    id: 'galleon-hull', name: 'Galleon hull', kind: 'tile', biome: 'sunlit-shore',
    silhouetteHook: 'the top of a thick dark wooden ship hull with iron bolts, barnacles and seaweed', body: 'flat wooden surface seen from above, boards spread evenly',
    materials: ['dark wood', 'iron bolts', 'barnacles'], colors: { main: 'dark tarred wood brown', secondary: 'slate shadow', accent: 'kelp green' },
    details: ['iron bolts', 'barnacles'], mood: 'rugged, ancient',
  },
  {
    // Only the isometric camera shows it: fitted to the hull's edges that face the camera.
    id: 'galleon-hull-face', name: 'Galleon hull side', kind: 'tile', biome: 'sunlit-shore',
    references: ['galleon-hull', 'galleon-deck'],
    framing: [
      'A wall texture: the upright side of a wooden ship hull seen straight on from the front, filling the entire square frame edge to edge.',
      'Not a deck seen from above, and not a whole ship: no top, no sides, no border, frame or horizon.',
      'Even lighting and low contrast; the planks run left to right evenly across it, so it repeats seamlessly left and right.',
      'The same wood as the first image sent along, which is its top seen from above; the other image is the deck it rises from.',
    ].join('\n'),
    silhouetteHook: 'the upright side of an old dark wooden ship hull, long planks running left to right, iron bolts, barnacles and seaweed near its foot', body: 'flat upright planked hull side, planks spread evenly',
    materials: ['dark wood', 'iron bolts', 'barnacles'], colors: { main: 'dark tarred wood brown', secondary: 'slate shadow', accent: 'kelp green' },
    details: ['barnacles near the foot', 'iron bolts in rows'], mood: 'rugged, ancient',
  },
  ...Object.values(GALLEON_PIECES).map((p): KitAsset => ({ id: p.id, name: p.name, kind: 'prop', biome: 'sunlit-shore', references: SHORE, ...PROP_LOOKS[p.id]! })),
];

/** The galleon's pieces the Art tab lists now: none while its wish is switched off. */
export function galleonPieces(): KitAsset[] {
  return modOn(GALLEON_MOD) ? GALLEON_KIT : [];
}

/** The size a galleon piece is fitted to: tiles as the biome kit's, props by how many tiles they stand on. */
export function galleonBox(id: string): { width: number; height: number } | undefined {
  const asset = GALLEON_KIT.find((a) => a.id === id);
  if (!asset) return undefined;
  if (asset.kind === 'tile') return { width: 128, height: 128 };
  const piece = Object.values(GALLEON_PIECES).find((p) => p.id === id)!;
  return piece.footprint.width > 1 ? { width: 192, height: 160 } : { width: 128, height: 192 };
}
