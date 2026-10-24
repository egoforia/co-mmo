import type { BiomeId } from './biomes.ts';
import type { BuildingSpec } from './building-kit/spec.ts';
import { LAND_BUILDING_STYLES } from './land-buildings.ts';

// Buildings are described here as data, and the image model chosen in God's
// View paints every picture they need: the outside, the floor, wall and door
// tiles inside, and the furniture. Nothing about a building is drawn in code.
//
// How the pieces fit together, for every building:
// - The outside art is painted with the front door at the middle of its
//   bottom edge, and drawn so that point sits on the doorway in the south
//   wall: the door you see is the door you walk through.
// - It is at least as wide as the walls, so it covers the whole inside.
// - Inside, floor, walls and door are tiles painted to repeat seamlessly,
//   with the outside art as their colour reference, so walking in keeps the
//   same wood, moss and light.
// - Furniture is painted in the same pixel art, at the same pixel size, as
//   the tiles it stands on.

/** A piece of furniture a building style paints. */
export interface FurnitureStyle {
  name: string;
  /** What it looks like, for the image model. */
  look: string;
  /** How wide the art is drawn, in tiles. */
  width: number;
  /** How many tiles deep it stands, front to back; 1 when left out. */
  depth?: number;
}

/** What a kind of building looks like, outside and in. */
export interface BuildingStyle {
  id: string;
  name: string;
  biome: BiomeId | 'any';
  /** The outside, seen from the road. */
  exterior: string;
  /** Floor, wall top and doorway threshold inside, seen from above. */
  floor: string;
  wall: string;
  door: string;
  furniture: Record<string, FurnitureStyle>;
  /** Approved reference images the outside should resemble. */
  references?: string[];
  /**
   * The kit look (building-kit/looks.ts) the building kit builds it in, for
   * the isometric camera. Its painted pictures stay for the top-down view.
   */
  kit?: string;
  /** What the kit builds over its walls besides a gable roof: a flat roof, battlements, towers, a dome. */
  kitShape?: KitShape;
}

/** The parts of a kit building's spec a building style may choose. */
export type KitShape = Pick<BuildingSpec, 'roof' | 'battlements' | 'towers' | 'dome'> & { numStoreys?: number };

/** The parts of a building that get their own picture. */
export type BuildingPart = 'exterior' | 'floor' | 'wall' | 'door';

/** Every building style in the world, by id. */
export const BUILDING_STYLES: Record<string, BuildingStyle> = {
  'bramble-cottage': {
    id: 'bramble-cottage',
    name: "Old Bramble's cottage",
    biome: 'whispering-woods',
    exterior:
      "Old Bramble the herbalist's home inside a huge, wide hollow tree: a carved round-topped wooden front door with a little round window, " +
      'a few short wooden steps down from the door, glowing round windows in the trunk, teal moss on the bark, ' +
      'thick roots reaching out to both sides, colourful mushrooms among the roots, a vast canopy of deep teal-green leaves',
    floor: "smooth honey-brown wooden floorboards cut from the tree's own heartwood, running left to right, with faint grain and a few small knots",
    wall: 'the top of a thick wall of living tree wood: dark rough bark-brown wood with ridged grain and small patches of teal moss',
    door: 'a worn doormat-like threshold of warm honey-brown boards running left to right, a little darker and more worn than the floorboards, with a thin dark groove along the top edge',
    furniture: {
      bed: { name: 'bed', look: 'a cosy wooden bed carved from a root, with a patchwork quilt in teal-green and cream and a plump pillow, the head of the bed at the top', width: 2 },
      bookshelf: { name: 'bookshelf', look: 'a tall wooden bookshelf grown from a root, full of old books with blank spines, jars and a candle', width: 2 },
      hearth: { name: 'hearth', look: 'a round stone hearth with a crackling fire and a black kettle hanging over it', width: 3 },
      'herb-rack': { name: 'herb rack', look: 'a wooden drying rack hung with bundles of herbs and flowers', width: 2 },
      cauldron: { name: 'cauldron', look: 'a small black iron cauldron on three feet, full of bubbling green potion', width: 1.2 },
      table: { name: 'table', look: 'a sturdy round-edged wooden table with a teapot, two cups and a bowl of berries on it', width: 2.6 },
      barrel: { name: 'barrel', look: 'a small wooden barrel with iron hoops and a lid', width: 1 },
    },
    references: ['woods-tree-house'],
  },
  // Wished by egoforia (issue #42): an arcane shop by the Sanctum's pond.
  'sanctum-arcanum': {
    id: 'sanctum-arcanum',
    name: 'The Sanctum Arcanum',
    biome: 'sanctum',
    // A timber-framed shop: the kit builds it as a cottage until it has a look of its own.
    kit: 'timber-cottage',
    exterior:
      'The Sanctum Arcanum, a whimsical little arcane shop of dark timber beams and grey slate: a steep crooked slate roof with a crooked stone chimney, ' +
      'a wooden front door whose doorframe is etched with softly glowing violet runes, a small round stone step before the door, ' +
      'amethyst-purple lanterns hanging either side of the door, small leaded windows glowing warm gold, ' +
      'weeping willow boughs draping over the roof, a few shimmering pale-blue motes of light drifting in the air',
    floor: 'aged cedar floorboards in warm reddish-brown, running left to right, with faint grain and a few small knots',
    wall: 'the top of a thick timber-framed wall: dark oak beams over grey stone, with a thin line of slate along it',
    door: 'a worn cedar threshold running left to right, a little darker than the floorboards, with small faint violet runes carved along it',
    furniture: {
      counter: { name: 'counter', look: 'a heavy carved wooden shop counter with polished brass weighing scales and a few small glass vials on it', width: 3 },
      shelf: { name: 'shelf', look: 'a tall wooden shelf crowded with glimmering crystal globes and swirling coloured tonic vials', width: 2 },
      'display-case': { name: 'display case', look: 'a glass-topped wooden display case holding rolled scrolls and small curios', width: 2 },
      'scrying-basin': { name: 'scrying basin', look: 'a round stone scrying basin on a short pedestal, filled with softly glowing blue water', width: 1.4 },
      'herb-rack': { name: 'herb rack', look: 'a wooden rack hung with bundles of dried arcane herbs and a rolled star chart', width: 2 },
      stool: { name: 'stool', look: 'a small round wooden stool with a plum velvet cushion', width: 1 },
    },
  },
  ...LAND_BUILDING_STYLES,
};

/** The style whose inside tiles stand in for a building whose own are not painted yet. */
export const FALLBACK_BUILDING_STYLE = 'bramble-cottage';

/** The art id of one part of a building style. */
export function buildingArt(style: string, part: BuildingPart): string {
  return `${style}-${part}`;
}

/** The art id of a building style's piece of furniture. */
export function furnitureArt(style: string, key: string): string {
  return `${style}-furniture-${key}`;
}

/** Every art id a building style needs. */
export function buildingArtIds(style: BuildingStyle): string[] {
  return [
    ...(['exterior', 'floor', 'wall', 'door'] as const).map((part) => buildingArt(style.id, part)),
    ...Object.keys(style.furniture).map((key) => furnitureArt(style.id, key)),
  ];
}

/**
 * Pixel art is painted with one art pixel this many game pixels wide, so a
 * 128 px tile is 32 art pixels across, and furniture uses the same grid.
 */
export const PIXEL_ART_SCALE = 4;
