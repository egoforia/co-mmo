import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiLog, isExternal, recordingFetch, withApiContext, type RawCall } from '../src/api-log.ts';
import { GeminiImageProvider } from '../src/assets/gemini.ts';
import { AnthropicChat } from '../src/ai/chat.ts';
import { createMailer } from '../src/auth.ts';
import { MemoryPaintQueue, queuedImages, watched } from '../src/paint-queue.ts';
import { account, api, app, start } from './helpers.ts';

const KEY = 'AIzaSyTESTKEY-0123456789abcdefWXYZ';
const PICTURE = Buffer.alloc(3000, 7).toString('base64');

/** A stand-in for the outside service: answers each request with `answer`. */
function service(answer: (url: string, init?: RequestInit) => Response): typeof fetch & { seen: string[] } {
  const seen: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push(String(input));
    return answer(String(input), init);
  }) as typeof fetch & { seen: string[] };
  f.seen = seen;
  return f;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Waits for the copy of an answer the log reads on the side. */
const settled = () => new Promise((r) => setTimeout(r, 20));

describe('the API Log', () => {
  it('keeps a picture request with its model and purpose, the key masked and the pictures left out', async () => {
    const log = ApiLog.memory({ env: { GEMINI_API_KEY: KEY } });
    const google = service(() => json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PICTURE } }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 1290 } }));
    const painter = queuedImages(new MemoryPaintQueue({ limit: () => undefined }), new GeminiImageProvider(KEY, 'gemini-3.1-flash-image', recordingFetch(log, google)));
    await watched(painter, { wait() {}, start() {}, job: { label: 'Mara walking left' } }).generate({ prompt: 'a fox', references: [{ mimeType: 'image/png', data: Buffer.alloc(3000, 1) }] });
    await settled();

    const page = log.query();
    expect(page.matched).toBe(1);
    const [summary] = page.calls;
    expect(summary).toMatchObject({ service: 'Google AI Studio', kind: 'Picture', model: 'gemini-3.1-flash-image', purpose: 'Mara walking left', method: 'POST', status: 200, inputTokens: 12, outputTokens: 1290 });
    const call = (await log.get(summary!.id))!;
    expect(call.requestHeaders['x-goog-api-key']).toBe('••••WXYZ');
    expect(call.requestBody).toContain('a fox');
    expect(call.requestBody).toMatch(/\[image\/png data, 2\.9 KB, not kept\]/);
    expect(call.responseBody).toMatch(/\[image\/png data, 2\.9 KB, not kept\]/);
    expect(JSON.stringify(call)).not.toContain(KEY);
    expect(JSON.stringify(call)).not.toContain(PICTURE.slice(0, 100));
  });

  it('marks chat requests with why they were sent and keeps what the service said went wrong', async () => {
    const log = ApiLog.memory();
    const anthropic = service(() => json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529));
    const chat = new AnthropicChat('sk-ant-secret-0123456789abcd', 'claude-haiku-5-5', recordingFetch(log, anthropic));
    await expect(chat.complete({ system: 'Be God.', messages: [{ role: 'user', content: 'hello' }], purpose: "God's reply" })).rejects.toThrow('Overloaded');
    await settled();
    const [summary] = log.query({ status: 'error' }).calls;
    expect(summary).toMatchObject({ service: 'Anthropic', kind: 'Chat', model: 'claude-haiku-5-5', purpose: "God's reply", status: 529, error: 'Overloaded' });
    expect((await log.get(summary!.id))!.requestHeaders['x-api-key']).toBe('••••abcd');
  });

  it('masks sign-in secrets: links in emails, form fields, tokens and bearer headers', async () => {
    const log = ApiLog.memory({ env: { RESEND_API_KEY: 're_resendsecret123' } });
    const resend = service(() => json({ id: 'mail-1' }));
    await createMailer({ RESEND_API_KEY: 're_resendsecret123', MAIL_FROM: 'god@co-mmo.test' }, recordingFetch(log, resend)).send({
      to: 'mara@example.com', subject: 'Sign in', text: 'Open https://game.test/api/auth/link?token=abcdef0123456789abcdef to sign in.',
    });
    const github = service(() => json({ access_token: 'gho_0123456789abcdefghijklmn', token_type: 'bearer' }));
    await recordingFetch(log, github)('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: 'oauth-code-1234567890', client_id: 'id', client_secret: 'very-secret-client-value' }).toString(),
    });
    await settled();
    // Both calls can land in the same millisecond, so pick each by its service, not its place in the list.
    const { calls } = log.query();
    const mail = calls.find((c) => c.service === 'Resend');
    const oauth = calls.find((c) => c.service === 'GitHub');
    expect(mail).toMatchObject({ service: 'Resend', kind: 'Email' });
    expect(oauth).toMatchObject({ service: 'GitHub', kind: 'Sign-in' });
    const sentMail = (await log.get(mail!.id))!;
    expect(sentMail.requestHeaders.authorization).toBe('Bearer ••••t123');
    expect(sentMail.requestBody).toContain('?token=••••cdef');
    const exchange = (await log.get(oauth!.id))!;
    const all = JSON.stringify(exchange);
    for (const secret of ['oauth-code-1234567890', 'very-secret-client-value', 'gho_0123456789abcdefghijklmn']) expect(all).not.toContain(secret);
    expect(exchange.requestBody).toContain('client_id=id');
  });

  it('counts sound and video answers without reading them, and keeps requests that got no answer', async () => {
    const log = ApiLog.memory();
    const eleven = service(() => new Response(Buffer.alloc(5000), { headers: { 'content-type': 'audio/mpeg', 'content-length': '5000' } }));
    const res = await recordingFetch(log, eleven)('https://api.elevenlabs.io/v1/sound-generation', { method: 'POST', body: JSON.stringify({ text: 'a door creaks', model_id: 'eleven_text_to_sound_v2' }) });
    expect((await res.arrayBuffer()).byteLength).toBe(5000);
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(withApiContext({ purpose: 'Opening an issue' }, () => recordingFetch(log, down)('https://api.github.com/repos/a/b/issues', { method: 'POST' }))).rejects.toThrow('fetch failed');
    await settled();
    // Both may be logged in the same millisecond, so find each by its service, not its place in the list.
    const { calls } = log.query();
    const sound = calls.find((c) => c.service === 'ElevenLabs');
    const failed = calls.find((c) => c.service === 'GitHub');
    expect(calls).toHaveLength(2);
    expect(sound).toMatchObject({ service: 'ElevenLabs', kind: 'Sound effect', model: 'eleven_text_to_sound_v2', responseBytes: 5000 });
    expect((await log.get(sound!.id))!.responseBody).toBe('[audio/mpeg, 4.9 KB, not kept]');
    expect(failed).toMatchObject({ service: 'GitHub', kind: 'Wish builds', status: 0, error: 'fetch failed', purpose: 'Opening an issue' });
  });

  it('leaves the game talking to itself out', async () => {
    const log = ApiLog.memory();
    const local = service(() => json({ ok: true }));
    await recordingFetch(log, local)('http://127.0.0.1:3001/api/health');
    await recordingFetch(log, local)('http://localhost:5173/');
    expect(local.seen).toHaveLength(2);
    expect(log.query().matched).toBe(0);
    expect(isExternal('https://api.openai.com/v1/chat/completions')).toBe(true);
  });

  it('keeps the log on disk across restarts, filters it, and lets old days go', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'co-mmo-api-log-'));
    const day = 86_400_000;
    const now = Date.parse('2026-10-16T12:00:00Z');
    // A day older than the log keeps.
    await writeFile(join(dir, '2026-09-01.jsonl'), '{}\n');
    await writeFile(join(dir, '2026-09-01.index.jsonl'), '');
    const log = await ApiLog.open({ dir, now: () => now });
    const raw = (at: number, model: string, status: number): RawCall => ({
      at, ms: 800, method: 'POST', url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      requestHeaders: {}, requestBody: '{"contents":[]}', requestBytes: 15, status, responseHeaders: {}, responseText: status === 200 ? '{}' : '{"error":{"message":"You exceeded your current quota"}}', responseBytes: 2,
    });
    log.record(raw(now - day, 'gemini-3.8-flash', 200));
    log.record(raw(now - 60_000, 'gemini-2.5-flash-image', 429));
    log.record(raw(now, 'gemini-3.8-flash', 200));
    await log.flush();
    expect((await readdir(dir)).sort()).toEqual(['2026-10-15.index.jsonl', '2026-10-15.jsonl', '2026-10-16.index.jsonl', '2026-10-16.jsonl']);

    const again = await ApiLog.open({ dir, now: () => now });
    expect(again.query().matched).toBe(3);
    expect(again.query({ model: 'gemini-3.8-flash' }).matched).toBe(2);
    expect(again.query({ from: now - 3_600_000 }).choices.models).toEqual(['gemini-2.5-flash-image', 'gemini-3.8-flash']);
    const errors = again.query({ status: 'error' });
    expect(errors.calls.map((c) => c.error)).toEqual(['You exceeded your current quota']);
    expect((await again.get(errors.calls[0]!.id))!.responseBody).toContain('exceeded');
    expect(again.query({ text: 'quota' }).matched).toBe(1);

    // On the last day the log keeps, the older day is gone.
    const later = await ApiLog.open({ dir, now: () => now + 13 * day });
    expect(later.query().matched).toBe(2);
  });

  it('is shown to the Owner only', async () => {
    const { store, base } = await start();
    const owner = account(store, 'egoforia', 'owner');
    const steward = account(store, 'Ilya', 'steward');
    app!.apiLog.record({ at: Date.now(), ms: 1200, method: 'POST', url: 'https://api.openai.com/v1/chat/completions', requestHeaders: { authorization: 'Bearer sk-0123456789abcdefghij' }, requestBody: '{"model":"gpt-4o-mini"}', requestBytes: 23, status: 200, responseHeaders: {}, responseText: '{"usage":{"prompt_tokens":5,"completion_tokens":7}}', responseBytes: 50 });
    const page = await api(base, '/api/admin/api-log?model=gpt-4o-mini', owner.token);
    expect(page.status).toBe(200);
    expect(page.body.calls).toHaveLength(1);
    expect(page.body.totals).toMatchObject({ inputTokens: 5, outputTokens: 7 });
    const one = await api(base, `/api/admin/api-log/${page.body.calls[0].id}`, owner.token);
    expect(one.body.requestHeaders.authorization).toBe('Bearer ••••ghij');
    expect((await api(base, '/api/admin/api-log?model=gpt-4o', owner.token)).body.calls).toHaveLength(0);
    expect((await api(base, '/api/admin/api-log', steward.token)).status).toBe(403);
  });
});
