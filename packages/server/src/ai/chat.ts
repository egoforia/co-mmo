// Language models behind one interface, so the provider and model for each
// AI role are settings in God's View, never code (design doc, God's View:
// "AI is provider-agnostic").

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  system: string;
  messages: ChatTurn[];
  /** Ask for a single JSON object back. */
  json?: boolean;
  maxTokens?: number;
}

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Estimated price of this call in US dollars. */
  usd: number;
}

export interface ChatModel {
  readonly provider: ProviderId;
  readonly model: string;
  complete(request: ChatRequest): Promise<ChatResult>;
}

export type ProviderId = 'gemini' | 'anthropic' | 'openai' | 'offline';

export class ChatError extends Error {
  constructor(readonly provider: string, readonly status: number, message: string) {
    super(`${provider}: ${message}`);
  }
}

/** Approximate list prices, US dollars per million tokens (input, output). */
const PRICES: Record<string, [number, number]> = {
  'gemini-2.5-flash': [0.3, 2.5],
  'gemini-2.5-flash-lite': [0.1, 0.4],
  'gemini-2.5-pro': [1.25, 10],
  'claude-haiku-5-5': [1, 5],
  'claude-sonnet-5-5': [3, 15],
  'gpt-4o-mini': [0.15, 0.6],
};

export function priceOf(model: string, input: number, output: number): number {
  const [i, o] = PRICES[model] ?? [0, 0];
  return (input * i + output * o) / 1_000_000;
}

/** Which environment variable holds each provider's key. */
export const KEY_ENV: Record<Exclude<ProviderId, 'offline'>, string> = {
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  gemini: 'gemini-2.5-flash',
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-4o-mini',
  offline: 'scripted',
};

export class GeminiChat implements ChatModel {
  readonly provider = 'gemini';
  constructor(private readonly apiKey: string, readonly model: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async complete(req: ChatRequest): Promise<ChatResult> {
    const res = await this.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: {
            maxOutputTokens: req.maxTokens ?? 1024,
            ...(req.json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      promptFeedback?: { blockReason?: string };
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    if (!res.ok) throw new ChatError(this.provider, res.status, body.error?.message ?? res.statusText);
    if (body.promptFeedback?.blockReason) throw new ChatError(this.provider, 422, `blocked (${body.promptFeedback.blockReason})`);
    const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    if (!text) throw new ChatError(this.provider, 502, 'empty reply');
    return result(this.model, text, body.usageMetadata?.promptTokenCount ?? 0, body.usageMetadata?.candidatesTokenCount ?? 0);
  }
}

export class AnthropicChat implements ChatModel {
  readonly provider = 'anthropic';
  constructor(private readonly apiKey: string, readonly model: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async complete(req: ChatRequest): Promise<ChatResult> {
    const res = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 1024,
        system: req.json ? `${req.system}\n\nReply with one JSON object and nothing else.` : req.system,
        messages: req.messages,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (!res.ok) throw new ChatError(this.provider, res.status, body.error?.message ?? res.statusText);
    const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    if (!text) throw new ChatError(this.provider, 502, 'empty reply');
    return result(this.model, text, body.usage?.input_tokens ?? 0, body.usage?.output_tokens ?? 0);
  }
}

/** OpenAI, or any service with an OpenAI-compatible API (set OPENAI_BASE_URL). */
export class OpenAiChat implements ChatModel {
  readonly provider = 'openai';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(req: ChatRequest): Promise<ChatResult> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 1024,
        messages: [{ role: 'system', content: req.system }, ...req.messages],
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (!res.ok) throw new ChatError(this.provider, res.status, body.error?.message ?? res.statusText);
    const text = body.choices?.[0]?.message?.content ?? '';
    if (!text) throw new ChatError(this.provider, 502, 'empty reply');
    return result(this.model, text, body.usage?.prompt_tokens ?? 0, body.usage?.completion_tokens ?? 0);
  }
}

function result(model: string, text: string, inputTokens: number, outputTokens: number): ChatResult {
  return { text, inputTokens, outputTokens, usd: priceOf(model, inputTokens, outputTokens) };
}

/** Builds a model from settings; undefined when its key is missing. */
export function createChatModel(
  provider: ProviderId,
  model: string,
  env: Record<string, string | undefined>,
  offline: () => ChatModel,
): ChatModel | undefined {
  if (provider === 'offline') return offline();
  const key = env[KEY_ENV[provider]];
  if (!key) return undefined;
  if (provider === 'gemini') return new GeminiChat(key, model);
  if (provider === 'anthropic') return new AnthropicChat(key, model);
  return new OpenAiChat(key, model, env.OPENAI_BASE_URL || undefined);
}

/** The first JSON object in a reply, tolerating code fences and chatter around it. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
