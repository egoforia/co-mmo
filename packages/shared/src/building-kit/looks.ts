// What kit buildings look like, as words the image model paints from. A look
// names every texture a building's faces use; the style (flat, square-on,
// unlit) comes from the server's style profile, so a look only says what each
// surface is.

/** Every texture a kit building is painted with, by the names its faces use. */
export const KIT_TEXTURES = ['panel', 'inside', 'door', 'window', 'plaster', 'floor', 'roof', 'stone', 'timber'] as const;
export type KitTexture = (typeof KIT_TEXTURES)[number];

/** A look for kit buildings: what each texture shows, in words the image model reads. */
export interface KitLook {
  id: string;
  /** Shown to the Owner. */
  name: string;
  words: Record<KitTexture, string>;
}

/** The timber-framed cottage of the first kit houses (painted 2026-10-17, Art Direction v2). */
export const TIMBER_COTTAGE: KitLook = {
  id: 'timber-cottage',
  name: 'Timber-framed cottage',
  words: {
    panel: 'one outside wall section of a timber-framed cottage, between two posts: cream plaster with one slim warm-brown timber brace running diagonally from its lower left corner to its upper right corner.',
    inside: 'the same wall seen from inside the room: plain warm cream plaster on the upper two thirds, and simple upright honey-brown boards on the lower third.',
    door: 'a front door made of upright sage-green planks filling the whole arch, with two dark iron straps across it and a small iron ring handle on the right.',
    window: 'a window: four panes of glass, each one flat even pale blue-grey with no reflections, glints or streaks, divided by a slim warm-brown timber cross that reaches all four edges; no outer frame.',
    plaster: 'plain cream plaster with a few very faint flat facets, nothing else.',
    floor: 'wooden floor boards running from left to right, honey-brown, six boards from top to bottom, each board split into planks of different lengths, with plank ends staggered from board to board.',
    roof: 'roof shingles in rows running from left to right, rectangular flat shingles in dusty rose and terracotta, six rows from top to bottom, each row overlapping the one below it, joints offset from row to row.',
    stone: 'a stone wall of rounded rectangular blocks in warm grey and sand only (no other colours), four rows of blocks from top to bottom, five or six blocks in each row, with the joints offset from row to row; thin pale mortar lines between the rows and between the blocks, all equally thick.',
    timber: 'one timber beam: warm brown wood with a long grain running from left to right along the strip.',
  },
};

/** Every kit look the game ships with, by id. */
export const KIT_LOOKS: Record<string, KitLook> = { [TIMBER_COTTAGE.id]: TIMBER_COTTAGE };
