import type { ProviderId } from './ai/chat.ts';

// The Owner's settings as saved with the world (God's View: AI models,
// Budget, Workshop and Builds tabs): their shape, their defaults, and readers
// that fill in what older saves lack. The store keeps them; this module says
// what they mean, so a new setting never touches the saved-world code.

export interface ModelChoice {
  provider: ProviderId;
  model: string;
}

export interface ImageChoice {
  provider: 'gemini' | 'none' | string;
  model: string;
  uses?: Partial<Record<ArtUse, string>>;
}

export interface VideoChoice {
  provider: 'gemini' | 'none' | string;
  model: string;
  dailyClips?: number;
}

export interface Settings {
  ai: {
    /** The in-character God conversation, which also compiles wishes. */
    god: ModelChoice;
    /** Used when the God model is down, over budget or refuses (e.g. mature requests). */
    fallback: ModelChoice | null;
    /** Drafts scripted rules for Major wishes; null uses the God's model. */
    compiler?: ModelChoice | null;
    /** Paints wished things; 'none' keeps tinted placeholders. `uses` picks another model for some kinds of art. */
    image: ImageChoice;
    /** Makes animation clips (missing in older saves: default video provider whenever images come from Gemini). */
    video?: VideoChoice;
    /** Makes sound effects and music (missing in older saves: see soundSettings). */
    sound?: SoundSettings;
    /** Checks painted pictures and looks for one to reuse (missing in older saves: see styleCheckSettings). */
    styleCheck?: StyleCheckSettings;
  };
  budget: {
    /** Monthly ceiling; above it wishes still work, with placeholder art. */
    monthlyUsd: number;
    /** God's View warns from here. */
    warnUsd: number;
    /** Painting and sound stop for the day (UTC) once this much is spent, and pick up the next day (missing in older saves). */
    dailyUsd?: number;
  };
  /** Building Engine wishes as code changes (missing in older saves). */
  builds?: BuildSettings;
  /** The Wish Workshop (missing in older saves). */
  workshop?: WorkshopSettings;
}

/** The daily spending cap unless the Owner sets one: a busy day's painting, well under the month. */
export const DEFAULT_DAILY_USD = 10;

/**
 * Kinds of art that can each have their own image model (design doc, asset
 * tiers): a dearer model where it shows most, a cheap one elsewhere.
 */
export type ArtUse = 'wishes' | 'buildings' | 'scenery' | 'walks';
export const ART_USES: ArtUse[] = ['wishes', 'buildings', 'scenery', 'walks'];

/** The video model in use: the saved choice, or the default video provider when the Gemini key is set. */
export function videoSettings(settings: Settings, env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): { provider: string; model: string; dailyClips?: number } {
  return settings.ai.video ?? (env.GEMINI_API_KEY ? { provider: 'gemini', model: 'veo-3.1-lite-generate-preview' } : { provider: 'none', model: '' });
}

/**
 * Daily video clips limit unless the Owner sets another number. Providers enforce
 * daily rate and quota limits, so the game counts its own and stops first.
 */
export const DEFAULT_DAILY_CLIPS = 7;

/** How many clips the video model may make a day, as set on the AI models tab. */
export function dailyClips(settings: Settings): number {
  return settings.ai.video?.dailyClips ?? DEFAULT_DAILY_CLIPS;
}

/** The style check and reuse (design doc, Art style, step 5; Keeping costs down). */
export interface StyleCheckSettings {
  /** The vision model that judges pictures and confirms reuse; null uses the God's, 'offline' runs the free checks only. */
  judge: ModelChoice | null;
  /** How many times a picture that fails is painted again (0 to 2). */
  retries: number;
  /** Whether a new wish may show an existing picture that fits instead of painting one. */
  reuse: boolean;
}

/** The style check as saved, or on with the God's model, two retries and reuse. */
export function styleCheckSettings(settings: Settings): StyleCheckSettings {
  return settings.ai.styleCheck ?? { judge: null, retries: 2, reuse: true };
}

export interface SoundSettings {
  /** Short sound effects; 'none' plays the game without them. */
  effects: { provider: 'elevenlabs' | 'none'; model: string };
  /** One looping track per land; 'none' plays the game without music. */
  music: { provider: 'gemini' | 'none'; model: string };
}

/** The sound services in use: the saved choice, or whatever the server's keys allow. */
export function soundSettings(settings: Settings, env: Record<string, string | undefined> = process.env): SoundSettings {
  return settings.ai.sound ?? {
    effects: env.ELEVENLABS_API_KEY ? { provider: 'elevenlabs', model: 'eleven_text_to_sound_v2' } : { provider: 'none', model: '' },
    music: env.GEMINI_API_KEY ? { provider: 'gemini', model: 'lyria-3-clip-preview' } : { provider: 'none', model: '' },
  };
}

export interface WorkshopSettings {
  /** Players may pay Favor to have a sample painted before sending a wish. Off unless the Owner turns it on. */
  samples: boolean;
  /** Favor one sample costs. */
  sampleFavor: number;
}

export const DEFAULT_WORKSHOP: WorkshopSettings = { samples: false, sampleFavor: 1 };

export interface BuildSettings {
  /** Who writes the change: Claude Code in GitHub Actions, or a person working from the issue. */
  agent: 'claude' | 'manual';
  /** Builds started per day (UTC); more wait in the queue. */
  dailyLimit: number;
  /** What one build is guessed to cost, counted until its run reports the real cost. */
  usdPerBuild: number;
}

export const DEFAULT_BUILDS: BuildSettings = { agent: 'claude', dailyLimit: 3, usdPerBuild: 1.5 };

export function defaultSettings(env: Record<string, string | undefined> = process.env): Settings {
  const gemini = Boolean(env.GEMINI_API_KEY);
  return {
    ai: {
      god: gemini ? { provider: 'gemini', model: 'gemini-3.8-flash' } : { provider: 'offline', model: 'scripted' },
      fallback: null,
      compiler: null,
      image: gemini ? { provider: 'gemini', model: 'gemini-2.5-flash-image' } : { provider: 'none', model: '' },
    },
    budget: { monthlyUsd: 70, warnUsd: 50, dailyUsd: DEFAULT_DAILY_USD },
    builds: { ...DEFAULT_BUILDS },
  };
}
