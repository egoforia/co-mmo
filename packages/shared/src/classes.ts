// The five Callings (docs/classes.md and docs/classes/*.md): a Wishbearer's
// class. Each has two neighbouring attributes on the pentagon, three trained
// weapon families, a signature gauge, five core skills and two Paths. Plain
// data; skills are ability ids that arrive in ABILITIES with the skills step
// (docs/callings-build-plan.md, step 7); weapon families are in weapons.ts.

import type { Stats } from './rpg.ts';
import type { OffhandFamily, WeaponFamily } from './weapons.ts';

export type CallingId = 'warden' | 'duelist' | 'ranger' | 'wishweaver' | 'bellkeeper';

/** A Path chosen at level 10 after the Calling's trial: a skill at 10, a passive at 15, a great skill at 20. */
export interface PathDef {
  id: string;
  name: string;
  /** Its one-line idea. */
  blurb: string;
  skills: { level: 10 | 15 | 20; skill: string }[];
}

export interface CallingDef {
  id: CallingId;
  name: string;
  /** Raised most: +3 at creation and +1 each level. */
  primary: keyof Stats;
  /** Its neighbour on the pentagon: +2 at creation and +1 each level. */
  secondary: keyof Stats;
  role: string;
  /** One line for the creation screen. */
  blurb: string;
  /** Weapon families it is trained in (weapons.ts). */
  weapons: WeaponFamily[];
  /** Off-hand families it is trained in. */
  offhands: OffhandFamily[];
  gauge: { id: string; name: string };
  /** Learned automatically at levels 1, 2, 4, 6 and 8. */
  core: { level: number; skill: string }[];
  paths: [PathDef, PathDef];
  /** Who teaches it in the Sanctum, and who waits at the end of its trial. */
  mentor: string;
  pathMentor: string;
}

/** Points a Calling adds at creation (docs/attributes.md, How attributes grow). */
export const CALLING_PRIMARY_START = 3;
export const CALLING_SECONDARY_START = 2;

export const CALLINGS: Record<CallingId, CallingDef> = {
  warden: {
    id: 'warden', name: 'Warden', primary: 'vigor', secondary: 'might', role: 'Tank',
    blurb: 'Stands in front, keeps creatures on themself and the party safe.',
    weapons: ['hammer', 'axe', 'spear'], offhands: ['shield'],
    gauge: { id: 'resolve', name: 'Resolve' },
    core: [
      { level: 1, skill: 'shield-bash' }, { level: 2, skill: 'challenge' }, { level: 4, skill: 'bulwark' },
      { level: 6, skill: 'earthbreak' }, { level: 8, skill: 'hold-the-line' },
    ],
    paths: [
      { id: 'oakheart', name: 'Oakheart', blurb: 'The one who does not fall.',
        skills: [{ level: 10, skill: 'rooted-stand' }, { level: 15, skill: 'barkskin' }, { level: 20, skill: 'last-knight' }] },
      { id: 'stonefist', name: 'Stonefist', blurb: 'The one who hits back.',
        skills: [{ level: 10, skill: 'quake-leap' }, { level: 15, skill: 'retaliate' }, { level: 20, skill: 'mountainfall' }] },
    ],
    mentor: 'Bramble Ursine', pathMentor: 'Sir Alder',
  },
  duelist: {
    id: 'duelist', name: 'Duelist', primary: 'might', secondary: 'agility', role: 'Melee damage',
    blurb: 'Dashes in, builds Momentum and spends it on big finishers.',
    weapons: ['sword', 'twin-blades', 'greatsword'], offhands: [],
    gauge: { id: 'momentum', name: 'Momentum' },
    core: [
      { level: 1, skill: 'lunge' }, { level: 2, skill: 'riposte' }, { level: 4, skill: 'whirl' },
      { level: 6, skill: 'rend' }, { level: 8, skill: 'sidestep' },
    ],
    paths: [
      { id: 'sunblade', name: 'Sunblade', blurb: 'The burst of the noon sun.',
        skills: [{ level: 10, skill: 'execute' }, { level: 15, skill: 'blazing-edge' }, { level: 20, skill: 'sunfall-dance' }] },
      { id: 'sandstorm', name: 'Sandstorm', blurb: 'The blade you cannot catch.',
        skills: [{ level: 10, skill: 'mirage' }, { level: 15, skill: 'thirsting-blade' }, { level: 20, skill: 'dune-tempest' }] },
    ],
    mentor: 'Dune Scorpid', pathMentor: 'Sultana Zahra',
  },
  ranger: {
    id: 'ranger', name: 'Ranger', primary: 'agility', secondary: 'wit', role: 'Ranged damage',
    blurb: 'Holds still to build Focus, then strikes from afar, with traps and a spirit hawk.',
    weapons: ['bow', 'sling', 'javelins'], offhands: [],
    gauge: { id: 'focus', name: 'Focus' },
    core: [
      { level: 1, skill: 'aimed-shot' }, { level: 2, skill: 'tumble' }, { level: 4, skill: 'snare-trap' },
      { level: 6, skill: 'volley' }, { level: 8, skill: 'hawk-mark' },
    ],
    paths: [
      { id: 'windeye', name: 'Windeye', blurb: 'The one shot that matters.',
        skills: [{ level: 10, skill: 'piercing-arrow' }, { level: 15, skill: 'steady-breath' }, { level: 20, skill: 'skyfall-arrow' }] },
      { id: 'wildkin', name: 'Wildkin', blurb: 'The hunter with a friend.',
        skills: [{ level: 10, skill: 'call-companion' }, { level: 15, skill: 'pack-instinct' }, { level: 20, skill: 'stampede' }] },
    ],
    mentor: 'Zephyr Falcon', pathMentor: 'The Windkeeper',
  },
  wishweaver: {
    id: 'wishweaver', name: 'Wishweaver', primary: 'wit', secondary: 'spirit', role: 'Caster and control',
    blurb: 'Weaves three threads of wishstuff, Ember, Tide and Gale, into doubled spells.',
    weapons: ['staff', 'wand'], offhands: ['tome', 'orb'],
    gauge: { id: 'weave', name: 'Weave' },
    core: [
      { level: 1, skill: 'ember-bolt' }, { level: 2, skill: 'tide-lash' }, { level: 4, skill: 'gale-step' },
      { level: 6, skill: 'chain-spark' }, { level: 8, skill: 'wish-ward' },
    ],
    paths: [
      { id: 'stormcaller', name: 'Stormcaller', blurb: 'The storm in full.',
        skills: [{ level: 10, skill: 'firestorm' }, { level: 15, skill: 'overflow' }, { level: 20, skill: 'starfall' }] },
      { id: 'threadbinder', name: 'Threadbinder', blurb: 'The one who rewrites the fight.',
        skills: [{ level: 10, skill: 'unravel' }, { level: 15, skill: 'loose-ends' }, { level: 20, skill: 'rewrite' }] },
    ],
    mentor: 'Tide Lutran', pathMentor: 'Queen Nerissa',
  },
  bellkeeper: {
    id: 'bellkeeper', name: 'Bellkeeper', primary: 'spirit', secondary: 'vigor', role: 'Healer and support',
    blurb: 'Rings heals that echo, raises the fallen, and tolls doom on creatures.',
    weapons: ['bell-mace', 'censer', 'hand-bell'], offhands: ['lantern', 'shield'],
    gauge: { id: 'echo', name: 'Echo' },
    core: [
      { level: 1, skill: 'mend' }, { level: 2, skill: 'chime' }, { level: 4, skill: 'toll' },
      { level: 6, skill: 'sanctuary' }, { level: 8, skill: 'peal-of-waking' },
    ],
    paths: [
      { id: 'dawnbell', name: 'Dawnbell', blurb: 'The one who keeps everyone standing.',
        skills: [{ level: 10, skill: 'grace' }, { level: 15, skill: 'overtone' }, { level: 20, skill: 'great-bell-of-waking' }] },
      { id: 'dirgebell', name: 'Dirgebell', blurb: 'The one who rings for the end.',
        skills: [{ level: 10, skill: 'knell' }, { level: 15, skill: 'iron-psalm' }, { level: 20, skill: 'final-knell' }] },
    ],
    mentor: 'Sylvan Cervid', pathMentor: 'Brother Tolle',
  },
};

/** The Callings in the order the creation screen shows them (round the pentagon). */
export const CALLING_IDS: readonly CallingId[] = ['warden', 'duelist', 'ranger', 'wishweaver', 'bellkeeper'];

/** Whether a value names one of the Callings. */
export function isCalling(v: unknown): v is CallingId {
  return typeof v === 'string' && Object.hasOwn(CALLINGS, v);
}

/** The Calling's Path with this id, if it has one. */
export function pathOf(calling: CallingId, path: string | undefined): PathDef | undefined {
  return CALLINGS[calling].paths.find((p) => p.id === path);
}
