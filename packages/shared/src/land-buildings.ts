import type { BuildingStyle } from './buildings.ts';

// The great buildings of the launch lands (see places.ts): a temple, a cave,
// a castle, a coral palace, a smugglers' sea cave, a desert palace and a
// tomb. Like every building they are only descriptions here; the image
// model paints them, outside and in, each beside an approved picture of
// its land so it matches.

/** The launch lands' great buildings, by id. */
export const LAND_BUILDING_STYLES: Record<string, BuildingStyle> = {
  'sanctum-temple': {
    id: 'sanctum-temple',
    name: 'The Temple of the Bell',
    biome: 'sanctum',
    kit: 'temple-stone',
    // A flat roof under the great dome; the belfry is its finial for now.
    kitShape: { roof: 'flat', dome: { finial: true } },
    references: ['sanctum-shrine'],
    exterior:
      'a grand old temple of pale cream stone with a wide flight of steps up to tall arched bronze double doors, ' +
      'slender columns along the front, a great domed roof of weathered green copper topped by a small open belfry with a golden bell, ' +
      'tall stained-glass windows glowing amber and violet, ivy climbing the corners, stone braziers burning either side of the steps',
    floor: 'polished pale cream marble flagstones laid in a simple grid, with thin gold lines between them and faint veins',
    wall: 'the top of a thick wall of pale cream stone blocks with a carved gold-leaf border along it',
    door: 'a wide worn threshold of darker cream marble running left to right, with a thin inlaid gold line along the top edge',
    furniture: {
      altar: { name: 'altar', look: 'a long white stone altar draped with a violet cloth, with candles and a small golden bell on it', width: 3 },
      'bell-rack': { name: 'bell rack', look: 'a dark wooden frame hung with a row of bronze bells of different sizes', width: 3 },
      brazier: { name: 'brazier', look: 'a tall bronze brazier on three legs with a bright flickering fire in its bowl', width: 1 },
      pew: { name: 'pew', look: 'a long dark wooden pew with a carved back, seen from behind', width: 3 },
    },
  },
  'sanctum-cathedral': {
    id: 'sanctum-cathedral',
    name: 'The High Cathedral of the Bell',
    biome: 'sanctum',
    kit: 'temple-stone',
    kitShape: { roof: 'flat', battlements: true, towers: [{ corner: 'front-left' }, { corner: 'front-right' }], numStoreys: 3 },
    references: ['sanctum-shrine'],
    exterior:
      'a magnificent cathedral of gleaming cream marble and white limestone: soaring twin bell towers with golden bells, a grand arched entrance with heavy bronze double doors, ' +
      'a rose stained-glass window glowing with radiant golden light, stone gargoyles and flying buttresses along the flanks, braziers flickering on the wide marble steps',
    floor: 'polished cream marble flagstones in an intricate mosaic pattern with gold grout and faint violet veins',
    wall: 'the top of a thick cathedral wall of fluted marble columns and gold-trimmed pale limestone',
    door: 'a grand double-width bronze threshold with intricate celestial engravings and a polished gold step',
    furniture: {
      'high-altar': { name: 'high altar', look: 'a grand white marble altar draped with violet and gold brocade, topped with golden candelabras and a sanctified chime', width: 4 },
      'gold-pew': { name: 'golden pew', look: 'a polished dark cedar church pew with carved seraph wings and plush violet velvet cushions', width: 3 },
      brazier: { name: 'brazier', look: 'a tall bronze brazier on three legs with a bright flickering fire in its bowl', width: 1 },
      lectern: { name: 'eagle lectern', look: 'a sculpted brass eagle lectern bearing a heavy illuminated prayer book', width: 1.5 },
      'crypt-gate': { name: 'crypt gate', look: 'a heavy wrought iron gate barred with silver chains and a glowing warding seal', width: 2 },
    },
  },
  'sanctum-scriptorium': {
    id: 'sanctum-scriptorium',
    name: "The Clerics' Scriptorium",
    biome: 'sanctum',
    kit: 'timber-cottage',
    kitShape: { numStoreys: 2 },
    references: ['sanctum-shrine'],
    exterior:
      'a graceful monastic library and scriptorium of cream stone and dark oak timber: arched leaded-glass windows, a steep slate roof with stone dormers, ' +
      'carved stone arches framing a studded wooden door, and warm lantern light glowing from within',
    floor: 'honey-waxed oak parquet floorboards laid in a tight herringbone pattern',
    wall: 'the top of an ashlar limestone wall lined with dark polished oak wainscoting',
    door: 'a sturdy oak threshold reinforced with dark iron studs and a worn central groove',
    furniture: {
      'scribe-desk': { name: 'scribe desk', look: 'a slanted oak desk with ink pots, parchment sheets, quill stands, and a magnifying lens', width: 2 },
      'tall-bookshelf': { name: 'tall bookshelf', look: 'a high wooden library bookshelf packed with leather-bound holy tomes and rolled scrolls', width: 2 },
      'reading-lectern': { name: 'reading lectern', look: 'a standing wooden reading lectern with an open illuminated scroll and a brass oil lamp', width: 1.5 },
      'relic-case': { name: 'relic case', look: 'a glass and polished brass reliquary display case holding sacred silver talismans and incense censer', width: 2 },
    },
  },
  'sanctum-inn': {
    id: 'sanctum-inn',
    name: "The Pilgrim's Haven",
    biome: 'sanctum',
    kit: 'timber-cottage',
    kitShape: { numStoreys: 2 },
    references: ['sanctum-shrine'],
    exterior:
      'a warm, welcoming two-storey coaching inn of whitewashed timber and warm sandstone: a carved wooden hanging sign depicting a golden bell over a foaming tankard, ' +
      'smoke curling from a sturdy chimney, flowering windowboxes, and a heavy wooden tavern door',
    floor: 'wide pine floorboards in a warm amber tone, worn smooth by generations of travelers',
    wall: 'the top of a sturdy timber-and-plaster wall with dark exposed oak beams',
    door: 'a heavy weathered oak door threshold with a cozy welcome rug texture',
    furniture: {
      hearth: { name: 'hearth', look: 'a massive stone tavern fireplace with a roaring log fire and a bubbling iron stew cauldron hanging from an iron crane', width: 3 },
      'bar-counter': { name: 'bar counter', look: 'a long polished dark wood tavern bar counter with brass beer taps, ceramic mugs, and a bowl of roasted nuts', width: 3 },
      'dining-table': { name: 'dining table', look: 'a sturdy rectangular wooden tavern table with clay bowls, fresh bread loaves, and tankards', width: 2.6 },
      bench: { name: 'wooden bench', look: 'a long sturdy wooden dining bench with iron brackets', width: 2 },
      'ale-cask': { name: 'ale cask', look: 'a large wooden barrel of spiced honey ale on a carved wooden cradle', width: 1 },
    },
  },
  'woods-cave': {
    id: 'woods-cave',
    name: 'The Thornwolf Cave',
    biome: 'whispering-woods',
    references: ['woods-tree-house'],
    exterior:
      'the mouth of a deep cave in a huge mossy hill of grey boulders: a wide dark rounded opening at the bottom middle, ' +
      'gnarled tree roots hanging over the entrance, glowing teal mushrooms and ferns around it, ' +
      'old claw marks and a few scattered bones by the opening, a twisted old tree growing on top of the hill',
    floor: 'rough cave floor of packed dark earth and flat grey stones, with small pebbles and a few patches of glowing teal moss',
    wall: 'the top of a rough cave wall of dark grey rock with jagged edges and trickles of moss',
    door: 'the rocky lip of the cave mouth running left to right, rough grey stone a little lighter than the floor',
    furniture: {
      crystals: { name: 'crystals', look: 'a cluster of glowing pale-blue crystals growing out of the rock', width: 2 },
      stalagmite: { name: 'stalagmite', look: 'a tall pointed grey stalagmite, wet and shiny', width: 1 },
      'old-chest': { name: 'old chest', look: 'a battered old wooden treasure chest with rusty iron bands, half covered in moss', width: 2 },
    },
  },
  'woods-castle': {
    id: 'woods-castle',
    name: 'Mossgate Castle',
    biome: 'whispering-woods',
    kit: 'castle-stone',
    // Round towers with pointed roofs either side of the gate (the south wall), square ones behind.
    kitShape: {
      roof: 'flat',
      battlements: true,
      towers: [
        { corner: 'front-left', size: 1.5, above: 1.4, round: true, top: 'cone' },
        { corner: 'back-left', size: 1.5, above: 1.4, round: true, top: 'cone' },
        { corner: 'front-right', size: 1.5, above: 0.8 },
        { corner: 'back-right', size: 1.5, above: 0.8 },
      ],
    },
    references: ['woods-tree-house'],
    exterior:
      'an old forest castle of grey-green stone, overgrown with ivy and moss: a great arched wooden gate at the bottom middle with an iron portcullis raised, ' +
      'two round towers with pointed slate-blue roofs and fluttering green banners either side, crenellated walls, ' +
      'small glowing windows, ancient trees pressing close around it',
    floor: 'big worn grey stone flagstones with moss between the cracks and a long faded green carpet runner',
    wall: 'the top of a thick castle wall of grey-green stone blocks with moss along the joints',
    door: 'a worn stone threshold running left to right, darker grey than the floor, with an iron strip along it',
    furniture: {
      throne: { name: 'throne', look: 'a tall carved oak throne with green velvet cushions and antlers on its back', width: 2 },
      tapestry: { name: 'tapestry', look: 'a long hanging tapestry showing a knight and a great tree, in faded green and gold', width: 3 },
      pillar: { name: 'pillar', look: 'a thick round stone pillar wrapped in ivy', width: 1 },
      'armour-stand': { name: 'armour stand', look: 'a suit of old dented knight armour on a wooden stand', width: 1 },
    },
  },
  'shore-coral-palace': {
    id: 'shore-coral-palace',
    name: 'The Coral Palace',
    biome: 'sunlit-shore',
    kit: 'coral-palace',
    // Tall round towers like seashells at its corners, and a pearly dome.
    kitShape: {
      roof: 'flat',
      dome: { finial: true },
      towers: (['front-left', 'front-right', 'back-left', 'back-right'] as const).map((corner) => ({ corner, size: 1.2, above: 2, round: true, top: 'cone' as const })),
    },
    references: ['shore-lighthouse'],
    exterior:
      'a shining palace grown from pink and white coral on a rocky point by the sea: a tall arched doorway of pearl at the bottom middle, ' +
      'spiral towers like seashells with rounded tops, walls of pastel coral with barnacles and starfish, ' +
      'windows of sea glass glowing turquoise, little waterfalls of seawater running down its sides',
    floor: 'smooth pale pink coral floor with swirls of white sand and tiny shells set into it',
    wall: 'the top of a wall of knobbly pink coral with white pearl studs along it',
    door: 'a curved threshold of mother-of-pearl running left to right, shimmering a little lighter than the floor',
    furniture: {
      'coral-throne': { name: 'coral throne', look: 'a grand throne of branching red coral with a giant scallop shell as its back', width: 2 },
      'giant-clam': { name: 'giant clam', look: 'a giant open clam with a big glowing pearl inside', width: 2 },
      'kelp-pillar': { name: 'kelp pillar', look: 'a pillar of twisting green kelp and coral', width: 1 },
      'pearl-fountain': { name: 'pearl fountain', look: 'a round fountain of white coral with clear water spilling and pearls in its basin', width: 2 },
    },
  },
  'shore-sea-cave': {
    id: 'shore-sea-cave',
    name: "The Smugglers' Sea Cave",
    biome: 'sunlit-shore',
    references: ['shore-lighthouse'],
    exterior:
      'a dark sea cave in a tall cliff of sandy-brown rock: a wide rough arch at the bottom middle with an old wooden plank walkway into it, ' +
      'a tattered pirate flag on a pole, ropes and nets hanging, seaweed and barnacles on the rocks, ' +
      'a faint lantern glow inside, gulls sitting on the cliff top',
    floor: 'wet dark sand and flat sea-worn stones with small tide pools and shells',
    wall: 'the top of a rough sandy-brown cave wall with barnacles and dark seaweed',
    door: 'old salt-bleached wooden planks running left to right over wet sand, lighter than the floor',
    furniture: {
      'treasure-chest': { name: 'treasure chest', look: 'an open treasure chest overflowing with gold coins and pearls', width: 2 },
      'rum-barrel': { name: 'rum barrel', look: 'a dark wooden barrel with iron hoops and a tap', width: 1 },
      'rope-coil': { name: 'rope coil', look: 'a thick coil of old ship rope', width: 1 },
      'ship-lantern': { name: 'ship lantern', look: 'a brass ship lantern on a post with a warm orange flame', width: 1 },
    },
  },
  'desert-palace': {
    id: 'desert-palace',
    name: "Sultana Zahra's Palace",
    biome: 'mirage-desert',
    kit: 'desert-sandstone',
    // A great dome, and two slender minarets at the back.
    kitShape: {
      roof: 'flat',
      dome: { finial: true },
      towers: [
        { corner: 'back-left', size: 0.9, above: 2.4, round: true, top: 'cone' },
        { corner: 'back-right', size: 0.9, above: 2.4, round: true, top: 'cone' },
      ],
    },
    references: ['desert-ruin'],
    exterior:
      'a magnificent desert palace of sandstone and white plaster: a tall pointed arch doorway with carved wooden doors at the bottom middle, ' +
      'golden onion domes and slender minarets, blue and turquoise mosaic tiles around the arches, ' +
      'silk awnings in deep red and saffron, palm trees and a reflecting pool before the doors',
    floor: 'smooth cream stone floor with small turquoise and terracotta diamond inlays spread evenly',
    wall: 'the top of a thick sandstone wall with a band of blue mosaic tiles along it',
    door: 'a smooth sandstone threshold running left to right with a thin row of turquoise tiles along it',
    furniture: {
      'golden-throne': { name: 'golden throne', look: 'a golden throne with red silk cushions under a small canopy', width: 2 },
      carpet: { name: 'carpet', look: 'a large richly patterned red and gold carpet, seen from above', width: 4 },
      cushions: { name: 'cushions', look: 'a pile of plump silk floor cushions in saffron, red and teal', width: 2 },
      'palace-fountain': { name: 'palace fountain', look: 'a small eight-sided tiled fountain with clear water', width: 2 },
      'palm-pot': { name: 'potted palm', look: 'a small palm tree in a big blue glazed pot', width: 1 },
    },
  },
  'desert-tomb': {
    id: 'desert-tomb',
    name: 'Tomb of the Sun King',
    biome: 'mirage-desert',
    references: ['desert-ruin'],
    exterior:
      'the entrance to an ancient tomb cut into a sandstone cliff: a dark square doorway at the bottom middle flanked by two huge seated stone kings, ' +
      'a carved sun disc above the door, faded painted pictures on the stone, half buried in drifting sand, broken columns nearby',
    floor: 'dusty sandstone floor slabs with faded carved sun symbols and a light drift of sand',
    wall: 'the top of a thick tomb wall of carved sandstone blocks with a band of faded blue and gold paint',
    door: 'a worn sandstone sill running left to right, darker than the floor, with sand drifted against it',
    furniture: {
      sarcophagus: { name: 'sarcophagus', look: 'a great golden sarcophagus with a painted face, lying on a stone plinth', width: 2 },
      'canopic-jars': { name: 'canopic jars', look: 'a row of four stone jars with animal-head lids', width: 2 },
      'sun-statue': { name: 'sun statue', look: 'a small stone statue of a kneeling figure holding up a golden sun disc', width: 1 },
    },
  },
};
