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
