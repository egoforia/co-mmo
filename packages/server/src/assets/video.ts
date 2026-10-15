import { ProviderError, googleError, type GeneratedImage, type GoogleError } from './provider.ts';

const API = 'https://generativelanguage.googleapis.com/v1beta';

/** One generated video clip, as an MP4. */
export interface GeneratedVideo {
  mimeType: string;
  data: Buffer;
  /** Length of the clip, which is what it is billed by. */
  seconds: number;
  resolution?: '720p' | '1080p';
}

export interface VideoRequest {
  prompt: string;
  /** The picture the clip starts from. */
  first: GeneratedImage;
  /** The picture the clip ends on; the same as `first` makes a loop. */
  last?: GeneratedImage;
  /** Length in seconds. Veo needs 8 when a last picture is given. */
  seconds: 4 | 6 | 8;
  /** Picture size; 720p unless asked. 1080p costs more. */
  resolution?: '720p' | '1080p';
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

/** Dollars per second of video at 720p and 1080p, from Google's price list (October 2026). */
const USD_PER_SECOND: Record<string, [number, number]> = {
  'veo-3.1-lite-generate-preview': [0.05, 0.08],
  'veo-3.1-fast-generate-preview': [0.1, 0.12],
  'veo-3.1-generate-preview': [0.4, 0.4],
};

/** Video models with a known price, for God's View to offer. */
export function knownVideoModels(): string[] {
  return Object.keys(USD_PER_SECOND);
}

/** What a clip cost; an unknown model is priced like the dearest one, so budgets err safe. */
export function videoUsd(model: string, video: GeneratedVideo): number {
  const [hd, fullHd] = USD_PER_SECOND[model] ?? [0.4, 0.4];
  return (video.resolution === '1080p' ? fullHd : hd) * video.seconds;
}

/** The cheapest Veo model, which already paints good walks. */
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
    const res = await this.fetchImpl(`${API}/models/${encodeURIComponent(this.model)}:predictLongRunning`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        instances: [{ prompt: request.prompt, image: picture(request.first), ...(request.last ? { lastFrame: picture(request.last) } : {}) }],
        parameters: { aspectRatio: '16:9', resolution: request.resolution ?? '720p', durationSeconds: request.seconds },
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
    return { mimeType: 'video/mp4', data: Buffer.from(await file.arrayBuffer()), seconds: request.seconds, resolution: request.resolution ?? '720p' };
  }
}
