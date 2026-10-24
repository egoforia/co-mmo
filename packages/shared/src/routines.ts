import type { DayPart } from './sky.ts';

// The people of each land keep a day: at work by day, gathering where
// travellers arrive at dusk, asleep at night. Some keep their own hours. A
// routine is data, so a wished person gets the usual day and a land's own
// people can be given theirs here.

/** Where someone spends part of their day: their own spot, or the square where travellers arrive. */
export type RoutinePlace = 'work' | 'square';

export interface RoutineStep {
  place: RoutinePlace;
  /** Asleep there: they wake when spoken to, then talk and trade as usual. */
  sleep?: boolean;
  /** Said first when someone talks to them at this time. */
  words?: string;
}

export type Routine = Record<DayPart, RoutineStep>;

/** Everyone's day unless their own says otherwise. */
export const DEFAULT_ROUTINE: Routine = {
  dawn: { place: 'work' },
  day: { place: 'work' },
  dusk: { place: 'square' },
  night: { place: 'work', sleep: true },
};

/** The land's own people and the hours they keep. */
export const NPC_ROUTINES: Record<string, Partial<Routine>> = {
  'sister-amala': {
    dusk: { place: 'work', words: 'Sister Amala is lighting the lamps around the shrine.' },
    night: { place: 'work', words: 'Sister Amala looks up from her night vigil.' },
  },
  'old-bramble': {
    day: { place: 'square', words: 'Old Bramble is out gathering herbs.' },
    dusk: { place: 'work' },
  },
  'cactus-elder': {
    night: { place: 'work', words: 'The Cactus Elder is watching the stars.' },
  },
  'high-priest-cassian': {
    dawn: { place: 'work', words: 'High Priest Cassian is offering the morning prayers for the city.' },
    day: { place: 'work', words: 'High Priest Cassian traces a blessing over you: "May the divine bell shield you from harm."' },
    dusk: { place: 'square', words: 'High Priest Cassian walks the plaza, sprinkling holy water upon travelers.' },
    night: { place: 'work', words: 'High Priest Cassian stands before the crypt gate in anxious vigil.' },
  },
  'brother-paul': {
    dawn: { place: 'work', words: 'Brother Paul is grinding fresh ink for the holy scrolls.' },
    day: { place: 'work', words: 'Brother Paul looks up from his parchment: "Knowledge of the heavens is our greatest fortress."' },
    dusk: { place: 'square', words: 'Brother Paul stretches his arms and takes in the evening air in the square.' },
    night: { place: 'work', sleep: true, words: 'Brother Paul nods off over an illuminated manuscript.' },
  },
  'mother-elena': {
    dawn: { place: 'work', words: 'Mother Elena is baking warm loaves and stoking the tavern hearth.' },
    day: { place: 'work', words: 'Mother Elena welcomes you warmly: "Rest your feet, traveller! A bowl of stew will do you good."' },
    dusk: { place: 'work', words: 'Mother Elena pours foaming mugs for the weary pilgrims.' },
    night: { place: 'work', words: 'Mother Elena whispers nervously: "Did you hear that low groan? It sounded like it came from beneath the cellar stones..."' },
  },
  'gravedigger-joshua': {
    dawn: { place: 'work', words: 'Joshua leans on his spade, examining the morning mist over the headstones.' },
    day: { place: 'work', words: 'Joshua shakes his head: "The ground feels uneasy these days... the roots are turning black."' },
    dusk: { place: 'square', words: 'Joshua joins the gathering in the square, eager for company away from the graveyard.' },
    night: { place: 'work', words: 'Joshua clutches a lantern with trembling hands, watching the sealed mausoleum door.' },
  },
};

/** What someone does in each part of the day. */
export function routineOf(npc: string): Routine {
  return { ...DEFAULT_ROUTINE, ...NPC_ROUTINES[npc] };
}

/** The first thing said when someone talks to this person now, if anything. */
export function routineWords(name: string, step: RoutineStep, asleep: boolean): string | undefined {
  if (asleep) return step.words ?? `${name} wakes with a start and blinks at you.`;
  return step.words;
}
