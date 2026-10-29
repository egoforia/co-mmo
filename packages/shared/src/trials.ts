// The five Path trials (docs/classes.md, Mentors; docs/classes/*.md, Trial):
// at level 10 a Calling's Sanctum mentor sends the player to its old home,
// and the trial is handed in to the Path mentor there, who lets them choose
// a Path (rpg/paths.ts). Added to QUESTS when the game loads, like lands.ts.

import { CALLINGS, type CallingId } from './classes.ts';
import { PATH_LEVEL, PATH_MENTORS, SANCTUM_MENTORS, TRIAL_QUESTS, pathCost, trialPassed } from './rpg/paths.ts';
import { ABILITIES, QUESTS, type Character, type QuestDef } from './rpg.ts';

/** A trial's quest, given by `mentor` in the Sanctum to the Calling's players from level 10. */
function trial(calling: CallingId, def: Omit<QuestDef, 'giver' | 'turnIn' | 'calling' | 'minLevel'>): QuestDef {
  const turnIn = PATH_MENTORS[calling];
  return { ...def, giver: SANCTUM_MENTORS[calling], ...(turnIn !== SANCTUM_MENTORS[calling] ? { turnIn } : {}), calling, minLevel: PATH_LEVEL };
}

/** The five trial quests, by quest id. */
export const TRIAL_QUEST_DEFS: Record<string, QuestDef> = {
  [TRIAL_QUESTS.warden]: trial('warden', {
    title: 'The Gate Holds',
    offer: 'You stand like a Warden now. Every Warden\'s road ends at Mossgate, where Sir Alder still keeps the gate. The bark golems have forgotten whom they serve: hold the gate against five of them, then tell Sir Alder it held.',
    waiting: 'The bark golems crowd Mossgate\'s broken gate, in the Whispering Woods. Five of them, then go to Sir Alder.',
    thanks: 'The gate held. For the first time in an age a Warden stood in it, and I was not alone. Now choose how you will keep it: as the oak that does not fall, or the fist that hits back.',
    goal: { kind: 'defeat', creature: 'bark-golem', count: 5 },
    reward: { xp: 150, gold: 30 },
  }),
  [TRIAL_QUESTS.duelist]: trial('duelist', {
    title: 'Sun and Sand',
    offer: 'Your feet have learned the rhythm. Sultana Zahra keeps the Duelists\' old dancing-floor in the Mirage Palace. The Sun King\'s guards still walk his sands at night: lay four of them to rest, then go and dance for her.',
    waiting: 'The mummy guards walk by night, by the tomb and the great pyramid in the Mirage Desert. Four of them, then go to Sultana Zahra.',
    thanks: 'Four of the King\'s guards at rest, and you still standing. That is timing, and the Sun King never had any. Now tell me: will you be the noon sun, or the storm no one can catch?',
    goal: { kind: 'defeat', creature: 'mummy-guard', count: 4 },
    reward: { xp: 150, gold: 30 },
  }),
  [TRIAL_QUESTS.ranger]: trial('ranger', {
    title: 'The Last Tower',
    offer: 'The old watchtowers stand empty, and the Windkeeper waits for the Sky Ruins to wake. Until then I will judge you. Keep watch over the Sanctum through the night. When the lantern moths come out of the dark, catch three of them, and bring me what you saw.',
    waiting: 'Watch after dark, when the lantern moths glow. Three of them, then come back to me.',
    thanks: 'You watched, and you saw. That is how the Hush ends. Now choose: the one shot that matters, or the hunter with a friend.',
    goal: { kind: 'defeat', creature: 'lantern-moth', count: 3 },
    reward: { xp: 150, gold: 30 },
  }),
  [TRIAL_QUESTS.wishweaver]: trial('wishweaver', {
    title: 'Threads in the Tide',
    offer: 'You pull the threads well enough to be tested. Wishstuff soaks into what the Sunlit Shore holds: a pearl steeped in tide, a gull feather that rode the gale, a crab shell warm as an ember. Bring one of each to Queen Nerissa and weave them before her.',
    waiting: 'A pearl, a gull feather and a crab shell, all from the Sunlit Shore. Then go to Queen Nerissa in her coral halls.',
    thanks: 'Ember, tide and gale, woven in my own hall. The threads are coming back, and so are the Wishweavers. Now choose: call the storm in full, or bind the threads and rewrite the fight.',
    goal: { kind: 'gather', items: [{ item: 'pearl', qty: 1 }, { item: 'gull-feather', qty: 1 }, { item: 'crab-shell', qty: 1 }] },
    reward: { xp: 150, gold: 30 },
  }),
  [TRIAL_QUESTS.bellkeeper]: trial('bellkeeper', {
    title: 'The Silent Bell',
    offer: 'Your bells carry now. Take this cracked bell down to the crypts below the High Cathedral, where the Hush lies thickest, and ring it for the dead who cannot rest: lay four of them to rest. Then bring it home to Brother Tolle at the temple.',
    waiting: 'The restless dead walk the crypts below the High Cathedral. Four of them, then go to Brother Tolle.',
    thanks: 'I heard it ring all the way from the crypts, cracked as it is. Now choose: the dawn bell that keeps everyone standing, or the dirge bell that rings for the end.',
    goal: { kind: 'defeat', creature: 'crypt-skeleton', count: 4 },
    reward: { xp: 150, gold: 30 },
  }),
};

Object.assign(QUESTS, TRIAL_QUEST_DEFS);

/** One Path a mentor offers, as the dialogue window shows it. */
export interface PathChoice {
  id: string;
  name: string;
  blurb: string;
  /** The skill it brings at once, by name. */
  skill: string;
  /** Gold it costs: nothing the first time, more to change. */
  cost: number;
}

/**
 * The Paths an NPC offers this character: their own Calling's Path mentor,
 * once the trial is passed and they are level 10. The Path they walk already
 * is left out. None for anyone else.
 */
export function pathChoices(c: Character, npc: string): PathChoice[] | undefined {
  if (!c.calling || PATH_MENTORS[c.calling] !== npc || c.level < PATH_LEVEL || !trialPassed(c)) return undefined;
  return CALLINGS[c.calling].paths
    .filter((p) => p.id !== c.path)
    .map((p) => ({ id: p.id, name: p.name, blurb: p.blurb, skill: ABILITIES[p.skills[0]!.skill]?.name ?? p.skills[0]!.skill, cost: pathCost(c, p.id) }));
}

/** The Calling whose Path mentor this NPC is, if any. */
export function mentorOf(npc: string): CallingId | undefined {
  return (Object.keys(PATH_MENTORS) as CallingId[]).find((c) => PATH_MENTORS[c] === npc);
}
