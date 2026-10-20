import type { Role } from '@co-mmo/shared';
import { ISOMETRIC, TOP_DOWN, setProjection } from './projection.ts';

// Everyone plays through the isometric camera (the Owner's choice of
// 2026-10-20: the top-down view is retired). Until its code is taken out,
// the Owner can look through the old top-down camera in their own browser,
// to compare a land before and after it is repainted. The choice is kept in
// this browser only; the server does not need to know which camera anyone
// looks through.

const KEY = 'co-mmo.camera';

/** True when the Owner switched this browser back to the old top-down view. */
export function oldViewOn(): boolean {
  try {
    return localStorage.getItem(KEY) === TOP_DOWN.id;
  } catch {
    return false;
  }
}

/** Switches the old top-down view on or off in this browser and reloads, so the world is drawn again through the other camera. */
export function switchOldView(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, TOP_DOWN.id);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage is blocked in this browser: the camera stays as it is.
  }
  location.reload();
}

/** Chooses the camera before the world is drawn: isometric, or the old top-down view for the Owner who switched it on. Returns true for the isometric camera. */
export function chooseCamera(role: Role): boolean {
  const old = role === 'owner' && oldViewOn();
  setProjection(old ? TOP_DOWN : ISOMETRIC);
  return !old;
}
