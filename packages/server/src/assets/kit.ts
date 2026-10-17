import type { AssetDescription } from './style.ts';

/**
 * The biome kit: the trees, rocks and water each launch biome is built from,
 * plus the Sanctum's meadow. Each is painted with its biome's approved
 * anchors as style references, so the kit matches the reference set.
 */
export type KitAsset = AssetDescription & {
  id: string;
  /** Approved anchors sent along as style references. */
  references?: string[];
  /**
   * Keep only this central share of a tile before making it seamless. The
   * model frames water as a pool with banks and ripple rings; the middle of
   * it is plain open water.
   */
  centerCrop?: number;
  /** Clear the key colour showing through gaps inside the subject too (an archway, a ring). */
  holes?: boolean;
};

const OPEN_WATER = 'flat open water seen from directly above, as if cut from the middle of a large lake: no shore, bank, rim, border or ripple rings, no centre point';

export const BIOME_KIT: KitAsset[] = [
  // The Sanctum
  {
    id: 'sanctum-meadow', name: 'Sanctum meadow', kind: 'tile', biome: 'sanctum',
    silhouetteHook: 'soft short grass with clover and tiny scattered flowers', body: 'flat lawn, small brushy grass clumps spread evenly',
    materials: ['grass', 'clover'], colors: { main: 'fresh sage green', secondary: 'clover green', accent: 'cream, rose and pale gold flower specks' },
    details: ['tiny daisies', 'clover leaves'], mood: 'peaceful, sacred',
  },
  {
    id: 'sanctum-pond', name: 'Sanctum pond water', kind: 'tile', biome: 'sanctum',
    silhouetteHook: 'calm clear blue water with soft painted ripples', body: OPEN_WATER, centerCrop: 0.5,
    materials: ['water'], colors: { main: 'soft sky blue', secondary: 'deeper blue', accent: 'pale glints of light' },
    details: ['short soft ripple strokes spread evenly', 'a few tiny floating petals'], mood: 'still, holy',
  },
  {
    id: 'sanctum-blossom-tree-a', name: 'Blossom tree', kind: 'prop', biome: 'sanctum', references: ['sanctum-shrine', 'sanctum-pilgrim'],
    silhouetteHook: 'a round fluffy crown of pale pink and cream blossoms', body: 'small graceful tree, slender curving trunk, crown about as wide as it is tall',
    materials: ['bark', 'blossoms', 'leaves'], colors: { main: 'blossom pink', secondary: 'cream', accent: 'sage green leaves' },
    details: ['a few petals falling', 'warm brown trunk'], mood: 'peaceful, sacred',
  },
  {
    id: 'sanctum-blossom-tree-b', name: 'Tall blossom tree', kind: 'prop', biome: 'sanctum', references: ['sanctum-shrine', 'sanctum-pilgrim'],
    silhouetteHook: 'a tall tree whose crown is three stacked puffs of cream and rose blossom', body: 'slim tree with a gently leaning trunk',
    materials: ['bark', 'blossoms'], colors: { main: 'cream blossom', secondary: 'soft rose', accent: 'pale gold' },
    details: ['light green leaves peeking out', 'small roots'], mood: 'gentle, airy',
  },
  {
    id: 'sanctum-rock', name: 'Mossy white stone', kind: 'prop', biome: 'sanctum', references: ['sanctum-shrine'],
    silhouetteHook: 'a rounded pale stone boulder with clover at its base', body: 'low wide boulder, smooth rounded shape',
    materials: ['pale stone', 'moss'], colors: { main: 'cream stone', secondary: 'lavender-grey shadow', accent: 'clover green' },
    details: ['a patch of moss on top'], mood: 'calm',
  },
  // Whispering Woods
  {
    id: 'woods-path', name: 'Forest path', kind: 'tile', biome: 'whispering-woods',
    silhouetteHook: 'packed warm brown earth worn smooth by footsteps, with fallen leaves scattered evenly', body: 'flat bare ground, no roots, stones or edges',
    materials: ['packed earth', 'fallen leaves'], colors: { main: 'dark muted umber brown in deep forest shade', secondary: 'mossy dark brown', accent: 'a few teal-green and russet leaves' },
    details: ['tiny pebbles', 'scattered small leaves'], mood: 'quiet, well trodden',
  },
  {
    id: 'woods-pool', name: 'Dark forest pool water', kind: 'tile', biome: 'whispering-woods',
    silhouetteHook: 'deep dark teal still water with soft reflections', body: OPEN_WATER, centerCrop: 0.5,
    materials: ['water'], colors: { main: 'deep teal', secondary: 'dark green-blue', accent: 'firefly yellow glints' },
    details: ['short soft ripple strokes spread evenly', 'faint reflections'], mood: 'quiet, mysterious',
  },
  {
    id: 'woods-tree-a', name: 'Twisting forest tree', kind: 'prop', biome: 'whispering-woods', references: ['woods-tree-house', 'woods-mushroom'],
    silhouetteHook: 'a twisting dark trunk with a heavy drooping crown of deep teal-green leaves', body: 'tall gnarled tree, roots spreading at the base',
    materials: ['bark', 'leaves'], colors: { main: 'deep teal-green', secondary: 'bark brown', accent: 'firefly yellow' },
    details: ['a knot hole in the trunk', 'a couple of fireflies'], mood: 'quiet, mysterious',
  },
  {
    id: 'woods-tree-b', name: 'Old leaning tree', kind: 'prop', biome: 'whispering-woods', references: ['woods-tree-house', 'woods-mushroom'],
    silhouetteHook: 'a leaning old tree with a lopsided round crown and a mushroom on its trunk', body: 'thick short trunk, crown of oversized leaves',
    materials: ['bark', 'leaves', 'moss'], colors: { main: 'dark green', secondary: 'bark brown', accent: 'russet mushroom' },
    details: ['moss on the roots', 'small shelf mushroom'], mood: 'ancient, cosy',
  },
  {
    id: 'woods-rock', name: 'Mossy boulder', kind: 'prop', biome: 'whispering-woods', references: ['woods-tree-house'],
    silhouetteHook: 'a round dark boulder covered in thick moss with a fern beside it', body: 'low wide boulder',
    materials: ['stone', 'moss'], colors: { main: 'slate grey', secondary: 'teal-green moss', accent: 'fern green' },
    details: ['a small fern'], mood: 'quiet',
  },
  // Sunlit Shore
  {
    id: 'shore-sea', name: 'Shallow sea water', kind: 'tile', biome: 'sunlit-shore',
    silhouetteHook: 'bright turquoise shallow sea water with soft white ripple glints', body: OPEN_WATER, centerCrop: 0.5,
    materials: ['water'], colors: { main: 'turquoise', secondary: 'ocean blue', accent: 'white glints' },
    details: ['soft ripple strokes evenly spread'], mood: 'bright, carefree',
  },
  {
    id: 'shore-palm-a', name: 'Leaning palm', kind: 'prop', biome: 'sunlit-shore', references: ['shore-lighthouse', 'shore-crab-knight'],
    silhouetteHook: 'a curved leaning palm trunk with a burst of big fronds on top', body: 'tall palm tree, ringed trunk, coconuts under the fronds',
    materials: ['palm bark', 'fronds'], colors: { main: 'leaf green', secondary: 'warm sand-brown trunk', accent: 'coral pink' },
    details: ['three coconuts', 'a small starfish at the base'], mood: 'cheerful, breezy',
  },
  {
    id: 'shore-palm-b', name: 'Short palm', kind: 'prop', biome: 'sunlit-shore', references: ['shore-lighthouse', 'shore-crab-knight'],
    silhouetteHook: 'a short stout palm with a wide umbrella of fronds', body: 'short ringed trunk, fronds drooping to the sides',
    materials: ['palm bark', 'fronds'], colors: { main: 'bright green', secondary: 'tan trunk', accent: 'turquoise' },
    details: ['coconuts'], mood: 'sunny, playful',
  },
  {
    id: 'shore-rock', name: 'Shore rock', kind: 'prop', biome: 'sunlit-shore', references: ['shore-lighthouse'],
    silhouetteHook: 'a rounded sea rock with barnacles and a shell on top', body: 'low wide boulder',
    materials: ['stone', 'barnacles', 'shells'], colors: { main: 'warm grey', secondary: 'sand cream', accent: 'coral pink shell' },
    details: ['barnacles', 'a little seaweed'], mood: 'breezy',
  },
  // Mirage Desert
  {
    id: 'desert-oasis', name: 'Oasis water', kind: 'tile', biome: 'mirage-desert',
    silhouetteHook: 'clear jade-turquoise oasis water with gentle shimmer', body: OPEN_WATER, centerCrop: 0.5,
    materials: ['water'], colors: { main: 'jade turquoise', secondary: 'deep teal', accent: 'warm gold glints' },
    details: ['soft ripple strokes evenly spread'], mood: 'cool, inviting',
  },
  {
    id: 'desert-cactus-a', name: 'Arm cactus', kind: 'prop', biome: 'mirage-desert', references: ['desert-ruin', 'desert-cactus-folk'],
    silhouetteHook: 'a tall rounded cactus with two arms raised and a pink flower on top', body: 'chunky ribbed cactus',
    materials: ['cactus'], colors: { main: 'sage green', secondary: 'deep green', accent: 'pink flower' },
    details: ['tiny pale spines'], mood: 'hot, still',
  },
  {
    id: 'desert-cactus-b', name: 'Barrel cactus cluster', kind: 'prop', biome: 'mirage-desert', references: ['desert-ruin', 'desert-cactus-folk'],
    silhouetteHook: 'a cluster of three round barrel cacti of different sizes', body: 'low cluster, wider than tall',
    materials: ['cactus'], colors: { main: 'sage green', secondary: 'ochre', accent: 'apricot blossoms' },
    details: ['tiny pale spines', 'small blossoms'], mood: 'hot, quirky',
  },
  {
    id: 'desert-rock', name: 'Sandstone rock', kind: 'prop', biome: 'mirage-desert', references: ['desert-ruin'],
    silhouetteHook: 'a wind-carved sandstone boulder with layered stripes', body: 'low wide boulder, rounded top',
    materials: ['sandstone'], colors: { main: 'ochre', secondary: 'apricot', accent: 'turquoise pebble' },
    details: ['wind-carved layers'], mood: 'ancient, hot',
  },
  // Effects
  {
    id: 'fx-slash', name: 'Sword slash', kind: 'effect', biome: 'any',
    silhouetteHook: 'a single bright crescent-moon arc of a sword swing, thick in the middle and tapering to points at both ends, curving from upper left to lower right',
    body: 'a glowing pale cream and white streak of motion with a few small sparkles trailing it, nothing else',
    colors: { main: 'warm white', secondary: 'pale gold', accent: 'soft sky blue sparkles' },
    mood: 'swift, sharp',
  },
];
