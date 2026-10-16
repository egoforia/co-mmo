import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { appendFile, mkdir, open, readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// Every request the server sends to a service outside this machine (the AI
// models, GitHub, sign-in providers, email) passes through one wrapper around
// fetch, so God's View's API Log tab shows what was sent and what came back.
// Keys and tokens are masked before anything is kept, and pictures, clips and
// sounds are kept as their type and size, never their bytes.

/** One request to an outside service, as the API Log keeps it. */
export interface ApiCall {
  id: string;
  /** When it was sent. */
  at: number;
  /** How long it took, until the whole answer had arrived. */
  ms: number;
  method: string;
  /** With keys and tokens in the address masked. */
  url: string;
  host: string;
  /** Who was asked, in words: "Google AI Studio", "ElevenLabs", "GitHub". */
  service: string;
  /** What kind of request: Chat, Picture, Video, Music, Sound effect, Sign-in, Email... */
  kind: string;
  model?: string;
  /** Why the game asked, when it said: "God's reply", "Mara walking left". */
  purpose?: string;
  /** The answer's status code; 0 when no answer came (the network failed or it was cancelled). */
  status: number;
  /** What went wrong, in the service's words, when it went wrong. */
  error?: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  requestBytes: number;
  responseBytes?: number;
  responseType?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** A call without its headers and bodies, for the list. */
export type ApiCallSummary = Omit<ApiCall, 'requestHeaders' | 'responseHeaders' | 'requestBody' | 'responseBody'>;

/** What the fetch wrapper saw, before anything is masked. */
export interface RawCall {
  at: number;
  ms: number;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  requestBytes: number;
  /** Set when the body was not text (bytes, a stream, a form with files). */
  requestBinary?: string;
  status: number;
  responseHeaders: Record<string, string>;
  responseText?: string;
  responseBytes?: number;
  responseType?: string;
  error?: string;
  purpose?: string;
  model?: string;
}

/** Where the fetch wrapper hands each call. */
export interface ApiSink {
  record(call: RawCall): void;
}

// --- Why a call was made -------------------------------------------------------

/** What the code making a request says about it. */
export interface ApiContext {
  purpose?: string;
  model?: string;
}

const context = new AsyncLocalStorage<ApiContext>();

/** Runs `fn` with its outside requests marked with why they were made. */
export function withApiContext<T>(ctx: ApiContext, fn: () => T): T {
  const outer = context.getStore();
  return context.run({ ...outer, ...(ctx.purpose ? { purpose: ctx.purpose } : {}), ...(ctx.model ? { model: ctx.model } : {}) }, fn);
}

// --- The fetch wrapper ---------------------------------------------------------

/** Answers that are pictures, sound or video are counted, not read. */
const BINARY = /^(image|audio|video)\/|octet-stream|application\/(zip|pdf)/i;

/** Only requests leaving this machine are logged; the game's own servers talking to each other are not. */
export function isExternal(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  return !(host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0' || /^127\./.test(host));
}

/** A fetch that tells `sink` about every outside request it sends through `base`. */
export function recordingFetch(sink: ApiSink, base: typeof fetch, active: () => boolean = () => true): typeof fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!active() || !isExternal(url)) return base(input, init);
    const at = Date.now();
    const t0 = performance.now();
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const requestHeaders = headerObject(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)));
    const body = describeBody(init?.body);
    const ctx = context.getStore() ?? {};
    const base0: Omit<RawCall, 'ms' | 'status' | 'responseHeaders'> = {
      at, method, url, requestHeaders, ...body, ...(ctx.purpose ? { purpose: ctx.purpose } : {}), ...(ctx.model ? { model: ctx.model } : {}),
    };
    let res: Response;
    try {
      res = await base(input, init);
    } catch (err) {
      sink.record({ ...base0, ms: performance.now() - t0, status: 0, responseHeaders: {}, error: (err as Error).message || String(err) });
      throw err;
    }
    const responseHeaders = headerObject(res.headers);
    const responseType = res.headers.get('content-type') ?? undefined;
    const length = Number(res.headers.get('content-length')) || undefined;
    const done = (more: Partial<RawCall>) => sink.record({ ...base0, ms: performance.now() - t0, status: res.status, responseHeaders, ...(responseType ? { responseType } : {}), ...more });
    if (!res.body || (responseType && BINARY.test(responseType))) {
      // A clip or a sound: its size is enough, and reading a copy would double what is held in memory.
      done(length !== undefined ? { responseBytes: length } : {});
      return res;
    }
    // Read a copy, so the caller reads the answer exactly as it came.
    res.clone().text().then(
      (text) => done({ responseText: text, responseBytes: Buffer.byteLength(text) }),
      (err: Error) => done({ error: `The answer could not be read: ${err.message}` }),
    );
    return res;
  };
}

function headerObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => (out[key] = value));
  return out;
}

function describeBody(body: RequestInit['body'] | undefined): Pick<RawCall, 'requestBody' | 'requestBytes' | 'requestBinary'> {
  if (body === undefined || body === null) return { requestBytes: 0 };
  if (typeof body === 'string') return { requestBody: body, requestBytes: Buffer.byteLength(body) };
  if (body instanceof URLSearchParams) {
    const text = body.toString();
    return { requestBody: text, requestBytes: Buffer.byteLength(text) };
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return { requestBytes: body.byteLength, requestBinary: 'bytes' };
  if (body instanceof Blob) return { requestBytes: body.size, requestBinary: body.type || 'bytes' };
  return { requestBytes: 0, requestBinary: 'a stream or form' };
}

const sinks = new Set<ApiSink>();
let unwrapped: typeof fetch | undefined;

/**
 * Sends every outside request this process makes through `log`, whichever
 * code makes it, including code that only calls the global fetch. Returns a
 * function that stops it.
 */
export function watchFetch(log: ApiSink): () => void {
  if (!unwrapped) {
    unwrapped = globalThis.fetch;
    const all: ApiSink = { record: (call) => sinks.forEach((s) => s.record(call)) };
    globalThis.fetch = recordingFetch(all, unwrapped, () => sinks.size > 0);
  }
  sinks.add(log);
  return () => void sinks.delete(log);
}

// --- What a call was -------------------------------------------------------------

/** Who was asked, what kind of request it was, and with which model, from the address and body. */
export function describeCall(url: URL, body: unknown): { service: string; kind: string; model?: string } {
  const host = url.hostname;
  const path = url.pathname;
  const sent = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const named = typeof sent.model === 'string' ? sent.model : undefined;
  if (host === 'generativelanguage.googleapis.com') {
    const model = path.match(/\/models\/([^/:]+)/)?.[1];
    const service = 'Google AI Studio';
    if (path.includes('/operations/')) return { service, kind: 'Video (checking)', ...(model ? { model } : {}) };
    if (path.includes(':predictLongRunning')) return { service, kind: 'Video', ...(model ? { model } : {}) };
    if (path.includes('/files/') || url.search.includes('alt=media')) return { service, kind: 'Video (download)', ...(model ? { model } : {}) };
    const kind = !model ? 'Other' : /image|^imagen/.test(model) ? 'Picture' : /^lyria/.test(model) ? 'Music' : /^veo/.test(model) ? 'Video' : 'Chat';
    return { service, kind, ...(model ? { model } : {}) };
  }
  if (host === 'api.anthropic.com') return { service: 'Anthropic', kind: 'Chat', ...(named ? { model: named } : {}) };
  if (host === 'api.openai.com') return { service: 'OpenAI', kind: path.includes('/images') ? 'Picture' : 'Chat', ...(named ? { model: named } : {}) };
  if (host === 'api.elevenlabs.io') {
    const model = typeof sent.model_id === 'string' ? sent.model_id : undefined;
    return { service: 'ElevenLabs', kind: path.includes('sound-generation') ? 'Sound effect' : 'Sound', ...(model ? { model } : {}) };
  }
  if (host === 'api.github.com') return { service: 'GitHub', kind: path.startsWith('/repos/') ? 'Wish builds' : 'Sign-in' };
  if (host === 'github.com') return { service: 'GitHub', kind: path.startsWith('/login/oauth') ? 'Sign-in' : 'Other' };
  if (/^(oauth2|openidconnect|accounts)\.googleapis\.com$|^accounts\.google\.com$/.test(host)) return { service: 'Google', kind: 'Sign-in' };
  if (host === 'api.resend.com') return { service: 'Resend', kind: 'Email' };
  // OpenAI-compatible services set with OPENAI_BASE_URL.
  if (path.endsWith('/chat/completions')) return { service: host, kind: 'Chat', ...(named ? { model: named } : {}) };
  return { service: host, kind: 'Other', ...(named ? { model: named } : {}) };
}

// --- Masking ---------------------------------------------------------------------

/** Header names that carry keys, tokens or cookies. Rate-limit counters only look like it. */
const SECRET_HEADER = /authorization|cookie|key|token|secret|signature|password/i;
/** Field and query names whose text values are secrets. */
const SECRET_FIELD = /api[-_]?key|secret|password|token|authorization|^code$|^key$|signature/i;
/** A secret inside any text, such as a sign-in link in an email: `?token=...`. */
const SECRET_IN_LINK = /([?&][\w-]*(?:token|code|key|secret|password|signature)[\w-]*=)([^&\s"'<>\\]+)/gi;

const DOTS = '••••';

/** A secret, with its last four characters when it is long enough that they give nothing away. */
export function mask(value: string): string {
  const scheme = value.match(/^(Bearer|Basic|token)\s+/i)?.[0] ?? '';
  const secret = value.slice(scheme.length);
  return `${scheme}${secret.length >= 16 ? `${DOTS}${secret.slice(-4)}` : DOTS}`;
}

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, SECRET_HEADER.test(k) && !/ratelimit/i.test(k) ? mask(v) : v]));
}

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const [k, v] of [...parsed.searchParams]) if (SECRET_FIELD.test(k)) parsed.searchParams.set(k, mask(v));
    return parsed.toString();
  } catch {
    return url;
  }
}

/** The longest text kept for each body; the rest is cut with a note. */
export const MAX_BODY_CHARS = 256 * 1024;

/** Base64 this long is a picture, clip or sound: kept as its type and size. */
const BASE64 = /^[A-Za-z0-9+/_-]{512,}={0,2}$/;

/** A JSON value with secrets masked and inline pictures and sounds summarised. */
function tidy(value: unknown, key = '', mime?: string): unknown {
  if (typeof value === 'string') {
    if (key && SECRET_FIELD.test(key)) return mask(value);
    if (value.length >= 512 && BASE64.test(value)) return `[${mime ?? 'binary'} data, ${bytes(Math.floor((value.length * 3) / 4))}, not kept]`;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => tidy(v, '', mime));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const type = [obj.mimeType, obj.mime_type, obj.media_type].find((t): t is string => typeof t === 'string') ?? mime;
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, tidy(v, k, type)]));
  }
  return value;
}

/** A body as kept: JSON tidied and indented, a form with its secrets masked, anything else as text. */
function tidyBody(text: string, type: string | undefined): { text: string; json?: unknown } {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(text) as unknown;
      return { text: JSON.stringify(tidy(json), null, 2), json };
    } catch {
      // Not JSON after all; kept as text.
    }
  }
  if (type?.includes('x-www-form-urlencoded') || /^[\w.-]+=[^\s]*(&[\w.-]+=[^\s]*)*$/.test(text)) {
    const form = new URLSearchParams(text);
    for (const [k, v] of [...form]) if (SECRET_FIELD.test(k)) form.set(k, mask(v));
    return { text: form.toString() };
  }
  return { text };
}

function clip(text: string): string {
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}\n\n[cut here: ${bytes(text.length - MAX_BODY_CHARS)} more not kept]` : text;
}

export function bytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The secret values in the server's environment, so they are masked wherever they turn up. */
export function secretsIn(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([k, v]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k) && v && v.length >= 8)
    .map(([, v]) => v!)
    .sort((a, b) => b.length - a.length);
}

function scrub(text: string, secrets: string[]): string {
  let out = text.replace(SECRET_IN_LINK, (_m, name: string, value: string) => `${name}${mask(value)}`);
  for (const s of secrets) if (out.includes(s)) out = out.split(s).join(mask(s));
  return out;
}

/** What went wrong, from an answer's body, in the service's own words. */
function errorFrom(json: unknown, status: number): string | undefined {
  const body = (json && typeof json === 'object' ? json : {}) as Record<string, any>;
  const said = typeof body.error === 'string' ? body.error
    : typeof body.error?.message === 'string' ? body.error.message
    : typeof body.detail === 'string' ? body.detail
    : typeof body.detail?.message === 'string' ? body.detail.message
    : typeof body.message === 'string' ? body.message
    : undefined;
  if (status >= 400) return said ?? `Answered ${status}`;
  if (typeof body.promptFeedback?.blockReason === 'string') return `Blocked (${body.promptFeedback.blockReason})`;
  return undefined;
}

/** Tokens used, from the usage figures Google, Anthropic and OpenAI send back. */
function tokensFrom(json: unknown): Pick<ApiCall, 'inputTokens' | 'outputTokens'> {
  const body = (json && typeof json === 'object' ? json : {}) as Record<string, any>;
  const g = body.usageMetadata;
  if (g) return { inputTokens: g.promptTokenCount ?? 0, outputTokens: (g.candidatesTokenCount ?? 0) + (g.thoughtsTokenCount ?? 0) };
  const u = body.usage;
  if (u && (u.input_tokens !== undefined || u.prompt_tokens !== undefined)) {
    return { inputTokens: u.input_tokens ?? u.prompt_tokens ?? 0, outputTokens: u.output_tokens ?? u.completion_tokens ?? 0 };
  }
  return {};
}

/** A raw call made safe to keep: secrets masked, media summarised, bodies cut to size. */
export function toApiCall(raw: RawCall, secrets: string[], id: string): ApiCall {
  const url = new URL(raw.url);
  const request = raw.requestBody !== undefined ? tidyBody(raw.requestBody, raw.requestHeaders['content-type']) : undefined;
  const response = raw.responseText !== undefined ? tidyBody(raw.responseText, raw.responseType) : undefined;
  const what = describeCall(url, request?.json);
  const model = what.model ?? raw.model;
  const error = raw.error ?? errorFrom(response?.json, raw.status);
  const s = (text: string) => scrub(text, secrets);
  const requestBody = request ? clip(s(request.text)) : raw.requestBinary ? `[${raw.requestBinary}, ${bytes(raw.requestBytes)}, not kept]` : undefined;
  const responseBody = response ? clip(s(response.text))
    : raw.responseType && BINARY.test(raw.responseType) ? `[${raw.responseType}${raw.responseBytes !== undefined ? `, ${bytes(raw.responseBytes)}` : ''}, not kept]`
    : undefined;
  return {
    id,
    at: raw.at,
    ms: Math.round(raw.ms),
    method: raw.method,
    url: s(maskUrl(raw.url)),
    host: url.host,
    service: what.service,
    kind: what.kind,
    ...(model ? { model } : {}),
    ...(raw.purpose ? { purpose: raw.purpose } : {}),
    status: raw.status,
    ...(error ? { error: s(error).slice(0, 500) } : {}),
    requestHeaders: Object.fromEntries(Object.entries(maskHeaders(raw.requestHeaders)).map(([k, v]) => [k, s(v)])),
    responseHeaders: Object.fromEntries(Object.entries(maskHeaders(raw.responseHeaders)).map(([k, v]) => [k, s(v)])),
    ...(requestBody !== undefined ? { requestBody } : {}),
    ...(responseBody !== undefined ? { responseBody } : {}),
    requestBytes: raw.requestBytes,
    ...(raw.responseBytes !== undefined ? { responseBytes: raw.responseBytes } : {}),
    ...(raw.responseType ? { responseType: raw.responseType } : {}),
    ...tokensFrom(response?.json),
  };
}

function summary(call: ApiCall): ApiCallSummary {
  const { requestHeaders: _a, responseHeaders: _b, requestBody: _c, responseBody: _d, ...rest } = call;
  return rest;
}

// --- The log ---------------------------------------------------------------------

/** What the API Log tab can filter by; every field is optional. */
export interface ApiLogFilter {
  from?: number;
  to?: number;
  service?: string;
  kind?: string;
  model?: string;
  purpose?: string;
  method?: string;
  /** `ok` (2xx and 3xx), `error` (4xx, 5xx, no answer), or one status code. */
  status?: string;
  /** Words in the address, model, purpose or error. */
  text?: string;
  /** Only calls that took at least this long. */
  slowerThanMs?: number;
  offset?: number;
  limit?: number;
}

/** A page of the log, newest first, with what the filters can choose from in that time. */
export interface ApiLogPage {
  calls: ApiCallSummary[];
  /** How many calls match, of which this page is `calls`. */
  matched: number;
  totals: { errors: number; ms: number; sentBytes: number; receivedBytes: number; inputTokens: number; outputTokens: number };
  choices: { services: string[]; kinds: string[]; models: string[]; purposes: string[]; methods: string[]; statuses: number[] };
  keeping: { days: number; maxBytes: number; usedBytes: number; onDisk: boolean };
}

export interface ApiLogOptions {
  /** Where the log is kept, one file a day; in memory only when absent. */
  dir?: string;
  /** Days kept before the oldest go. */
  keepDays?: number;
  /** Bytes kept on disk in all; the oldest days go first. */
  maxBytes?: number;
  /** Secrets in here are masked wherever they turn up. */
  env?: Record<string, string | undefined>;
  now?: () => number;
}

export const KEEP_DAYS = 14;
export const MAX_BYTES = 200 * 1024 * 1024;
/** Calls kept when there is no folder to keep them in. */
const KEEP_IN_MEMORY = 1000;

interface Kept {
  summary: ApiCallSummary;
  day: string;
  offset: number;
  length: number;
  /** The whole call, when the log lives in memory. */
  call?: ApiCall;
}

const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

/**
 * The API Log: one JSON line per call in `<dir>/<day>.jsonl`, with a small
 * index file beside it, so the list loads without reading every body. Days
 * past `keepDays`, and the oldest days once the folder passes `maxBytes`, are
 * deleted.
 */
export class ApiLog implements ApiSink {
  private readonly kept = new Map<string, Kept>();
  private readonly sizes = new Map<string, number>();
  private readonly secrets: string[];
  private readonly keepDays: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private writing: Promise<void> = Promise.resolve();
  private today = '';
  private warned = false;

  private constructor(private readonly options: ApiLogOptions) {
    this.secrets = secretsIn(options.env ?? process.env);
    this.keepDays = options.keepDays ?? KEEP_DAYS;
    this.maxBytes = options.maxBytes ?? MAX_BYTES;
    this.now = options.now ?? Date.now;
  }

  /** A log in `options.dir` (made if missing), with what is already there; in memory without a folder. */
  static async open(options: ApiLogOptions = {}): Promise<ApiLog> {
    const log = new ApiLog(options);
    if (options.dir) {
      await mkdir(options.dir, { recursive: true });
      await log.load();
      await log.prune();
    }
    return log;
  }

  /** A log in memory only, for tests and tools. */
  static memory(options: Omit<ApiLogOptions, 'dir'> = {}): ApiLog {
    return new ApiLog(options);
  }

  record(raw: RawCall): void {
    let call: ApiCall;
    try {
      call = toApiCall(raw, this.secrets, randomBytes(6).toString('hex'));
    } catch (err) {
      console.warn(`The API Log could not keep a call to ${raw.url.split('?')[0]}: ${(err as Error).message}`);
      return;
    }
    const day = dayOf(call.at);
    const dir = this.options.dir;
    if (!dir) {
      this.kept.set(call.id, { summary: summary(call), day, offset: 0, length: 0, call });
      while (this.kept.size > KEEP_IN_MEMORY) this.kept.delete(this.kept.keys().next().value!);
      return;
    }
    if (day !== this.today) {
      this.today = day;
      this.writing = this.writing.then(() => this.prune());
    }
    // A full folder still lists each call; only its headers and bodies are left out.
    const full = this.usedBytes() > this.maxBytes;
    const stored = full ? { ...call, requestHeaders: {}, responseHeaders: {}, requestBody: '[not kept: the API Log is full for today]', responseBody: '[not kept: the API Log is full for today]' } : call;
    const line = `${JSON.stringify(stored)}\n`;
    const offset = this.size(day);
    const length = Buffer.byteLength(line);
    const kept: Kept = { summary: summary(call), day, offset, length };
    const index = `${JSON.stringify({ s: kept.summary, o: offset, l: length })}\n`;
    this.sizes.set(day, offset + length);
    this.sizes.set(`${day}.index`, this.size(`${day}.index`) + Buffer.byteLength(index));
    this.kept.set(call.id, kept);
    this.writing = this.writing
      .then(() => appendFile(join(dir, `${day}.jsonl`), line))
      .then(() => appendFile(join(dir, `${day}.index.jsonl`), index))
      .catch((err: Error) => {
        if (!this.warned) console.warn(`The API Log could not be written: ${err.message}`);
        this.warned = true;
      });
  }

  /** One whole call, headers and bodies included. */
  async get(id: string): Promise<ApiCall | undefined> {
    const kept = this.kept.get(id);
    if (!kept) return undefined;
    if (kept.call) return kept.call;
    await this.writing;
    const file = await open(join(this.options.dir!, `${kept.day}.jsonl`), 'r');
    try {
      const buffer = Buffer.alloc(kept.length);
      await file.read(buffer, 0, kept.length, kept.offset);
      return JSON.parse(buffer.toString('utf8')) as ApiCall;
    } catch {
      return undefined;
    } finally {
      await file.close();
    }
  }

  query(filter: ApiLogFilter = {}): ApiLogPage {
    const inTime = [...this.kept.values()]
      .map((k) => k.summary)
      .filter((c) => (filter.from === undefined || c.at >= filter.from) && (filter.to === undefined || c.at <= filter.to));
    const text = filter.text?.trim().toLowerCase();
    const matching = inTime
      .filter((c) => (!filter.service || c.service === filter.service)
        && (!filter.kind || c.kind === filter.kind)
        && (!filter.model || c.model === filter.model)
        && (!filter.purpose || c.purpose === filter.purpose)
        && (!filter.method || c.method === filter.method)
        && statusMatches(c.status, filter.status)
        && (!filter.slowerThanMs || c.ms >= filter.slowerThanMs)
        && (!text || [c.url, c.model, c.purpose, c.error, c.service, c.kind].some((v) => v?.toLowerCase().includes(text))))
      .sort((a, b) => b.at - a.at);
    const offset = Math.max(0, filter.offset ?? 0);
    const limit = Math.min(500, Math.max(1, filter.limit ?? 100));
    const sum = (f: (c: ApiCallSummary) => number) => matching.reduce((n, c) => n + f(c), 0);
    const unique = <T>(values: (T | undefined)[]) => [...new Set(values.filter((v): v is T => v !== undefined))];
    return {
      calls: matching.slice(offset, offset + limit),
      matched: matching.length,
      totals: {
        errors: matching.filter((c) => isError(c.status)).length,
        ms: sum((c) => c.ms),
        sentBytes: sum((c) => c.requestBytes),
        receivedBytes: sum((c) => c.responseBytes ?? 0),
        inputTokens: sum((c) => c.inputTokens ?? 0),
        outputTokens: sum((c) => c.outputTokens ?? 0),
      },
      choices: {
        services: unique(inTime.map((c) => c.service)).sort(),
        kinds: unique(inTime.map((c) => c.kind)).sort(),
        models: unique(inTime.map((c) => c.model)).sort(),
        purposes: unique(inTime.map((c) => c.purpose)).sort(),
        methods: unique(inTime.map((c) => c.method)).sort(),
        statuses: unique(inTime.map((c) => c.status)).sort((a, b) => a - b),
      },
      keeping: { days: this.keepDays, maxBytes: this.maxBytes, usedBytes: this.usedBytes(), onDisk: Boolean(this.options.dir) },
    };
  }

  /** Resolves once everything recorded so far is written. */
  async flush(): Promise<void> {
    await this.writing;
  }

  private size(name: string): number {
    let size = this.sizes.get(name);
    if (size === undefined) {
      const path = join(this.options.dir!, `${name}.jsonl`);
      size = existsSync(path) ? statSync(path).size : 0;
      this.sizes.set(name, size);
    }
    return size;
  }

  private usedBytes(): number {
    let n = 0;
    for (const size of this.sizes.values()) n += size;
    return n;
  }

  private async days(): Promise<string[]> {
    const names = await readdir(this.options.dir!);
    return names.map((n) => n.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/)?.[1]).filter((d): d is string => Boolean(d)).sort();
  }

  private async load(): Promise<void> {
    const dir = this.options.dir!;
    for (const day of await this.days()) {
      this.sizes.set(day, (await stat(join(dir, `${day}.jsonl`))).size);
      const indexFile = join(dir, `${day}.index.jsonl`);
      const index = await readFile(indexFile, 'utf8').catch(() => '');
      this.sizes.set(`${day}.index`, Buffer.byteLength(index));
      for (const line of index.split('\n')) {
        if (!line) continue;
        try {
          const { s, o, l } = JSON.parse(line) as { s: ApiCallSummary; o: number; l: number };
          this.kept.set(s.id, { summary: s, day, offset: o, length: l });
        } catch {
          // A line cut short by a crash; the calls after it are still read.
        }
      }
    }
  }

  /** Deletes days past `keepDays`, then the oldest days while the folder is over `maxBytes` (never today). */
  private async prune(): Promise<void> {
    const dir = this.options.dir!;
    const today = dayOf(this.now());
    const oldest = dayOf(this.now() - (this.keepDays - 1) * 86_400_000);
    const days = await this.days();
    const drop = async (day: string) => {
      await unlink(join(dir, `${day}.jsonl`)).catch(() => undefined);
      await unlink(join(dir, `${day}.index.jsonl`)).catch(() => undefined);
      this.sizes.delete(day);
      this.sizes.delete(`${day}.index`);
      for (const [id, k] of this.kept) if (k.day === day) this.kept.delete(id);
    };
    for (const day of days) if (day < oldest) await drop(day);
    for (const day of days) {
      if (day >= oldest && day !== today && this.usedBytes() > this.maxBytes) await drop(day);
    }
  }
}

function isError(status: number): boolean {
  return status === 0 || status >= 400;
}

function statusMatches(status: number, wanted: string | undefined): boolean {
  if (!wanted) return true;
  if (wanted === 'ok') return !isError(status);
  if (wanted === 'error') return isError(status);
  return status === Number(wanted);
}
