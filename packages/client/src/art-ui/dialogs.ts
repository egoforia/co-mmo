// Review/approval modal, recipe step formatter (with diff highlighting), and
// side-by-side version comparison / rollback dialogs for God's View's Art tab.

import {
  ISO_WAYS,
  isWalkDirection,
  type Facing,
} from '@co-mmo/shared';
import {
  type ArtItem,
  type Ask,
  FACING_WORDS,
  MEDIA,
  type Recipe,
  type RecipeStep,
  type Review,
  SOURCE,
  type Shown,
   type SoundItem,
  WAYS,
  type WalkerView,
  artState,
  budgetLine,
  esc,
  stripHtml,
  usd,
  when,
} from './state.ts';

/** What one recipe sent, step by step; with `other`, prompt lines that differ from it are marked. */
export function recipeHtml(recipe: Recipe | undefined, other?: Recipe, planned = false): string {
  if (!recipe) return "<p class=\"note\">Nothing is known about what made this one: it was painted before God's View kept that.</p>";
  const otherLines = new Set(other?.steps.flatMap((s) => s.prompt.split('\n')) ?? []);
  const prompt = (text: string) => text.split('\n').map((line) => (other && !otherLines.has(line) ? `<mark>${esc(line)}</mark>` : esc(line))).join('\n');
  const step = (s: RecipeStep, i: number) => `
    <section class="step">
      <h4>${recipe.steps.length > 1 ? `${i + 1}. ` : ''}${esc(s.label)}</h4>
      <p class="meta"><b>${esc(s.model)}</b> <small>(${esc(s.provider === 'gemini' ? 'Google AI Studio' : s.provider)})</small> · ${MEDIA[s.media]}${s.settings.length ? ` · ${s.settings.map(esc).join(' · ')}` : ''} · ${planned || recipe.partial ? 'about' : 'cost'} ${usd(s.usd)}</p>
      ${s.pictures.length ? `<div class="sent">${s.pictures.map((p) => `<figure>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="" loading="lazy"></a>` : `<span class="ph">${p.later ? '↑' : '?'}</span>`}<figcaption>${esc(p.name)}${p.later ? '<br><small>painted in the step above</small>' : p.url ? '' : '<br><small>not kept</small>'}</figcaption></figure>`).join('')}</div>` : '<p class="note">No pictures sent along.</p>'}
      ${s.note ? `<p class="note">Sent with the pictures: “${esc(s.note)}”<br><small>The pictures here are only examples of the style, so this keeps the model from painting them again instead of what the prompt asks for. It is left out when a picture sent is the subject itself, such as a walk's standing picture.</small></p>` : ''}
      <pre class="prompt">${prompt(s.prompt)}</pre>
    </section>`;
  return `
    ${recipe.steps.map(step).join('')}
    ${recipe.notes?.length ? `<ul class="recipe-notes">${recipe.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    ${recipe.partial ? "<p class=\"note\">Kept from before God's View saved everything: the pictures sent along are shown as the game has them now.</p>" : ''}`;
}

export function dialog(): HTMLDialogElement {
  let d = document.getElementById('art-dialog') as HTMLDialogElement | null;
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'art-dialog';
  document.body.append(d);
  d.addEventListener('click', (e) => {
    // A click on the backdrop closes it.
    if (e.target === d) d!.close();
  });
  return d;
}

/** Asks the server what a request will send, and shows it for approval; `note` lets the Owner add words first. */
export async function openReview(ask: Ask, takesNote: boolean, note = ''): Promise<void> {
  const ctx = artState.ctx;
  const d = dialog();
  d.innerHTML = '<p class="note">Working out exactly what will be sent…</p>';
  if (!d.open) d.showModal();
  let review: Review;
  // A walk's standing picture or clip takes the Owner's own prompt in place of the usual one.
  const editable = ask.what === 'view' || ask.what === 'clip' || ask.what === 'normal' ? ask : undefined;
  try {
    review = await ctx.api<Review>('art/review', 'POST', { ...ask, ...(note ? { note } : {}) });
  } catch (err) {
    d.innerHTML = `<div class="dialog-body"><p class="bad">${esc((err as Error).message)}</p></div><footer><button type="button" class="quiet" data-close>Close</button></footer>`;
    d.querySelector('[data-close]')!.addEventListener('click', () => d.close());
    return;
  }
  const many = review.parts.length > 1;
  d.innerHTML = `
    <header><h2>${esc(review.title)}</h2><button type="button" class="quiet" data-close aria-label="Close">✕</button></header>
    <div class="dialog-body">
      <p class="note">This is everything that will be sent to the AI model${many ? 's' : ''}. Nothing is painted until you approve it.</p>
      ${ask.what === 'view' ? sourcesHtml(ask) : ''}
      ${editable ? `<form class="form review-prompt"><label>Prompt${editable.prompt ? ' (your own words)' : ' (the usual words; edit them if you like)'}<span><textarea name="prompt" rows="8" maxlength="4000">${esc(review.parts[0]?.recipe.steps[0]?.prompt ?? '')}</textarea></span></label>
        <div class="card-actions"><button type="submit" class="quiet">Show with this prompt</button>${editable.prompt ? '<button type="button" class="quiet" data-usual>Back to the usual prompt</button>' : ''}</div></form>` : ''}
      ${takesNote ? `<form class="form review-note"><label>Anything to change? (optional; added to the prompt)<span><textarea name="note" rows="2" maxlength="1000" placeholder="warmer light, a mossier roof">${esc(note)}</textarea></span></label><button type="submit" class="quiet">Show with these words</button></form>` : ''}
      ${review.parts.map((p) => `${many ? `<details><summary><b>${esc(p.name)}</b> · about ${usd(p.recipe.steps.reduce((n, s) => n + s.usd, 0))}</summary>${recipeHtml(p.recipe, undefined, true)}</details>` : recipeHtml(p.recipe, undefined, true)}`).join('')}
    </div>
    <footer>
      <span>About <b>${usd(review.estimateUsd)}</b> · ${budgetLine(artState.data!.budget)}</span>
      <button type="button" class="quiet" data-close>Cancel</button>
      <button type="button" data-approve>Approve and paint</button>
    </footer>`;
  for (const b of d.querySelectorAll('[data-close]')) b.addEventListener('click', () => d.close());
  d.querySelector('form.review-sources')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const from = new FormData(e.target as HTMLFormElement).getAll('from').map(String);
    if (!from.length) return ctx.toast('Pick at least one picture to paint from.');
    void openReview({ ...(ask as Extract<Ask, { what: 'view' }>), from }, false);
  });
  d.querySelector('form.review-prompt')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const words = String(new FormData(e.target as HTMLFormElement).get('prompt') ?? '').trim();
    void openReview({ ...editable!, ...(words ? { prompt: words } : {}) }, false);
  });
  d.querySelector('[data-usual]')?.addEventListener('click', () => {
    const { prompt: _, ...usual } = editable!;
    void openReview(usual, false);
  });
  d.querySelector('form.review-note')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const words = String(new FormData(e.target as HTMLFormElement).get('note') ?? '').trim();
    void openReview(ask, takesNote, words);
  });
  d.querySelector<HTMLButtonElement>('[data-approve]')!.addEventListener('click', async (e) => {
    const button = e.target as HTMLButtonElement;
    button.disabled = true;
    try {
      await ctx.api(`art/${ask.what}`, 'POST', { ...ask, ...(note ? { note } : {}), approved: review.fingerprint });
      d.close();
      ctx.toast(ask.what === 'clip' ? 'Approved. Clips take a minute or two each; follow them under Painting now.' : ask.what === 'view' ? 'Approved. The picture shows here once it is painted; then make the clip from it.' : ask.what === 'ways' ? 'Approved. Each picture shows here as it is painted; follow them under Painting now.' : 'Approved. Follow it under Painting now.');
      ctx.rerender();
    } catch (err) {
      button.disabled = false;
      ctx.toast((err as Error).message);
    }
  });
}

/** Which pictures a standing picture is painted from: the approved picture and any standing pictures already kept. */
export function sourcesHtml(ask: Extract<Ask, { what: 'view' }>): string {
  const w = artState.data!.walkers.find((x) => x.id === ask.walker);
  if (!w) return '';
  // The server's choice when none is made: an isometric way is painted from the other isometric ways too, so it matches them.
  const others = isWalkDirection(ask.direction) ? [] : ISO_WAYS.filter((d) => d !== ask.direction && w.standing[d].url && !w.standing[d].approved);
  const from = ask.from ?? ['approved', ...others];
  const options: [string, string, string | undefined][] = [['approved', 'The approved picture', w.url]];
  for (const [d, label] of WAYS) {
    const view = w.standing[d];
    if (view.url && !view.approved) options.push([d, `Standing, ${label}`, view.url]);
  }
  if (options.length < 2) return '';
  return `<form class="form review-sources"><p class="note">Paint it from these pictures (the approved one alone does not show everything, such as how a scarf hangs at the back):</p>
    <div class="source-picks">${options.map(([id, label, url]) => `<label class="check">${url ? `<img src="${esc(url)}" alt="">` : ''}<span><input type="checkbox" name="from" value="${id}"${from.includes(id) ? ' checked' : ''}> ${esc(label)}</span></label>`).join('')}</div>
    <button type="submit" class="quiet">Show with these pictures</button></form>`;
}

/** Shows the version in use beside an earlier one, with what made each, and puts the chosen one back. */
export function openVersions(title: string, now: Shown, earlier: Shown[], restore: (id: string) => Promise<void>, pick = 0): void {
  const ctx = artState.ctx;
  const d = dialog();
  const chosen = earlier[pick];
  d.innerHTML = `
    <header><h2>${esc(title)}</h2><button type="button" class="quiet" data-close aria-label="Close">✕</button></header>
    <div class="dialog-body">
      ${earlier.length ? `<p class="note">Pick an earlier version to compare with the one in use. Lines of its prompt that differ are marked.</p>
        <div class="version-picks">${earlier.map((v, i) => `<button type="button" class="quiet${i === pick ? ' chosen' : ''}" data-pick="${i}">${v.look}<small>${esc(v.label)}</small></button>`).join('')}</div>` : '<p class="note">There are no earlier versions yet. Painting it again keeps this one here, so it can be put back.</p>'}
      <div class="compare${chosen ? '' : ' single'}">
        <section><h3>In use now · ${esc(now.label)}</h3><div class="look">${now.look}</div>${recipeHtml(now.recipe, chosen?.recipe)}</section>
        ${chosen ? `<section><h3>${esc(chosen.label)}</h3><div class="look">${chosen.look}</div>${recipeHtml(chosen.recipe, now.recipe)}</section>` : ''}
      </div>
    </div>
    <footer>
      <button type="button" class="quiet" data-close>Close</button>
      ${chosen ? '<button type="button" data-restore>Use this version</button>' : ''}
    </footer>`;
  if (!d.open) d.showModal();
  for (const b of d.querySelectorAll('[data-close]')) b.addEventListener('click', () => d.close());
  for (const b of d.querySelectorAll<HTMLButtonElement>('[data-pick]')) b.addEventListener('click', () => openVersions(title, now, earlier, restore, Number(b.dataset.pick)));
  d.querySelector<HTMLButtonElement>('[data-restore]')?.addEventListener('click', async (e) => {
    (e.target as HTMLButtonElement).disabled = true;
    try {
      await restore(chosen!.id);
      d.close();
      ctx.toast('Put back. The one it replaced is kept as an earlier version. Players see it after they reload.');
      ctx.rerender();
    } catch (err) {
      (e.target as HTMLButtonElement).disabled = false;
      ctx.toast((err as Error).message);
    }
  });
}

const picture = (url: string) => `<img src="${esc(url)}" alt="">`;
const madeOn = (recipe: Recipe | undefined, fallback: string) => (recipe?.at ? when(recipe.at) : fallback);
/** A version id is when it was put aside, in base 36. */
const putAside = (id: string) => when(Number.parseInt(id, 36));

export function pictureVersions(item: ArtItem): void {
  const earlier: Shown[] = (item.versions ?? []).map((v) => ({ id: v.id, label: `Put aside ${putAside(v.id)}`, look: picture(v.url), recipe: v.recipe }));
  if (item.shipped) earlier.push({ id: 'shipped', label: 'Shipped with the game', look: picture(item.shipped.url), recipe: item.shipped.recipe });
  const now: Shown = { id: 'now', label: madeOn(item.recipe, SOURCE[item.source]), look: item.url ? picture(item.url) : '', recipe: item.recipe };
  openVersions(item.name, now, earlier, (version) => artState.ctx.api('art/restore', 'POST', { asset: item.id, version }));
}

export function walkVersions(w: WalkerView, direction: Facing): void {
  const label = FACING_WORDS.find(([d]) => d === direction)![1];
  const strip = w.walks[direction];
  const earlier: Shown[] = (strip?.versions ?? w.lost[direction] ?? []).map((v) => ({ id: v.id, label: `Put aside ${putAside(v.id)}`, look: stripHtml(v, label, 160), recipe: v.recipe }));
  const now: Shown = { id: 'now', label: strip ? madeOn(strip.recipe, 'shipped with the game') : 'no walk now', look: stripHtml(strip, label, 160), recipe: strip?.recipe };
  openVersions(`${w.name} walking ${label === 'towards us' ? 'towards us' : label === 'away' ? 'away' : label}`, now, earlier, (version) => artState.ctx.api('art/restore-walk', 'POST', { walker: w.id, direction, version }));
}

export function viewVersions(w: WalkerView, direction: Facing): void {
  const label = FACING_WORDS.find(([d]) => d === direction)![1];
  const view = w.standing[direction];
  const earlier: Shown[] = view.versions.map((v) => ({ id: v.id, label: v.id === 'approved' ? 'The approved picture' : `Put aside ${putAside(v.id)}`, look: picture(v.url), recipe: v.recipe }));
  const now: Shown = { id: 'now', label: view.approved ? 'the approved picture' : madeOn(view.recipe, 'painted here'), look: view.url ? picture(view.url) : '', recipe: view.recipe };
  openVersions(`${w.name} standing, facing ${label}`, now, earlier, (version) => artState.ctx.api('art/restore-view', 'POST', { walker: w.id, direction, version }));
}

export function soundVersions(s: SoundItem): void {
  const audio = (url: string) => `<audio controls preload="none" src="${esc(url)}"></audio>`;
  const earlier: Shown[] = s.versions.map((v) => ({ id: v.id, label: `Made ${when(v.recipe.at)}`, look: audio(v.url), recipe: v.recipe }));
  const now: Shown = { id: 'now', label: madeOn(s.recipe, 'made here'), look: s.url ? audio(s.url) : '', recipe: s.recipe };
  openVersions(s.name, now, earlier, (version) => artState.ctx.api('art/restore-sound', 'POST', { sound: s.id, version }));
}
