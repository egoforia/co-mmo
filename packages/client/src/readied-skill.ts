import { HOTBAR_SIZE } from '@co-mmo/shared';

// A skill readied with Ctrl or Shift and its hotbar key: nothing is sent
// yet, and the next Space casts it instead of a strike (held-strike.ts).
// After that one cast, Space strikes again. Readying the same key again, or
// Esc, puts it down; readying another key swaps it. Shift always works;
// Ctrl too where the browser lets a page have Ctrl + a number.

/** Which skill is readied, if any, telling `changed` each time that changes. */
export class ReadiedSkill {
  private id: string | undefined;

  constructor(private readonly changed: (id: string | undefined) => void = () => {}) {}

  /** The readied skill's id. */
  get current(): string | undefined {
    return this.id;
  }

  /** Readies a skill, or puts it down when it is the one already readied. */
  toggle(id: string): void {
    this.set(this.id === id ? undefined : id);
  }

  /** Puts the readied skill down. */
  clear(): void {
    this.set(undefined);
  }

  private set(id: string | undefined): void {
    if (id === this.id) return;
    this.id = id;
    this.changed(id);
  }
}

/** The modifier keys and key of a key press, as KeyboardEvent has them. */
export type KeyPress = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>;

/**
 * The hotbar key (1 to 6) a press readies: Ctrl or Shift with a number key,
 * read by where the key is (`code`), so Shift + 1 works on any keyboard
 * layout. Undefined for any other press.
 */
export function readyKey(e: KeyPress): number | undefined {
  if (e.altKey || e.metaKey || !(e.ctrlKey || e.shiftKey)) return undefined;
  const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= HOTBAR_SIZE ? n : undefined;
}
