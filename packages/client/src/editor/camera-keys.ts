// The keys that pan the world editor's free camera: W A S D and the arrow
// keys, held down, with Shift to go twice as fast. The editor asks each
// frame how far to pan; the camera itself is the scene's (free-camera.ts).

/** How fast the keys pan the free camera, in screen pixels a second (twice that with Shift). */
const PAN_SPEED = 700;
/** The longest frame the pan counts, so a stalled frame does not throw the camera across the land. */
const LONGEST_MS = 250;
/** The keys that pan the free camera, and which way. */
const PAN_KEYS: Record<string, [number, number]> = {
  w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0],
};

/** The pan keys held down. */
export class CameraKeys {
  private readonly held = new Set<string>();
  private fast = false;

  constructor() {
    document.addEventListener('keyup', (event) => {
      this.held.delete(event.key.toLowerCase());
      this.fast = event.shiftKey;
    });
    window.addEventListener('blur', () => this.clear());
  }

  /** A key went down: true when it is a pan key (now held). */
  down(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase();
    this.fast = event.shiftKey;
    if (!PAN_KEYS[key] || event.ctrlKey || event.metaKey || event.altKey) return false;
    this.held.add(key);
    return true;
  }

  clear(): void {
    this.held.clear();
  }

  /** How far to pan for a frame this long, in screen pixels. */
  step(deltaMs: number): [number, number] {
    if (!this.held.size) return [0, 0];
    let [dx, dy] = [0, 0];
    for (const k of this.held) [dx, dy] = [dx + PAN_KEYS[k]![0], dy + PAN_KEYS[k]![1]];
    const px = (PAN_SPEED * (this.fast ? 2 : 1) * Math.min(deltaMs, LONGEST_MS)) / 1000;
    return [dx * px, dy * px];
  }
}
