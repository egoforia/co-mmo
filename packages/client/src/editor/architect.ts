import type { WorldEditDraft } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';

// The AI Map Architect in the editor: say in plain words what to change; it
// proposes steps, the server checks each, and they are marked on the map (in
// cyan on the Plan camera) to tick before anything changes. Made steps are
// drafts unless changes go live at once. Its form is `#architect-form`, its
// ticks `data-ai-check`, and Make and Never mind `data-ai-apply`, `data-ai-discard`.

/** One step the Architect proposes, as the server checked it. */
export interface AiStep {
  draft: WorldEditDraft;
  summary: string;
  valid: boolean;
  why?: string;
  checked: boolean;
}

/** What the Architect holds: the words asked, its answer, what it cost, and its steps. */
export interface ArchitectState {
  prompt: string;
  summary: string;
  usd: number;
  steps: AiStep[];
  busy: boolean;
}

export const emptyArchitect = (): ArchitectState => ({ prompt: '', summary: '', usd: 0, steps: [], busy: false });

async function call<T>(token: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Error(json.message ?? 'The Architect could not reach the server. Try again.');
  return json as T;
}

/** Asks the Architect for steps; the state holds them, each ticked when it fits. */
export async function askArchitect(a: ArchitectState, token: string, region: string, prompt: string): Promise<void> {
  a.prompt = prompt;
  a.busy = true;
  try {
    const res = await call<{ rationale: string; usd: number; steps: Omit<AiStep, 'checked'>[] }>(token, '/api/world-edits/ai-preview', { region, prompt });
    Object.assign(a, { summary: res.rationale, usd: res.usd, steps: res.steps.map((s) => ({ ...s, checked: s.valid })) });
  } finally {
    a.busy = false;
  }
}

/** Makes the ticked steps that fit; how many were made. */
export async function makeSteps(a: ArchitectState, token: string, region: string, live: boolean): Promise<number> {
  const drafts = ticked(a);
  if (!drafts.length) return 0;
  a.busy = true;
  try {
    const res = await call<{ applied: number }>(token, '/api/world-edits/ai-apply', { region, drafts, live });
    Object.assign(a, { summary: '', steps: [] });
    return res.applied;
  } finally {
    a.busy = false;
  }
}

/** The steps ticked that fit, to mark and to make. */
export function ticked(a: ArchitectState): WorldEditDraft[] {
  return a.steps.filter((s) => s.checked && s.valid).map((s) => s.draft);
}

/** The Architect's card: its form, then its steps to tick. */
export function architectHtml(a: ArchitectState): string {
  const n = ticked(a).length;
  const steps = a.steps.length ? `<p class="note"><b>${escapeHtml(a.summary)}</b>${a.usd ? ` <small>($${a.usd.toFixed(3)})</small>` : ''}</p>
    <ul class="ai-steps">${a.steps.map((s, i) => `<li class="${s.valid ? 'ok' : 'bad'}"><label class="check">
      <input type="checkbox" data-ai-check="${i}"${s.checked && s.valid ? ' checked' : ''}${s.valid ? '' : ' disabled'} /> ${escapeHtml(s.summary)}</label>${s.why ? `<small class="bad">${escapeHtml(s.why)}</small>` : ''}</li>`).join('')}</ul>
    <p><button type="button" data-ai-apply${n && !a.busy ? '' : ' disabled'}>Make ${n} step${n === 1 ? '' : 's'}</button> <button type="button" class="quiet" data-ai-discard>Never mind</button></p>` : '';
  return `<form id="architect-form" class="architect"><p class="note">Say in plain words what to change. The Architect proposes steps and checks each one; they are marked on the plan before anything changes.</p>
    <textarea name="prompt" rows="3" placeholder="Lay a stone road from 22,28 to 36,28 and put two gathering spots beside it">${escapeHtml(a.prompt)}</textarea>
    <button type="submit"${a.busy ? ' disabled' : ''}>${a.busy ? 'Thinking…' : 'Show the steps'}</button></form>${steps}`;
}
