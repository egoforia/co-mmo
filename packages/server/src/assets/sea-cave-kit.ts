import { SEA_CAVE_MOD, SEA_CAVE_PIECES, modOn } from '@co-mmo/shared';
import { BIOME_KIT, type KitAsset } from './kit.ts';

// The Smugglers' Sea Cave Art Kit (wish #75): the Sunlit Shore's sea cave
// painted again as pieces any land can reuse: cavern tiles that repeat, and
// coastal props the world editor stands as set pieces (shared
// sea-cave-kit.ts). Nothing is painted until the Owner asks in the Art tab,
// where each piece shows its prompt and price first.

/** Shore pictures sent along so the cave pieces match the shore. */
const SHORE = ['shore-rock', 'shore-shipwreck'];

type Look = Pick<KitAsset, 'silhouetteHook' | 'body' | 'materials' | 'colors' | 'details' | 'mood'>;

/** What each prop looks like, by its id in SEA_CAVE_PIECES. */
const PROP_LOOKS: Record<string, Look> = {
  'sea-cave-boulder': {
    silhouetteHook: 'a sea-worn sandy-brown cave boulder crusted with barnacles and draped in dark seaweed', body: 'low wide boulder, smoothed by the tide',
    materials: ['stone', 'barnacles', 'seaweed'], colors: { main: 'sandy brown', secondary: 'blue-violet shadow', accent: 'kelp green' }, details: ['barnacles', 'a small crab'], mood: 'damp, hidden',
  },
  'sea-cave-stalagmite': {
    silhouetteHook: 'a tall dripping stalagmite of wet sandy rock rising from a puddle', body: 'pointed rock spire, taller than wide',
    materials: ['wet stone'], colors: { main: 'sandy brown', secondary: 'slate blue', accent: 'pale drips' }, details: ['water drips', 'a few barnacles at its foot'], mood: 'echoing, cool',
  },
  'sea-cave-glow-barnacles': {
    silhouetteHook: 'a small rock studded with softly glowing turquoise barnacles', body: 'low rounded rock, wider than tall',
    materials: ['stone', 'barnacles'], colors: { main: 'dark slate', secondary: 'sandy brown', accent: 'glowing turquoise' }, details: ['tiny glowing barnacles', 'a strand of seaweed'], mood: 'magical, hidden',
  },
  'sea-cave-tide-pool': {
    silhouetteHook: 'a shallow tide pool held in a ring of sea-worn rocks, with a starfish and shells', body: 'low wide rock ring around clear water',
    materials: ['stone', 'water', 'shells'], colors: { main: 'sandy brown', secondary: 'turquoise water', accent: 'coral pink starfish' }, details: ['a starfish', 'small shells'], mood: 'quiet, salty',
  },
  'sea-cave-crates': {
    silhouetteHook: "a stack of old smugglers' wooden crates bound with rope, one lid ajar", body: 'two crates side by side with a smaller one on top',
    materials: ['salt-bleached wood', 'rope', 'iron nails'], colors: { main: 'weathered driftwood brown', secondary: 'rope tan', accent: 'rusty iron' }, details: ['a lid ajar', 'a few gold coins peeking out'], mood: 'secretive',
  },
  'sea-cave-rope-nets': {
    silhouetteHook: 'a thick coil of old ship rope with a fishing net and cork floats heaped beside it', body: 'low heap, wider than tall',
    materials: ['rope', 'net', 'cork'], colors: { main: 'rope tan', secondary: 'net brown', accent: 'faded red floats' }, details: ['cork floats', 'a tangle of seaweed'], mood: 'weathered',
  },
  'sea-cave-lantern': {
    silhouetteHook: 'a brass ship lantern hanging from a driftwood post, a warm orange flame inside', body: 'slim post, taller than wide, the lantern near the top',
    materials: ['driftwood', 'brass', 'glass'], colors: { main: 'driftwood brown', secondary: 'brass gold', accent: 'warm orange flame' }, details: ['a coil of rope round the post'], mood: 'warm, watchful',
  },
};

/** The kit's pieces: the cavern tiles first, then the props the editor places. */
export const SEA_CAVE_KIT: KitAsset[] = [
  {
    id: 'sea-cave-floor', name: 'Sea cave floor', kind: 'tile', biome: 'sunlit-shore',
    silhouetteHook: 'wet dark sand and flat sea-worn stones with tiny shells', body: 'flat cave floor, stones spread evenly',
    materials: ['wet sand', 'stone', 'shells'], colors: { main: 'damp sandy brown', secondary: 'blue-violet shadow', accent: 'pale shell specks' },
    details: ['tiny shells', 'small puddles'], mood: 'damp, hidden',
  },
  {
    id: 'sea-cave-wall', name: 'Sea cave rock', kind: 'tile', biome: 'sunlit-shore',
    silhouetteHook: 'the rough top of a sandy-brown cave wall with barnacles and dark seaweed', body: 'flat rocky surface seen from above, cracks spread evenly',
    materials: ['stone', 'barnacles', 'seaweed'], colors: { main: 'sandy brown', secondary: 'slate shadow', accent: 'kelp green' },
    details: ['barnacles', 'strands of seaweed'], mood: 'rugged',
  },
  {
    id: 'sea-cave-planks', name: 'Smugglers\' walkway', kind: 'tile', biome: 'sunlit-shore',
    silhouetteHook: 'old salt-bleached wooden planks running left to right over wet sand', body: 'flat boardwalk, planks spread evenly',
    materials: ['driftwood', 'iron nails'], colors: { main: 'pale driftwood', secondary: 'sandy brown gaps', accent: 'rusty nail heads' },
    details: ['nail heads', 'grains of sand between boards'], mood: 'weathered',
  },
  {
    // Only the isometric camera shows it: fitted to the cave rock's edges that face the camera, under the rock lifted a little.
    id: 'sea-cave-rock-face', name: 'Sea cave rock face', kind: 'tile', biome: 'sunlit-shore',
    references: ['sea-cave-wall', 'sea-cave-floor', 'sea-cave-planks'],
    framing: [
      'A wall texture: the upright face of a rock wall seen straight on from the front, filling the entire square frame edge to edge.',
      'Not ground seen from above, and not a block: no top, no sides, no border, frame or horizon.',
      'Even lighting and low contrast; cracks and ledges run evenly across it, so it repeats seamlessly left and right.',
      'The same rock as the first image sent along, which is its top seen from above; the other images are the cave floor and walkway it rises from.',
    ].join('\n'),
    silhouetteHook: 'the upright face of a sea-worn sandy-brown cave wall, ledges and cracks running across it, barnacles and dark seaweed near its foot', body: 'flat upright rock face, ledges spread evenly',
    materials: ['stone', 'barnacles', 'seaweed'], colors: { main: 'sandy brown', secondary: 'slate shadow', accent: 'kelp green' },
    details: ['barnacles near the foot', 'thin horizontal ledges'], mood: 'rugged',
  },
  ...SEA_CAVE_PIECES.map((p): KitAsset => ({ id: p.id, name: p.name, kind: 'prop', biome: 'sunlit-shore', references: SHORE, ...PROP_LOOKS[p.id]! })),
];

/** The size a sea cave piece is fitted to: tiles as the biome kit's, props by how many tiles they stand on. */
export function seaCaveBox(id: string): { width: number; height: number } | undefined {
  const asset = SEA_CAVE_KIT.find((a) => a.id === id);
  if (!asset) return undefined;
  if (asset.kind === 'tile') return { width: 128, height: 128 };
  const piece = SEA_CAVE_PIECES.find((p) => p.id === id)!;
  return piece.footprint.width > 1 ? { width: 192, height: 160 } : { width: 128, height: 192 };
}

/** Every scenery piece the Art tab lists: the biome kit, and the sea cave's while its wish is on. */
export function kitPieces(): KitAsset[] {
  return modOn(SEA_CAVE_MOD) ? [...BIOME_KIT, ...SEA_CAVE_KIT] : BIOME_KIT;
}
