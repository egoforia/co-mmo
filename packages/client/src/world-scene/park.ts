// Takes scenery nobody can see out of the scene's display list, and puts it
// back as it comes near or is shown. Phaser walks the whole display list
// every frame, sorting it by depth whenever anything moves and asking each
// object whether to draw it: on the laptop some 14,900 objects were kept for
// about 300 on screen, most of them hidden storeys and far-off houses.
// Set-aside scenery keeps living (shown, hidden, tinted and faded as
// before); only the frame's walk skips it. Equal depths keep the order they
// were first drawn in, wherever an object is put back in the list.

import type Phaser from 'phaser';

/** How far beyond the camera's view, as a share of its size, visible scenery is kept in the scene. */
export const PARK_MARGIN = 1;

const scenery = new WeakSet<object>();

/** Marks objects as the land's scenery (ground, rocks, trees, buildings, furniture), which may be set aside. */
export function markScenery(objects: Iterable<Phaser.GameObjects.GameObject>): void {
  for (const o of objects) scenery.add(o);
}

/** True for scenery that may be set aside: not characters, marks or anything inside a container. */
export function isScenery(o: Phaser.GameObjects.GameObject): boolean {
  return scenery.has(o) && !(o as { parentContainer?: unknown }).parentContainer;
}

type Listed = Phaser.GameObjects.GameObject & { _depth: number; visible: boolean };
/** Phaser's own link from an object to the list it is in (null when it is in none). */
const setList = (o: object, list: Phaser.GameObjects.DisplayList | null) => ((o as { displayList: unknown }).displayList = list);

/** The scene's set-aside scenery, and the depth order that keeps equal depths as first drawn. */
export class Parking {
  /** Hidden scenery: looked at every frame, so it comes back the frame it is shown. */
  private readonly hidden = new Set<Listed>();
  /** Visible scenery far off: judged with the culling's slices. */
  readonly far = new Set<Listed>();
  private readonly leaving = new Set<object>();
  private readonly order = new WeakMap<object, number>();
  private next = 0;

  constructor(private readonly list: Phaser.GameObjects.DisplayList) {
    // Ties in depth by first-drawn order, as the list kept them before anything was set aside.
    const sort = list.depthSort.bind(list);
    list.sortByDepth = (a: Phaser.GameObjects.GameObject, b: Phaser.GameObjects.GameObject) =>
      (a as Listed)._depth - (b as Listed)._depth || this.rank(a) - this.rank(b);
    list.depthSort = () => {
      if (list.sortChildrenFlag) for (const o of list.list) this.rank(o);
      sort();
    };
  }

  /** How many objects are set aside now. */
  get count(): number {
    return this.hidden.size + this.far.size;
  }

  private rank(o: object): number {
    let n = this.order.get(o);
    if (n === undefined) this.order.set(o, (n = this.next++));
    return n;
  }

  /** Sets an object aside (taken out of the list at `settle`): hidden, or visible but far. */
  park(o: Phaser.GameObjects.GameObject, far: boolean): void {
    const l = o as Listed;
    (far ? this.far : this.hidden).add(l);
    this.leaving.add(l);
  }

  /**
   * Each frame: drops destroyed scenery, moves what was shown or hidden to
   * the right set, and puts back what `near` says is close (all of the far
   * ones when `all`, else those in `slice`).
   */
  review(near: (o: Phaser.GameObjects.GameObject) => boolean, farSlice: (i: number, size: number) => boolean): void {
    const back: Listed[] = [];
    for (const o of this.hidden) {
      if (!o.scene) this.hidden.delete(o);
      else if (o.visible) {
        this.hidden.delete(o);
        if (near(o)) back.push(o);
        else this.far.add(o);
      }
    }
    let i = 0;
    const size = this.far.size;
    for (const o of this.far) {
      const judged = farSlice(i++, size);
      if (!o.scene) this.far.delete(o);
      else if (!o.visible) {
        this.far.delete(o);
        this.hidden.add(o);
      } else if (judged && near(o)) {
        this.far.delete(o);
        back.push(o);
      }
    }
    this.unpark(back);
  }

  /** Takes what was set aside this frame out of the list, in one pass. */
  settle(): void {
    if (!this.leaving.size) return;
    const items = this.list.list;
    // Ranked in list order before any leave, so they come back among equal depths where they were.
    for (const o of items) this.rank(o);
    let w = 0;
    for (let r = 0; r < items.length; r++) {
      const o = items[r]!;
      if (this.leaving.has(o)) setList(o, null);
      else items[w++] = o;
    }
    items.length = w;
    this.leaving.clear();
  }

  private unpark(back: Listed[]): void {
    if (!back.length) return;
    for (const o of back) {
      setList(o, this.list);
      this.list.list.push(o);
    }
    this.list.queueDepthSort();
  }
}
