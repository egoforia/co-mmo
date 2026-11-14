// God's View Monsters tab (its id is still "loot"): how big every kind of
// creature stands, what it may leave on its body, where each loot line came
// from (built in, a wish, or God's View), and setting both anew. Each change
// is kept like a wish, so it can be undone here.

import { CHARACTER_HEIGHT, CREATURE_HEIGHTS, SIZE_TIERS, SIZE_WORDS, chanceText, type CreatureSizeTier } from '@co-mmo/shared';
import { escapeHtml } from './ui.ts';

export interface LootContext {
  api<T>(path: string, method?: string, body?: unknown): Promise<T>;
  toast(text: string): void;
  /** Draws the open tab again. */
  rerender(): void;
}

interface Source {
  kind: 'built-in' | 'creature-wish' | 'wish' | 'gods-view';
  by?: string;
  at?: number;
  entry?: string;
}

interface CreatureLoot {
  id: string;
  name: string;
  picture?: string;
  level: number;
  size: CreatureSizeTier;
  ownSize: CreatureSizeTier;
  wished?: { by: string; at: number; entry: string };
  lines: { item: string; name: string; chance: number; qty: number; source: Source }[];
  changes: { id: string; at: number; by: string; godsView: boolean; status: string; summary: string }[];
}

interface Overview {
  creatures: CreatureLoot[];
  items: { id: string; name: string; bound: boolean }[];
}

/** Empty rows each form offers for adding things. */
const SPARE_ROWS = 2;

const when = (at: number) => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Where a line came from, in words. */
function sourceText(s: Source): string {
  const at = s.at ? ` · ${when(s.at)}` : '';
  if (s.kind === 'gods-view') return `Changed by God (${escapeHtml(s.by ?? '')}, in God's View)${at}`;
  if (s.kind === 'wish') return `Wished by ${escapeHtml(s.by ?? '')}${at}`;
  if (s.kind === 'creature-wish') return `Came with ${escapeHtml(s.by ?? '')}'s wish for the creature`;
  return 'Built in';
}

export async function lootPage(ctx: LootContext): Promise<string> {
  const o = await ctx.api<Overview>('loot');
  const options = (chosen?: string) => ['<option value="">(nothing)</option>',
    ...o.items.map((i) => `<option value="${escapeHtml(i.id)}"${i.id === chosen ? ' selected' : ''}>${escapeHtml(i.name)}${i.bound ? ' (bound)' : ''}</option>`)].join('');
  const sizeForm = (c: CreatureLoot) => {
    const others = o.creatures.filter((x) => x.id !== c.id && x.size === c.size).map((x) => escapeHtml(x.name));
    const choices = SIZE_TIERS.map((t) => `<option value="${t}"${t === c.size ? ' selected' : ''}>${escapeHtml(SIZE_WORDS[t])}, ${CREATURE_HEIGHTS[t]} px${t === c.ownSize ? ' (its own)' : ''}</option>`).join('');
    return `<form class="form loot-size" data-size="${escapeHtml(c.id)}">
        <label>Size <select name="size">${choices}</select></label>
        <button type="submit">Save size</button>
        <p class="note">Stands ${CREATURE_HEIGHTS[c.size]} px tall (a player is ${CHARACTER_HEIGHT} px), and its body is as wide as its size.
          ${others.length ? `The same size: ${others.join(', ')}.` : 'No other monster is this size.'} Saving changes every ${escapeHtml(c.name)} at once.</p>
      </form>`;
  };
  const card = (c: CreatureLoot) => {
    const rows = c.lines.map((l) => `<tr><td><b>${escapeHtml(l.name)}</b></td><td>${chanceText(l.chance)}</td><td>${l.qty}</td><td>${sourceText(l.source)}</td></tr>`).join('');
    const edit = [...c.lines.map((l) => ({ item: l.item, chance: l.chance, qty: l.qty })), ...Array.from({ length: SPARE_ROWS }, () => ({ item: '', chance: 0.25, qty: 1 }))]
      .map((l, i) => `<div class="loot-row">
        <select name="item-${i}" aria-label="Item">${options(l.item)}</select>
        <label>Chance <input type="number" name="chance-${i}" min="1" max="100" value="${Math.round(l.chance * 100)}"> %</label>
        <label>How many <input type="number" name="qty-${i}" min="1" max="99" value="${l.qty}"></label>
      </div>`).join('');
    const history = c.changes.map((h) => `<li>${when(h.at)} · ${h.godsView ? `Changed by God (${escapeHtml(h.by)})` : `Wished by ${escapeHtml(h.by)}`}: ${escapeHtml(h.summary)}
      ${h.status === 'granted' ? `<button type="button" class="quiet" data-loot-undo="${escapeHtml(h.id)}">Undo</button>` : ' <i>(undone)</i>'}</li>`).join('');
    return `<section class="wish loot" id="loot-${escapeHtml(c.id)}">
      <header>${c.picture ? `<img src="${escapeHtml(c.picture)}" alt="">` : ''}<b>${escapeHtml(c.name)}</b>
        <span class="tier">level ${c.level}</span><span class="tier">${escapeHtml(SIZE_WORDS[c.size].replace(/ \(.*\)$/, '').toLowerCase())}</span><small>${c.wished ? `wished by ${escapeHtml(c.wished.by)}` : 'built in'}</small></header>
      <details><summary>Change its size</summary>${sizeForm(c)}</details>
      ${rows ? `<table class="log"><tr><th>Drops</th><th>Chance</th><th>How many</th><th>From</th></tr>${rows}</table>` : '<p class="note">It drops nothing.</p>'}
      <details><summary>Change its loot</summary>
        <form class="form loot-form" data-loot="${escapeHtml(c.id)}">
          ${edit}
          <p class="note">Saving sets its whole loot, for every ${escapeHtml(c.name)} defeated from now on. Choose "(nothing)" to take a line away.</p>
          <button type="submit">Save loot</button>
        </form>
      </details>
      ${history ? `<details><summary>Changes (${c.changes.length})</summary><ul class="recent">${history}</ul></details>` : ''}
    </section>`;
  };
  return `
    <p>How big each kind of monster stands, and what it may leave on its body when it is defeated. A size counts for every monster of that kind, so similar monsters stay one size. Anyone close by can open its loot with <b>E</b> and take what they like; the rest stays on the body until it fades.
      Players can wish for more loot; a wish adds to what a creature drops, and saving here sets its whole list. Every change can be undone.</p>
    ${o.creatures.map(card).join('')}`;
}

/** Undoes a loot change. True when the click was the Loot tab's. */
export function lootClick(target: HTMLElement, ctx: LootContext): boolean {
  const undo = target.closest<HTMLButtonElement>('button[data-loot-undo]')?.dataset.lootUndo;
  if (!undo) return false;
  if (!confirm('Undo this change? The creature goes back to what it was before it.')) return true;
  void ctx.api(`content/${undo}/rollback`, 'POST').then(() => {
    ctx.toast('Undone. It is back to what it was before that change.');
    ctx.rerender();
  }, (err: Error) => ctx.toast(err.message));
  return true;
}

/** Saves a creature's size or loot form. True when the form was the Loot tab's. */
export function lootSubmit(form: HTMLFormElement, ctx: LootContext): boolean {
  const sized = form.dataset.size;
  if (sized) {
    const size = String(new FormData(form).get('size') ?? '');
    void ctx.api(`creature-size/${sized}`, 'PUT', { size }).then(() => {
      ctx.toast('Saved. Every one of them stands this size now.');
      ctx.rerender();
    }, (err: Error) => ctx.toast(err.message));
    return true;
  }
  const creature = form.dataset.loot;
  if (!creature) return false;
  const f = new FormData(form);
  const drops: { item: string; chance: number; qty: number }[] = [];
  for (let i = 0; f.has(`item-${i}`); i++) {
    const item = String(f.get(`item-${i}`) ?? '');
    if (item) drops.push({ item, chance: Number(f.get(`chance-${i}`)) / 100, qty: Number(f.get(`qty-${i}`)) || 1 });
  }
  void ctx.api(`loot/${creature}`, 'PUT', { drops }).then(() => {
    ctx.toast('Saved. Creatures defeated from now on drop this.');
    ctx.rerender();
  }, (err: Error) => ctx.toast(err.message));
  return true;
}
