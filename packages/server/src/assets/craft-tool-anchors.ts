import type { TieredAsset } from './skill-anchors.ts';

// The seven craft tools' bag pictures (gather and craft plan, step 4),
// described for the painter. One picture serves all three tiers of a tool
// for now. None ships with the game: each is painted the first time from the
// Art tab at the launch items' size (home-land-art.ts).

const ITEM_REFERENCES = ['item-wooden-sword', 'item-tonic'];

/** One tool picture per craft, by the art id its items use (`item-tool-<craft>`). */
export const CRAFT_TOOL_ANCHORS: TieredAsset[] = [
  {
    id: 'item-tool-woodcarving', name: 'Woodcarver\'s axe', kind: 'item', biome: 'any', references: ITEM_REFERENCES,
    silhouetteHook: 'a short hand axe with a wedge-shaped iron head and a curved wooden haft',
    body: 'shown diagonally, head up', materials: ['iron', 'ash wood', 'leather wrap'], colors: { main: 'honey wood', secondary: 'dark iron', accent: 'red leather grip' },
    details: ['a bright worn edge', 'wood grain'], mood: 'sturdy, honest', extra: { category: 'tool', craft: 'Woodcarving' },
  },
  {
    id: 'item-tool-leatherwork', name: 'Skinning knife', kind: 'item', biome: 'any', references: ITEM_REFERENCES,
    silhouetteHook: 'a curved skinning knife with a broad crescent blade and an antler handle',
    body: 'shown diagonally, blade up', materials: ['steel', 'antler', 'sinew'], colors: { main: 'pale steel', secondary: 'cream antler', accent: 'brown sinew binding' },
    details: ['a sinew-wrapped join'], mood: 'practical, wild', extra: { category: 'tool', craft: 'Leatherwork' },
  },
  {
    id: 'item-tool-tailoring', name: 'Tailor\'s shears', kind: 'item', biome: 'any', references: ITEM_REFERENCES,
    silhouetteHook: 'a pair of long tailor\'s shears, slightly open, with looped handles',
    body: 'shown diagonally, points up', materials: ['brass', 'steel'], colors: { main: 'warm brass', secondary: 'steel blades', accent: 'a red thread tied to a handle' },
    details: ['a small rivet at the pivot'], mood: 'neat, careful', extra: { category: 'tool', craft: 'Tailoring' },
  },
  {
    id: 'item-tool-smithing', name: 'Miner\'s pick', kind: 'item', biome: 'any', references: ITEM_REFERENCES,
    silhouetteHook: 'a pickaxe with a long curved two-pointed iron head on a straight wooden handle',
    body: 'shown diagonally, head up', materials: ['iron', 'oak'], colors: { main: 'dark iron', secondary: 'oak brown', accent: 'copper bands' },
    details: ['copper bands where head meets handle'], mood: 'tough, hardworking', extra: { category: 'tool', craft: 'Smithing' },
  },
  {
    id: 'item-tool-fletching', name: 'Fletching knife', kind: 'item', biome: 'any', references: ITEM_REFERENCES,
    silhouetteHook: 'a slim straight fletching knife with a feather tucked against its wooden handle',
    body: 'shown diagonally, blade up', materials: ['steel', 'birch', 'feather'], colors: { main: 'pale birch', secondary: 'bright steel', accent: 'a white and grey feather' },
    details: ['a notch in the blade for trimming quills'], mood: 'light, precise', extra: { category: 'tool', craft: 'Fletching' },
  },
  {
    id: 'item-tool-herbalism', name: 'Herbalist\'s sickle', kind: 'item', biome: 'any', references: ITEM_REFERENCES,
    silhouetteHook: 'a small crescent sickle with a short wooden handle and a sprig of herbs hanging from it',
    body: 'shown diagonally, blade up', materials: ['bronze', 'wood', 'twine'], colors: { main: 'bronze', secondary: 'dark wood', accent: 'leaf green sprig' },
    details: ['twine around the handle'], mood: 'gentle, green', extra: { category: 'tool', craft: 'Herbalism' },
  },
  {
    id: 'item-tool-jewellery', name: 'Jeweller\'s pliers', kind: 'item', biome: 'any', references: ITEM_REFERENCES,
    silhouetteHook: 'a pair of small fine-nosed pliers holding a tiny pearl in their tips',
    body: 'shown diagonally, tips up', materials: ['silver steel', 'pearl'], colors: { main: 'silver', secondary: 'pearl white', accent: 'turquoise grip' },
    details: ['a tiny pearl in the tips'], mood: 'delicate, precious', extra: { category: 'tool', craft: 'Jewellery' },
  },
];
