import { HALLOWED_ART, MARK_ART, ECHO_ART, BELL_ART, SAND_DOUBLE_ART, SPIRIT_HAWK_ART, STATUSES, THREAD_ART, TRAP_ART, statusArt, type CreatureSizeTier, type StatusId } from '@co-mmo/shared';
import type { KitAsset } from './kit.ts';

// What skills show (build plan step 10): a burst for each Wishweaver thread
// and the Bellkeeper's bell, what skills leave in the world, an icon per
// status, and the two creatures skills bring. Painted like any anchor
// (npm run anchors -- --only fx-ember); until one is, the game shows
// nothing in its place, and a status shows its name.

/** An anchor that walks or flies beside players, fitted to its height tier (docs/art-pipeline.md). */
export type TieredAsset = KitAsset & { tier?: CreatureSizeTier };

type Words = Pick<KitAsset, 'silhouetteHook' | 'body' | 'colors' | 'mood'>;

function effect(id: string, name: string, w: Words): KitAsset {
  return { id, name, kind: 'effect', biome: 'any', references: ['fx-slash', 'item-firebolt'], ...w };
}

const EFFECTS: KitAsset[] = [
  effect(THREAD_ART.ember, 'Ember burst', { silhouetteHook: 'a small round burst of warm flame petals opening outwards', body: 'a flat flower-like splash of fire with a few embers flying off, nothing else', colors: { main: 'amber orange', secondary: 'pale gold core', accent: 'rose sparks' }, mood: 'fierce, bright' }),
  effect(THREAD_ART.tide, 'Tide burst', { silhouetteHook: 'a small round splash of water curling up into a wave crest', body: 'a crown of water droplets and one curling wave, nothing else', colors: { main: 'sea teal', secondary: 'pale aqua', accent: 'white foam flecks' }, mood: 'cool, flowing' }),
  effect(THREAD_ART.gale, 'Gale burst', { silhouetteHook: 'three curved gusts of wind swirling into a small spiral', body: 'pale swirling wind ribbons with a few leaves caught in them, nothing else', colors: { main: 'pale sage', secondary: 'cream', accent: 'soft sky blue' }, mood: 'quick, airy' }),
  effect(BELL_ART, 'Bell ring', { silhouetteHook: 'a small bronze bell shape ringed by two round sound rings', body: 'a ghostly bell outline with circles of sound rippling out from it, nothing else', colors: { main: 'warm bronze', secondary: 'pale gold rings', accent: 'cream' }, mood: 'clear, ringing' }),
  effect(ECHO_ART, 'Echo', { silhouetteHook: 'one faint ring of pale gold light with a tiny bell glyph floating in its middle', body: 'a thin hovering halo, mostly empty in the middle, nothing else', colors: { main: 'pale gold', secondary: 'cream', accent: 'soft rose' }, mood: 'gentle, waiting' }),
  effect(TRAP_ART, 'Trap', { silhouetteHook: 'a ring of sharpened stakes and a coiled snare lying flat on the ground', body: 'low flat trap seen from above at an angle, as wide as a tile', colors: { main: 'weathered wood', secondary: 'iron grey', accent: 'ochre rope' }, mood: 'hidden, ready' }),
  effect(MARK_ART, 'Hunter\'s mark', { silhouetteHook: 'a small hovering diamond-shaped hunting sigil with a feather at its tip', body: 'a flat sigil that floats above a head, nothing else', colors: { main: 'falcon yellow', secondary: 'rust red', accent: 'cream feather' }, mood: 'keen, warning' }),
  effect(HALLOWED_ART, 'Hallowed ground', { silhouetteHook: 'a flat round circle of pale light on the ground with bell glyphs around its rim', body: 'a ring lying flat on the ground seen from above at an angle, about three tiles across, mostly empty inside', colors: { main: 'pale gold', secondary: 'cream', accent: 'soft rose' }, mood: 'holy, safe' }),
];

/** What each status icon shows: one simple symbol on a small round badge. */
const STATUS_SYMBOLS: Record<StatusId, { symbol: string; color: string }> = {
  slowed: { symbol: 'a snail shell', color: 'dusty blue' },
  rooted: { symbol: 'roots gripping a foot', color: 'moss green' },
  stunned: { symbol: 'three small stars circling', color: 'pale gold' },
  silenced: { symbol: 'a closed mouth with a ribbon tied across it', color: 'lavender grey' },
  burning: { symbol: 'a single flame', color: 'amber orange' },
  bleeding: { symbol: 'one falling drop', color: 'deep rose red' },
  poisoned: { symbol: 'a bubbling drop', color: 'sickly green' },
  marked: { symbol: 'a diamond hunting sigil', color: 'falcon yellow' },
  taunted: { symbol: 'a pointing angry eye', color: 'rust red' },
  shielded: { symbol: 'a round shield', color: 'sky blue' },
  guarded: { symbol: 'a raised wall of stone blocks', color: 'slate grey' },
  evasive: { symbol: 'a swift curved feather', color: 'pale sage' },
  poised: { symbol: 'a crossed pair of blades held ready', color: 'steel grey' },
  hallowed: { symbol: 'a small bell inside a halo', color: 'pale gold' },
  hidden: { symbol: 'a half-closed eye behind a veil', color: 'dusk violet' },
  unyielding: { symbol: 'a fist clenched around an oak leaf', color: 'warm oak' },
  graced: { symbol: 'a bell with a heart beneath it', color: 'soft rose' },
  knelled: { symbol: 'a cracked bell', color: 'charcoal grey' },
  weakened: { symbol: 'a drooping broken sword', color: 'faded grey' },
};

const ICONS: KitAsset[] = (Object.keys(STATUS_SYMBOLS) as StatusId[]).map((id) => {
  const { symbol, color } = STATUS_SYMBOLS[id];
  return {
    id: statusArt(id), name: `${STATUSES[id].name} icon`, kind: 'effect', biome: 'any', references: ['item-scarab-charm', 'item-tonic'],
    silhouetteHook: `${symbol} on a small round flat badge`, body: 'a simple icon, one symbol, readable when tiny, seen straight on',
    colors: { main: color, secondary: STATUSES[id].harmful ? 'dark plum rim' : 'cream rim', accent: 'brass' },
    mood: STATUSES[id].harmful ? 'warning' : 'reassuring',
  };
});

const CREATURES: TieredAsset[] = [
  {
    id: SPIRIT_HAWK_ART, name: 'Spirit hawk', kind: 'monster', biome: 'any', tier: 'small', references: ['zephyr-falcon', 'woods-mushroom'],
    silhouetteHook: 'a hawk of pale glowing spirit light with wide swept-back wings, mid-flight',
    body: 'a small hawk with a hooked beak and fanned tail, its edges fading into soft light',
    materials: ['spirit light', 'feathers'], colors: { main: 'pale sky blue', secondary: 'cream', accent: 'falcon yellow eyes' },
    details: ['a few loose glowing feathers'], mood: 'loyal, fierce', extra: { threat: 'friendly companion', movement: 'glides beside its friend' },
  },
  {
    id: SAND_DOUBLE_ART, name: 'Sandstorm double', kind: 'monster', biome: 'any', tier: 'medium', references: ['dune-scorpid', 'desert-scarab'],
    silhouetteHook: 'a beastfolk duelist made entirely of swirling sand, frozen mid-stance with a blade raised',
    body: 'a person-sized figure of packed sand with grains streaming off its edges, standing upright',
    materials: ['sand'], colors: { main: 'apricot sand', secondary: 'ochre', accent: 'pale gold glints' },
    details: ['sand trailing from its shoulders', 'no face, only a smooth sand mask'], mood: 'eerie, decoy', extra: { threat: 'harmless decoy', movement: 'stands still, then crumbles' },
  },
];

/** Every picture skills show: effects, status icons, and the spirit hawk and Sandstorm double. */
export const SKILL_ANCHORS: TieredAsset[] = [...EFFECTS, ...ICONS, ...CREATURES];
