import { ProviderError, googleError, type GeneratedImage, type GoogleError } from './provider.ts';

const API = 'https://generativelanguage.googleapis.com/v1beta';

/** One generated video clip, as an MP4. */
export interface GeneratedVideo {
  mimeType: string;
  data: Buffer;
  /** Length of the clip, which is what it is billed by. */
  seconds: number;
  resolution?: '720p' | '1080p' | string;
  /** Optional native or sampled frame rate. */
  fps?: number;
  /** Video frame width in pixels. */
  width?: number;
  /** Video frame height in pixels. */
  height?: number;
}

export interface VideoRequest {
  prompt: string;
  /** The picture the clip starts from. */
  first: GeneratedImage;
  /** The picture the clip ends on; the same as `first` makes a loop. */
  last?: GeneratedImage;
  /** Length in seconds. Providers map or clamp this to their native durations. */
  seconds: number;
  /** Picture size; '720p', '1080p', or arbitrary resolution string. */
  resolution?: '720p' | '1080p' | string;
  /** Aspect ratio hint (e.g. '16:9', '1:1', '9:16'). */
  aspectRatio?: string;
  /** Frame rate hint in frames per second. */
  fps?: number;
  /** Seamless loop hint. */
  loop?: boolean;
  /** Negative constraints when supported by the provider. */
  negativePrompt?: string;
  /** Whether provider-side automatic prompt expansion/rewriting is enabled (default false). */
  promptExpansion?: boolean;
}

/**
 * Every video service sits behind this interface, like images do, so the
 * model is a setting rather than hard-coded in game logic.
 */
export interface VideoProvider {
  readonly id: string;
  readonly model: string;
  generate(request: VideoRequest): Promise<GeneratedVideo>;
}

/** Default dollars per second of video at [720p, 1080p] for known video models. */
const DEFAULT_USD_PER_SECOND: Record<string, [number, number]> = {
  // Google Veo models
  'veo-3.1-lite-generate-preview': [0.05, 0.08],
  'veo-3.1-fast-generate-preview': [0.1, 0.12],
  'veo-3.1-generate-preview': [0.4, 0.4],
  'veo-2.0-generate-001': [0.2, 0.25],
  // Wan / open video diffusion models
  'wan-2.1': [0.05, 0.08],
  'wan-2.1-t2v-14b': [0.05, 0.08],
  'wan-2.1-i2v-720p': [0.05, 0.08],
  'wan-3.0': [0.05, 0.08],
  // Replicate provider-prefixed models
  'replicate/wan-2.1': [0.05, 0.08],
  'replicate/wan-3.0': [0.05, 0.08],
  default: [0.4, 0.4],
};

const customUsdPerSecond: Record<string, [number, number]> = {};

/** Register or override pricing for a video model or provider prefix. */
export function registerVideoPricing(model: string, rates: [number, number]): void {
  customUsdPerSecond[model.toLowerCase().trim()] = rates;
}

/** Look up rates [720p, 1080p] per second for a model, handling provider prefixes (e.g. "gemini/", "google:", "replicate/"). */
export function videoRatesPerSecond(model: string): [number, number] {
  const normalized = model.toLowerCase().trim();
  if (customUsdPerSecond[normalized]) return customUsdPerSecond[normalized]!;
  if (DEFAULT_USD_PER_SECOND[normalized]) return DEFAULT_USD_PER_SECOND[normalized]!;

  const withoutPrefix = normalized.replace(/^[a-z0-9_-]+[/:]/, '');
  if (customUsdPerSecond[withoutPrefix]) return customUsdPerSecond[withoutPrefix]!;
  if (DEFAULT_USD_PER_SECOND[withoutPrefix]) return DEFAULT_USD_PER_SECOND[withoutPrefix]!;

  for (const [key, rates] of Object.entries(customUsdPerSecond)) {
    if (normalized.startsWith(key) || withoutPrefix.startsWith(key)) return rates;
  }
  for (const [key, rates] of Object.entries(DEFAULT_USD_PER_SECOND)) {
    if (key !== 'default' && (normalized.startsWith(key) || withoutPrefix.startsWith(key))) return rates;
  }
  return DEFAULT_USD_PER_SECOND.default!;
}

/** Video models with a known price, for God's View to offer. */
export function knownVideoModels(): string[] {
  return [...new Set([...Object.keys(DEFAULT_USD_PER_SECOND).filter((k) => k !== 'default'), ...Object.keys(customUsdPerSecond)])];
}

/** What a clip cost; an unknown model is priced like the dearest one, so budgets err safe. */
export function videoUsd(model: string, video: GeneratedVideo): number {
  const [hd, fullHd] = videoRatesPerSecond(model);
  return (video.resolution === '1080p' ? fullHd : hd) * video.seconds;
}

/** Dollars per second of video, backwards-compatible proxy mapping. */
export const USD_PER_SECOND: Record<string, [number, number]> = new Proxy(
  DEFAULT_USD_PER_SECOND,
  {
    get: (target, prop: string) => customUsdPerSecond[prop] ?? target[prop] ?? videoRatesPerSecond(prop),
  },
);

/** The default video model when none is specified. */
export const DEFAULT_VIDEO_MODEL = 'veo-3.1-lite-generate-preview';

interface Operation {
  name?: string;
  done?: boolean;
  error?: GoogleError;
  response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[]; raiMediaFilteredReasons?: string[] } };
}

/**
 * Google's Veo through the Gemini API. A clip takes a minute or two: the
 * request starts a job, which is checked every few seconds until the video is
 * ready to download.
 */
export class GeminiVideoProvider implements VideoProvider {
  readonly id = 'gemini';

  constructor(
    private readonly apiKey: string,
    readonly model = DEFAULT_VIDEO_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  ) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
  }

  async generate(request: VideoRequest): Promise<GeneratedVideo> {
    const picture = (image: GeneratedImage) => ({ bytesBase64Encoded: image.data.toString('base64'), mimeType: image.mimeType });
    const headers = { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey };
    // Veo supports 4, 6, or 8 seconds; requires 8 when lastFrame is given.
    const durationSeconds = request.last
      ? 8
      : request.seconds <= 5 ? 4 : request.seconds <= 7 ? 6 : 8;
    const resolution = (request.resolution === '1080p' ? '1080p' : '720p');
    const aspectRatio = request.aspectRatio === '9:16' ? '9:16' : '16:9';
    const res = await this.fetchImpl(`${API}/models/${encodeURIComponent(this.model)}:predictLongRunning`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        instances: [{ prompt: request.prompt, image: picture(request.first), ...(request.last ? { lastFrame: picture(request.last) } : {}) }],
        parameters: { aspectRatio, resolution, durationSeconds },
      }),
    });
    let op = (await res.json().catch(() => ({}))) as Operation;
    if (!res.ok || !op.name) throw googleError(this.id, res.ok ? 502 : res.status, op.error, 'the video could not be started');
    // A clip is usually ready within two minutes; give up after ten.
    for (let i = 0; !op.done; i++) {
      if (i >= 60) throw new ProviderError(this.id, 504, 'the video took too long');
      await this.wait(10_000);
      const poll = await this.fetchImpl(`${API}/${op.name}`, { headers });
      // Checking too often is refused too; the clip is already paid for, so keep checking rather than start again.
      if (poll.status === 429) continue;
      const checked = (await poll.json().catch(() => ({}))) as Operation;
      if (!poll.ok) throw new ProviderError(this.id, poll.status, checked.error?.message ?? 'checking on the video failed');
      op = checked;
    }
    if (op.error) throw new ProviderError(this.id, 502, op.error.message ?? 'the video failed');
    const result = op.response?.generateVideoResponse;
    const uri = result?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new ProviderError(this.id, 422, `no video returned (${result?.raiMediaFilteredReasons?.join('; ') || 'no reason given'})`);
    const file = await this.fetchImpl(uri, { headers: { 'x-goog-api-key': this.apiKey } });
    if (!file.ok) throw new ProviderError(this.id, file.status, 'downloading the video failed');
    return { mimeType: 'video/mp4', data: Buffer.from(await file.arrayBuffer()), seconds: durationSeconds, resolution };
  }
}
