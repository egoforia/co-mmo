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

/** The Temple of the Bell: pale cream stone and a weathered green copper dome. */
export const TEMPLE_STONE: KitLook = {
  id: 'temple-stone',
  name: 'Pale temple stone',
  words: {
    panel: 'one outside wall section of a temple, between two posts: smooth pale cream stone blocks with one slim carved band of a simple leaf pattern running across it at two thirds of its height.',
    inside: 'the same wall seen from inside the temple: smooth pale cream stone on the upper two thirds, and a band of soft violet-grey stone on the lower third.',
    door: 'a tall double door of warm bronze filling the whole arch, divided down the middle, with a few raised square panels and two round bronze ring handles.',
    window: 'a tall stained-glass window: flat panes in soft amber, violet and pale gold in a simple geometric pattern, divided by slim bronze lines that reach all four edges; no outer frame.',
    plaster: 'plain smooth pale cream stone with a few very faint flat facets, nothing else.',
    floor: 'a temple floor of large square pale cream and soft grey flagstones in a chequer, four rows from top to bottom, with thin even joints.',
    roof: 'weathered green copper roofing: flat soft sea-green and pale verdigris sheets in rows running from left to right, five rows from top to bottom, with thin raised seams between them.',
    stone: 'a wall of large smooth pale cream stone blocks, four rows from top to bottom, four or five blocks in each row, joints offset from row to row, thin pale mortar lines all equally thick.',
    timber: 'one long beam of pale carved stone: smooth cream stone with a fine straight grain running from left to right along the strip.',
  },
};

/** Mossgate Castle: grey-green stone, moss and slate-blue roofs. */
export const CASTLE_STONE: KitLook = {
  id: 'castle-stone',
  name: 'Mossy castle stone',
  words: {
    panel: 'one outside wall section of an old forest castle, between two posts: rough grey-green stone blocks with a few soft patches of moss low down.',
    inside: 'the same wall seen from inside the castle hall: grey-green stone blocks on the upper two thirds, and dark oak panelling on the lower third.',
    door: 'a great castle gate of heavy dark oak planks filling the whole arch, with broad black iron straps across it and big round iron studs.',
    window: 'a narrow castle window: four small panes of flat even pale blue-grey glass with no reflections, divided by a slim dark iron cross that reaches all four edges; no outer frame.',
    plaster: 'plain rough grey-green stone with a few very faint flat facets, nothing else.',
    floor: 'a castle floor of large worn grey flagstones of different sizes, four rows from top to bottom, with thin even joints.',
    roof: 'slate roof tiles in rows running from left to right, flat rectangular slates in soft slate blue and blue-grey, six rows from top to bottom, each row overlapping the one below it, joints offset from row to row.',
    stone: 'a castle wall of big rough grey-green stone blocks, four rows from top to bottom, four or five blocks in each row, joints offset from row to row, thin pale mortar lines all equally thick.',
    timber: 'one dark oak beam: dark brown wood with a long grain running from left to right along the strip.',
  },
};

/** The Coral Palace: pastel pink and white coral, sea glass and pearl. */
export const CORAL_PALACE: KitLook = {
  id: 'coral-palace',
  name: 'Pastel coral',
  words: {
    panel: 'one outside wall section of a palace grown from coral, between two posts: smooth pastel pink coral with a few small cream barnacles and one tiny pale starfish.',
    inside: 'the same wall seen from inside the palace: smooth pearly white coral on the upper two thirds, and soft turquoise tiles on the lower third.',
    door: 'a tall door of pearl filling the whole arch: smooth soft white mother-of-pearl in a few broad flat curved bands, with a small round pearl handle.',
    window: 'a round-cornered window of sea glass: four flat panes of even soft turquoise, divided by a slim pearly white cross that reaches all four edges; no outer frame.',
    plaster: 'plain smooth pastel pink coral with a few very faint flat facets, nothing else.',
    floor: 'a palace floor of square tiles in soft turquoise and pearly white in a chequer, five rows from top to bottom, with thin even joints.',
    roof: 'pearly roof scales in rows running from left to right: rounded flat scales in pale coral pink and pearly white, six rows from top to bottom, each row overlapping the one below it, joints offset from row to row.',
    stone: 'a wall of rounded blocks of pale pink and cream coral stone, four rows from top to bottom, five blocks in each row, joints offset from row to row, thin pale lines all equally thick.',
    timber: 'one beam of smooth pearly white coral with a faint long grain running from left to right along the strip.',
  },
};

/** The Desert Palace: warm sandstone, gold and turquoise tiles. */
export const DESERT_SANDSTONE: KitLook = {
  id: 'desert-sandstone',
  name: 'Desert sandstone',
  words: {
    panel: 'one outside wall section of a desert palace, between two posts: smooth warm sand-coloured plaster with one slim band of turquoise and gold tiles running across it at two thirds of its height.',
    inside: 'the same wall seen from inside the palace: smooth warm sand plaster on the upper two thirds, and turquoise and cream patterned tiles on the lower third.',
    door: 'a tall door of carved dark cedar filling the whole arch, with a simple star pattern of raised flat panels and a small gold ring handle.',
    window: 'a window with a carved screen: flat cream lattice in a simple star pattern over even pale gold glass, the lattice reaching all four edges; no outer frame.',
    plaster: 'plain smooth warm sand-coloured plaster with a few very faint flat facets, nothing else.',
    floor: 'a palace floor of square tiles in cream, terracotta and turquoise in a simple repeating star pattern, five rows from top to bottom, with thin even joints.',
    roof: 'a dome covering of flat glazed tiles in rows running from left to right, soft turquoise and gold, six rows from top to bottom, joints offset from row to row.',
    stone: 'a wall of smooth warm sandstone blocks, four rows from top to bottom, four or five blocks in each row, joints offset from row to row, thin pale mortar lines all equally thick.',
    timber: 'one beam of dark cedar wood with a long grain running from left to right along the strip.',
  },
};

/** Every kit look the game ships with, by id. */
export const KIT_LOOKS: Record<string, KitLook> = Object.fromEntries([TIMBER_COTTAGE, TEMPLE_STONE, CASTLE_STONE, CORAL_PALACE, DESERT_SANDSTONE].map((l) => [l.id, l]));
