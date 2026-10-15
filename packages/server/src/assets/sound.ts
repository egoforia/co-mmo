import { ProviderError, googleError, type GoogleError } from './provider.ts';

/** One made sound, as the service sent it (before trimming and levelling). */
export interface GeneratedSound {
  mimeType: string;
  data: Buffer;
  /** How long the service was asked to make it, which is what some bill by. */
  seconds: number;
}

export interface SoundRequest {
  prompt: string;
  /** Length in seconds, for services that take one. */
  seconds: number;
}

/**
 * Every sound service sits behind this interface, like images and video do,
 * so the service is a setting in God's View rather than hard-coded.
 */
export interface SoundProvider {
  readonly id: string;
  readonly model: string;
  generate(request: SoundRequest): Promise<GeneratedSound>;
}

/** The music model used unless God's View says otherwise: 30-second clips, the cheapest Lyria. */
export const DEFAULT_MUSIC_MODEL = 'lyria-3-clip-preview';
/** ElevenLabs' sound-effects model. */
export const DEFAULT_EFFECTS_MODEL = 'eleven_text_to_sound_v2';

/**
 * Dollars per piece of music, from Google's price list (October 2026): a
 * 30-second Lyria 3 clip is $0.04 and a full Lyria 3 Pro song $0.08.
 * Lyria 3.5 is an ESTIMATE, priced like Pro until checked.
 */
const MUSIC_USD: Record<string, number> = {
  'lyria-3-clip-preview': 0.04,
  'lyria-3-pro-preview': 0.08,
  'lyria-3.5': 0.08,
};

/** ElevenLabs' API list price for sound effects, $0.12 a minute. An ESTIMATE: plans with credits cost less. */
const EFFECT_USD_PER_SECOND = 0.002;

/** What a sound cost; an unknown model is priced high, so budgets err safe. */
export function soundUsd(model: string, sound: { seconds: number }): number {
  if (model.startsWith('eleven')) return EFFECT_USD_PER_SECOND * Math.max(0.5, sound.seconds);
  return MUSIC_USD[model] ?? 0.1;
}

/**
 * ElevenLabs sound effects: a description in, a short MP3 out. The key is
 * ELEVENLABS_API_KEY in the server's environment.
 */
export class ElevenLabsSoundProvider implements SoundProvider {
  readonly id = 'elevenlabs';

  constructor(
    private readonly apiKey: string,
    readonly model = DEFAULT_EFFECTS_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set.');
  }

  async generate(request: SoundRequest): Promise<GeneratedSound> {
    // ElevenLabs makes 0.5 to 30 seconds.
    const seconds = Math.min(30, Math.max(0.5, request.seconds));
    const res = await this.fetchImpl('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': this.apiKey },
      body: JSON.stringify({ text: request.prompt, duration_seconds: seconds, prompt_influence: 0.5, model_id: this.model }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: { message?: string; status?: string } | string };
      const detail = typeof body.detail === 'string' ? body.detail : body.detail?.message;
      // Too many at once or too fast: the paint queue waits and asks again.
      throw new ProviderError(this.id, res.status, detail?.trim() || res.statusText, res.status === 429 ? { quotas: [] } : undefined);
    }
    return { mimeType: res.headers.get('content-type') ?? 'audio/mpeg', data: Buffer.from(await res.arrayBuffer()), seconds };
  }
}

/**
 * Google's Lyria music through the Gemini API, on the same key as pictures.
 * A clip model makes about 30 seconds whatever is asked, billed per clip.
 */
export class LyriaMusicProvider implements SoundProvider {
  readonly id = 'gemini';

  constructor(
    private readonly apiKey: string,
    readonly model = DEFAULT_MUSIC_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
  }

  async generate(request: SoundRequest): Promise<GeneratedSound> {
    const res = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        generationConfig: { responseModalities: ['AUDIO', 'TEXT'] },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: GoogleError;
      promptFeedback?: { blockReason?: string };
      candidates?: { finishReason?: string; content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[];
    };
    if (!res.ok) throw googleError(this.id, res.status, body.error, res.statusText);
    if (body.promptFeedback?.blockReason) throw new ProviderError(this.id, 422, `request blocked (${body.promptFeedback.blockReason})`);
    for (const part of body.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) return { mimeType: part.inlineData.mimeType, data: Buffer.from(part.inlineData.data, 'base64'), seconds: request.seconds };
    }
    throw new ProviderError(this.id, 502, `no music returned (${body.candidates?.[0]?.finishReason ?? 'no audio in response'})`);
  }
}
