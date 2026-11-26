// The Studio's docks: the asset browser on the left and the Inspector on the
// right, each widened by dragging its grip and remembered in this browser
// only (a double click puts it back). Below 900 px wide the docks fold into
// tabs under the top bar, one shown at a time.

/** Where the widths are remembered. */
const KEY = 'co-mmo.artStudio.docks';
/** Each dock's usual width, and how narrow and wide it may be. */
export const DOCK_WIDTH = { usual: { left: 280, right: 300 }, least: 200, most: 520 };

export type DockSide = 'left' | 'right';

/** The width a drag asks for, kept within the limits. */
export function dockWidth(asked: number): number {
  return Math.round(Math.max(DOCK_WIDTH.least, Math.min(DOCK_WIDTH.most, asked)));
}

/** Both docks' widths, remembered or usual. */
export function readDocks(): Record<DockSide, number> {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<DockSide, number>>;
    return {
      left: typeof kept.left === 'number' ? dockWidth(kept.left) : DOCK_WIDTH.usual.left,
      right: typeof kept.right === 'number' ? dockWidth(kept.right) : DOCK_WIDTH.usual.right,
    };
  } catch {
    return { ...DOCK_WIDTH.usual };
  }
}

/** Makes a grip widen its dock, setting `--dock-<side>` on the frame. */
export function wireDocks(frame: HTMLElement): void {
  const widths = readDocks();
  const apply = () => {
    frame.style.setProperty('--dock-left', `${widths.left}px`);
    frame.style.setProperty('--dock-right', `${widths.right}px`);
  };
  const keep = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(widths));
    } catch {
      // No storage here: the widths hold until the page is reloaded.
    }
  };
  for (const grip of frame.querySelectorAll<HTMLElement>('[data-grip]')) {
    const side = grip.dataset.grip as DockSide;
    grip.addEventListener('pointerdown', (e) => {
      grip.setPointerCapture(e.pointerId);
      grip.classList.add('dragging');
    });
    grip.addEventListener('pointermove', (e) => {
      if (!grip.hasPointerCapture(e.pointerId)) return;
      widths[side] = dockWidth(side === 'left' ? e.clientX : window.innerWidth - e.clientX);
      apply();
    });
    grip.addEventListener('pointerup', (e) => {
      grip.releasePointerCapture(e.pointerId);
      grip.classList.remove('dragging');
      keep();
    });
    grip.addEventListener('dblclick', () => {
      widths[side] = DOCK_WIDTH.usual[side];
      apply();
      keep();
    });
  }
  apply();
}

/** On a narrow screen, shows one pane: the asset browser, the page or the Inspector. */
export function showPane(frame: HTMLElement, pane: 'assets' | 'page' | 'inspector'): void {
  frame.dataset.pane = pane;
  for (const b of document.querySelectorAll<HTMLElement>('[data-pane-tab]')) b.setAttribute('aria-pressed', String(b.dataset.paneTab === pane));
}
