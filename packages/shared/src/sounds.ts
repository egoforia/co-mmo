import { BIOMES, type BiomeId } from './biomes.ts';

// Every sound in the game is made by an AI sound service from a description,
// the way pictures are painted from one: nothing is synthesized in code. The
// server makes whatever is missing when it starts (sound effects with the
// effects service, one looping track per land with the music service), and
// the Owner can make any of them again from God's View's Art tab.

/** A short sound the game plays when something happens. */
export interface SoundEffect {
  id: SoundId;
  /** What it is, in words, for God's View. */
  name: string;
  /** What the sound service is asked for. */
  prompt: string;
  /** How long it should be, in seconds. */
  seconds: number;
  /** How loud it plays, 0 to 1, so a soft footstep does not drown a fanfare. */
  volume: number;
}

export type SoundId =
  | 'swing'
  | 'hit'
  | 'hurt'
  | 'defeat'
  | 'spell'
  | 'pickup'
  | 'coin'
  | 'level-up'
  | 'favor'
  | 'wish-granted'
  | 'god-speaks'
  | 'talk'
  | 'notify';

/** Said before every effect, so they sound like one game. */
export const EFFECT_STYLE = 'Clean, close-miked sound effect for a cosy hand-painted fantasy role-playing game. One single sound, no music, no voices, no background noise.';

export const SOUND_EFFECTS: Record<SoundId, SoundEffect> = {
  swing: { id: 'swing', name: 'Swinging a weapon', seconds: 0.6, volume: 0.5, prompt: 'A quick light whoosh of a short sword swung through the air.' },
  hit: { id: 'hit', name: 'Striking a creature', seconds: 0.6, volume: 0.6, prompt: 'A soft cartoonish thump of a blow landing on a creature, with a small bright smack.' },
  hurt: { id: 'hurt', name: 'Being struck', seconds: 0.6, volume: 0.6, prompt: 'A dull padded impact of being hit, with a short low wobble.' },
  defeat: { id: 'defeat', name: 'A creature falls', seconds: 1.2, volume: 0.6, prompt: 'A creature vanishing in a puff: a soft pop followed by a sparkly fading shimmer.' },
  spell: { id: 'spell', name: 'Casting a spell', seconds: 1, volume: 0.55, prompt: 'A magical bolt cast from the hand: a rising crackle of energy and a swift airy zip.' },
  pickup: { id: 'pickup', name: 'Picking something up', seconds: 0.5, volume: 0.5, prompt: 'Picking up a small item into a leather satchel: a light rustle and a soft pluck.' },
  coin: { id: 'coin', name: 'Buying and selling', seconds: 0.6, volume: 0.5, prompt: 'A few gold coins clinking into a purse.' },
  'level-up': { id: 'level-up', name: 'Reaching a new level', seconds: 2, volume: 0.6, prompt: 'A short triumphant fantasy level-up jingle on harp and bells, rising and bright.' },
  favor: { id: 'favor', name: 'Gaining Favor', seconds: 1, volume: 0.45, prompt: 'A warm soft chime of holy light, a gentle shimmering glimmer.' },
  'wish-granted': { id: 'wish-granted', name: 'A wish comes true', seconds: 2.5, volume: 0.6, prompt: 'A wish being granted by a god: a swelling heavenly choir pad with sparkling glittering bells.' },
  'god-speaks': { id: 'god-speaks', name: 'The God answers', seconds: 1.2, volume: 0.45, prompt: 'A soft ethereal bell tone with a gentle airy shimmer, like a divine presence appearing.' },
  talk: { id: 'talk', name: 'Talking to someone', seconds: 0.4, volume: 0.4, prompt: 'A tiny friendly blip, like a dialogue box opening in a storybook game.' },
  notify: { id: 'notify', name: 'Someone wants you', seconds: 0.6, volume: 0.45, prompt: 'A small pleasant two-note wooden chime calling for attention.' },
};

/** Said before every land's track, so the music sounds like one game. */
export const MUSIC_STYLE = 'Instrumental background music for a gentle hand-painted fantasy role-playing game, in the spirit of 1990s Japanese RPG soundtracks: warm, melodic and storybook-like. No vocals, no lyrics. It loops as background music: a steady tempo and mood the whole way through, no intro, no big ending, no fade-out.';

/** Each land's own music, in words. */
export const MUSIC: Record<BiomeId, string> = {
  sanctum: 'A serene, reverent theme for a sunlit temple garden: soft harp arpeggios, a gentle wooden flute melody, a warm string pad, slow and peaceful.',
  'verdant-meadows': 'A breezy pastoral theme for rolling green hills: light acoustic guitar, a cheerful recorder melody, pizzicato strings, an easy walking pace.',
  'whispering-woods': 'A mysterious, gentle forest theme: plucked dulcimer, a breathy flute melody, soft marimba, distant chimes, a little magical and curious.',
  'mushroom-hollow': 'A whimsical, dreamy theme for a glowing mushroom village: celesta and music box, playful bassoon, soft bouncy pizzicato, slightly odd and charming.',
  'sunlit-shore': 'A sunny, relaxed seaside theme: steel-string guitar, a light accordion melody, gentle hand percussion, carefree and warm.',
  frostpeak: 'A cold, quiet mountain theme: glassy bells, slow felt piano, airy strings, a lonely flute, crisp and calm.',
  'ember-wastes': 'A tense, smouldering theme for a volcanic wasteland: low frame drums, a deep cello ostinato, a dark reedy duduk melody, brooding but not frightening.',
  'mirage-desert': 'A hot, shimmering desert theme: oud and plucked strings, a winding ney flute melody, soft frame drum, hazy and adventurous.',
  'murkmire-swamp': 'A murky, sleepy swamp theme: slow plucked banjo, low clarinet, soft muted percussion, a lazy and a little eerie mood.',
  'sky-ruins': 'A soaring, wistful theme for ruins floating among clouds: airy choir pad without words, harp, light strings, a lofty flute melody.',
};

/** Seconds of music made per land; it loops. */
export const MUSIC_SECONDS = 30;

/** The art id of a land's music. */
export function musicId(biome: BiomeId): string {
  return `music-${biome}`;
}

/** A land's music track in words, for God's View. */
export function musicName(biome: BiomeId): string {
  return `Music of ${BIOMES[biome].name}`;
}

/** Everything the server sends a sound service for an effect. */
export function effectPrompt(effect: SoundEffect): string {
  return `${EFFECT_STYLE} ${effect.prompt}`;
}

/** Everything the server sends the music service for a land. */
export function musicPrompt(biome: BiomeId): string {
  return `${MUSIC_STYLE}\n${MUSIC[biome]}`;
}

/** A made sound, as clients load it. */
export interface SoundEntry {
  /** Where the browser loads it from. */
  file: string;
  kind: 'effect' | 'music';
  /** Its length once finished, in seconds. */
  seconds: number;
  /** Set when the Owner had it made again. */
  redone?: number;
}

/** Every sound made so far, by id (a SoundId or a music id). */
export type SoundManifest = Record<string, SoundEntry>;
