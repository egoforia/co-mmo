// Biomes from the Style Bible. Each owns five signatures no other biome
// shares (dominant hue, ground pattern, silhouette, ambient particle, light
// tint); its key colours are what generated art is colour-graded toward.
// The full 24-colour key palettes come with the anchor images.

export type BiomeId =
  | 'sanctum'
  | 'verdant-meadows'
  | 'whispering-woods'
  | 'mushroom-hollow'
  | 'sunlit-shore'
  | 'frostpeak'
  | 'ember-wastes'
  | 'mirage-desert'
  | 'murkmire-swamp'
  | 'sky-ruins';

export interface Biome {
  id: BiomeId;
  name: string;
  /** Available when the world launches (egoforia, 2026-10-14). */
  launch: boolean;
  /** Dominant hue first, accent last. */
  keyColors: number[];
  ground: string;
  silhouette: string;
  particle: string;
  /** Multiplied over the scene by the engine's lighting pass. */
  lightTint: number;
}

export const BIOMES: Record<BiomeId, Biome> = {
  sanctum: {
    id: 'sanctum', name: 'the Sanctum', launch: true,
    keyColors: [0xf3e6c8, 0xe8c66a, 0xe7a3a6, 0x8aa86b],
    ground: 'worn pale flagstones in circles, clover, rose bushes',
    silhouette: 'round arches, white shrine with a floating golden orb, banners',
    particle: 'drifting light motes', lightTint: 0xfff4dc,
  },
  'verdant-meadows': {
    id: 'verdant-meadows', name: 'Verdant Meadows', launch: false,
    keyColors: [0x8cc45a, 0xf2d35b, 0x8fc6e8, 0x5c8a3a],
    ground: 'rolling grass in brushy clumps, giant daisies, clover patches',
    silhouette: 'round hills, lone oversized oak, stone fences, windmills',
    particle: 'floating seed puffs', lightTint: 0xfffbe8,
  },
  'whispering-woods': {
    id: 'whispering-woods', name: 'Whispering Woods', launch: true,
    keyColors: [0x2f6b5e, 0x6b4a33, 0x5f9468, 0xf2dc6b],
    ground: 'root-tangled moss, ferns, fallen leaves',
    silhouette: 'huge twisting trees with doors and windows, hollow logs',
    particle: 'fireflies', lightTint: 0xe6f2d8,
  },
  'mushroom-hollow': {
    id: 'mushroom-hollow', name: 'Mushroom Hollow', launch: false,
    keyColors: [0xb79ad6, 0xc8559a, 0x4a3a66, 0x6fe3e0],
    ground: 'spongy violet soil, spore mats',
    silhouette: 'giant capped mushrooms as houses and bridges, spirals',
    particle: 'floating spores', lightTint: 0xd9cfee,
  },
  'sunlit-shore': {
    id: 'sunlit-shore', name: 'Sunlit Shore', launch: true,
    keyColors: [0x46c2c2, 0xf1e2c0, 0x2c7fa8, 0xf08e86],
    ground: 'sand with shells and starfish, sea grass, palms',
    silhouette: 'driftwood piers, curved shell huts, lighthouse',
    particle: 'sea foam', lightTint: 0xfffaf0,
  },
  frostpeak: {
    id: 'frostpeak', name: 'Frostpeak', launch: false,
    keyColors: [0xbfe0f2, 0xc9c0e6, 0x3e6b5a, 0x6f8fc8],
    ground: 'snow drifts with blue shading, frosted pines',
    silhouette: 'jagged peaks softened by snow caps, ice crystals, round stone huts',
    particle: 'falling snow', lightTint: 0xe4ecfa,
  },
  'ember-wastes': {
    id: 'ember-wastes', name: 'Ember Wastes', launch: false,
    keyColors: [0xc0612f, 0x3d2f45, 0x6b3f3a, 0xf2b84b],
    ground: 'cracked dark rock, ash, glowing fissures',
    silhouette: 'basalt columns, smoking vents, blackened ruins',
    particle: 'drifting embers', lightTint: 0xffd8c0,
  },
  'mirage-desert': {
    id: 'mirage-desert', name: 'Mirage Desert', launch: true,
    keyColors: [0xf2b886, 0xc99a4b, 0xa0663a, 0x3fbfae],
    ground: 'rippled dunes, cracked clay, cacti and succulents',
    silhouette: 'domed sandstone ruins, oasis palms, half-buried statues',
    particle: 'blown sand', lightTint: 0xfff0d6,
  },
  'murkmire-swamp': {
    id: 'murkmire-swamp', name: 'Murkmire Swamp', launch: false,
    keyColors: [0x6b7a3a, 0x2f5a52, 0x4a3e2a, 0xb8d65a],
    ground: 'mud, lily pads, reeds, dead trees',
    silhouette: 'stilt houses, crooked trees with hanging moss',
    particle: 'rising bubbles', lightTint: 0xdfe8c8,
  },
  'sky-ruins': {
    id: 'sky-ruins', name: 'Sky Ruins', launch: false,
    keyColors: [0xaab4e8, 0xf4f1ea, 0x8a8fb0, 0xe2b84a],
    ground: 'floating islands, cloud floors, ivy on marble',
    silhouette: 'broken columns, floating stairs, giant bells',
    particle: 'drifting feathers', lightTint: 0xf0f2ff,
  },
};

export const LAUNCH_BIOMES = Object.values(BIOMES).filter((b) => b.launch);
