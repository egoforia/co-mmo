import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIOMES, SOUND_EFFECTS, musicId, musicPrompt } from '@co-mmo/shared';
import { finishEffect, finishMusic } from '../src/assets/sound-finish.ts';
import { ElevenLabsSoundProvider, LyriaMusicProvider, soundUsd, type SoundProvider, type SoundRequest } from '../src/assets/sound.ts';
import { refusal } from '../src/paint-queue.ts';
import { account, api, app, start, stop } from './helpers.ts';

/** A sound service that answers with the words it was asked, as bytes. */
const fakeSounds = (id: string, model: string): SoundProvider & { asked: SoundRequest[] } => ({
  id,
  model,
  asked: [],
  async generate(request) {
    this.asked.push(request);
    return { mimeType: 'audio/mpeg', data: Buffer.from(`made: ${request.prompt}`), seconds: request.seconds };
  },
});

/** Finishing without ffmpeg: marks the sound and says how long it is. */
const finish = {
  effect: async (raw: Buffer) => ({ data: Buffer.concat([Buffer.from('effect|'), raw]), seconds: 1 }),
  music: async (raw: Buffer) => ({ data: Buffer.concat([Buffer.from('music|'), raw]), seconds: 28 }),
};

/** A sound's entry once start-up has made it. */
async function made(base: string, id: string): Promise<{ file: string }> {
  for (let i = 0; i < 100; i++) {
    const manifest = await (await fetch(`${base}/api/sounds`)).json();
    if (manifest[id]) return manifest[id];
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`${id} was never made`);
}

const effectCount = Object.keys(SOUND_EFFECTS).length;
const landCount = Object.keys(BIOMES).length;

describe('sound services', () => {
  it('asks ElevenLabs for an effect of the given length, and reads a refusal for asking too fast', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = new ElevenLabsSoundProvider('key', undefined, (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(Buffer.from('mp3'), { headers: { 'content-type': 'audio/mpeg' } });
    }) as typeof fetch);
    const sound = await ok.generate({ prompt: 'a whoosh', seconds: 0.2 });
    expect(sound).toMatchObject({ mimeType: 'audio/mpeg', seconds: 0.5 });
    expect(calls[0]!.url).toMatch(/^https:\/\/api\.elevenlabs\.io\/v1\/sound-generation/);
    expect((calls[0]!.init.headers as Record<string, string>)['xi-api-key']).toBe('key');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ text: 'a whoosh', duration_seconds: 0.5, model_id: 'eleven_text_to_sound_v2' });

    const busy = new ElevenLabsSoundProvider('key', undefined, (async () =>
      Response.json({ detail: { status: 'concurrent_limit_exceeded', message: 'Too many concurrent requests.' } }, { status: 429 })) as unknown as typeof fetch);
    const err = await busy.generate({ prompt: 'a whoosh', seconds: 1 }).catch((e) => e);
    expect(err.message).toMatch(/Too many concurrent/);
    expect(refusal(err)).toBe('minute');
  });

  it("reads Lyria's music out of a Gemini answer", async () => {
    let body: any;
    const lyria = new LyriaMusicProvider('key', undefined, (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return Response.json({ candidates: [{ content: { parts: [{ text: '<instrumental>' }, { inlineData: { mimeType: 'audio/mpeg', data: Buffer.from('song').toString('base64') } }] } }] });
    }) as typeof fetch);
    const song = await lyria.generate({ prompt: 'a calm harp', seconds: 30 });
    expect(song.data.toString()).toBe('song');
    expect(body.generationConfig.responseModalities).toContain('AUDIO');
    expect(lyria.model).toBe('lyria-3-clip-preview');
  });

  it('prices a Lyria clip per clip and an effect per second', () => {
    expect(soundUsd('lyria-3-clip-preview', { seconds: 30 })).toBe(0.04);
    expect(soundUsd('eleven_text_to_sound_v2', { seconds: 2 })).toBeCloseTo(0.004);
    expect(soundUsd('someone-new', { seconds: 1 })).toBeGreaterThan(0.04);
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** A test tone after a second of quiet, standing in for a service's recording. */
async function recording(seconds: number): Promise<Buffer> {
  const file = join(await mkdtemp(join(tmpdir(), 'tone-')), 'tone.mp3');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=1`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-filter_complex', '[0][1]concat=n=2:v=0:a=1', file]);
  return readFile(file);
}

describe.skipIf(!hasFfmpeg)('finishing sounds', () => {
  it('trims the quiet off an effect', async () => {
    const done = await finishEffect(await recording(2));
    expect(done.seconds).toBeGreaterThan(1.8);
    expect(done.seconds).toBeLessThan(2.3);
  });

  it('blends the end of a track over its start, so it loops two seconds shorter', async () => {
    const done = await finishMusic(await recording(12));
    expect(done.seconds).toBeGreaterThan(10.5);
    expect(done.seconds).toBeLessThan(11.5);
  });
});

describe('the game\'s sounds', () => {
  it('makes every missing effect and each land\'s music at start-up, keeps the recipe, and serves them', async () => {
    const effects = fakeSounds('elevenlabs', 'eleven_text_to_sound_v2');
    const music = fakeSounds('gemini', 'lyria-3-clip-preview');
    const { store, artDir } = await start({ sound: { effects: () => effects, music: () => music, finish, start: true } });
    await stop();
    expect(effects.asked).toHaveLength(effectCount);
    expect(music.asked).toHaveLength(landCount);
    expect(music.asked[0]!.prompt).toBe(musicPrompt('sanctum'));
    const spent = store.spendThisMonth(Date.now()).filter((s) => s.kind === 'sound');
    expect(spent).toHaveLength(effectCount + landCount);

    // Started again on the same art: nothing is made twice, and clients can load it all.
    await start({ store, artDir, sound: { effects: () => effects, music: () => music, finish, start: true } });
    await stop();
    expect(effects.asked).toHaveLength(effectCount);
    const third = await start({ store, artDir, sound: { effects: () => effects, music: () => music, finish } });
    const manifest = await (await fetch(`${third.base}/api/sounds`)).json();
    expect(manifest.hit).toMatchObject({ kind: 'effect', seconds: 1, file: expect.stringMatching(/^wished-art\/sounds\/hit-\w+\.mp3$/) });
    expect(manifest[musicId('whispering-woods')]).toMatchObject({ kind: 'music', seconds: 28 });
    const served = await fetch(`${third.base}/${manifest.hit.file}`);
    expect(served.headers.get('content-type')).toBe('audio/mpeg');
    expect(Buffer.from(await served.arrayBuffer()).toString()).toMatch(/^effect\|made: /);
    const kept = JSON.parse(await readFile(join(artDir, 'sounds', 'manifest.json'), 'utf8'));
    expect(kept.hit).toMatchObject({ provider: 'elevenlabs', model: 'eleven_text_to_sound_v2', prompt: expect.stringContaining(SOUND_EFFECTS.hit.prompt) });
  });

  it('says once in the painting log when there is no service, instead of failing each sound', async () => {
    const { base, store } = await start({ sound: { effects: () => undefined, music: () => undefined, finish, start: true } });
    const owner = account(store, 'Ego', 'owner');
    const { body } = await api(base, '/api/admin/art', owner.token);
    const skipped = body.jobs.filter((j: any) => j.status === 'skipped');
    expect(skipped).toHaveLength(2);
    expect(skipped.map((j: any) => j.reason).join(' ')).toMatch(/ELEVENLABS_API_KEY/);
    expect(body.sounds).toHaveLength(effectCount + landCount);
    expect(body.sounds[0]).toMatchObject({ makeable: false, why: expect.stringMatching(/sound-effects service/) });
  });

  it('makes one sound again with the Owner\'s words, from the Art tab, keeping the old file', async () => {
    const effects = fakeSounds('elevenlabs', 'eleven_text_to_sound_v2');
    const music = fakeSounds('gemini', 'lyria-3-clip-preview');
    const { base, store } = await start({ sound: { effects: () => effects, music: () => music, finish, start: true } });
    const owner = account(store, 'Ego', 'owner');
    const before = (await made(base, 'coin')).file;
    await new Promise((r) => setTimeout(r, 5));
    const asked = await api(base, '/api/admin/art/sound', owner.token, 'POST', { sound: 'coin', note: 'heavier coins' });
    expect(asked.status).toBe(202);
    expect(asked.body.estimateUsd).toBeGreaterThan(0);
    await app!.art.idle();
    expect(effects.asked.some((a) => a.prompt.endsWith('Also: heavier coins'))).toBe(true);
    const after = (await (await fetch(`${base}/api/sounds`)).json()).coin;
    expect(after.file).not.toBe(before);
    expect(after.redone).toEqual(expect.any(Number));
    expect((await fetch(`${base}/${before}`)).status).toBe(200);
    expect((await api(base, '/api/admin/art/sound', owner.token, 'POST', { sound: 'kazoo' })).body.message).toMatch(/no sound/);
    const steward = account(store, 'Wren', 'steward');
    expect((await api(base, '/api/admin/art/sound', steward.token, 'POST', { sound: 'coin' })).status).toBe(403);
  });

  it('lets the Owner choose the sound services on the AI models tab', async () => {
    const { base, store } = await start({ env: { GEMINI_API_KEY: 'g' } });
    const owner = account(store, 'Ego', 'owner');
    const { body } = await api(base, '/api/admin/ai', owner.token);
    expect(body.ai.sound).toEqual({ effects: { provider: 'none', model: '' }, music: { provider: 'gemini', model: 'lyria-3-clip-preview' } });
    expect(body.effectsKeySet).toBe(false);
    const saved = await api(base, '/api/admin/ai', owner.token, 'PUT', { ...body.ai, sound: { effects: { provider: 'elevenlabs', model: '' }, music: { provider: 'none' } } });
    expect(saved.status).toBe(200);
    expect(store.settings.ai.sound).toEqual({ effects: { provider: 'elevenlabs', model: 'eleven_text_to_sound_v2' }, music: { provider: 'none', model: '' } });
    await stop();
  });
});
