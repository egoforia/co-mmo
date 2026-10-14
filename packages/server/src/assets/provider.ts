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

export class ProviderError extends Error {
  constructor(readonly provider: string, readonly status: number, message: string) {
    super(`${provider}: ${message}`);
  }
}
