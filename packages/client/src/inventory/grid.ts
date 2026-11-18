/** A direction the arrow keys (or WASD) move a choice in a grid of slots. */
export type GridMove = 'left' | 'right' | 'up' | 'down';

/** Arrow keys and WASD, as grid moves. */
export const GRID_KEYS: Record<string, GridMove> = {
  arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
};

/**
 * The slot chosen after a move, row by row as the window lays the slots out
 * (`tops` are the slots' offsetTop, in order), or the same slot when the move
 * would leave the grid. Shared by the loot window and the bag.
 */
export function gridStep(tops: number[], selected: number, to: GridMove): number {
  const count = tops.length;
  if (!count) return selected;
  const columns = Math.max(1, tops.filter((t) => t === tops[0]).length);
  const step = to === 'left' ? -1 : to === 'right' ? 1 : to === 'up' ? -columns : columns;
  const next = selected + step;
  return next < 0 || next >= count ? selected : next;
}
