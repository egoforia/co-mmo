import type { Role } from '@co-mmo/shared';
import { ISOMETRIC, setProjection } from './projection.ts';

/** Sets the isometric camera before the world is drawn. Returns true for the isometric camera. */
export function chooseCamera(_role?: Role): boolean {
  setProjection(ISOMETRIC);
  return true;
}
