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
  /** Building insides: their own style, tile framing and furniture framing, and whether they are turned into pixel art after painting. */
  interior: { style: string; tileFraming: string; spriteFraming: string; pixelArt: boolean };
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

/** The launch style: hand-painted storybook art in the spirit of Legend of Mana, with pixel-art building insides. Kept for the top-down camera's pictures and as ART_STYLE=storybook. */
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
    pixelArt: true,
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
  // The words the first kit sheets were painted with, kept exactly so their
  // prompts still match (FLAT_ISOMETRIC's leave each look's colours to the look).
  kitTextures: [
    'Every texture is flat and seen square-on, like a scan of a flat surface held straight in front of the camera: no perspective, no isometric view, no 3D, no depth, no objects drawn on top.',
    'Built from a few flat facets of solid colour with crisp edges and very low contrast, in one small palette of soft muted warm pastels: cream, sand, warm honey-brown timber, terracotta, dusty rose, sage green.',
    'No lighting at all: no shading, no shadows, no highlights, no gradients, no darker edges or corners, no glow; the same brightness all over each texture.',
    'No border, frame or outline round any shape. No writing, letters or symbols.',
  ].join(' '),
};

const ISO_VIEW = 'classic 2:1 isometric view, looking down at about 30 degrees from one corner, standing upright';

/** House style text of Style Bible v3: every picture is painted unlit, and the game lights it. */
const FLAT_BASE = [
  'Stylised low-poly isometric fantasy game art, light-neutral.',
  'Flat faceted shapes built from a few large flat planes with crisp hard edges, like cut paper or a clean vector illustration.',
  'NO LIGHTING AT ALL: every material is one single flat base colour on all its facets, with no lit side, no shadow side, no highlights, no gradients and no glow; facets are shown only by a very thin, slightly darker seam where two planes meet. No outlines, no texture, no noise.',
  'A small harmonious palette of soft, muted warm pastels (sand, terracotta, dusty rose, sage green, teal, cream, brass). No writing anywhere.',
].join('\n');

/** The isometric camera's style (Style Bible v3, Art Direction v2): flat faceted low-poly pastel, painted unlit and lit by the game. */
export const FLAT_ISOMETRIC: StyleProfile = {
  id: 'flat-isometric',
  name: 'Flat faceted isometric',
  version: 1,
  keyColor: MAGENTA,
  base: FLAT_BASE,
  negatives: [
    'photorealistic', 'painterly', 'watercolour', 'brush strokes', 'anime cel shading', 'outlines', 'thick black outlines',
    'shading', 'cast shadow', 'drop shadow', 'highlights', 'gradients', 'glow', 'texture', 'noise',
    'pure black', 'pure white', 'harsh contrast', 'neon', 'lens flare', 'blur', 'top-down view',
    'text', 'letters', 'words', 'labels with writing', 'watermark', 'signature', 'frame', 'border', 'vignette',
  ],
  view: ISO_VIEW,
  sprite: {
    framing: [
      `A single game sprite in ${ISO_VIEW}, centred, with empty margin all around it.`,
      `Background: one flat solid pure magenta (${MAGENTA.hex}) filling everything behind the subject,`,
      'with no floor, scenery, gradient, glow, vignette or shadow on it. No magenta anywhere in the subject.',
    ].join('\n'),
    negatives: ['background scenery', 'floor', 'ground shadow', 'cast shadow', 'gradient background'],
  },
  // Ground is painted as square textures; the game turns the tiled plane into diamonds.
  tile: STORYBOOK.tile,
  interior: {
    // Insides follow the outside look (Style Bible v3 retires the pixel-art insides); the game lights them with their own lamps.
    style: FLAT_BASE,
    tileFraming: [
      'A floor or wall texture seen square-on, filling the entire square frame edge to edge.',
      'Very low contrast, small flat facets spread evenly with no single big feature or object,',
      'so it repeats seamlessly on all four edges. No border, frame, perspective, wall face or shadow at the edges.',
    ].join('\n'),
    spriteFraming: [
      `A single sprite in ${ISO_VIEW}, centred, with empty margin all around it.`,
      `Background: one flat solid pure magenta (${MAGENTA.hex}) filling everything behind the subject, with no floor, gradient, glow or shadow on it. No magenta anywhere in the subject.`,
      'Fire and light have no glow or halo spilling outside the object.',
    ].join('\n'),
    pixelArt: false,
  },
  animation: 'Stylised low-poly isometric game character animation: flat faceted shapes in flat unlit colours that stay the same the whole time.',
  judge: {
    game: 'a stylised low-poly isometric fantasy RPG',
    look: 'flat faceted shapes with crisp edges, soft muted pastels, no outlines or texture, no light or shadow painted in, seen from the same isometric corner',
  },
  normalMap: [
    STORYBOOK.normalMap.split('\n').slice(0, 3).join('\n'),
    'Every flat facet is one even colour for the one way it faces, with crisp edges where facets meet; nothing is rounded or bumpy.',
    STORYBOOK.normalMap.split('\n').slice(4).join('\n'),
  ].join('\n'),
  // Each kit look names its own colours, so these words set only how a texture is painted, not its palette.
  kitTextures: [
    'Every texture is flat and seen square-on, like a scan of a flat surface held straight in front of the camera: no perspective, no isometric view, no 3D, no depth, no objects drawn on top.',
    'Built from a few flat facets of solid colour with crisp edges and very low contrast, soft and muted, in the colours each texture below names.',
    'No lighting at all: no shading, no shadows, no highlights, no gradients, no darker edges or corners, no glow; the same brightness all over each texture.',
    'No border, frame or outline round any shape. No writing, letters or symbols.',
  ].join(' '),
};

/** Every style the game knows, by id. A new style is one more entry. */
export const STYLE_PROFILES: Record<string, StyleProfile> = { [FLAT_ISOMETRIC.id]: FLAT_ISOMETRIC, [STORYBOOK.id]: STORYBOOK };

/** The style new pictures are painted in when ART_STYLE names none: the isometric camera's. */
export const DEFAULT_STYLE = FLAT_ISOMETRIC;

/**
 * The words for pictures only the old top-down camera uses (its four walk
 * directions). They stay exactly as they were until that camera is retired,
 * so a top-down picture painted again still matches the rest.
 */
export const TOP_DOWN_STYLE = STORYBOOK;

/** The style ART_STYLE names, or the default style (with a warning when the name is unknown). */
export function chooseStyle(env: Record<string, string | undefined> = process.env): StyleProfile {
  const id = env.ART_STYLE?.trim();
  if (!id) return DEFAULT_STYLE;
  const found = STYLE_PROFILES[id];
  if (!found) console.warn(`ART_STYLE=${id} is not a known art style (${Object.keys(STYLE_PROFILES).join(', ')}), so ${DEFAULT_STYLE.id} is used.`);
  return found ?? DEFAULT_STYLE;
}

/** The style this server paints in, chosen once at start-up. */
export const STYLE: StyleProfile = chooseStyle();
