// The target the player chose (docs/attributes.md, Threat and targeting): a
// creature for attacks and skills, or another player for heals and buffs.
// Chosen by clicking someone or by Tab through the creatures nearby, and
// shown on their name tag (plain UI text, no shapes drawn). The server
// checks range and falls back when the target is too far.

import type Phaser from 'phaser';
import type { Avatar } from './types.ts';

/** How far Tab looks for creatures to choose, in tiles. */
export const TAB_RANGE = 10;
/** The chosen one's name tag: gold, with a pointer before the name. */
const MARKED_COLOUR = '#fee761';
const MARK = '▸ ';

/** Who the player has chosen, and the name tag showing it. */
export class Targeting {
  /** The chosen creature's or player's id, if any. */
  id: string | null = null;
  private marked?: { label: Phaser.GameObjects.Text; colour: string };

  /** Chooses someone (or nobody) and marks their name tag. */
  choose(id: string | null, avatar?: Avatar): void {
    this.unmark();
    this.id = avatar ? id : null;
    if (avatar) this.mark(avatar);
  }

  /**
   * Tab: the next creature after the chosen one, nearest first, of those on
   * our floor within TAB_RANGE that we can see.
   */
  cycle(creatures: Map<string, Avatar>, me: Avatar, floor: number): void {
    const from = me.at;
    if (!from) return;
    const near = [...creatures]
      .filter(([, a]) => a.at && a.body.visible && (a.floor ?? 0) === floor && Math.hypot(a.at.x - from.x, a.at.y - from.y) <= TAB_RANGE)
      .sort(([, a], [, b]) => Math.hypot(a.at!.x - from.x, a.at!.y - from.y) - Math.hypot(b.at!.x - from.x, b.at!.y - from.y));
    if (!near.length) return this.choose(null);
    const next = near[(near.findIndex(([id]) => id === this.id) + 1) % near.length]!;
    this.choose(next[0], next[1]);
  }

  /** After name tags are rewritten: marks the chosen one again, or lets go when they are gone. */
  refresh(find: (id: string) => Avatar | undefined): void {
    if (!this.id) return;
    const a = find(this.id);
    if (!a || !a.body.visible) return this.choose(null);
    if (this.marked?.label !== a.label) this.unmark();
    this.mark(a);
  }

  /** The topmost of these whose picture is under a point in the world. */
  static under(x: number, y: number, groups: Map<string, Avatar>[]): [string, Avatar] | undefined {
    let best: [string, Avatar] | undefined;
    for (const group of groups) {
      for (const entry of group) {
        const body = entry[1].body;
        if (!body.visible || !body.getBounds().contains(x, y)) continue;
        if (!best || body.depth > best[1].body.depth) best = entry;
      }
    }
    return best;
  }

  private mark(a: Avatar): void {
    const label = a.label;
    if (!this.marked) this.marked = { label, colour: label.style.color as string };
    if (!label.text.startsWith(MARK)) label.setText(MARK + label.text);
    label.setColor(MARKED_COLOUR);
  }

  private unmark(): void {
    const m = this.marked;
    this.marked = undefined;
    if (!m || !m.label.active) return;
    m.label.setColor(m.colour);
    if (m.label.text.startsWith(MARK)) m.label.setText(m.label.text.slice(MARK.length));
  }
}
