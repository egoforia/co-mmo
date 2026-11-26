// The Studio's keys. 1 to 5 open the workspaces, / searches the assets, Esc
// puts the selected asset down. The tool keys of the plan (V move, C centre,
// B hitbox, H hands, arrows nudge, Ctrl Z undo) come with their tools.

/** What a key press does in the Studio, if anything. */
export type StudioKey = { workspace: number } | { search: true } | { deselect: true };

/** The Studio's meaning of a key press; nothing while typing or with Ctrl, Alt or Meta held. */
export function studioKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>, typing: boolean): StudioKey | undefined {
  if (typing || e.ctrlKey || e.altKey || e.metaKey) return undefined;
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
