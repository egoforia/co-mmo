import { copyArea, pasteArea, type AreaCopy, type Outline, type RegionMap, type TilePoint } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import type { ToolStep } from './core.ts';

// The editor's Copy and paste tool: two clicks copy an area (its ground and
// everything standing wholly in it), each click after that pastes it there,
// all or none. A copy can be kept as a prefab by name, in this browser, to
// paste in any land later.

/** Where prefabs are kept in this browser. */
const PREFABS_KEY = 'co-mmo.editor-prefabs';
/** Most prefabs kept. */
const MAX_PREFABS = 40;

/** The prefabs kept in this browser, by name; none when storage cannot be read. */
export function readPrefabs(): Record<string, AreaCopy> {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFABS_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, AreaCopy>) : {};
  } catch {
    return {};
  }
}

function writePrefabs(all: Record<string, AreaCopy>): boolean {
  try {
    localStorage.setItem(PREFABS_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** The copy-and-paste tool's state: a first corner clicked, what is copied, and the name to keep it by. */
export class AreaTool {
  private corner: { region: string; at: TilePoint } | undefined;
  copied: AreaCopy | undefined;
  private name = '';

  reset(): void {
    this.corner = undefined;
  }

  /** True while the first corner of an area is clicked and the second is not. */
  midway(): boolean {
    return !!this.corner;
  }

  /** A click: the first corner, the second (copies), or where a copy is pasted. */
  press(region: string, map: RegionMap, at: TilePoint): ToolStep {
    if (this.copied) return { drafts: pasteArea(this.copied, at), region, say: 'Pasted.' };
    if (!this.corner || this.corner.region !== region) {
      this.corner = { region, at };
      return { say: 'Now click the opposite corner of the area to copy.' };
    }
    const from = this.corner.at;
    this.corner = undefined;
    return this.copy(map, from, at);
  }

  /** Copies the area between two corners (an area dragged out with Select, or two clicks here). */
  copy(map: RegionMap, from: TilePoint, to: TilePoint): ToolStep {
    const copy = copyArea(map, from, to);
    if (!copy) return { say: 'There is nothing in that area to copy.' };
    this.copied = copy;
    return { say: `Copied ${copy.size[0]} × ${copy.size[1]} tiles: ${copy.drafts.length} changes. Click where its top-left corner goes to paste it.` };
  }

  /** The buttons: copy another area, keep this one as a prefab, take out a prefab, forget one. */
  action(action: string, value = ''): ToolStep {
    if (action === 'again') {
      this.copied = undefined;
      this.corner = undefined;
      return { say: 'Click one corner of the area to copy.' };
    }
    const all = readPrefabs();
    if (action === 'save') {
      const name = this.name.trim().slice(0, 40);
      if (!this.copied) return { say: 'Copy an area first.' };
      if (!name) return { say: 'Give the prefab a name first.' };
      if (!all[name] && Object.keys(all).length >= MAX_PREFABS) return { say: `This browser keeps ${MAX_PREFABS} prefabs. Forget one first.` };
      return { say: writePrefabs({ ...all, [name]: this.copied }) ? `Kept as the prefab “${name}”.` : 'This browser would not keep it.' };
    }
    if (action === 'load' && all[value]) {
      this.copied = all[value];
      return { say: `“${value}” is ready: click where its top-left corner goes to paste it.` };
    }
    if (action === 'forget' && all[value]) {
      delete all[value];
      writePrefabs(all);
      return { say: `Forgot the prefab “${value}”.` };
    }
    return {};
  }

  /** A setting's input changed: the name to keep a prefab by. */
  set(key: string, raw: string): boolean {
    if (key !== 'prefab-name') return false;
    this.name = raw.slice(0, 40);
    return true;
  }

  html(): string {
    const prefabs = Object.keys(readPrefabs()).sort();
    const list = prefabs.length
      ? `<details class="prefabs"><summary>Prefabs kept here (${prefabs.length})</summary><ul>${prefabs.map((n) => `<li>${escapeHtml(n)} <button type="button" class="quiet" data-area="load" data-value="${escapeHtml(n)}">Paste</button><button type="button" class="quiet" data-area="forget" data-value="${escapeHtml(n)}">Forget</button></li>`).join('')}</ul></details>`
      : '';
    const copied = this.copied
      ? `<p class="note">Holding ${this.copied.size[0]} × ${this.copied.size[1]} tiles, ${this.copied.drafts.length} changes. Each click pastes it.</p>
        <label>Keep as <input name="prefab-name" type="text" maxlength="40" value="${escapeHtml(this.name)}" placeholder="a name" /></label>
        <span class="pick-actions"><button type="button" class="quiet" data-area="save">Keep as a prefab</button><button type="button" class="quiet" data-area="again">Copy another area</button></span>`
      : `<p class="note">${this.corner ? 'Now click the opposite corner.' : 'Click one corner of the area to copy, then the opposite one.'}</p>`;
    return copied + list;
  }

  /** The area being chosen, or where a paste would land. */
  outlines(region: string, at: TilePoint): Outline[] {
    if (this.copied) return [{ x: at[0], y: at[1], w: this.copied.size[0], h: this.copied.size[1] }];
    if (this.corner?.region === region) {
      const [a, b] = [this.corner.at, at];
      return [{ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1, tone: 'held' }];
    }
    return [{ x: at[0], y: at[1], w: 1, h: 1 }];
  }
}
