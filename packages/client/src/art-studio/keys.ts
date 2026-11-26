// The Studio's keys. 1 to 5 open the workspaces, / searches the assets, Esc
// puts the selected asset down, the arrows nudge a picture being fitted by a
// pixel (Shift: 10) and Ctrl Z steps back. The other tool keys of the plan
// (C centre, B hitbox, H hands) come with their tools.

/** What a key press does in the Studio, if anything. */
export type StudioKey = { workspace: number } | { search: true } | { deselect: true } | { nudge: [number, number] } | { undo: true };

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** The Studio's meaning of a key press; nothing while typing, or with Alt held. */
export function studioKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'> & { shiftKey?: boolean }, typing: boolean): StudioKey | undefined {
  if (typing || e.altKey) return undefined;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) return { undo: true };
  if (e.ctrlKey || e.metaKey) return undefined;
  const arrow = ARROWS[e.key];
  if (arrow) return { nudge: [arrow[0] * (e.shiftKey ? 10 : 1), arrow[1] * (e.shiftKey ? 10 : 1)] };
  if (/^[1-5]$/.test(e.key)) return { workspace: Number(e.key) };
  if (e.key === '/') return { search: true };
  if (e.key === 'Escape') return { deselect: true };
  return undefined;
}

/** True when the focus is somewhere keys type into. */
export function typingIn(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'range'].includes(el.type);
  return (el as HTMLElement).isContentEditable;
}
