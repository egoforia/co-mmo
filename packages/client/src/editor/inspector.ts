import {
  EDIT_KINDS,
  copyDraft,
  moveDrafts,
  pickAt,
  removeDraft,
  type EditKind,
  type EditKindId,
  type FieldValue,
  type Outline,
  type PickKind,
  type Picked,
  type RegionMap,
  type TilePoint,
  type WorldEditDraft,
} from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import type { ToolStep } from './core.ts';
import { fieldsHtml, filled, hasRules, readField } from './fields.ts';

// The Select tool's inspector: select first, then change. A click picks the
// thing standing there, and the panel shows it with what can be done to it:
// move, copy or take it away, and a section for each kind of edit that
// changes such a thing (its look and size, its floors, a monster spawn's
// ways, a person's quests), filled in with how it is now. Those kinds are
// no longer tools of their own on the rail (rail.ts). Dragging over bare
// ground picks an area instead, to copy (area.ts).
// Inputs are named `insp.<kind>.<key>`; buttons are `data-pick`.

/** What each kind of picked thing is called above its card. */
const KIND_WORDS: Record<PickKind, string> = {
  building: 'Building', storey: 'Storey', stairway: 'Stairs', landmark: 'Piece', spot: 'Gathering spot',
  monster: 'Monster’s home', person: 'Person', bookmark: 'Bookmark', light: 'Light',
};

/** Where inspector inputs' names start. */
const PREFIX = 'insp.';

/** The kinds that change a picked thing of this kind, in the registry's order. */
export function inspecting(kind: PickKind): EditKind<EditKindId>[] {
  return (Object.values(EDIT_KINDS) as EditKind<EditKindId>[]).filter((k) => k.inspects?.picks.includes(kind) && (k.available?.() ?? true));
}

/** The Select tool's state: the pick and its sections, a copy or move waiting for where it goes, an area being dragged, a patrol path to draw. */
export class Inspector {
  picked: { region: string; thing: Picked; placing?: 'copy' | 'move' } | undefined;
  /** An area being dragged out over bare ground. */
  box: { region: string; map: RegionMap; from: TilePoint; to: TilePoint } | undefined;
  /** The picked spawn's patrol path waits to be drawn from its home. */
  path = false;
  private values: Partial<Record<EditKindId, Record<string, FieldValue>>> = {};
  private readonly opened = new Set<string>();

  reset(): void {
    this.picked = undefined;
    this.box = undefined;
    this.path = false;
  }

  /** True while there is something Esc would drop. */
  midway(): boolean {
    return !!(this.picked || this.box || this.path);
  }

  /** A press on a tile: a copy or move lands there, or the thing there is picked, or an area starts. */
  press(region: string, map: RegionMap, at: TilePoint, level: number): ToolStep {
    const p = this.picked;
    if (p?.placing) {
      if (p.region !== region) return { say: 'Keep it in the land it came from.' };
      // People go to the floor shown; everything else stays on its own.
      const onto = p.thing.kind === 'person' ? (level ? { level } : { level: undefined }) : {};
      const drafts: WorldEditDraft[] | undefined = p.placing === 'copy'
        ? [copyDraft(map, p.thing, at)].filter((d) => !!d).map((d) => ({ ...d, ...onto }))
        : moveDrafts(map, p.thing, at, p.thing.kind === 'person' ? level : p.thing.level);
      if (!drafts?.length) return { say: 'That cannot be copied yet.' };
      this.picked = p.placing === 'copy' ? { region, thing: p.thing, placing: 'copy' } : undefined;
      return drafts.length === 1 ? { draft: drafts[0]!, region } : { drafts, region };
    }
    const thing = pickAt(map, at, level);
    this.path = false;
    if (!thing) {
      this.picked = undefined;
      this.box = { region, map, from: at, to: at };
      return {};
    }
    this.pick(region, map, thing);
    return { say: `Picked ${thing.name}.` };
  }

  /** Picks a thing, filling its sections with how it is now and opening the first. */
  private pick(region: string, map: RegionMap, thing: Picked): void {
    this.picked = { region, thing };
    this.values = {};
    const kinds = inspecting(thing.kind);
    for (const k of kinds) this.values[k.kind] = filled(k.fields, k.inspects?.current?.(map, thing) ?? {});
    this.opened.clear();
    if (kinds[0]) this.opened.add(kinds[0].kind);
  }

  /** The pointer moved while pressed: the area grows. */
  drag(region: string, at: TilePoint): void {
    if (this.box?.region === region) this.box.to = at;
  }

  /** The pointer let go: the area dragged, or undefined when it is one tile (nothing was there to pick). */
  release(): { region: string; map: RegionMap; from: TilePoint; to: TilePoint } | undefined {
    const box = this.box;
    this.box = undefined;
    return box;
  }

  /** The card's buttons: take the pick away, copy or move it with the next click, or one section's change. */
  action(action: string): ToolStep {
    const p = this.picked;
    if (!p) return {};
    if (action === 'remove') {
      this.reset();
      return { draft: removeDraft(p.thing), region: p.region };
    }
    if (action === 'copy' || action === 'move') {
      p.placing = action;
      this.path = false;
      return { say: action === 'copy' ? 'Click where the copy goes.' : 'Click where it goes.' };
    }
    const kindId = action.startsWith('apply:') ? (action.slice(6) as EditKindId) : undefined;
    const kind = kindId && inspecting(p.thing.kind).find((k) => k.kind === kindId);
    if (!kind) return {};
    // A patrol path is drawn: the next drag starts at the home.
    if (kind.pointer === 'drag') {
      this.path = true;
      return { say: 'Drag along the way they should walk, then let go. The path starts at their home.' };
    }
    const { thing } = p;
    const draft = kind.make({ at: [thing.box.x, thing.box.y], ...(thing.id ? { target: thing.id } : {}) }, this.values[kind.kind] ?? {}) as WorldEditDraft;
    return { draft: kind.onFloors ? { ...draft, level: thing.level } : draft, region: p.region };
  }

  /** An inspector input changed; false when the name is not one of its own. */
  set(name: string, raw: string, checked?: boolean): boolean {
    const [kindId, key] = this.input(name);
    const field = kindId && EDIT_KINDS[kindId]?.fields.find((f) => f.key === key);
    if (!kindId || !field) return false;
    (this.values[kindId] ??= {})[field.key] = readField(field, raw, checked);
    return true;
  }

  /** True when changing this input can show or hide another of its section. */
  redraws(name: string): boolean {
    const [kindId] = this.input(name);
    return !!kindId && hasRules(EDIT_KINDS[kindId]?.fields ?? []);
  }

  /** A section was folded or unfolded, kept as the card is drawn again. */
  toggled(section: string, open: boolean): void {
    if (open) this.opened.add(section);
    else this.opened.delete(section);
  }

  private input(name: string): [EditKindId | undefined, string] {
    if (!name.startsWith(PREFIX)) return [undefined, ''];
    const [kind, key = ''] = name.slice(PREFIX.length).split('.');
    return Object.hasOwn(EDIT_KINDS, kind!) ? [kind as EditKindId, key] : [undefined, ''];
  }

  /** The card: what is picked, its actions (`data-pick`), and a section per kind that changes it. */
  html(): string {
    const p = this.picked;
    if (!p) return `<p class="note">${this.box ? 'Drag over the area to pick it.' : 'Nothing picked yet. Click something, or drag over bare ground to pick an area.'}</p>`;
    const { thing } = p;
    const actions = p.placing
      ? `<p class="note">Click where its top-left corner goes${thing.kind === 'person' ? ', on any floor' : ''}. Esc to stop.</p>`
      : `<span class="pick-actions"><button type="button" class="quiet" data-pick="move">Move <kbd>M</kbd></button><button type="button" class="quiet" data-pick="copy">Copy <kbd>Ctrl C</kbd></button><button type="button" class="quiet" data-pick="remove">Take away <kbd>Del</kbd></button></span>`;
    const sections = p.placing ? [] : inspecting(thing.kind).map((k) => {
      const values = this.values[k.kind] ?? filled(k.fields, {});
      const drawing = this.path && k.pointer === 'drag';
      return `<details class="inspect" data-section="${k.kind}"${this.opened.has(k.kind) ? ' open' : ''}><summary>${escapeHtml(k.inspects!.title)}</summary>
        <div class="settings">${fieldsHtml(k.fields, values, `${PREFIX}${k.kind}.`)}</div>
        ${drawing ? '<p class="note">Drag along the way, then let go.</p>' : `<button type="button" data-pick="apply:${k.kind}">${escapeHtml(k.inspects!.action)}</button>`}</details>`;
    });
    return `<div class="picked inspector"><header><strong>${escapeHtml(thing.name)}</strong><span class="kind">${KIND_WORDS[thing.kind]}</span></header>
      ${[...thing.details, `At ${thing.box.x}, ${thing.box.y}${thing.level ? `, floor ${thing.level}` : ''}`].map((d) => `<span class="note">${escapeHtml(d)}</span>`).join('')}
      ${thing.id ? `<span class="note">Name: <code>${escapeHtml(thing.id)}</code></span>` : ''}
      ${actions}${sections.join('')}</div>`;
  }

  /** The pick held, where a copy or move would land, the area dragged, or what a click would pick. */
  outlines(region: string, map: RegionMap, at: TilePoint, level: number): Outline[] {
    if (this.box?.region === region) {
      const [a, b] = [this.box.from, this.box.to];
      return [{ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1, tone: 'held' }];
    }
    const hover = pickAt(map, at, level)?.box ?? { x: at[0], y: at[1], w: 1, h: 1 };
    const p = this.picked?.region === region ? this.picked : undefined;
    if (!p) return [hover];
    const held: Outline = { ...p.thing.box, tone: 'held' };
    return p.placing ? [held, { x: at[0], y: at[1], w: p.thing.box.w, h: p.thing.box.h }] : [held, hover];
  }
}
