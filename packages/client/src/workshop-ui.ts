import {
  CREATURES,
  ITEMS,
  REGION_WISH_COST,
  WISH_CATEGORIES,
  WISH_COSTS,
  wishSubcategory,
  type DraftMessage,
  type DraftUpdateMessage,
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
 * subcategory, fill in a short form or talk it over with the God, and watch
 * the server's preview of the card, the numbers and the exact image prompt.
 * Nothing here is painted.
 */
export class WorkshopUi {
  private view: DraftView | null = null;
  private category: string | null = null;
  /** The draft the form was drawn for; the form is kept while typing so focus is never lost. */
  private formFor = '';
  private timer: number | undefined;
  /** Fields the player wrote; the God leaves them alone. */
  private locked = new Set<string>();
  /** Waiting for the God's answer. */
  private waiting = false;
  /** Picking a kind of wish for "Shape this wish": the God then fills it in from the talk. */
  private carry = false;

  constructor(private readonly el: HTMLElement, private readonly actions: WorkshopActions) {
    el.addEventListener('click', (e) => this.click(e));
    el.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      if (!target.closest('.ws-form')) return;
      // What the player writes is theirs: the God will not change it.
      const key = target.name.replace(/-qty$/, '');
      if (key && !this.locked.has(key)) {
        this.locked.add(key);
        this.showLocks();
      }
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.actions.draft({ action: 'edit', ...this.current() }), EDIT_DELAY_MS);
    });
    el.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!(e.target as HTMLElement).classList.contains('ws-ask')) return;
      const box = this.el.querySelector<HTMLInputElement>('#ws-ask');
      if (box?.value.trim()) {
        this.ask(box.value.trim());
        box.value = '';
      }
    });
    this.render();
  }

  /** The server sent the draft (or none), maybe changed by the God, or asked for a kind of wish to carry the talk into. */
  update(view: DraftView | null, message: Pick<DraftUpdateMessage, 'god' | 'pick'> = {}): void {
    if (message.pick) {
      if (this.view && !confirm('Shape the wish from your talk? Your current draft will be replaced.')) return;
      this.carry = true;
      this.category = null;
      return this.render();
    }
    // The God has answered, or the draft it was thinking about is gone.
    if (message.god || !view || (this.formFor && `${view.draft.category}/${view.draft.sub}` !== this.formFor)) this.waiting = false;
    this.view = view;
    this.render(message.god);
  }

  /** The draft's fields and locks as they are on screen. */
  private current(): { fields: Record<string, unknown>; locked: string[] } {
    return { fields: this.collect(), locked: [...this.locked] };
  }

  private ask(text: string): void {
    if (this.waiting || !this.view) return;
    window.clearTimeout(this.timer);
    this.waiting = true;
    this.actions.draft({ action: 'ask', say: text, ...this.current() });
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
    if (sub) {
      const carry = this.carry;
      this.carry = false;
      this.waiting = carry;
      return this.actions.draft({ action: 'start', category: this.category!, sub: sub.dataset.sub!, ...(carry ? { carry } : {}) });
    }
    const unlock = target.closest<HTMLElement>('[data-unlock]');
    if (unlock) {
      this.locked.delete(unlock.dataset.unlock!);
      this.showLocks();
      return this.actions.draft({ action: 'edit', ...this.current() });
    }
    const choice = target.closest<HTMLElement>('[data-choice]');
    if (choice) return this.ask(choice.dataset.choice!);
    if (target.closest('[data-fill]')) {
      if (this.waiting || !this.view) return;
      window.clearTimeout(this.timer);
      this.waiting = true;
      this.actions.draft({ action: 'fill', ...this.current() });
      return this.render();
    }
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
    if (target.closest('[data-cancel-carry]')) {
      this.carry = false;
      return this.render();
    }
    if (target.closest('[data-send]')) {
      window.clearTimeout(this.timer);
      // Any edit still waiting goes first, so the card is made from what is on screen.
      this.actions.draft({ action: 'edit', ...this.current() });
      this.actions.draft({ action: 'send' });
    }
  }

  private render(god = false): void {
    const view = this.view;
    if (!view || this.carry) {
      this.formFor = '';
      this.el.innerHTML = this.category ? this.subsHtml(this.category) : this.categoriesHtml();
      return;
    }
    const sub = wishSubcategory(view.draft.category, view.draft.sub);
    if (!sub) return;
    const key = `${view.draft.category}/${view.draft.sub}`;
    if (this.formFor !== key || !this.el.querySelector('.ws-form')) {
      this.formFor = key;
      this.locked = new Set(view.draft.locked ?? []);
      const category = WISH_CATEGORIES.find((c) => c.id === view.draft.category)!;
      this.el.innerHTML = `
        <header class="ws-head"><span>${escapeHtml(category.name)} › <b>${escapeHtml(sub.name)}</b></span><button type="button" class="quiet" data-drop>Start over</button></header>
        <div class="ws-body">
          <div class="ws-left">
            <section class="ws-talk" aria-label="Talk it over with the God">
              <ol class="ws-log" aria-live="polite"></ol>
              <div class="ws-choices"></div>
              <form class="ws-ask" autocomplete="off">
                <input id="ws-ask" maxlength="400" placeholder="Ask the God: make it spookier…">
                <button type="submit">Ask</button>
              </form>
              <button type="button" class="quiet ws-fill" data-fill>Ask the God to fill the rest</button>
            </section>
            <form class="ws-form" autocomplete="off">${sub.fields.map((f) => fieldHtml(f, view.draft.fields[f.key])).join('')}</form>
          </div>
          <section class="ws-preview" aria-live="polite"></section>
        </div>`;
    } else if (god) {
      this.fillForm(sub, view.draft.fields);
    }
    this.showLocks();
    this.showTalk(view);
    this.el.querySelector('.ws-preview')!.innerHTML = previewHtml(view);
  }

  /** Shows the God's changes in the form, leaving the field being typed in alone. */
  private fillForm(sub: WishSubcategory, values: Record<string, unknown>): void {
    const form = this.el.querySelector<HTMLFormElement>('.ws-form');
    if (!form) return;
    for (const field of sub.fields) {
      if (this.locked.has(field.key)) continue;
      const value = values[field.key];
      const inputs = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${field.key}"]`)];
      if (inputs.some((i) => i === document.activeElement)) continue;
      if (field.kind === 'materials') {
        const rows = Array.isArray(value) ? (value as { item: string; qty: number }[]) : [];
        const qty = [...form.querySelectorAll<HTMLInputElement>(`[name="${field.key}-qty"]`)];
        inputs.forEach((i, n) => { i.value = rows[n]?.item ?? ''; });
        qty.forEach((i, n) => { i.value = String(rows[n]?.qty ?? 1); });
      } else if (field.kind === 'items') {
        const list = Array.isArray(value) ? value : [];
        inputs.forEach((i, n) => { i.value = typeof list[n] === 'string' ? list[n] : ''; });
      } else if (inputs[0]) {
        inputs[0].value = typeof value === 'string' || typeof value === 'number' ? String(value) : field.kind === 'color' ? '#c8a2c8' : '';
      }
    }
  }

  /** A lock beside each field the player wrote; clicking it lets the God change the field again. */
  private showLocks(): void {
    for (const label of this.el.querySelectorAll<HTMLElement>('.ws-form [data-field]')) {
      const key = label.dataset.field!;
      label.querySelector('.ws-lock')?.remove();
      if (!this.locked.has(key)) continue;
      const lock = document.createElement('button');
      lock.type = 'button';
      lock.className = 'ws-lock';
      lock.dataset.unlock = key;
      lock.title = 'You wrote this, so the God will not change it. Click to let the God change it.';
      lock.textContent = '🔒';
      label.append(lock);
    }
  }

  /** The talk with the God, its quick answers, and whether it is still thinking. */
  private showTalk(view: DraftView): void {
    const log = this.el.querySelector<HTMLOListElement>('.ws-log');
    const choices = this.el.querySelector<HTMLElement>('.ws-choices');
    if (!log || !choices) return;
    const lines = view.draft.chat ?? [];
    log.innerHTML = (lines.length ? lines : [{ who: 'god', text: 'Fill in what you know, or tell me your idea and I will help shape it.' }])
      .map((l) => `<li class="${l.who}">${escapeHtml(l.text)}</li>`).join('') +
      (this.waiting ? '<li class="god listening">The God is listening…</li>' : '');
    log.scrollTop = log.scrollHeight;
    const quick = this.waiting ? [] : view.draft.choices ?? [];
    choices.innerHTML = quick.map((c) => `<button type="button" class="quiet" data-choice="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.ws-ask button, .ws-fill')) b.disabled = this.waiting;
  }

  private categoriesHtml(): string {
    return `${this.carryHtml()}
      <p class="ws-intro">What would you like to wish for? Pick a kind of wish, fill in what you know, and see exactly what will be made before you spend any Favor.</p>
      <div class="ws-cats">${WISH_CATEGORIES.map((c) => `
        <button type="button" class="ws-cat" data-cat="${c.id}"><img src="art/${c.picture}.png" alt=""><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.blurb)}</small></button>`).join('')}
      </div>`;
  }

  /** While carrying a talk into the Workshop: what picking a kind of wish will do. */
  private carryHtml(): string {
    return this.carry
      ? '<p class="ws-carry">Pick what kind of wish this is, and the God will fill it in from what you talked about. <button type="button" class="quiet" data-cancel-carry>Never mind</button></p>'
      : '';
  }

  private subsHtml(categoryId: string): string {
    const category = WISH_CATEGORIES.find((c) => c.id === categoryId);
    if (!category) return this.categoriesHtml();
    return `${this.carryHtml()}
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
  const label = `<label for="${id}" data-field="${field.key}">${escapeHtml(field.label)}${field.optional ? ' <small>(optional)</small>' : ''}</label>`;
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
      return `<fieldset><legend data-field="${field.key}">${escapeHtml(field.label)}</legend>${[0, 1, 2, 3].map((i) => `
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
