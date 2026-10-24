import { GeminiImageProvider } from '../assets/gemini.ts';
import type { ImageProvider } from '../assets/provider.ts';
import { ElevenLabsSoundProvider, LyriaMusicProvider, type SoundProvider } from '../assets/sound.ts';
import { GeminiVideoProvider, type VideoProvider } from '../assets/video.ts';
import { queuedImages, queuedSound, queuedVideo, type DailyClips, type PaintQueue } from '../paint-queue.ts';
import { soundSettings, styleCheckSettings, videoSettings, type ArtUse, type Settings } from '../settings.ts';
import { createChatModel, type ChatModel } from './chat.ts';

/**
 * Stand-ins tests (and later, other hosts) can give instead of the real
 * services. Each one replaces exactly one choice below; the rest keep
 * reading settings and keys.
 */
export interface ServiceOverrides {
  /** The God's models (the offline God is always added last). */
  chatModel?: (settings: Settings) => ChatModel[];
  /** The rule compiler's models (the offline compiler is always added last). */
  compilerModel?: (settings: Settings) => ChatModel[];
  /** The style check's judge; with chatModel set and no judge, only the free checks run. */
  judgeModel?: (settings: Settings) => ChatModel | undefined;
  imageProvider?: (settings: Settings, use?: ArtUse) => ImageProvider | undefined;
  videoProvider?: () => VideoProvider | undefined;
  effects?: () => SoundProvider | undefined;
  music?: () => SoundProvider | undefined;
}

export interface AiServicesOptions {
  /** The Owner's current choices (God's View, AI models tab). */
  settings: () => Settings;
  /** Where API keys are read from. */
  env: Record<string, string | undefined>;
  /** True once this month's budget is spent: only the offline God and compiler answer. */
  overBudget: () => boolean;
  /** The God that answers without any service, from its word rules. */
  offlineGod: ChatModel;
  /** The rule compiler that answers without any service. */
  offlineCompiler: ChatModel;
  /** Turns at the image, video and sound models; without one, calls go straight out. */
  paintQueue?: PaintQueue;
  /** Video clips a day, counted by the game. */
  clips?: DailyClips;
  overrides?: ServiceOverrides;
}

/**
 * The one place that turns settings and API keys into AI services (design
 * doc: providers sit behind adapters and are chosen in settings). Game code
 * asks for "the God's models" or "the image model for buildings" and never
 * names a provider or reads a key. A new provider is an adapter that
 * implements ChatModel, ImageProvider, VideoProvider or SoundProvider, plus
 * one branch here.
 */
export class AiServices {
  constructor(private readonly options: AiServicesOptions) {}

  /** The God model, its fallback, and the offline God last; offline only once over budget. */
  godModels(settings = this.options.settings()): ChatModel[] {
    const { offlineGod, overrides } = this.options;
    if (this.options.overBudget()) return [offlineGod];
    if (overrides?.chatModel) return [...overrides.chatModel(settings), offlineGod];
    const models: ChatModel[] = [];
    for (const choice of [settings.ai.god, settings.ai.fallback]) {
      if (!choice) continue;
      const model = createChatModel(choice.provider, choice.model, this.options.env, () => offlineGod);
      if (model && !models.includes(model)) models.push(model);
    }
    if (!models.includes(offlineGod)) models.push(offlineGod);
    return models;
  }

  /** The rule compiler's model, the fallback, and the offline compiler last. */
  compilerModels(settings = this.options.settings()): ChatModel[] {
    const { offlineCompiler, overrides } = this.options;
    if (this.options.overBudget()) return [offlineCompiler];
    if (overrides?.compilerModel) return [...overrides.compilerModel(settings), offlineCompiler];
    if (overrides?.chatModel) return [offlineCompiler];
    const models: ChatModel[] = [];
    for (const choice of [settings.ai.compiler ?? settings.ai.god, settings.ai.fallback]) {
      if (!choice || choice.provider === 'offline') continue;
      const model = createChatModel(choice.provider, choice.model, this.options.env, () => offlineCompiler);
      if (model) models.push(model);
    }
    models.push(offlineCompiler);
    return models;
  }

  /** The style check's judge: its own model, else the God's, when it has a key; none runs the free checks only. */
  judgeModel(settings = this.options.settings()): ChatModel | undefined {
    const { overrides } = this.options;
    if (overrides?.judgeModel) return overrides.judgeModel(settings);
    if (overrides?.chatModel) return undefined;
    const choice = styleCheckSettings(settings).judge ?? settings.ai.god;
    if (choice.provider === 'offline') return undefined;
    return createChatModel(choice.provider, choice.model, this.options.env, () => this.options.offlineGod);
  }

  /**
   * The image model chosen for this kind of art (its own model when one is
   * set, else the main one), when it has a key, taking turns in the paint queue.
   */
  image(use?: ArtUse): ImageProvider | undefined {
    const provider = this.chosenImage(use);
    const queue = this.options.paintQueue;
    return provider && queue ? queuedImages(queue, provider) : provider;
  }

  /** The video model for walks, counted against the day's clips and taking turns in the paint queue. */
  video(): VideoProvider | undefined {
    const provider = this.chosenVideo();
    const queue = this.options.paintQueue;
    return provider && queue ? queuedVideo(queue, provider, this.options.clips) : provider;
  }

  /** The sound effects model, taking turns in the paint queue. */
  effects(): SoundProvider | undefined {
    return this.queuedSound(this.chosenEffects());
  }

  /** The music model, taking turns in the paint queue. */
  music(): SoundProvider | undefined {
    return this.queuedSound(this.chosenMusic());
  }

  private chosenImage(use?: ArtUse): ImageProvider | undefined {
    const settings = this.options.settings();
    const { env, overrides } = this.options;
    if (overrides?.imageProvider) return overrides.imageProvider(settings, use);
    const provider = settings.ai.image.provider;
    if (!provider || provider === 'none') return undefined;
    const model = (use && settings.ai.image.uses?.[use]) || settings.ai.image.model;
    if (provider === 'gemini') {
      return env.GEMINI_API_KEY ? new GeminiImageProvider(env.GEMINI_API_KEY, model || undefined) : undefined;
    }
    return undefined;
  }

  // Video clips use the provider and model chosen in AI settings (defaults to Gemini/Veo).
  private chosenVideo(): VideoProvider | undefined {
    const { env, overrides } = this.options;
    if (overrides?.videoProvider) return overrides.videoProvider();
    const v = videoSettings(this.options.settings(), env);
    if (!v || v.provider === 'none') return undefined;
    if (v.provider === 'gemini') {
      return env.GEMINI_API_KEY ? new GeminiVideoProvider(env.GEMINI_API_KEY, v.model || undefined) : undefined;
    }
    return undefined;
  }

  private chosenEffects(): SoundProvider | undefined {
    const { env, overrides } = this.options;
    if (overrides?.effects) return overrides.effects();
    const s = soundSettings(this.options.settings(), env).effects;
    return s.provider === 'elevenlabs' && env.ELEVENLABS_API_KEY ? new ElevenLabsSoundProvider(env.ELEVENLABS_API_KEY, s.model) : undefined;
  }

  private chosenMusic(): SoundProvider | undefined {
    const { env, overrides } = this.options;
    if (overrides?.music) return overrides.music();
    const s = soundSettings(this.options.settings(), env).music;
    return s.provider === 'gemini' && env.GEMINI_API_KEY ? new LyriaMusicProvider(env.GEMINI_API_KEY, s.model) : undefined;
  }

  private queuedSound(provider: SoundProvider | undefined): SoundProvider | undefined {
    const queue = this.options.paintQueue;
    return provider && queue ? queuedSound(queue, provider) : provider;
  }
}
