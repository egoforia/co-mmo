import type { Role } from '@co-mmo/shared';
import { ISOMETRIC, setProjection } from './projection.ts';

// The isometric camera is not ready for players: its lands are still painted
// for the top-down view. The Owner can switch it on for themselves as a
// preview (their choice of 2026-10-18), and everyone else keeps today's view.
// The switch is kept in this browser only, as a convenience; the server does
// not need to know which camera anyone looks through.

const KEY = 'co-mmo.camera-preview';

/** True when the preview was switched on in this browser. */
export function previewOn(): boolean {
  try {
    return localStorage.getItem(KEY) === ISOMETRIC.id;
  } catch {
    return false;
  }
}

/** Switches the preview on or off in this browser and reloads, so the world is drawn again through the new camera. */
export function switchPreview(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, ISOMETRIC.id);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage is blocked in this browser: the camera stays as it is.
  }
  location.reload();
}

/** Chooses the camera before the world is drawn: the isometric preview for the Owner who switched it on, top-down otherwise. Returns true for the preview. */
export function chooseCamera(role: Role): boolean {
  const preview = role === 'owner' && previewOn();
  if (preview) setProjection(ISOMETRIC);
  return preview;
}
