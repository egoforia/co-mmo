import { describe, expect, it } from 'vitest';
import { Parking, isScenery, markScenery } from '../src/world-scene/park.ts';

// Hidden or far-off scenery leaves the display list and comes back when shown
// or near, keeping equal depths in first-drawn order (world-scene/park.ts).

type Obj = { name: string; _depth: number; visible: boolean; scene: object | undefined; displayList: unknown; parentContainer?: unknown };

function fakeList(names: string[]) {
  const scene = {};
  const list = {
    list: [] as Obj[],
    sortChildrenFlag: false,
    queueDepthSort() { this.sortChildrenFlag = true; },
    sortByDepth: (a: Obj, b: Obj) => a._depth - b._depth,
    depthSort() {
      if (!this.sortChildrenFlag) return;
      this.list.sort((a, b) => this.sortByDepth(a, b));
      this.sortChildrenFlag = false;
    },
  };
  for (const name of names) list.list.push({ name, _depth: 0, visible: true, scene, displayList: list });
  return list;
}

const names = (l: { list: Obj[] }) => l.list.map((o) => o.name);

describe('setting scenery aside', () => {
  it('marks only scenery outside containers', () => {
    const a = { parentContainer: undefined } as never;
    const b = { parentContainer: {} } as never;
    markScenery([a, b]);
    expect(isScenery(a)).toBe(true);
    expect(isScenery(b)).toBe(false);
    expect(isScenery({} as never)).toBe(false);
  });

  it('takes set-aside objects out in one pass and puts back a shown one in first-drawn order', () => {
    const l = fakeList(['a', 'b', 'c', 'd']);
    const p = new Parking(l as never);
    const [a, b, c] = l.list as [Obj, Obj, Obj];
    b.visible = false;
    p.park(b as never, false);
    p.park(c as never, true);
    p.settle();
    expect(names(l)).toEqual(['a', 'd']);
    expect(b.displayList).toBe(null);
    expect(p.count).toBe(2);
    // Shown again, and near: back, in its place among equal depths.
    b.visible = true;
    p.review(() => true, () => false);
    l.depthSort();
    expect(names(l)).toEqual(['a', 'b', 'd']);
    expect(b.displayList).toBe(l);
    // The far one comes back only when its slice judges it near.
    p.review(() => true, () => true);
    l.depthSort();
    expect(names(l)).toEqual(['a', 'b', 'c', 'd']);
    expect(p.count).toBe(0);
    expect(a.displayList).toBe(l);
  });

  it('forgets destroyed objects and keeps far ones that were hidden until shown', () => {
    const l = fakeList(['a', 'b']);
    const p = new Parking(l as never);
    const [a, b] = l.list as [Obj, Obj];
    p.park(a as never, true);
    p.park(b as never, true);
    p.settle();
    a.scene = undefined;
    b.visible = false;
    p.review(() => true, () => true);
    expect(p.count).toBe(1);
    expect(names(l)).toEqual([]);
    b.visible = true;
    p.review(() => true, () => true);
    expect(names(l)).toEqual(['b']);
  });
});
