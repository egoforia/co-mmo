// Decoupled Art & Media AI Models Tab (#models) in the AI Art Studio:
// - Pictures model + per-use overrides (buildings, scenery, wishes, walks)
// - Walk Videos (Google Veo / Replicate Wan) + daily clip cap & clipsToday tracker
// - Sound Effects (ElevenLabs) & Region Music (Google Lyria)
// - AI Art Director & Vision Style Judge (judge provider/model, auto-retries, picture reuse)
// - Model pricing catalog & API key status badges

import { artState, esc, usd } from './state.ts';

type ArtUse = 'wishes' | 'buildings' | 'scenery' | 'walks';
const ART_USES: [ArtUse, string][] = [
  ['buildings', 'Buildings and furniture'],
  ['scenery', 'Scenery and landmarks'],
  ['wishes', 'Wished things and characters'],
  ['walks', 'Standing views for walks'],
];

interface StudioAiSettings {
  ai: {
    god: { provider: string; model: string };
    image: { provider: string; model: string; uses?: Partial<Record<ArtUse, string>> };
    video: { provider: string; model: string; dailyClips: number };
    sound: { effects: { provider: string; model: string }; music: { provider: string; model: string } };
    styleCheck: { judge: { provider: string; model: string } | null; retries: number; reuse: boolean };
  };
  providers: { id: string; keySet: boolean; keyName: string | null; defaultModel: string }[];
  imageKeySet: boolean;
  replicateKeySet?: boolean;
  effectsKeySet: boolean;
  clipsToday?: { count: number; resetsAt: number };
  keys: { name: string; set: boolean; for: string }[];
  catalog: Record<'image' | 'video' | 'music' | 'effects', { model: string; usd: number; per: string }[]>;
}

let modelsState: StudioAiSettings | null = null;

const providerLabel = (id: string) =>
  ({ gemini: 'Google Gemini', anthropic: 'Anthropic Claude', openai: 'OpenAI-compatible', offline: 'Offline God' })[id] ?? id;

export async function loadArtModels(): Promise<StudioAiSettings> {
  modelsState = await artState.ctx.api<StudioAiSettings>('ai');
  return modelsState;
}

export function modelsPage(): string {
  const s = modelsState;
  if (!s) return '<p class="note">Loading AI Art &amp; Media models…</p>';

  const judgeOptions = (selected: string) =>
    ['<option value="">Same as the God</option>']
      .concat(
        s.providers.map(
          (p) =>
            `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(
              p.id === 'offline' ? 'Free pixel checks only' : providerLabel(p.id),
            )}${p.keySet ? '' : ' (no key)'}</option>`,
        ),
      )
      .join('');

  const keys = s.keys
    .map(
      (k) =>
        `<li><span class="${k.set ? 'ok' : 'missing'}">${k.set ? 'set' : 'not set'}</span> <code>${esc(k.name)}</code> <small>${esc(k.for)}</small></li>`,
    )
    .join('');

  return `
    <div class="studio-split-header">
      <div>
        <h2>🤖 Art, Animation, Audio &amp; AI Art Director Models</h2>
        <p class="note">Configure the generative models that power pictures, 4-way turnarounds, walk/run/attack clips, sound effects, region music, and the AI Art Director's vision style judge. Gameplay &amp; Coding models live in <a href="/gods-view.html#ai"><b>God's View · AI Models</b></a>.</p>
      </div>
    </div>

    <div class="director-grid">
      <section class="studio-card">
        <h3>Pictures, Walk Videos &amp; Audio Models</h3>
        <form id="studio-models-form" class="form">
          <label>Pictures (Sprites, Tiles, Props, Icons &amp; Turnarounds)
            <span>
              <select name="imageProvider">
                <option value="gemini"${s.ai.image.provider === 'gemini' ? ' selected' : ''}>Google AI Studio${s.imageKeySet ? '' : ' (no key)'}</option>
                <option value="none"${s.ai.image.provider === 'none' ? ' selected' : ''}>None (placeholder art only)</option>
              </select>
              <input name="imageModel" list="image-models" value="${esc(s.ai.image.model)}" />
            </span>
          </label>
          ${ART_USES.map(
            ([use, name]) =>
              `<label class="sub">${esc(name)}<span><input name="use-${use}" list="image-models" value="${esc(s.ai.image.uses?.[use] ?? '')}" placeholder="same as Pictures" /></span></label>`,
          ).join('')}

          <label>Walk &amp; Animation Videos
            <span>
              <select name="videoProvider">
                <option value="gemini"${s.ai.video.provider === 'gemini' ? ' selected' : ''}>Google Veo${s.imageKeySet ? '' : ' (no key)'}</option>
                <option value="replicate"${s.ai.video.provider === 'replicate' ? ' selected' : ''}>Replicate (Wan)${s.replicateKeySet ? '' : ' (no key)'}</option>
                <option value="none"${s.ai.video.provider === 'none' ? ' selected' : ''}>None (no new walks)</option>
              </select>
              <input name="videoModel" list="video-models" value="${esc(s.ai.video.model)}" placeholder="veo-3.1-lite-generate-preview" />
            </span>
          </label>
          <label class="sub">Clips per day cap
            <span><input name="dailyClips" type="number" min="0" max="1000" step="1" value="${s.ai.video.dailyClips}" /></span>
          </label>
          <p class="note">Google allows only a few Veo clips a day on one key; walks pause once this cap is reached and resume after 08:00 UTC.${
            s.clipsToday ? ` Made since last reset: <b>${s.clipsToday.count} of ${s.ai.video.dailyClips}</b>.` : ''
          }</p>

          <label>Sound Effects
            <span>
              <select name="effectsProvider">
                <option value="elevenlabs"${s.ai.sound.effects.provider === 'elevenlabs' ? ' selected' : ''}>ElevenLabs${s.effectsKeySet ? '' : ' (no key)'}</option>
                <option value="none"${s.ai.sound.effects.provider === 'none' ? ' selected' : ''}>None (no sound effects)</option>
              </select>
              <input name="effectsModel" list="effects-models" value="${esc(s.ai.sound.effects.model)}" placeholder="eleven_text_to_sound_v2" />
            </span>
          </label>

          <label>Region Music
            <span>
              <select name="musicProvider">
                <option value="gemini"${s.ai.sound.music.provider === 'gemini' ? ' selected' : ''}>Google Lyria${s.imageKeySet ? '' : ' (no key)'}</option>
                <option value="none"${s.ai.sound.music.provider === 'none' ? ' selected' : ''}>None (no music)</option>
              </select>
              <input name="musicModel" list="music-models" value="${esc(s.ai.sound.music.model)}" placeholder="lyria-3-clip-preview" />
            </span>
          </label>

          <h3>✦ AI Art Director &amp; Style Check Judge</h3>
          <label>Vision Judge &amp; Art Director Model
            <span>
              <select name="judgeProvider">${judgeOptions(s.ai.styleCheck.judge?.provider ?? '')}</select>
              <input name="judgeModel" value="${esc(s.ai.styleCheck.judge?.provider === 'offline' ? '' : s.ai.styleCheck.judge?.model ?? '')}" placeholder="vision-capable model (e.g. gemini-2.5-flash)" />
            </span>
          </label>
          <label>Auto-Repaint Retries When Style Check Fails
            <span>
              <select name="retries">
                ${[0, 1, 2]
                  .map(
                    (n) =>
                      `<option value="${n}"${n === s.ai.styleCheck.retries ? ' selected' : ''}>${
                        n === 0 ? 'Never (0)' : n === 1 ? 'Once (1)' : 'Up to twice (2)'
                      }</option>`,
                  )
                  .join('')}
              </select>
            </span>
          </label>
          <label class="check">
            <input type="checkbox" name="reuse"${s.ai.styleCheck.reuse ? ' checked' : ''} />
            Show an existing picture when a new wish looks the same, instead of painting a duplicate
          </label>

          ${(['image', 'video', 'effects', 'music'] as const)
            .map(
              (kind) =>
                `<datalist id="${kind}-models">${s.catalog[kind]
                  .map((m) => `<option value="${esc(m.model)}">about ${usd(m.usd)} a ${esc(m.per)}</option>`)
                  .join('')}</datalist>`,
            )
            .join('')}

          <button type="submit">Save Art &amp; Media AI Settings</button>
        </form>
      </section>

      <section class="studio-card">
        <h3>Model Pricing Reference</h3>
        <table class="log">
          <thead><tr><th>Category</th><th>Model ID</th><th>Estimated Cost</th></tr></thead>
          <tbody>
            ${(['image', 'video', 'effects', 'music'] as const)
              .flatMap((kind) =>
                s.catalog[kind].map(
                  (m) => `<tr><td>${esc(kind)}</td><td><code>${esc(m.model)}</code></td><td>about ${usd(m.usd)} / ${esc(m.per)}</td></tr>`,
                ),
              )
              .join('')}
          </tbody>
        </table>

        <h3>Environment API Keys (.env)</h3>
        <p class="note">Keys live in the server's environment (<code>.env</code>), never in the browser. Restart the server after adding a key.</p>
        <ul class="keys">${keys}</ul>
      </section>
    </div>`;
}

const VIDEO_DEFAULTS: Record<string, string> = { gemini: 'veo-3.1-lite-generate-preview', replicate: 'alibaba/wan-3' };

export function handleModelsChange(el: HTMLElement): boolean {
  const select = el as HTMLSelectElement;
  if (!select.form || select.form.id !== 'studio-models-form') return false;
  const input = select.parentElement?.querySelector<HTMLInputElement>('input');
  if (input && select.name === 'videoProvider') {
    input.value = VIDEO_DEFAULTS[select.value] ?? '';
    return true;
  }
  if (input && select.name === 'judgeProvider') {
    const p = modelsState?.providers.find((x) => x.id === select.value);
    if (p) input.value = p.id === 'offline' ? '' : p.defaultModel;
    return true;
  }
  return false;
}

export function handleModelsSubmit(form: HTMLFormElement): boolean {
  if (form.id !== 'studio-models-form') return false;
  const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
  void artState.ctx
    .api('ai', 'PUT', {
      image: {
        provider: f.imageProvider,
        model: f.imageModel,
        uses: Object.fromEntries(ART_USES.map(([use]) => [use, f[`use-${use}`] ?? ''])),
      },
      video: {
        provider: f.videoProvider,
        model: f.videoModel,
        dailyClips: Number(f.dailyClips),
      },
      sound: {
        effects: { provider: f.effectsProvider, model: f.effectsModel },
        music: { provider: f.musicProvider, model: f.musicModel },
      },
      styleCheck: {
        judge: f.judgeProvider ? { provider: f.judgeProvider, model: f.judgeModel } : null,
        retries: Number(f.retries),
        reuse: f.reuse === 'on',
      },
    })
    .then(
      async () => {
        await loadArtModels();
        artState.ctx.toast('Saved Art & Media AI models.');
        artState.ctx.rerender();
      },
      (err: Error) => artState.ctx.toast(err.message),
    );
  return true;
}
