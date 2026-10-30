import { ProviderError, type GeneratedImage } from './provider.ts';
import type { GeneratedVideo, VideoProvider, VideoRequest } from './video.ts';

const API = 'https://api.replicate.com/v1';

/** The Replicate video model offered first in God's View. */
export const DEFAULT_REPLICATE_VIDEO_MODEL = 'alibaba/wan-3';

/**
 * Replicate's token. Replicate documents `REPLICATE_API_TOKEN`; `REPLICATE_API_KEY`
 * is read too, since that is the name a key is easily saved under.
 */
export function replicateToken(env: Record<string, string | undefined>): string | undefined {
  return env.REPLICATE_API_TOKEN?.trim() || env.REPLICATE_API_KEY?.trim() || undefined;
}

/** Pictures up to this size go inline as a data URL; bigger ones are uploaded first, as Replicate asks. */
export const MAX_DATA_URL_BYTES = 256 * 1024;

/** Wan clips are 2 to 30 seconds long. */
const MIN_SECONDS = 2;
const MAX_SECONDS = 30;

interface Prediction {
  id?: string;
  status?: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[] | null;
  error?: string | null;
  urls?: { get?: string };
  detail?: string;
  title?: string;
  retry_after?: number;
}

/**
 * A video model on Replicate, such as Alibaba's Wan 3.0. Like Veo, a clip is
 * a job: it is started, checked every few seconds until it is done, and then
 * downloaded. Wan starts from one picture and cannot be given the last one,
 * so a looping walk is asked for in words only.
 */
export class ReplicateVideoProvider implements VideoProvider {
  readonly id = 'replicate';

  constructor(
    private readonly token: string,
    readonly model = DEFAULT_REPLICATE_VIDEO_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  ) {
    if (!token) throw new Error('REPLICATE_API_TOKEN is not set.');
  }

  async generate(request: VideoRequest): Promise<GeneratedVideo> {
    const seconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(request.seconds)));
    const resolution = request.resolution === '1080p' || request.resolution === '480p' ? request.resolution : '720p';
    const input: Record<string, unknown> = {
      prompt: request.prompt,
      image: await this.picture(request.first),
      resolution,
      duration: seconds,
      // Prompt rewriting makes up gestures and props the walk prompt forbids (docs/art-pipeline.md).
      enable_prompt_expansion: false,
      ...(request.negativePrompt ? { negative_prompt: request.negativePrompt } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
    };
    let prediction = await this.start(input);
    // A clip is usually ready within a few minutes; give up after fifteen.
    for (let i = 0; !finished(prediction); i++) {
      if (i >= 180) throw new ProviderError(this.id, 504, 'the video took too long');
      await this.wait(5_000);
      const poll = await this.fetchImpl(prediction.urls?.get ?? `${API}/predictions/${encodeURIComponent(prediction.id!)}`, { headers: this.headers() });
      // Checking too often is refused too; the clip is already paid for, so keep checking rather than start again.
      if (poll.status === 429) continue;
      const checked = (await poll.json().catch(() => ({}))) as Prediction;
      if (!poll.ok) throw replicateError(this.id, poll, checked, 'checking on the video failed');
      prediction = checked;
    }
    if (prediction.status !== 'succeeded') {
      throw new ProviderError(this.id, 502, prediction.error?.trim() || (prediction.status === 'canceled' ? 'the video was cancelled' : 'the video failed'));
    }
    const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!url) throw new ProviderError(this.id, 422, 'no video returned');
    // The file is on Replicate's delivery host, which needs no token: keep the token on api.replicate.com.
    const file = await this.fetchImpl(url);
    if (!file.ok) throw new ProviderError(this.id, file.status, 'downloading the video failed');
    return { mimeType: file.headers.get('content-type')?.startsWith('video/') ? file.headers.get('content-type')! : 'video/mp4', data: Buffer.from(await file.arrayBuffer()), seconds, resolution };
  }

  /** Starts the job by the model's name, or through the general endpoint when Replicate does not run that model by name. */
  private async start(input: Record<string, unknown>): Promise<Prediction> {
    const byName = await this.fetchImpl(`${API}/models/${this.model.split('/').map(encodeURIComponent).join('/')}/predictions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ input }),
    });
    let res = byName;
    if (byName.status === 404) {
      res = await this.fetchImpl(`${API}/predictions`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ version: this.model, input }) });
    }
    const body = (await res.json().catch(() => ({}))) as Prediction;
    if (!res.ok || !body.id) throw replicateError(this.id, res, body, 'the video could not be started');
    return body;
  }

  /** A small picture inline; a bigger one uploaded to Replicate's files, by its address. */
  private async picture(image: GeneratedImage): Promise<string> {
    if (image.data.length <= MAX_DATA_URL_BYTES) return `data:${image.mimeType};base64,${image.data.toString('base64')}`;
    const form = new FormData();
    const ext = image.mimeType.split('/')[1] ?? 'png';
    form.append('content', new Blob([new Uint8Array(image.data)], { type: image.mimeType }), `first-frame.${ext}`);
    const res = await this.fetchImpl(`${API}/files`, { method: 'POST', headers: { authorization: `Bearer ${this.token}` }, body: form });
    const body = (await res.json().catch(() => ({}))) as { urls?: { get?: string }; detail?: string };
    if (!res.ok || !body.urls?.get) throw replicateError(this.id, res, body, 'the first picture could not be sent');
    return body.urls.get;
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', authorization: `Bearer ${this.token}` };
  }
}

function finished(p: Prediction): boolean {
  return p.status === 'succeeded' || p.status === 'failed' || p.status === 'canceled';
}

/** A Replicate refusal as a ProviderError; a 429 keeps how long Replicate asked us to wait. */
export function replicateError(provider: string, res: Response, body: Prediction, fallback: string): ProviderError {
  const said = body.detail?.trim() || body.error?.trim() || body.title?.trim() || fallback;
  if (res.status !== 429) return new ProviderError(provider, res.ok ? 502 : res.status, said);
  const seconds = Number(res.headers.get('retry-after') ?? body.retry_after);
  return new ProviderError(provider, 429, said, { quotas: [], ...(Number.isFinite(seconds) ? { retryAfterMs: Math.ceil(seconds * 1000) } : {}) });
}
