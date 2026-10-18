// The game's art style as one piece of data (Style Bible). Every prompt that
// paints, animates or judges a picture takes its style words from here, so a
// new art style is a new profile, chosen with ART_STYLE in .env, rather than
// sentences hunted down across the prompt builders. What a picture shows (a
// cottage, a mushroom, Mara) stays with each builder; how it is painted and
// from where it is seen lives here.

/** One art style: the words every image, video and judge prompt is built from. */
export interface StyleProfile {
  id: string;
  /** Shown to the Owner. */
  name: string;
  /** Raised whenever the words change, so every recipe records which rules it was made under. */
  version: number;
  /** The flat colour sprites are painted on; the pipeline turns it transparent. */
  keyColor: { r: number; g: number; b: number; hex: string };
  /** How every painting looks, sent first. */
  base: string;
  /** Things no picture may look like. */
  negatives: string[];
  /** Where the camera stands for sprites and buildings, in words (the game's projection). */
  view: string;
  /** How a lone sprite is framed on the key colour. */
  sprite: { framing: string; negatives: string[] };
  /** How a seamless ground tile is framed. */
  tile: { framing: string; negatives: string[] };
  /** Building insides: their own style, tile framing and furniture framing. */
  interior: { style: string; tileFraming: string; spriteFraming: string };
  /** The opening words of a walk clip prompt. */
  animation: string;
  /** What the style check's judge is told the game is, and what belonging to its look means. */
  judge: { game: string; look: string };
  /** How a picture's normal map is asked for: the light's guide to which way each pixel faces. */
  normalMap: string;
  /** How the building kit's flat textures are painted on their sheet: square-on, unlit, unframed, in the style's look. */
  kitTextures: string;
}

const MAGENTA = { r: 255, g: 0, b: 255, hex: '#FF00FF' };
const VIEW = 'three-quarter top-down view';

/** The launch style: hand-painted storybook art in the spirit of Legend of Mana, with pixel-art building insides. */
export const STORYBOOK: StyleProfile = {
  id: 'storybook',
  name: 'Hand-painted storybook',
  version: 2,
  keyColor: MAGENTA,
  base: [
    'Hand-painted 2D game art in the style of a 1999 storybook RPG.',
    'Soft watercolour and gouache shading with visible brush texture and 3 to 5 value steps per colour.',
    'Warm golden key light from the upper left, blue-violet shadows.',
    'Selective coloured outlines, rounded organic shapes, whimsical fairy-tale mood. Softened saturation.',
    'No writing anywhere: labels, signs and covers are blank or carry simple symbols.',
  ].join('\n'),
  negatives: [
    'photorealistic', '3D render', 'anime cel shading', 'vector art', 'flat design', 'thick black outlines',
    'pure black', 'pure white', 'harsh contrast', 'neon', 'lens flare', 'blur', 'noise',
    'text', 'letters', 'words', 'labels with writing', 'watermark', 'signature', 'frame', 'border', 'vignette',
  ],
  view: VIEW,
  sprite: {
    framing: [
      `A single game sprite in ${VIEW}, centred, with empty margin all around it.`,
      `Background: one flat solid pure magenta (${MAGENTA.hex}) filling everything behind the subject,`,
      'with no floor, scenery, gradient, glow, vignette or shadow on it. No magenta anywhere in the subject.',
    ].join('\n'),
    negatives: ['background scenery', 'floor', 'ground shadow', 'cast shadow', 'gradient background'],
  },
  tile: {
    framing: [
      'A ground texture tile: flat ground seen from directly above, filling the entire square frame edge to edge.',
      'Not a block, diamond, island or platform: no sides, thickness, border, frame or horizon.',
      'Even lighting and low contrast across the whole tile; small details spread evenly with no clumps, patches or single large feature, so it repeats seamlessly on all four edges.',
    ].join('\n'),
    negatives: ['isometric block', 'diamond shape', 'floating island', 'tile sides', 'drop shadow', 'perspective horizon'],
  },
  interior: {
    style: [
      'Pixel art game graphics in the style of a 16-bit SNES / PS1 Legend of Mana RPG interior.',
      'Every art pixel is a crisp, hard-edged square block: no anti-aliasing, no smooth gradients, no blur.',
      'A limited palette of about 16 colours taken from the reference painting, warm light from the upper left. No writing anywhere.',
    ].join('\n'),
    tileFraming: [
      'A texture tile seen from directly above, filling the entire square frame edge to edge, drawn as if 32 by 32 pixels scaled up.',
      'Even lighting and low contrast, small details spread evenly with no single big feature, no moss clumps, mushrooms or objects,',
      'so it repeats seamlessly on all four edges. No border, frame, perspective, wall face or shadow at the edges.',
    ].join('\n'),
    spriteFraming: [
      `A single sprite in ${VIEW}, centred, with empty margin all around it, with a darker coloured outline.`,
      `Background: one flat solid pure magenta (${MAGENTA.hex}) filling everything behind the subject, with no floor, gradient, glow or shadow on it. No magenta anywhere in the subject.`,
      'Fire and light have no glow or halo spilling outside the object.',
    ].join('\n'),
  },
  animation: '2D hand-painted storybook game character animation.',
  judge: {
    game: 'a hand-painted 2D fantasy RPG',
    look: 'hand-painted with soft brush shading, warm light, the same kind of view and outline',
  },
  normalMap: [
    'Make the tangent-space normal map of the attached game picture, for 2D lighting.',
    'Exactly the same shapes, outline and size as the picture, every detail in the same place, filling the same frame.',
    'Colours mean the direction each surface faces: flat facing the viewer is lavender blue (128, 128, 255); facing right is pinker, facing left is bluer-green; facing the top of the picture is greener, facing the bottom is more purple.',
    'Smooth rounded forms for bodies, cloth and leaves; crisp edges for stone, wood and metal; small bumps for texture.',
    'Where the picture is empty or magenta, fill with flat lavender blue (128, 128, 255).',
    'No shading, no light, no colours of the picture itself, no outlines, no writing.',
  ].join('\n'),
  // Kit buildings come with the isometric camera and the flat faceted look of
  // Art Direction v2; until that look has its own profile (camera plan, step
  // 5), its texture words are kept here, exactly as the first sheets were painted.
  kitTextures: [
    'Every texture is flat and seen square-on, like a scan of a flat surface held straight in front of the camera: no perspective, no isometric view, no 3D, no depth, no objects drawn on top.',
    'Built from a few flat facets of solid colour with crisp edges and very low contrast, in one small palette of soft muted warm pastels: cream, sand, warm honey-brown timber, terracotta, dusty rose, sage green.',
    'No lighting at all: no shading, no shadows, no highlights, no gradients, no darker edges or corners, no glow; the same brightness all over each texture.',
    'No border, frame or outline round any shape. No writing, letters or symbols.',
  ].join(' '),
};

/** Every style the game knows, by id. A new style is one more entry. */
export const STYLE_PROFILES: Record<string, StyleProfile> = { [STORYBOOK.id]: STORYBOOK };

/** The style ART_STYLE names, or the storybook style (with a warning when the name is unknown). */
export function chooseStyle(env: Record<string, string | undefined> = process.env): StyleProfile {
  const id = env.ART_STYLE?.trim();
  if (!id) return STORYBOOK;
  const found = STYLE_PROFILES[id];
  if (!found) console.warn(`ART_STYLE=${id} is not a known art style (${Object.keys(STYLE_PROFILES).join(', ')}), so ${STORYBOOK.id} is used.`);
  return found ?? STORYBOOK;
}

/** The style this server paints in, chosen once at start-up. */
export const STYLE: StyleProfile = chooseStyle();
