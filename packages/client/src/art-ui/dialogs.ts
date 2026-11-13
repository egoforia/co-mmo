// Review/approval modal, recipe step formatter (with diff highlighting), and
// side-by-side version comparison / rollback dialogs for God's View's Art tab.

import {
  ISO_WAYS,
  ISO_WAY_LABELS,
  generateAngleTurnaroundPrompt,
  type AngleReferenceType,
  type AngleTargetType,
  type Facing,
  type IsoWay,
} from '@co-mmo/shared';
import {
  type ArtItem,
  type ArtReferenceInfo,
  type ArtReferenceVersion,
  type Ask,
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
      ${review.references ? referencesHtml(review) : ''}
      ${editable ? `<form class="form review-prompt"><label>Prompt${editable.prompt ? ' (your own words)' : ' (the usual words; edit them if you like)'}<span><textarea name="prompt" rows="8" maxlength="4000">${esc(review.parts[0]?.recipe.steps[0]?.prompt ?? '')}</textarea></span></label>
        <div class="card-actions"><button type="submit" class="quiet">Show with this prompt</button><button type="button" class="quiet director-btn" data-harmonize-prompt>✦ Harmonize with Art Director</button>${'walker' in ask ? '<button type="button" class="quiet" data-angle-turnaround-review>✦ Turn from another angle</button>' : ''}${editable.prompt ? '<button type="button" class="quiet" data-usual>Back to the usual prompt</button>' : ''}</div></form>` : ''}
      ${takesNote ? `<form class="form review-note"><label>Anything to change? (optional; added to the prompt)<span><textarea name="note" rows="2" maxlength="1000" placeholder="warmer light, a mossier roof">${esc(note)}</textarea></span></label><div class="card-actions"><button type="submit" class="quiet">Show with these words</button><button type="button" class="quiet director-btn" data-harmonize-note>✦ Harmonize with Art Director</button></div></form>` : ''}
      ${review.parts.map((p) => `${many ? `<details><summary><b>${esc(p.name)}</b> · about ${usd(p.recipe.steps.reduce((n, s) => n + s.usd, 0))}</summary>${recipeHtml(p.recipe, undefined, true)}</details>` : recipeHtml(p.recipe, undefined, true)}`).join('')}
    </div>
    <footer>
      <span>About <b>${usd(review.estimateUsd)}</b> · ${budgetLine(artState.data!.budget)}</span>
      <button type="button" class="quiet" data-close>Cancel</button>
      <button type="button" data-approve>Approve and paint</button>
    </footer>`;
  const withRefs = (newRefs: string[]): Ask => (ask.what === 'paint' || ask.what === 'ways' ? { ...ask, references: newRefs } : ask);
  for (const b of d.querySelectorAll('[data-close]')) b.addEventListener('click', () => d.close());
  for (const b of d.querySelectorAll('[data-remove-ref]')) {
    b.addEventListener('click', () => {
      const id = b.getAttribute('data-remove-ref');
      const cur = (review.references ?? []).map((r) => r.id);
      const next = cur.filter((x) => x !== id);
      void openReview(withRefs(next), takesNote, note);
    });
  }
  for (const sel of d.querySelectorAll<HTMLSelectElement>('.ref-version-select')) {
    sel.addEventListener('change', () => {
      const idx = Number(sel.getAttribute('data-ref-index'));
      const chosen = sel.value;
      const cur = (review.references ?? []).map((r) => r.id);
      const target = review.references?.[idx];
      if (!target) return;
      const baseId = target.assetId ?? target.id.split('@')[0]!;
      const newId = chosen === 'current' ? baseId : `${baseId}@${chosen}`;
      cur[idx] = newId;
      void openReview(withRefs(cur), takesNote, note);
    });
  }
  const refPicker = d.querySelector<HTMLSelectElement>('.ref-picker');
  refPicker?.addEventListener('change', () => {
    const id = refPicker.value;
    if (!id) return;
    const cur = (review.references ?? []).map((r) => r.id);
    if (!cur.includes(id)) {
      void openReview(withRefs([...cur, id]), takesNote, note);
    }
  });
  const fileInput = d.querySelector<HTMLInputElement>('.ref-file-input');
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = reader.result as string;
        const res = await ctx.api<ArtReferenceInfo>('art/reference', 'POST', { name: file.name, dataUrl });
        const cur = (review.references ?? []).map((r) => r.id);
        void openReview(withRefs([...cur, res.id]), takesNote, note);
      } catch (err) {
        ctx.toast((err as Error).message);
      }
    };
    reader.readAsDataURL(file);
  });
  const urlInput = d.querySelector<HTMLInputElement>('.ref-url-input');
  const urlSubmit = d.querySelector<HTMLButtonElement>('.ref-url-submit');
  const submitUrl = async () => {
    const url = urlInput?.value.trim();
    if (!url) return ctx.toast('Please enter an image URL.');
    try {
      if (urlSubmit) {
        urlSubmit.disabled = true;
        urlSubmit.textContent = 'Adding…';
      }
      const res = await ctx.api<ArtReferenceInfo>('art/reference', 'POST', { url });
      const cur = (review.references ?? []).map((r) => r.id);
      void openReview(withRefs([...cur, res.id]), takesNote, note);
    } catch (err) {
      if (urlSubmit) {
        urlSubmit.disabled = false;
        urlSubmit.textContent = 'Add link';
      }
      ctx.toast((err as Error).message);
    }
  };
  urlSubmit?.addEventListener('click', submitUrl);
  urlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitUrl();
    }
  });
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
  d.querySelector<HTMLButtonElement>('[data-harmonize-note]')?.addEventListener('click', async (e) => {
    const btn = e.target as HTMLButtonElement;
    const textarea = d.querySelector<HTMLTextAreaElement>('form.review-note textarea[name="note"]');
    btn.disabled = true;
    btn.textContent = '✦ Harmonizing…';
    const asset = 'asset' in ask ? ask.asset : 'walker' in ask ? ask.walker : undefined;
    try {
      const res = await ctx.api<{ harmonizedNote: string }>('art/director', 'POST', {
        action: 'harmonize',
        asset,
        note: textarea?.value ?? note,
      });
      void openReview(ask, takesNote, res.harmonizedNote);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '✦ Harmonize with Art Director';
      ctx.toast((err as Error).message);
    }
  });
  d.querySelector<HTMLButtonElement>('[data-harmonize-prompt]')?.addEventListener('click', async (e) => {
    const btn = e.target as HTMLButtonElement;
    const textarea = d.querySelector<HTMLTextAreaElement>('form.review-prompt textarea[name="prompt"]');
    if (!editable || !textarea) return;
    btn.disabled = true;
    btn.textContent = '✦ Harmonizing…';
    const asset = 'asset' in editable ? editable.asset : 'walker' in editable ? editable.walker : undefined;
    try {
      const res = await ctx.api<{ harmonizedPrompt: string }>('art/director', 'POST', {
        action: 'harmonize',
        asset,
        prompt: textarea.value,
      });
      void openReview({ ...editable, prompt: res.harmonizedPrompt }, false);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '✦ Harmonize with Art Director';
      ctx.toast((err as Error).message);
    }
  });
  d.querySelector<HTMLButtonElement>('[data-angle-turnaround-review]')?.addEventListener('click', () => {
    const walkerId = 'walker' in ask ? ask.walker : undefined;
    const direction = 'direction' in ask ? (ask.direction as Facing) : undefined;
    const walker = walkerId ? artState.data?.walkers.find((x) => x.id === walkerId) : undefined;
    if (walker) {
      const others = ISO_WAYS.filter((way) => way !== direction && (walker.standing[way]?.url || walker.walks[way]));
      const source = others[0] ?? (direction === 'front-right' ? 'front-left' : 'front-right');
      openAnglePromptDialog(walker, source, direction, ask.what === 'clip' ? 'clip' : 'standing');
    }
  });
  d.querySelector<HTMLButtonElement>('[data-approve]')!.addEventListener('click', async (e) => {
    const button = e.target as HTMLButtonElement;
    button.disabled = true;
    try {
      const refIds = review.references ? review.references.map((r) => r.id) : undefined;
      await ctx.api(`art/${ask.what}`, 'POST', { ...ask, ...(note ? { note } : {}), ...(refIds ? { references: refIds } : {}), approved: review.fingerprint });
      d.close();
      ctx.toast(ask.what === 'clip' ? 'Approved. Clips take a minute or two each; follow them under Painting now.' : ask.what === 'view' ? 'Approved. The picture shows here once it is painted; then make the clip from it.' : ask.what === 'ways' ? 'Approved. Each picture shows here as it is painted; follow them under Painting now.' : 'Approved. Follow it under Painting now.');
      ctx.rerender();
    } catch (err) {
      button.disabled = false;
      ctx.toast((err as Error).message);
    }
  });
}

/** Reference images selection and upload controls for painting recipes. */
export function referencesHtml(review: Review): string {
  const currentRefs = review.references ?? [];
  const existingIds = new Set(currentRefs.map((r) => r.assetId ?? r.id.split('@')[0]!));

  // Collect game art options from artState.data
  const walkers = artState.data?.walkers ?? [];
  const items = artState.data?.items ?? [];

  // Group walkers into characters vs creatures/monsters
  const characters = walkers.filter((w) => !existingIds.has(w.id) && (w.kind === 'player look' || w.kind === 'person'));
  const creatures = walkers.filter((w) => !existingIds.has(w.id) && (w.kind === 'creature' || w.kind === 'monster'));
  const gameItems = items.filter((i) => !existingIds.has(i.id) && !i.id.includes(':'));

  // Sort them
  characters.sort((a, b) => a.name.localeCompare(b.name));
  creatures.sort((a, b) => a.name.localeCompare(b.name));
  gameItems.sort((a, b) => a.name.localeCompare(b.name));

  const renderPickerOption = (id: string, name: string) => {
    const item = items.find((it) => it.id === id);
    const versions = item?.versions ?? [];
    const hasShipped = Boolean(item?.shipped);
    if (!versions.length && !hasShipped) {
      return `<option value="${esc(id)}">${esc(name)}</option>`;
    }
    return `
      <option value="${esc(id)}">${esc(name)} (Current)</option>
      ${versions.map((v) => `<option value="${esc(id)}@${esc(v.id)}">  ↳ ${esc(name)} (Earlier: ${esc(v.id)})</option>`).join('')}
      ${hasShipped ? `<option value="${esc(id)}@shipped">  ↳ ${esc(name)} (Original Shipped)</option>` : ''}
    `;
  };

  return `
    <div class="review-references">
      <div class="ref-header">
        <label><strong>Reference Images</strong> <small>(${currentRefs.length})</small></label>
        <span class="note">Guide character design, palette, and style. Choose a specific version when multiple exist.</span>
      </div>
      <div class="ref-chips">
        ${currentRefs.length ? currentRefs.map((ref, idx) => `
          <div class="ref-chip" data-ref-id="${esc(ref.id)}">
            ${ref.url ? `<img src="${esc(ref.url)}" alt="" class="ref-chip-img">` : '<span class="ph">?</span>'}
            <div class="ref-chip-body">
              <span class="ref-chip-name" title="${esc(ref.name)}">${esc(ref.name)}</span>
              ${ref.availableVersions && ref.availableVersions.length > 1 ? `
                <select class="ref-version-select" data-ref-index="${idx}" title="Select reference version">
                  ${ref.availableVersions.map((v) => `
                    <option value="${esc(v.id)}" ${v.id === (ref.versionId ?? 'current') ? 'selected' : ''}>
                      ${esc(v.label)}
                    </option>
                  `).join('')}
                </select>
              ` : ''}
            </div>
            <button type="button" class="quiet ref-remove-btn" title="Remove reference" data-remove-ref="${esc(ref.id)}">✕</button>
          </div>
        `).join('') : '<p class="note">No references currently selected.</p>'}
      </div>
      <div class="ref-actions">
        <select class="ref-picker">
          <option value="">+ Add game art as reference…</option>
          ${characters.length ? `<optgroup label="Characters & Walkers">${characters.map((w) => renderPickerOption(w.id, w.name)).join('')}</optgroup>` : ''}
          ${creatures.length ? `<optgroup label="NPCs & Creatures">${creatures.map((w) => renderPickerOption(w.id, w.name)).join('')}</optgroup>` : ''}
          ${gameItems.length ? `<optgroup label="Items & Equipment">${gameItems.map((i) => renderPickerOption(i.id, i.name)).join('')}</optgroup>` : ''}
        </select>
        <label class="ref-upload-btn button quiet">
          <span>📁 Upload image</span>
          <input type="file" class="ref-file-input" accept="image/png,image/jpeg,image/webp" style="display:none">
        </label>
        <div class="ref-url-bar">
          <input type="url" class="ref-url-input" placeholder="Paste image link…">
          <button type="button" class="quiet ref-url-submit">Add link</button>
        </div>
      </div>
    </div>`;
}

/** Which pictures a standing picture is painted from: the approved picture and any standing pictures already kept. */
export function sourcesHtml(ask: Extract<Ask, { what: 'view' }>): string {
  const w = artState.data!.walkers.find((x) => x.id === ask.walker);
  if (!w) return '';
  // The server's choice when none is made: an isometric way is painted from the other isometric ways too, so it matches them.
  const others = ISO_WAYS.filter((d) => d !== ask.direction && w.standing[d].url);
  const from = ask.from ?? ['approved', ...others];
  const options: [string, string, string | undefined][] = [['approved', 'The approved picture', w.url]];
  for (const [d, label] of WAYS) {
    const view = w.standing[d];
    if (view.url) options.push([d, `Standing, ${label}`, view.url]);
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
  const label = WAYS.find(([d]) => d === direction)![1];
  const strip = w.walks[direction];
  const earlier: Shown[] = (strip?.versions ?? w.lost[direction] ?? []).map((v) => ({ id: v.id, label: `Put aside ${putAside(v.id)}`, look: stripHtml(v, label, 160), recipe: v.recipe }));
  const now: Shown = { id: 'now', label: strip ? madeOn(strip.recipe, 'shipped with the game') : 'no walk now', look: stripHtml(strip, label, 160), recipe: strip?.recipe };
  openVersions(`${w.name} walking ${label}`, now, earlier, (version) => artState.ctx.api('art/restore-walk', 'POST', { walker: w.id, direction, version }));
}

export function viewVersions(w: WalkerView, direction: Facing): void {
  const label = WAYS.find(([d]) => d === direction)![1];
  const view = w.standing[direction];
  const earlier: Shown[] = view.versions.map((v) => ({ id: v.id, label: `Put aside ${putAside(v.id)}`, look: picture(v.url), recipe: v.recipe }));
  const now: Shown = { id: 'now', label: madeOn(view.recipe, 'painted here'), look: view.url ? picture(view.url) : '', recipe: view.recipe };
  openVersions(`${w.name} standing, facing ${label}`, now, earlier, (version) => artState.ctx.api('art/restore-view', 'POST', { walker: w.id, direction, version }));
}

export function soundVersions(s: SoundItem): void {
  const audio = (url: string) => `<audio controls preload="none" src="${esc(url)}"></audio>`;
  const earlier: Shown[] = s.versions.map((v) => ({ id: v.id, label: `Made ${when(v.recipe.at)}`, look: audio(v.url), recipe: v.recipe }));
  const now: Shown = { id: 'now', label: madeOn(s.recipe, 'made here'), look: s.url ? audio(s.url) : '', recipe: s.recipe };
  openVersions(s.name, now, earlier, (version) => artState.ctx.api('art/restore-sound', 'POST', { sound: s.id, version }));
}

/** Shows a denied walk clip with its video player, automated check failure reasons, and options to approve anyway or repaint. */
export function openDeniedWalkReview(walkerId: string, direction: Facing): void {
  const ctx = artState.ctx;
  const w = artState.data?.walkers.find((x) => x.id === walkerId);
  const denied = w?.denied?.[direction];
  if (!w || !denied) {
    ctx.toast('No denied walk clip found for this direction.');
    return;
  }
  const d = dialog();
  let useRetry = false;
  const render = () => {
    const videoSrc = useRetry && denied.retryVideoUrl ? denied.retryVideoUrl : denied.videoUrl;
    d.innerHTML = `
      <header>
        <h2>Review Denied Walk Animation: ${esc(w.name)} (${esc(direction)})</h2>
        <button type="button" class="quiet" data-close aria-label="Close">✕</button>
      </header>
      <div class="dialog-body">
        <p class="note">This walk animation was generated by the video model, but was held back because automated consistency checks flagged potential issues.</p>
        <div style="display: flex; gap: 20px; align-items: flex-start; margin: 16px 0; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 280px; max-width: 400px;">
            <video id="denied-walk-video" controls autoplay loop muted playsinline src="${esc(videoSrc)}" style="width: 100%; border-radius: 6px; background: #111; display: block; border: 1px solid var(--rim, #444);"></video>
            ${denied.retryVideoUrl ? `
              <div style="margin-top: 8px; text-align: center;">
                <button type="button" class="quiet" data-toggle-retry>Switch to ${useRetry ? 'First Attempt Clip' : 'Retry Attempt Clip'}</button>
              </div>` : ''}
          </div>
          <div style="flex: 1.2; min-width: 260px;">
            <h4 style="margin-top: 0;">Automated Check Findings</h4>
            <div style="padding: 10px 12px; background: rgba(217, 83, 79, 0.08); border: 1px solid var(--bad, #d9534f); border-radius: 6px; margin-bottom: 12px;">
              <ul style="margin: 0; padding-left: 18px; color: var(--bad, #d9534f); font-size: 13px;">
                ${denied.problems.map((p) => `<li style="margin-bottom: 4px;">${esc(p)}</li>`).join('')}
              </ul>
            </div>
            <p style="font-size: 13px; line-height: 1.5; color: var(--text-dim, #888);">
              <b>Movement:</b> ${denied.distinctPoses ?? 12} distinct walking poses detected. If the character's motion looks natural and the limb swings or clothing folds account for the color shifts, you can safely override the check and adopt this animation into the game.
            </p>
          </div>
        </div>
      </div>
      <footer>
        <button type="button" class="quiet" data-close>Close</button>
        <button type="button" class="quiet" data-repaint-director>✦ Repaint with AI Art Director</button>
        <button type="button" data-adopt-clip>✓ Approve Anyway (Adopt into Game)</button>
      </footer>`;

    for (const b of d.querySelectorAll('[data-close]')) b.addEventListener('click', () => d.close());
    d.querySelector('[data-toggle-retry]')?.addEventListener('click', () => {
      useRetry = !useRetry;
      render();
    });
    d.querySelector('[data-repaint-director]')?.addEventListener('click', () => {
      d.close();
      void openReview({ what: 'clip', walker: w.id, body: w.body ?? 'two-legged', direction }, true);
    });
    d.querySelector<HTMLButtonElement>('[data-adopt-clip]')?.addEventListener('click', async (e) => {
      const btn = e.target as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Adopting clip…';
      try {
        await ctx.api('art/adopt-denied-walk', 'POST', { walker: w.id, body: w.body ?? 'two-legged', direction, retry: useRetry });
        d.close();
        ctx.toast(`Approved ${w.name}'s walk animation into the game!`);
        ctx.rerender();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '✓ Approve Anyway (Adopt into Game)';
        ctx.toast((err as Error).message);
      }
    });
  };

  render();
  if (!d.open) d.showModal();
}

/** Opens an interactive prompt generator to copy a single standing image or walking clip as reference to one of the other 3 isometric angles. */
export function openAnglePromptDialog(
  w: WalkerView,
  initialSource?: Facing,
  initialTarget?: Facing,
  initialTargetType?: 'standing' | 'clip',
): void {
  const d = dialog();
  const availableDirections = ISO_WAYS.filter((way) => Boolean(w.standing[way]?.url || w.walks[way]));
  let sourceDirection: IsoWay = initialSource && ISO_WAYS.includes(initialSource as IsoWay)
    ? (initialSource as IsoWay)
    : (availableDirections[0] ?? 'front-right');

  const otherDirections = (src: IsoWay) => ISO_WAYS.filter((way) => way !== src);

  let targetDirection: IsoWay = initialTarget && initialTarget !== sourceDirection && ISO_WAYS.includes(initialTarget as IsoWay)
    ? (initialTarget as IsoWay)
    : otherDirections(sourceDirection)[0]!;

  const hasStanding = Boolean(w.standing[sourceDirection]?.url);
  const hasClip = Boolean(w.walks[sourceDirection]);
  let referenceType: AngleReferenceType = hasStanding ? 'standing' : hasClip ? 'clip' : 'standing';
  let targetType: AngleTargetType = initialTargetType ?? (referenceType === 'clip' ? 'clip' : 'standing');

  const render = () => {
    if (targetDirection === sourceDirection) {
      targetDirection = otherDirections(sourceDirection)[0]!;
    }
    const curHasStanding = Boolean(w.standing[sourceDirection]?.url);
    const curHasClip = Boolean(w.walks[sourceDirection]);

    if (referenceType === 'standing' && !curHasStanding && curHasClip) {
      referenceType = 'clip';
    } else if (referenceType === 'clip' && !curHasClip && curHasStanding) {
      referenceType = 'standing';
    }

    const { prompt, rotationSummary, sourceLabel } = generateAngleTurnaroundPrompt({
      name: w.name,
      sourceDirection,
      targetDirection,
      referenceType,
      targetType,
      body: w.body,
      kind: w.kind,
    });

    const sourceView = w.standing[sourceDirection];
    const sourceStrip = w.walks[sourceDirection];
    const sourcePreview = referenceType === 'standing' && sourceView?.url
      ? `<img src="${esc(sourceView.url)}" alt="${esc(sourceLabel)} standing" style="max-height: 80px; max-width: 80px; object-fit: contain; border: 1px solid var(--rim, #444); border-radius: 4px; background: #1a1a1a;">`
      : referenceType === 'clip' && sourceStrip
        ? stripHtml(sourceStrip, sourceLabel, 80)
        : '<span class="ph" style="font-size: 11px;">no art</span>';

    const others = otherDirections(sourceDirection);

    d.innerHTML = `
      <header>
        <h2>Angle Turnaround Prompt · ${esc(w.name)}</h2>
        <button type="button" class="quiet" data-close aria-label="Close">✕</button>
      </header>
      <div class="dialog-body">
        <p class="note">Generate an exact prompt that uses a single standing image or walking clip as reference to copy the character with 100% fidelity while rotating to one of the other 3 isometric angles.</p>

        <div style="display: flex; gap: 16px; margin: 12px 0; flex-wrap: wrap;">
          <fieldset style="flex: 1; min-width: 250px; border: 1px solid var(--rim, #444); border-radius: 6px; padding: 10px 14px; background: rgba(255, 255, 255, 0.02);">
            <legend style="font-weight: bold; padding: 0 6px;">1. Reference Source</legend>
            <div style="margin-bottom: 8px;">
              <label style="display: block; font-size: 12px; margin-bottom: 4px; color: var(--text-dim, #888);">Source direction:</label>
              <select class="source-dir-select" style="width: 100%; padding: 4px 8px; border-radius: 4px;">
                ${WAYS.map(([way, label]) => {
                  const sHasImg = Boolean(w.standing[way]?.url);
                  const sHasClip = Boolean(w.walks[way]);
                  const badge = sHasImg && sHasClip ? ' (image + clip)' : sHasImg ? ' (image)' : sHasClip ? ' (clip)' : ' (empty)';
                  return `<option value="${way}" ${way === sourceDirection ? 'selected' : ''}>${esc(label)}${badge}</option>`;
                }).join('')}
              </select>
            </div>
            <div style="margin-bottom: 8px;">
              <label style="display: block; font-size: 12px; margin-bottom: 4px; color: var(--text-dim, #888);">Reference type:</label>
              <div style="display: flex; gap: 12px; align-items: center;">
                <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
                  <input type="radio" name="angle-ref-type" value="standing" ${referenceType === 'standing' ? 'checked' : ''} ${!curHasStanding ? 'disabled' : ''}>
                  <span>Standing image ${!curHasStanding ? '(none)' : ''}</span>
                </label>
                <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
                  <input type="radio" name="angle-ref-type" value="clip" ${referenceType === 'clip' ? 'checked' : ''} ${!curHasClip ? 'disabled' : ''}>
                  <span>Walking clip ${!curHasClip ? '(none)' : ''}</span>
                </label>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--rim, #333);">
              <span style="font-size: 11px; color: var(--text-dim, #888);">Preview:</span>
              ${sourcePreview}
            </div>
          </fieldset>

          <fieldset style="flex: 1.2; min-width: 280px; border: 1px solid var(--rim, #444); border-radius: 6px; padding: 10px 14px; background: rgba(255, 255, 255, 0.02);">
            <legend style="font-weight: bold; padding: 0 6px;">2. Target Angle &amp; Media</legend>
            <div style="margin-bottom: 8px;">
              <label style="display: block; font-size: 12px; margin-bottom: 4px; color: var(--text-dim, #888);">Rotate to one of the other 3 isometric angles:</label>
              <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                ${others.map((way) => {
                  const lbl = ISO_WAY_LABELS[way];
                  const active = way === targetDirection;
                  return `
                    <label class="button quiet" style="font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 4px; ${active ? 'background: rgba(255, 204, 0, 0.15); border: 1px solid var(--accent, #e5a93c); font-weight: bold;' : 'border: 1px solid var(--rim, #444);'}">
                      <input type="radio" name="angle-target-dir" value="${way}" ${active ? 'checked' : ''} style="margin: 0;">
                      <span>${esc(lbl)}</span>
                    </label>`;
                }).join('')}
              </div>
            </div>
            <div style="margin-bottom: 8px;">
              <label style="display: block; font-size: 12px; margin-bottom: 4px; color: var(--text-dim, #888);">Target output media:</label>
              <div style="display: flex; gap: 12px; align-items: center;">
                <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
                  <input type="radio" name="angle-target-type" value="standing" ${targetType === 'standing' ? 'checked' : ''}>
                  <span>Standing picture</span>
                </label>
                <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
                  <input type="radio" name="angle-target-type" value="clip" ${targetType === 'clip' ? 'checked' : ''}>
                  <span>Walk clip</span>
                </label>
              </div>
            </div>
            <div style="padding: 6px 10px; border-radius: 4px; background: rgba(255, 255, 255, 0.04); font-size: 12px; color: var(--accent, #e5a93c); border: 1px solid rgba(255, 204, 0, 0.2); margin-top: 8px;">
              ${esc(rotationSummary)}
            </div>
          </fieldset>
        </div>

        <div style="margin-top: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <label style="font-weight: bold; font-size: 12px;">Generated Turnaround Prompt</label>
            <span style="font-size: 11px; color: var(--text-dim, #888);">${prompt.length} characters</span>
          </div>
          <textarea class="angle-prompt-output" rows="9" style="width: 100%; box-sizing: border-box; font-family: monospace; font-size: 11px; line-height: 1.45; padding: 8px 10px; border-radius: 4px; border: 1px solid var(--rim, #444); background: #141414; color: #eee; resize: vertical;" readonly>${esc(prompt)}</textarea>
        </div>
      </div>
      <footer>
        <button type="button" class="quiet" data-close>Close</button>
        <button type="button" class="quiet" data-copy-prompt>📋 Copy Prompt</button>
        <button type="button" data-use-in-studio>✦ Review &amp; Paint in Studio</button>
      </footer>
    `;

    for (const b of d.querySelectorAll('[data-close]')) b.addEventListener('click', () => d.close());

    d.querySelector('.source-dir-select')?.addEventListener('change', (e) => {
      sourceDirection = (e.target as HTMLSelectElement).value as IsoWay;
      render();
    });

    for (const radio of d.querySelectorAll<HTMLInputElement>('input[name="angle-ref-type"]')) {
      radio.addEventListener('change', (e) => {
        referenceType = (e.target as HTMLInputElement).value as AngleReferenceType;
        render();
      });
    }

    for (const radio of d.querySelectorAll<HTMLInputElement>('input[name="angle-target-dir"]')) {
      radio.addEventListener('change', (e) => {
        targetDirection = (e.target as HTMLInputElement).value as IsoWay;
        render();
      });
    }

    for (const radio of d.querySelectorAll<HTMLInputElement>('input[name="angle-target-type"]')) {
      radio.addEventListener('change', (e) => {
        targetType = (e.target as HTMLInputElement).value as AngleTargetType;
        render();
      });
    }

    const copyBtn = d.querySelector<HTMLButtonElement>('[data-copy-prompt]');
    copyBtn?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(prompt);
        copyBtn.textContent = '✓ Copied!';
        artState.ctx.toast('Prompt copied to clipboard!');
        setTimeout(() => {
          if (copyBtn) copyBtn.textContent = '📋 Copy Prompt';
        }, 1800);
      } catch {
        artState.ctx.toast('Could not copy to clipboard.');
      }
    });

    d.querySelector<HTMLButtonElement>('[data-use-in-studio]')?.addEventListener('click', () => {
      d.close();
      if (targetType === 'standing') {
        void openReview({ what: 'view', walker: w.id, direction: targetDirection, prompt, from: [sourceDirection] }, false);
      } else {
        void openReview({ what: 'clip', walker: w.id, body: w.body ?? 'two-legged', direction: targetDirection, prompt }, true);
      }
    });
  };

  render();
  if (!d.open) d.showModal();
}

