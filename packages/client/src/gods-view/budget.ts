// The Budget tab: this month's and today's spending, and the limits.

import { escapeHtml } from '../ui.ts';
import { api, toast, usd, type Budget, type Handled, type Tab } from './core.ts';

async function budget(): Promise<string> {
  const b = await api<Budget>('budget');
  const pct = Math.min(100, (100 * b.spentUsd) / Math.max(b.monthlyUsd, 0.0001));
  const list = (o: Record<string, number> = {}) =>
    Object.entries(o).sort((a, c) => c[1] - a[1]).map(([k, v]) => `<li><span>${escapeHtml(k)}</span><b>${usd(v)}</b></li>`).join('') || '<li><span>Nothing yet</span></li>';
  return `
    <h2>This month</h2>
    <div class="budget ${b.over ? 'bad' : b.warn ? 'warn' : ''}">
      <div class="bar"><span style="width:${pct}%"></span><i style="left:${(100 * b.warnUsd) / Math.max(b.monthlyUsd, 0.0001)}%"></i></div>
      <p><b>${usd(b.spentUsd)}</b> of ${usd(b.monthlyUsd)} · ${b.calls ?? 0} paid calls${b.estimatedUsd ? ` · ${usd(b.estimatedUsd)} of it is a guess until those builds report their real cost` : ''}${b.over ? ' · <b>Over the ceiling: the offline God answers and no art is painted.</b>' : b.warn ? ' · Past the warning line.' : ''}</p>
    </div>
    <div class="cols">
      <div><h3>Today</h3><ul class="spend"><li><span>Spent today (UTC)</span><b>${usd(b.todayUsd ?? 0)}</b></li><li><span>Daily cap</span><b>${usd(b.dailyUsd ?? 0)}</b></li></ul>${b.overToday ? '<p class="note bad">Today\'s cap is reached: painting and sound wait until midnight UTC, then whatever is missing is made.</p>' : ''}</div>
      <div><h3>By provider</h3><ul class="spend">${list(b.byProvider)}</ul></div>
      <div><h3>By kind</h3><ul class="spend">${list(b.byKind)}</ul></div>
      <div><h3>By player</h3><ul class="spend">${list(b.byPlayer)}</ul></div>
    </div>
    <h2>Limits</h2>
    <form id="budget-form" class="form">
      <label>Monthly ceiling (USD)<span><input name="monthlyUsd" type="number" min="0" step="1" value="${b.monthlyUsd}"></span></label>
      <label>Warn at (USD)<span><input name="warnUsd" type="number" min="0" step="1" value="${b.warnUsd}"></span></label>
      <label>Daily cap (USD): painting, walks and sound pause for the day once spending reaches it<span><input name="dailyUsd" type="number" min="0" step="0.5" value="${b.dailyUsd ?? 10}"></span></label>
      <label class="check"><input type="checkbox" name="samples"${b.workshop?.samples ? ' checked' : ''}> Paint a sample in Wish Workshop previews (one per draft, paid by the player in Favor; paused past the warning line)</label>
      <label>Favor a sample costs<span><input name="sampleFavor" type="number" min="0" max="10" step="1" value="${b.workshop?.sampleFavor ?? 1}"></span></label>
      <button type="submit">Save</button>
    </form>`;
}

async function submit(form: HTMLFormElement, f: Record<string, string>): Promise<Handled> {
  if (form.id !== 'budget-form') return false;
  await api('budget', 'PUT', { monthlyUsd: Number(f.monthlyUsd), warnUsd: Number(f.warnUsd), dailyUsd: Number(f.dailyUsd), samples: f.samples === 'on', sampleFavor: Number(f.sampleFavor) });
  toast('Budget saved.');
  return true;
}

export const budgetTab: Tab = { id: 'budget', label: 'Budget', ownerOnly: true, page: budget, submit };
