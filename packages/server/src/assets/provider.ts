/** One generated image as returned by a provider, before post-processing. */
export interface GeneratedImage {
  mimeType: string;
  data: Buffer;
}

export interface ImageRequest {
  prompt: string;
  /** Reference images (anchors, a base pose) the result must match in style. */
  references?: GeneratedImage[];
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
