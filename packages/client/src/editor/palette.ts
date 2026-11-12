import { escapeHtml } from '../ui.ts';

// The editor's finder (Ctrl K, or /): type a few letters to choose a tool,
// go to a bookmark or do one of the editor's actions, without hunting for
// its button. The editor hands it what can be found each time it opens.

/** One thing the finder can find. */
export interface Findable {
  /** What it is called, as the list shows it. */
  name: string;
  /** What kind of thing it is, shown beside it: "Tool", "Place", "Do". */
  kind: string;
  /** More words it is found by (a tool's group, a bookmark's note). */
  also?: string;
  run: () => void;
}

/** How many matches the list shows at most. */
const SHOWN = 8;

/** The things whose words hold every word typed, best first: names that start with it, then names holding it, then the rest. */
export function find(items: Findable[], typed: string): Findable[] {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.slice(0, SHOWN);
  const scored = items.flatMap((item) => {
    const name = item.name.toLowerCase();
    const all = `${name} ${item.kind} ${item.also ?? ''}`.toLowerCase();
    if (!words.every((w) => all.includes(w))) return [];
    const score = name.startsWith(words[0]!) ? 0 : name.includes(words[0]!) ? 1 : 2;
    return [{ item, score }];
  });
  return scored.sort((a, b) => a.score - b.score).slice(0, SHOWN).map((s) => s.item);
}

/** The finder's box, in the editor's frame. */
export class Finder {
  private readonly el = document.createElement('div');
  private items: Findable[] = [];
  private shown: Findable[] = [];
  private chosen = 0;

  constructor(parent: HTMLElement) {
    this.el.className = 'editor-finder';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Find a tool, a place or an action');
    this.el.innerHTML = '<input name="finder" type="text" autocomplete="off" placeholder="Find a tool, a place or an action…" aria-label="Find" /><ol class="found" role="listbox"></ol><p class="note">↑ ↓ to choose · Enter to use · Esc to close</p>';
    parent.append(this.el);
    const input = this.input();
    input.addEventListener('input', () => this.list(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.chosen = (this.chosen + (e.key === 'ArrowDown' ? 1 : -1) + this.shown.length) % Math.max(1, this.shown.length);
        this.draw();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.use(this.shown[this.chosen]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
      e.stopPropagation();
    });
    this.el.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-found]');
      if (row) this.use(this.shown[Number(row.dataset.found)]);
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Opens the finder with what can be found now. */
  show(items: Findable[]): void {
    this.items = items;
    this.el.hidden = false;
    const input = this.input();
    input.value = '';
    this.list('');
    input.focus();
  }

  close(): void {
    this.el.hidden = true;
    this.input().blur();
  }

  private input(): HTMLInputElement {
    return this.el.querySelector('input')!;
  }

  private list(typed: string): void {
    this.shown = find(this.items, typed);
    this.chosen = 0;
    this.draw();
  }

  private draw(): void {
    const list = this.el.querySelector('.found')!;
    list.innerHTML = this.shown.length
      ? this.shown.map((f, i) => `<li role="option" data-found="${i}" aria-selected="${i === this.chosen}" class="${i === this.chosen ? 'chosen' : ''}"><span>${escapeHtml(f.name)}</span><span class="kind">${escapeHtml(f.kind)}</span></li>`).join('')
      : '<li class="note">Nothing by that name.</li>';
  }

  private use(found: Findable | undefined): void {
    if (!found) return;
    this.close();
    found.run();
  }
}
