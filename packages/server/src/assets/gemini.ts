import { ProviderError, type GeneratedImage, type ImageProvider, type ImageRequest } from './provider.ts';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

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
      parts.push({ text: 'Match the art style of the reference images exactly; do not copy their subjects.' });
    }
    parts.push({ text: request.prompt });

    const res = await this.fetchImpl(`${API}/${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      promptFeedback?: { blockReason?: string };
      candidates?: { finishReason?: string; content?: { parts?: GeminiPart[] } }[];
    };
    if (!res.ok) throw new ProviderError(this.id, res.status, body.error?.message ?? res.statusText);
    if (body.promptFeedback?.blockReason) {
      throw new ProviderError(this.id, 422, `request blocked (${body.promptFeedback.blockReason})`);
    }
    for (const part of body.candidates?.[0]?.content?.parts ?? []) {
      const inline = part.inlineData ?? (part.inline_data && { mimeType: part.inline_data.mime_type, data: part.inline_data.data });
      if (inline?.data) return { mimeType: inline.mimeType, data: Buffer.from(inline.data, 'base64') };
    }
    const reason = body.candidates?.[0]?.finishReason ?? 'no image in response';
    throw new ProviderError(this.id, 502, `no image returned (${reason})`);
  }
}
