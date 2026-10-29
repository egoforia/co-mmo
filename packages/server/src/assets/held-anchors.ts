import { familyArt, OFFHAND_FAMILIES, WEAPON_FAMILIES, type OffhandFamily, type WeaponFamily } from '@co-mmo/shared';
import type { KitAsset } from './kit.ts';

// One plain picture of each weapon and off-hand family (build plan step 10):
// what a wished weapon shows in the hand until its own picture is painted,
// and the first reference sent when it is, so a wished bow is a bow in the
// house style. Painted like any anchor (npm run anchors -- --only held-bow).

type Words = { hook: string; body: string; materials: string[]; colors: KitAsset['colors']; details?: string[] };

/** Held items are drawn alone, the grip at the lower left, so the hand finder can find where it is held. */
const ALONE = 'shown on its own with nothing holding it, lying diagonally with the grip at the lower left';

const WEAPONS: Record<WeaponFamily, Words> = {
  hammer: { hook: 'a stout war hammer with a blocky faceted stone head', body: `short wooden haft wrapped in leather, ${ALONE}`, materials: ['grey stone', 'oak', 'leather'], colors: { main: 'slate grey', secondary: 'warm oak', accent: 'brass bands' } },
  axe: { hook: 'a one-handed axe with a single crescent bronze blade', body: `short curved haft, ${ALONE}`, materials: ['bronze', 'ash wood', 'twine'], colors: { main: 'bronze', secondary: 'pale ash wood', accent: 'leaf green twine' } },
  spear: { hook: 'a long spear with a leaf-shaped steel head and a tuft below it', body: `long straight shaft, ${ALONE}`, materials: ['steel', 'ash wood', 'cloth'], colors: { main: 'pale ash wood', secondary: 'steel grey', accent: 'rose red tuft' } },
  sword: { hook: 'a plain straight sword with a simple cross guard', body: `one-handed blade about an arm long, ${ALONE}`, materials: ['steel', 'leather', 'brass'], colors: { main: 'steel grey', secondary: 'brown leather grip', accent: 'brass pommel' } },
  'twin-blades': { hook: 'one short curved fighting knife, the kind carried as a matched pair', body: `short single blade with a wrapped grip, ${ALONE}`, materials: ['steel', 'cord'], colors: { main: 'steel grey', secondary: 'dark plum cord', accent: 'amber bead' } },
  greatsword: { hook: 'a huge two-handed sword with a long grip and a wide cross guard', body: `broad blade nearly as tall as a person, ${ALONE}`, materials: ['steel', 'leather', 'iron'], colors: { main: 'steel grey', secondary: 'dark leather', accent: 'gold inlay' } },
  bow: { hook: 'a recurved wooden bow with a taut string', body: 'bow lying diagonally from the lower left to the upper right, its leather-wrapped grip in the middle', materials: ['yew wood', 'string', 'leather'], colors: { main: 'honey yew wood', secondary: 'cream string', accent: 'falcon yellow grip wrap' } },
  sling: { hook: 'a leather sling with a cupped pouch holding one round stone', body: `two long cords hanging from a looped handle, ${ALONE}`, materials: ['leather', 'cord', 'stone'], colors: { main: 'tan leather', secondary: 'cream cord', accent: 'river stone grey' } },
  javelins: { hook: 'a bundle of three short throwing javelins tied together near the grip', body: `short light shafts with narrow points, ${ALONE}`, materials: ['ash wood', 'steel', 'twine'], colors: { main: 'pale ash wood', secondary: 'steel grey', accent: 'ochre feather' } },
  staff: { hook: 'a tall wooden staff whose top curls around a softly glowing crystal', body: `long gnarled staff, ${ALONE}`, materials: ['willow wood', 'crystal'], colors: { main: 'willow brown', secondary: 'sage green', accent: 'pale violet glow' } },
  wand: { hook: 'a short slender wand with a small glowing tip', body: `straight wand about a forearm long, ${ALONE}`, materials: ['dark wood', 'silver'], colors: { main: 'dark cherry wood', secondary: 'silver ferrule', accent: 'pale blue glow' } },
  'bell-mace': { hook: 'a mace whose head is a heavy bronze bell with ridges', body: `short haft with the bell at the top, ${ALONE}`, materials: ['bronze', 'oak', 'leather'], colors: { main: 'warm bronze', secondary: 'dark oak', accent: 'cream ribbon' } },
  censer: { hook: 'a round pierced brass censer swinging on a chain, wisps of pale smoke curling out', body: `censer hanging from a short chain and ring, the ring at the lower left`, materials: ['brass', 'chain', 'incense smoke'], colors: { main: 'brass', secondary: 'soft grey smoke', accent: 'ember orange glow' } },
  'hand-bell': { hook: 'a small silver hand bell with a turned wooden handle', body: `bell with its mouth down, handle above, ${ALONE}`, materials: ['silver', 'wood'], colors: { main: 'bright silver', secondary: 'honey wood', accent: 'rose ribbon' } },
};

const OFFHANDS: Record<OffhandFamily, Words> = {
  shield: { hook: 'a round wooden shield with an iron rim and a bronze boss', body: 'round shield seen from the front at a slight angle, its strap behind', materials: ['oak planks', 'iron', 'bronze'], colors: { main: 'warm oak', secondary: 'iron grey rim', accent: 'bronze boss' } },
  tome: { hook: 'a thick spell book with a clasp and a glowing sigil on the cover', body: 'closed book held by its spine, seen at three-quarter view', materials: ['leather', 'brass', 'parchment'], colors: { main: 'deep teal leather', secondary: 'cream pages', accent: 'gold sigil glow' } },
  orb: { hook: 'a clear glass orb with swirling light inside, on a small claw cradle', body: 'orb resting in a short metal cradle with a grip below', materials: ['glass', 'silver'], colors: { main: 'pale lilac glass', secondary: 'silver', accent: 'soft white swirl' } },
  lantern: { hook: 'a hooded travelling lantern with a warm flame behind amber glass', body: 'lantern hanging from a carrying ring on top', materials: ['iron', 'amber glass'], colors: { main: 'dark iron', secondary: 'amber glass', accent: 'warm flame glow' } },
};

function held(family: WeaponFamily | OffhandFamily, name: string, w: Words, category: string, references: string[]): KitAsset {
  return {
    id: familyArt(family), name, kind: 'item', biome: 'any', references,
    silhouetteHook: w.hook, body: w.body, materials: w.materials, colors: w.colors,
    details: ['plain and well made, with no owner\'s marks', ...(w.details ?? [])], mood: 'sturdy, ready', extra: { category },
  };
}

/** A picture for each weapon and off-hand family, in the order classes.md lists them. */
export const HELD_ANCHORS: KitAsset[] = [
  ...(Object.keys(WEAPONS) as WeaponFamily[]).map((f) => held(f, WEAPON_FAMILIES[f].name, WEAPONS[f], 'weapon', ['item-wooden-sword', 'item-crab-lance'])),
  ...(Object.keys(OFFHANDS) as OffhandFamily[]).map((f) => held(f, OFFHAND_FAMILIES[f].name, OFFHANDS[f], 'off-hand', ['item-tonic', 'item-temple-lantern'])),
];
