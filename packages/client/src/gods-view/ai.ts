// The AI models tab in God's View: which model the God, the fallback, and the rule compiler use,
// plus the prayer tester and the coding agent. Art, video, sound, music, and the AI Art Director
// models live in the standalone AI Art Studio (/art-studio.html#models).

import { escapeHtml } from '../ui.ts';
import { api, toast, usd, when, type Handled, type Tab } from './core.ts';

interface AiSettings {
  ai: {
    god: { provider: string; model: string };
    fallback: { provider: string; model: string } | null;
    compiler?: { provider: string; model: string } | null;
  };
  providers: { id: string; keySet: boolean; keyName: string | null; defaultModel: string }[];
  keys: { name: string; set: boolean; for: string }[];
}

interface BuildsInfo {
  settings: { agent: 'claude' | 'manual'; dailyLimit: number; usdPerBuild: number };
  connection: { connected: boolean; repo: string | null; reason?: string; lastError?: string; lastSync: number | null };
  today: number;
}

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
      <button type="submit">Save</button>
    </form>
    <p class="note">Pictures, walk videos, sound effects, music, and the AI Art Director (style check judge) now live in the <a href="/art-studio.html#models"><b>✦ AI Art Studio · AI Models</b></a> tab.</p>
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

/** A provider change suggests its default model. */
function change(el: HTMLElement): boolean {
  const select = el as HTMLSelectElement;
  const input = select.parentElement?.querySelector<HTMLInputElement>('input');
  const provider = aiState?.providers.find((p) => p.id === select.value);
  if (input && provider && /Provider$/.test(select.name)) input.value = provider.defaultModel;
  return false;
}

export const aiTab: Tab = { id: 'ai', label: 'AI models', ownerOnly: true, page: ai, click, submit, change };
