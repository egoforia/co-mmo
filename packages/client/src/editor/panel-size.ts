// How wide edit mode's panel is: dragged by the grip on its left edge,
// remembered in this browser only, and set on the editor's frame as
// `--panel-w`, which the panel, the options bar and the Plan camera follow.
// A double click on the grip puts it back.

/** Where the width is remembered, on this browser only. */
const KEY = 'co-mmo.editor.panelWidth';
/** The panel's width when nothing was remembered, and how narrow and wide it may be. */
export const PANEL_WIDTH = { usual: 340, least: 280, most: 640 };
/** The room the world keeps, left of the panel, however wide it is dragged. */
const WORLD_ROOM = 320;

/** The width a drag asks for, kept between the least and the most, and clear of the world's room. */
export function panelWidth(asked: number, screen: number): number {
  return Math.round(Math.max(PANEL_WIDTH.least, Math.min(PANEL_WIDTH.most, screen - WORLD_ROOM, asked)));
}

/** The panel's grip and the width it sets. */
export class PanelSize {
  readonly grip = document.createElement('div');
  private width = read();

  constructor(private readonly frame: HTMLElement) {
    this.grip.className = 'panel-grip';
    this.grip.title = 'Drag to make the panel wider or narrower (double click: as it was)';
    this.grip.setAttribute('role', 'separator');
    this.grip.setAttribute('aria-orientation', 'vertical');
    this.grip.addEventListener('pointerdown', (e) => {
      this.grip.setPointerCapture(e.pointerId);
      this.grip.classList.add('dragging');
    });
    this.grip.addEventListener('pointermove', (e) => {
      if (this.grip.hasPointerCapture(e.pointerId)) this.set(window.innerWidth - e.clientX - 12, false);
    });
    this.grip.addEventListener('pointerup', (e) => {
      this.grip.releasePointerCapture(e.pointerId);
      this.grip.classList.remove('dragging');
      this.set(this.width, true);
    });
    this.grip.addEventListener('dblclick', () => this.set(PANEL_WIDTH.usual, true));
    this.apply();
  }

  /** Sets the width, and remembers it when the drag ends. */
  private set(width: number, keep: boolean): void {
    this.width = panelWidth(width, window.innerWidth);
    this.apply();
    if (!keep) return;
    try {
      localStorage.setItem(KEY, String(this.width));
    } catch {
      // No storage here: the width holds until the page is reloaded.
    }
  }

  private apply(): void {
    this.frame.style.setProperty('--panel-w', `${this.width}px`);
    this.grip.setAttribute('aria-valuenow', String(this.width));
  }
}

/** The width remembered in this browser, or the usual one. */
function read(): number {
  try {
    const kept = Number(localStorage.getItem(KEY));
    return kept ? panelWidth(kept, window.innerWidth) : PANEL_WIDTH.usual;
  } catch {
    return PANEL_WIDTH.usual;
  }
}
