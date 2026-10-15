import {
  CREATURES,
  ITEMS,
  REGION_WISH_COST,
  WISH_CATEGORIES,
  WISH_COSTS,
  wishSubcategory,
  type DraftMessage,
  type DraftView,
  type PicturePreview,
  type WishSubcategory,
  type WorkshopField,
} from '@co-mmo/shared';
import { escapeHtml } from './ui.ts';

export interface WorkshopActions {
  draft(message: Omit<DraftMessage, 't'>): void;
  /** "Something else": the words go to the God as a prayer in the Talk tab. */
  pray(text: string): void;
}

/** Waits this long after the last keystroke before sending an edit. */
const EDIT_DELAY_MS = 350;

/**
 * The Shape a wish tab (Wish Workshop design doc): pick a category and a
 * subcategory, fill in a short form, and watch the server's preview of the
 * card, the numbers and the exact image prompt. Nothing here is painted.
 */
export class WorkshopUi {
  private view: DraftView | null = null;
  private category: string | null = null;
  /** The draft the form was drawn for; the form is kept while typing so focus is never lost. */
  private formFor = '';
  private timer: number | undefined;

  constructor(private readonly el: HTMLElement, private readonly actions: WorkshopActions) {
    el.addEventListener('click', (e) => this.click(e));
    el.addEventListener('input', (e) => {
      if (!(e.target as HTMLElement).closest('.ws-form')) return;
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.actions.draft({ action: 'edit', fields: this.collect() }), EDIT_DELAY_MS);
    });
    this.render();
  }

  /** The server sent the draft (or none). */
  update(view: DraftView | null): void {
    this.view = view;
    this.render();
  }

  private click(e: Event): void {
    const target = e.target as HTMLElement;
    const cat = target.closest<HTMLElement>('[data-cat]');
    if (cat) {
      this.category = cat.dataset.cat!;
      return this.render();
    }
    if (target.closest('[data-back]')) {
      this.category = null;
      return this.render();
    }
    const sub = target.closest<HTMLElement>('[data-sub]');
    if (sub) return this.actions.draft({ action: 'start', category: this.category!, sub: sub.dataset.sub! });
    if (target.closest('[data-else]')) {
      const box = this.el.querySelector<HTMLTextAreaElement>('#ws-else')!;
      const text = box.value.trim();
      if (text) {
        box.value = '';
        this.actions.pray(text);
      }
      return;
    }
    if (target.closest('[data-drop]')) {
      if (confirm('Start over? This draft will be thrown away.')) this.actions.draft({ action: 'drop' });
      return;
    }
    if (target.closest('[data-send]')) {
      window.clearTimeout(this.timer);
      // Any edit still waiting goes first, so the card is made from what is on screen.
      this.actions.draft({ action: 'edit', fields: this.collect() });
      this.actions.draft({ action: 'send' });
    }
  }

  private render(): void {
    const view = this.view;
    if (!view) {
      this.formFor = '';
      this.el.innerHTML = this.category ? this.subsHtml(this.category) : this.categoriesHtml();
      return;
    }
    const sub = wishSubcategory(view.draft.category, view.draft.sub);
    if (!sub) return;
    const key = `${view.draft.category}/${view.draft.sub}`;
    if (this.formFor !== key || !this.el.querySelector('.ws-form')) {
      this.formFor = key;
      const category = WISH_CATEGORIES.find((c) => c.id === view.draft.category)!;
      this.el.innerHTML = `
        <header class="ws-head"><span>${escapeHtml(category.name)} › <b>${escapeHtml(sub.name)}</b></span><button type="button" class="quiet" data-drop>Start over</button></header>
        <div class="ws-body">
          <form class="ws-form" autocomplete="off">${sub.fields.map((f) => fieldHtml(f, view.draft.fields[f.key])).join('')}</form>
          <section class="ws-preview" aria-live="polite"></section>
        </div>`;
    }
    this.el.querySelector('.ws-preview')!.innerHTML = previewHtml(view);
  }

  private categoriesHtml(): string {
    return `
      <p class="ws-intro">What would you like to wish for? Pick a kind of wish, fill in what you know, and see exactly what will be made before you spend any Favor.</p>
      <div class="ws-cats">${WISH_CATEGORIES.map((c) => `
        <button type="button" class="ws-cat" data-cat="${c.id}"><img src="art/${c.picture}.png" alt=""><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.blurb)}</small></button>`).join('')}
      </div>`;
  }

  private subsHtml(categoryId: string): string {
    const category = WISH_CATEGORIES.find((c) => c.id === categoryId);
    if (!category) return this.categoriesHtml();
    return `
      <header class="ws-head"><button type="button" class="quiet" data-back>‹ All wishes</button><b>${escapeHtml(category.name)}</b></header>
      <ul class="ws-subs">${category.subs.map((s) => `
        <li><button type="button" data-sub="${s.id}"><b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.blurb)}</small><span class="ws-price">${escapeHtml(priceLabel(s))}</span></button></li>`).join('')}
      </ul>
      <div class="ws-else">
        <label for="ws-else"><b>Something else</b> <small>Tell the God in your own words.</small></label>
        <textarea id="ws-else" rows="2" maxlength="400" placeholder="I wish for..."></textarea>
        <button type="button" data-else>Ask the God</button>
      </div>`;
  }

  /** Reads the form back into draft fields. */
  private collect(): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    const form = this.el.querySelector<HTMLFormElement>('.ws-form');
    const sub = this.view && wishSubcategory(this.view.draft.category, this.view.draft.sub);
    if (!form || !sub) return fields;
    for (const field of sub.fields) {
      const inputs = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${field.key}"]`)];
      if (field.kind === 'materials') {
        const qty = [...form.querySelectorAll<HTMLInputElement>(`[name="${field.key}-qty"]`)];
        fields[field.key] = inputs.map((i, n) => ({ item: i.value, qty: Number(qty[n]?.value) || 1 })).filter((m) => m.item);
      } else if (field.kind === 'items') fields[field.key] = inputs.map((i) => i.value).filter(Boolean);
      else if (inputs[0]?.value) fields[field.key] = field.kind === 'number' ? Number(inputs[0].value) : inputs[0].value;
    }
    return fields;
  }
}

/** "Minor · 2 Favor · granted at once" and the like. */
function priceLabel(sub: WishSubcategory): string {
  if (sub.tier === 'major') return 'Free to ask · the Stewards review it';
  if (sub.tier === 'engine') return 'Free to ask · the Owner reviews it';
  const cost = sub.makes === 'region' ? REGION_WISH_COST : WISH_COSTS[sub.tier];
  return `${cost} Favor · granted at once`;
}

function fieldHtml(field: WorkshopField, value: unknown): string {
  const id = `ws-${field.key}`;
  const label = `<label for="${id}">${escapeHtml(field.label)}${field.optional ? ' <small>(optional)</small>' : ''}</label>`;
  const v = typeof value === 'string' || typeof value === 'number' ? escapeHtml(String(value)) : '';
  const hint = field.hint ? ` placeholder="${escapeHtml(field.hint)}"` : '';
  switch (field.kind) {
    case 'long':
      return `<p>${label}<textarea id="${id}" name="${field.key}" rows="2" maxlength="${field.length ?? 400}"${hint}>${v}</textarea></p>`;
    case 'color':
      return `<p>${label}<input id="${id}" name="${field.key}" type="color" value="${v || '#c8a2c8'}"></p>`;
    case 'number':
      return `<p>${label}<input id="${id}" name="${field.key}" type="number" min="${field.min}" max="${field.max}" value="${v}" placeholder="${field.min} to ${field.max}"></p>`;
    case 'choice':
      return `<p>${label}<select id="${id}" name="${field.key}">${options(field.optional ? 'Any' : 'Choose…', field.options!.map((o) => [o.value, o.label]), value)}</select></p>`;
    case 'item':
      return `<p>${label}<select id="${id}" name="${field.key}">${options('Choose…', itemChoices(), value)}</select></p>`;
    case 'creature':
      return `<p>${label}<select id="${id}" name="${field.key}">${options('Choose…', Object.entries(CREATURES).map(([k, c]) => [k, c.name]), value)}</select></p>`;
    case 'items': {
      const chosen = Array.isArray(value) ? value : [];
      return `<p>${label}${[0, 1, 2].map((i) => `<select name="${field.key}" aria-label="${escapeHtml(field.label)} ${i + 1}">${options('Nothing', itemChoices(), chosen[i])}</select>`).join('')}</p>`;
    }
    case 'materials': {
      const rows = Array.isArray(value) ? (value as { item: string; qty: number }[]) : [];
      return `<fieldset><legend>${escapeHtml(field.label)}</legend>${[0, 1, 2, 3].map((i) => `
        <span class="ws-row"><select name="${field.key}" aria-label="Material ${i + 1}">${options('Nothing', itemChoices(), rows[i]?.item)}</select><input name="${field.key}-qty" type="number" min="1" max="10" value="${rows[i]?.qty ?? 1}" aria-label="How many"></span>`).join('')}</fieldset>`;
    }
    default:
      return `<p>${label}<input id="${id}" name="${field.key}" maxlength="${field.length ?? 64}" value="${v}"${hint}></p>`;
  }
}

/** Things a recipe or a creature's drops may use: anything that exists and can change hands. */
function itemChoices(): [string, string][] {
  return Object.entries(ITEMS).filter(([, d]) => !d.bound).map(([id, d]) => [id, d.name] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
}

function options(empty: string, list: [string, string][], chosen: unknown): string {
  return `<option value="">${escapeHtml(empty)}</option>${list.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === chosen ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}`;
}

const TIER_NAMES: Record<string, string> = { minor: 'Minor wish', moderate: 'Moderate wish', major: 'Major wish', engine: 'A wish beyond the world', refused: 'Wish' };

function previewHtml(view: DraftView): string {
  const { card, world, plan, art } = view.preview;
  const ready = view.problems.length === 0;
  const todo = ready ? '' : `<div class="ws-todo"><b>Still to do</b><ul>${view.problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul></div>`;
  const cardHtml = `
    <div class="card ${card.tier} ws-card">
      <span class="tier">${TIER_NAMES[card.tier] ?? 'Wish'}</span>
      <b>${escapeHtml(card.title)}</b>
      <p>${escapeHtml(card.summary)}</p>
      <dl><div><dt>Where</dt><dd>${escapeHtml(card.where || 'Known once the wish is filled in')}</dd></div><div><dt>Cost</dt><dd>${card.cost ? `${card.cost} Favor` : 'Free to ask'}</dd></div></dl>
    </div>`;
  const worldHtml = world.length ? `<h3>What the world sets</h3><ul>${world.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : '';
  const planHtml = plan?.length ? `<h3>What happens next</h3><ol>${plan.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ol>` : '';
  return `
    ${todo}
    ${cardHtml}
    ${worldHtml}
    ${planHtml}
    ${art ? artHtml(art) : ''}
    <p class="ws-send"><button type="button" data-send${ready ? '' : ' disabled'}>Make the wish card</button><small>Previews are free. Favor is only spent when you grant the card.</small></p>`;
}

function artHtml(art: NonNullable<DraftView['preview']['art']>): string {
  const count = art.pictures.length;
  const who = art.model
    ? `Painted by ${escapeHtml(art.model)} after the wish is granted${art.usdEach !== undefined ? `, about $${art.usdEach.toFixed(2)} a picture` : ''}${count > 1 ? ` (${count} pictures)` : ''}.`
    : '';
  return `
    <h3>How it will be painted</h3>
    ${art.notice ? `<p class="ws-note">${escapeHtml(art.notice)}</p>` : ''}
    ${who ? `<p class="ws-note">${who} Your words are marked in the prompt; the rest comes from the Style Bible.</p>` : ''}
    <figure class="ws-placeholder"><img src="art/${escapeHtml(art.placeholder)}.png" alt=""><figcaption>Until it is painted, it looks like this.</figcaption></figure>
    ${art.pictures.map((p) => pictureHtml(p, art.mine)).join('')}`;
}

function pictureHtml(p: PicturePreview, mine: string[]): string {
  const refs = p.references.length
    ? `<div class="ws-refs"><small>Style references sent with it:</small>${p.references.map((r) => `<img src="art/${escapeHtml(r)}.png" alt="${escapeHtml(r)}" title="${escapeHtml(r)}">`).join('')}</div>`
    : '';
  return `
    <details class="ws-picture" open>
      <summary>${escapeHtml(p.label)}</summary>
      ${refs}
      <pre class="ws-prompt">${p.note ? `<span class="fixed">${escapeHtml(p.note)}</span>\n` : ''}${markWords(p.prompt, mine)}</pre>
    </details>`;
}

/** Escapes the prompt and marks the player's own words in it. */
function markWords(prompt: string, mine: string[]): string {
  const words = mine.filter((w) => prompt.includes(w));
  if (!words.length) return escapeHtml(prompt);
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return prompt.split(pattern).map((part, i) => (i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part))).join('');
}
