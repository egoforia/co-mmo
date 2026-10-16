/** One generated image as returned by a provider, before post-processing. */
export interface GeneratedImage {
  mimeType: string;
  data: Buffer;
  /** Image tokens the provider billed for it, when it says. */
  outputTokens?: number;
}

export interface ImageRequest {
  prompt: string;
  /** Reference images (anchors, a base pose) the result must match in style. */
  references?: GeneratedImage[];
  /** What each reference is, in order, for God's View; never sent to the service. */
  labels?: string[];
  /** The references show the subject itself, to be painted again with a change, not just the style. */
  edit?: boolean;
  /** Width to height, such as "4:5"; square when left out. */
  aspectRatio?: string;
  /** Long side: "1K" (about 1024 px, the default), "2K" or "4K", for models that offer it. */
  size?: '1K' | '2K' | '4K';
}

/**
 * Every image service sits behind this interface, so the provider and model
 * are a setting (God's View), never hard-coded in game logic.
 */
export interface ImageProvider {
  readonly id: string;
  readonly model: string;
  generate(request: ImageRequest): Promise<GeneratedImage>;
}

/** What a service said about a refusal for asking too often, when it said anything. */
export interface Throttle {
  /** The quotas it named, such as `GenerateRequestsPerDayPerProjectPerModel`. */
  quotas: string[];
  /** How long it asked us to wait before asking again. */
  retryAfterMs?: number;
}

export class ProviderError extends Error {
  constructor(readonly provider: string, readonly status: number, readonly said: string, readonly throttle?: Throttle) {
    super(`${provider}: ${said}`);
  }
}

/** A Google API error body, as the Gemini API sends it. */
export interface GoogleError {
  message?: string;
  details?: { '@type'?: string; violations?: { quotaId?: string }[]; retryDelay?: string }[];
}

/** A Google API error as a ProviderError, keeping which quota it hit and how long to wait. */
export function googleError(provider: string, status: number, error: GoogleError | undefined, fallback: string): ProviderError {
  let throttle: Throttle | undefined;
  if (status === 429) {
    throttle = { quotas: [] };
    for (const detail of error?.details ?? []) {
      for (const v of detail.violations ?? []) if (v.quotaId) throttle.quotas.push(v.quotaId);
      const seconds = Number.parseFloat(detail.retryDelay ?? '');
      if (Number.isFinite(seconds)) throttle.retryAfterMs = Math.ceil(seconds * 1000);
    }
  }
  return new ProviderError(provider, status, error?.message?.trim() || fallback, throttle);
}
