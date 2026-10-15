import { ProviderError, googleError, type GoogleError, type GeneratedImage, type ImageProvider, type ImageRequest } from './provider.ts';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Sent to Gemini after the reference images, before the prompt; previews show it too. */
export const REFERENCE_NOTE = 'Match the art style of the reference images exactly; do not copy their subjects.';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  inline_data?: { mime_type: string; data: string };
}

/**
 * Google AI Studio (Gemini API) image generation. Gemini takes reference
 * images alongside the text, which is how anchors keep the style consistent.
 */
export class GeminiImageProvider implements ImageProvider {
  readonly id = 'gemini';

  constructor(
    private readonly apiKey: string,
    readonly model = 'gemini-2.5-flash-image',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
  }

  async generate(request: ImageRequest): Promise<GeneratedImage> {
    const parts: GeminiPart[] = [];
    for (const ref of request.references ?? []) {
      parts.push({ inline_data: { mime_type: ref.mimeType, data: ref.data.toString('base64') } });
    }
    if (request.references?.length) {
      parts.push({ text: REFERENCE_NOTE });
    }
    parts.push({ text: request.prompt });

    const res = await this.fetchImpl(`${API}/${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: imageConfig(this.model, request) },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: GoogleError;
      usageMetadata?: { candidatesTokenCount?: number };
      promptFeedback?: { blockReason?: string };
      candidates?: { finishReason?: string; content?: { parts?: GeminiPart[] } }[];
    };
    if (!res.ok) throw googleError(this.id, res.status, body.error, res.statusText);
    if (body.promptFeedback?.blockReason) {
      throw new ProviderError(this.id, 422, `request blocked (${body.promptFeedback.blockReason})`);
    }
    for (const part of body.candidates?.[0]?.content?.parts ?? []) {
      const inline = part.inlineData ?? (part.inline_data && { mimeType: part.inline_data.mime_type, data: part.inline_data.data });
      if (inline?.data) {
        return { mimeType: inline.mimeType, data: Buffer.from(inline.data, 'base64'), outputTokens: body.usageMetadata?.candidatesTokenCount };
      }
    }
    const reason = body.candidates?.[0]?.finishReason ?? 'no image in response';
    throw new ProviderError(this.id, 502, `no image returned (${reason})`);
  }
}

/** Shape and size settings; only Gemini 3 image models take a size above 1K. */
function imageConfig(model: string, request: ImageRequest): Record<string, string> {
  const config: Record<string, string> = {};
  if (request.aspectRatio) config.aspectRatio = request.aspectRatio;
  if (request.size && request.size !== '1K' && !model.startsWith('gemini-2')) config.imageSize = request.size;
  return config;
}
