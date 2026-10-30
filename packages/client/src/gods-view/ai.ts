// The AI models tab: which model the God, the compiler, the judge, painting, video and sound use, and the coding agent.

import { escapeHtml } from '../ui.ts';
import { api, toast, usd, when, type Handled, type Tab } from './core.ts';

interface AiSettings {
  ai: {
    god: { provider: string; model: string };
    fallback: { provider: string; model: string } | null;
    compiler?: { provider: string; model: string } | null;
    image: { provider: string; model: string; uses?: Partial<Record<ArtUse, string>> };
    video: { provider: string; model: string; dailyClips: number };
    sound: { effects: { provider: string; model: string }; music: { provider: string; model: string } };
    styleCheck: { judge: { provider: string; model: string } | null; retries: number; reuse: boolean };
  };
  providers: { id: string; keySet: boolean; keyName: string | null; defaultModel: string }[];
  imageKeySet: boolean;
  replicateKeySet?: boolean;
  effectsKeySet: boolean;
  /** Walk clips made since Google's daily reset, when walks use Veo. */
  clipsToday?: { count: number; resetsAt: number };
  keys: { name: string; set: boolean; for: string }[];
  catalog: Record<'image' | 'video' | 'music' | 'effects', { model: string; usd: number; per: string }[]>;
}

interface BuildsInfo {
  settings: { agent: 'claude' | 'manual'; dailyLimit: number; usdPerBuild: number };
  connection: { connected: boolean; repo: string | null; reason?: string; lastError?: string; lastSync: number | null };
  today: number;
}

type ArtUse = 'wishes' | 'buildings' | 'scenery' | 'walks';
const ART_USES: [ArtUse, string][] = [['buildings', 'Buildings and furniture'], ['scenery', 'Scenery and landmarks'], ['wishes', 'Wished things and characters'], ['walks', 'Standing views for walks']];

let aiState: AiSettings | null = null;

async function ai(): Promise<string> {
  const [settings, b] = await Promise.all([api<AiSettings>('ai'), api<BuildsInfo>('builds')]);
  aiState = settings;
  const s = aiState;
  const options = (selected: string, none = false) =>
    (none ? ['<option value="">None</option>'] : [])
      .concat(s.providers.map((p) => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${label(p.id)}${p.keySet ? '' : ' (no key)'}</option>`))
      .join('');
  const keys = s.keys.map((k) => `<li><span class="${k.set ? 'ok' : 'missing'}">${k.set ? 'set' : 'not set'}</span> ${escapeHtml(k.name)} <small>${escapeHtml(k.for)}</small></li>`).join('');
  return `
    <h2>The God's language model</h2>
    <form id="ai-form" class="form">
      <label>Model<span><select name="godProvider">${options(s.ai.god.provider)}</select><input name="godModel" value="${escapeHtml(s.ai.god.model)}"></span></label>
      <label>Fallback, if it fails<span><select name="fallbackProvider">${options(s.ai.fallback?.provider ?? '', true)}</select><input name="fallbackModel" value="${escapeHtml(s.ai.fallback?.model ?? '')}" placeholder="default model"></span></label>
      <label>Rule compiler<span><select name="compilerProvider">${options(s.ai.compiler?.provider ?? '', true).replace('>None<', '>Same as the God<')}</select><input name="compilerModel" value="${escapeHtml(s.ai.compiler?.model ?? '')}" placeholder="drafts scripts for Major wishes"></span></label>
      <h3>Pictures, video and sound</h3>
      <label>Pictures<span><select name="imageProvider"><option value="gemini"${s.ai.image.provider === 'gemini' ? ' selected' : ''}>Google AI Studio${s.imageKeySet ? '' : ' (no key)'}</option><option value="none"${s.ai.image.provider === 'none' ? ' selected' : ''}>None (placeholder art only)</option></select><input name="imageModel" list="image-models" value="${escapeHtml(s.ai.image.model)}"></span></label>
      ${ART_USES.map(([use, name]) => `<label class="sub">${name}<span><input name="use-${use}" list="image-models" value="${escapeHtml(s.ai.image.uses?.[use] ?? '')}" placeholder="same as Pictures"></span></label>`).join('')}
      <label>Walk videos<span><select name="videoProvider"><option value="gemini"${s.ai.video.provider === 'gemini' ? ' selected' : ''}>Google Veo${s.imageKeySet ? '' : ' (no key)'}</option><option value="replicate"${s.ai.video.provider === 'replicate' ? ' selected' : ''}>Replicate (Wan)${s.replicateKeySet ? '' : ' (no key)'}</option><option value="none"${s.ai.video.provider === 'none' ? ' selected' : ''}>None (no new walks)</option></select><input name="videoModel" list="video-models" value="${escapeHtml(s.ai.video.model)}" placeholder="veo-3.1-lite-generate-preview"></span></label>
      <label class="sub">Clips a day<span><input name="dailyClips" type="number" min="0" max="1000" step="1" value="${s.ai.video.dailyClips}"></span></label>
      <p class="note">Google allows only a few Veo clips a day on this key and does not say so when it refuses, so walks stop once this many are made and pick up after Google's reset at 08:00 UTC. Replicate has no daily cap, so there this is just a limit on spending; <code>alibaba/wan-3</code> costs about $0.10 a second at 720p.${s.clipsToday ? ` Made since the last reset: <b>${s.clipsToday.count} of ${s.ai.video.dailyClips}</b>.` : ''}</p>
      <label>Sound effects<span><select name="effectsProvider"><option value="elevenlabs"${s.ai.sound.effects.provider === 'elevenlabs' ? ' selected' : ''}>ElevenLabs${s.effectsKeySet ? '' : ' (no key)'}</option><option value="none"${s.ai.sound.effects.provider === 'none' ? ' selected' : ''}>None (no sound effects)</option></select><input name="effectsModel" list="effects-models" value="${escapeHtml(s.ai.sound.effects.model)}" placeholder="eleven_text_to_sound_v2"></span></label>
      <label>Music<span><select name="musicProvider"><option value="gemini"${s.ai.sound.music.provider === 'gemini' ? ' selected' : ''}>Google Lyria${s.imageKeySet ? '' : ' (no key)'}</option><option value="none"${s.ai.sound.music.provider === 'none' ? ' selected' : ''}>None (no music)</option></select><input name="musicModel" list="music-models" value="${escapeHtml(s.ai.sound.music.model)}" placeholder="lyria-3-clip-preview"></span></label>
      <h3>Style check</h3>
      <label>Judge<span><select name="judgeProvider">${options(s.ai.styleCheck.judge?.provider ?? '', true).replace('>None<', '>Same as the God<').replace(/>Offline God[^<]*</, '>Free checks only<')}</select><input name="judgeModel" value="${escapeHtml(s.ai.styleCheck.judge?.provider === 'offline' ? '' : s.ai.styleCheck.judge?.model ?? '')}" placeholder="a model that can see pictures"></span></label>
      <label>Paint again when a picture fails<span><select name="retries">${[0, 1, 2].map((n) => `<option value="${n}"${n === s.ai.styleCheck.retries ? ' selected' : ''}>${n === 0 ? 'Never' : n === 1 ? 'Once' : 'Up to twice'}</option>`).join('')}</select></span></label>
      <label class="check"><input type="checkbox" name="reuse"${s.ai.styleCheck.reuse ? ' checked' : ''}> Show an existing picture when a new wish looks the same, instead of painting one</label>
      <p class="note">Every wished picture is checked for free first: a clean background, nothing cut off, no pure black, white or neon. The judge then compares it with the approved anchors and the wish, for well under a cent. A picture that still fails after its retries is shown anyway, marked on the Art tab, and the Stewards are told.</p>
      ${(['image', 'video', 'effects', 'music'] as const).map((kind) => `<datalist id="${kind}-models">${s.catalog[kind].map((m) => `<option value="${escapeHtml(m.model)}">about ${usd(m.usd)} a ${m.per}</option>`).join('')}</datalist>`).join('')}
      <p class="note">Prices per model: ${(['image', 'video', 'effects', 'music'] as const).flatMap((kind) => s.catalog[kind].map((m) => `<code>${escapeHtml(m.model)}</code> about ${usd(m.usd)} a ${m.per}`)).join(' · ')}. A dearer picture model can be used only where it shows most, such as buildings.</p>
      <button type="submit">Save</button>
    </form>
    <p class="note">The offline God needs no key: it understands simple wishes and is always the last fallback. Keys live in the server's environment (the .env file), never here; restart the game after adding one.</p>
    <ul class="keys">${keys}</ul>
    <h2>Try it</h2>
    <form id="ai-test" class="form">
      <label>Prayer<span><input name="prompt" placeholder="I wish for a glowing blue hat"><button type="submit">Ask</button></span></label>
    </form>
    <pre id="ai-result" hidden></pre>
    ${codingAgent(b)}`;
}

/** Who builds Engine wishes, how many a day, and whether GitHub is connected. */
function codingAgent(b: BuildsInfo): string {
  const c = b.connection;
  const status = c.connected
    ? `<p class="note"><b class="ok">Connected</b> to <code>${escapeHtml(c.repo ?? '')}</code>${c.lastSync ? ` · checked ${when(c.lastSync)}` : ''} · ${b.today} of ${b.settings.dailyLimit} builds started today</p>${c.lastError ? `<p class="note bad">${escapeHtml(c.lastError)}</p>` : ''}`
    : `<p class="note warn"><b>Not connected.</b> ${escapeHtml(c.reason ?? '')}</p>`;
  return `
    <h2>Coding agent</h2>
    <p class="note">Builds approved Engine wishes as pull requests on GitHub. It can only open pull requests: you merge them, then release them from Updates.</p>
    ${status}
    <form id="builds-form" class="form">
      <label>Who builds<span><select name="agent">
        <option value="claude"${b.settings.agent === 'claude' ? ' selected' : ''}>Claude Code in GitHub Actions</option>
        <option value="manual"${b.settings.agent === 'manual' ? ' selected' : ''}>A person (the game only opens the issue)</option>
      </select></span></label>
      <label>Builds per day<span><input name="dailyLimit" type="number" min="0" max="20" step="1" value="${b.settings.dailyLimit}"></span></label>
      <label>Guessed cost per build, counted until the run reports its real cost (USD)<span><input name="usdPerBuild" type="number" min="0" max="50" step="0.5" value="${b.settings.usdPerBuild}"></span></label>
      <button type="submit">Save</button>
    </form>
    <p class="actions"><button type="button" class="quiet" data-builds-sync${c.connected ? '' : ' disabled'}>Check GitHub now</button></p>
    ${c.connected ? '' : `<details open><summary>Setting it up (once)</summary><ol class="setup">
      <li>Install the Claude GitHub app on the repository: github.com/apps/claude.</li>
      <li>Add your Anthropic API key to the repository's secrets as <code>ANTHROPIC_API_KEY</code> (Settings, Secrets and variables, Actions).</li>
      <li>Make a fine-grained GitHub token for this repository only, with Issues set to read and write and nothing else. Put it in the server's <code>.env</code> as <code>GITHUB_ISSUES_TOKEN=…</code> and restart the game.</li>
    </ol></details>`}`;
}

const label = (id: string) => ({ gemini: 'Google Gemini', anthropic: 'Anthropic Claude', openai: 'OpenAI-compatible', offline: 'Offline God' })[id] ?? id;

async function click(t: HTMLButtonElement): Promise<Handled> {
  if (t.dataset.buildsSync === undefined) return false;
  t.disabled = true;
  await api('builds/sync', 'POST');
  toast('Checked GitHub.');
  return true;
}

async function submit(form: HTMLFormElement, f: Record<string, string>): Promise<Handled> {
  if (form.id === 'builds-form') {
    await api('builds', 'PUT', { agent: f.agent, dailyLimit: Number(f.dailyLimit), usdPerBuild: Number(f.usdPerBuild) });
    toast('Saved.');
  } else if (form.id === 'ai-form') {
    await api('ai', 'PUT', {
      god: { provider: f.godProvider, model: f.godModel },
      fallback: f.fallbackProvider ? { provider: f.fallbackProvider, model: f.fallbackModel } : null,
      compiler: f.compilerProvider ? { provider: f.compilerProvider, model: f.compilerModel } : null,
      image: { provider: f.imageProvider, model: f.imageModel, uses: Object.fromEntries(ART_USES.map(([use]) => [use, f[`use-${use}`] ?? ''])) },
      video: { provider: f.videoProvider, model: f.videoModel, dailyClips: f.dailyClips },
      sound: { effects: { provider: f.effectsProvider, model: f.effectsModel }, music: { provider: f.musicProvider, model: f.musicModel } },
      styleCheck: { judge: f.judgeProvider ? { provider: f.judgeProvider, model: f.judgeModel } : null, retries: Number(f.retries), reuse: f.reuse === 'on' },
    });
    toast('Saved. The next prayer uses these models.');
  } else if (form.id === 'ai-test') {
    const out = document.getElementById('ai-result')!;
    out.hidden = false;
    out.textContent = 'Asking…';
    const r = await api<{ provider: string; model: string; reply: unknown; usd: number }>('ai/test', 'POST', { prompt: f.prompt });
    out.textContent = `${label(r.provider)} · ${r.model} · ${usd(r.usd)}\n\n${JSON.stringify(r.reply, null, 2)}`;
    return 'keep';
  } else return false;
  return true;
}

const VIDEO_DEFAULTS: Record<string, string> = { gemini: 'veo-3.1-lite-generate-preview', replicate: 'alibaba/wan-3' };

/** A provider change suggests its default model. */
function change(el: HTMLElement): boolean {
  const select = el as HTMLSelectElement;
  const input = select.parentElement?.querySelector<HTMLInputElement>('input');
  const provider = aiState?.providers.find((p) => p.id === select.value);
  if (input && provider && /Provider$/.test(select.name) && !['imageProvider', 'videoProvider', 'effectsProvider', 'musicProvider'].includes(select.name)) input.value = provider.defaultModel;
  // Each video service has its own models; suggest the first one it offers.
  if (input && select.name === 'videoProvider') input.value = VIDEO_DEFAULTS[select.value] ?? '';
  return false;
}

export const aiTab: Tab = { id: 'ai', label: 'AI models', ownerOnly: true, page: ai, click, submit, change };
