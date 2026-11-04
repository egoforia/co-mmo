import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ArtStudio } from '../art-studio.ts';
import { ArtRequestError, type ArtAsk } from './types.ts';

/** One staged item in the persistent "Up Next" art queue. */
export interface UpNextItem {
  id: string;
  ask: ArtAsk;
  kind: string;
  targetId: string;
  direction?: string;
  body?: string;
  note?: string;
  prompt?: string;
  harmonizedPrompt?: string;
  references?: string[];
  status: 'staged' | 'running' | 'done' | 'failed';
  reason?: string;
  label: string;
  category: string;
  estimateUsd: number;
  harmonized?: boolean;
  addedAt: number;
}

/**
 * Persistent "Up Next" staged queue (`up-next-queue.json` in `artDir`).
 * Lets the Owner stage missing or redone art items, reorder priorities,
 * edit notes/prompts or harmonize with the AI Art Director, and run the
 * queue sequentially or one item at a time.
 */
export class UpNextQueue {
  private items: UpNextItem[] = [];
  private loaded = false;
  private running = false;
  private pauseRequested = false;

  constructor(private readonly artDir: string) {}

  private get file(): string {
    return resolve(this.artDir, 'up-next-queue.json');
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'));
      if (Array.isArray(raw)) this.items = raw as UpNextItem[];
    } catch {
      this.items = [];
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await mkdir(this.artDir, { recursive: true });
    await writeFile(this.file, JSON.stringify(this.items, null, 2));
  }

  async list(): Promise<{ items: UpNextItem[]; running: boolean; totalUsd: number }> {
    await this.load();
    const normalized = this.items.map(normalizeItem);
    const totalUsd = Math.round(normalized.reduce((sum, i) => sum + (i.estimateUsd || 0), 0) * 1000) / 1000;
    return { items: normalized, running: this.running, totalUsd };
  }

  async add(
    ask: ArtAsk,
    meta?: { label?: string; category?: string; estimateUsd?: number; harmonized?: boolean },
  ): Promise<UpNextItem> {
    await this.load();
    const item = normalizeItem({
      id: randomUUID().slice(0, 8),
      ask,
      kind: ask.kind === 'group' ? 'paint-group' : ask.kind,
      targetId: targetIdOf(ask),
      status: 'staged',
      label: meta?.label?.trim() || defaultLabel(ask),
      category: meta?.category || ask.kind,
      estimateUsd: typeof meta?.estimateUsd === 'number' && Number.isFinite(meta.estimateUsd) ? meta.estimateUsd : defaultUsd(ask),
      ...(meta?.harmonized ? { harmonized: true } : {}),
      addedAt: Date.now(),
    });
    this.items.push(item);
    await this.save();
    return item;
  }

  async remove(id: string): Promise<boolean> {
    await this.load();
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.items.length === before) return false;
    await this.save();
    return true;
  }

  async reorder(ids: string[]): Promise<UpNextItem[]> {
    await this.load();
    const byId = new Map(this.items.map((i) => [i.id, i]));
    const next: UpNextItem[] = [];
    for (const id of ids) {
      const found = byId.get(id);
      if (found) {
        next.push(found);
        byId.delete(id);
      }
    }
    for (const rest of byId.values()) next.push(rest);
    this.items = next;
    await this.save();
    return [...this.items];
  }

  async update(
    id: string,
    patch: { note?: string; prompt?: string; harmonized?: boolean; harmonizedPrompt?: string; references?: string[]; label?: string },
  ): Promise<UpNextItem | undefined> {
    await this.load();
    const item = this.items.find((i) => i.id === id);
    if (!item) return undefined;
    if (patch.note !== undefined) {
      const note = patch.note.trim().slice(0, 1000);
      item.note = note || undefined;
      if (item.ask.kind === 'paint' || item.ask.kind === 'sound' || item.ask.kind === 'sheet') {
        item.ask = { ...item.ask, ...(note ? { note } : { note: undefined }) };
      }
    }
    if (patch.prompt !== undefined) {
      const prompt = patch.prompt.trim().slice(0, 4000);
      item.prompt = prompt || undefined;
      if (item.ask.kind === 'view' || item.ask.kind === 'clip' || item.ask.kind === 'normal') {
        item.ask = { ...item.ask, ...(prompt ? { prompt } : { prompt: undefined }) };
      } else if (item.ask.kind === 'paint') {
        item.ask = { ...item.ask, ...(prompt ? { note: prompt } : { note: undefined }) };
      }
    }
    if (patch.harmonized !== undefined) item.harmonized = patch.harmonized;
    if (patch.harmonizedPrompt !== undefined) item.harmonizedPrompt = patch.harmonizedPrompt.trim() || undefined;
    if (Array.isArray(patch.references)) item.references = patch.references;
    if (patch.label !== undefined && patch.label.trim()) item.label = patch.label.trim();
    await this.save();
    return normalizeItem(item);
  }

  async clear(): Promise<void> {
    await this.load();
    this.items = [];
    await this.save();
  }

  pause(): void {
    this.pauseRequested = true;
  }

  /**
   * Dispatches up to `count` items (or all items when `count` is omitted)
   * into `studio`, popping each item as it is queued into `ArtJobs`.
   */
  async runNext(studio: ArtStudio, count?: number): Promise<{ started: number; estimateUsd: number; paused?: string }> {
    await this.load();
    if (this.running) throw new ArtRequestError('The Up Next queue is already running.');
    this.running = true;
    this.pauseRequested = false;
    let started = 0;
    let estimateUsd = 0;
    let paused: string | undefined;
    try {
      const limit = count !== undefined && count > 0 ? count : this.items.length;
      while (started < limit && this.items.length > 0) {
        if (this.pauseRequested) {
          paused = 'Paused by Owner.';
          break;
        }
        const next = this.items[0]!;
        try {
          const res = await dispatchAsk(studio, next.ask);
          estimateUsd += res.estimateUsd;
          this.items.shift();
          await this.save();
          started++;
        } catch (err) {
          paused = (err as Error).message;
          break;
        }
      }
    } finally {
      this.running = false;
      this.pauseRequested = false;
    }
    return { started, estimateUsd: Math.round(estimateUsd * 1000) / 1000, ...(paused ? { paused } : {}) };
  }
}

async function dispatchAsk(studio: ArtStudio, ask: ArtAsk): Promise<{ estimateUsd: number }> {
  switch (ask.kind) {
    case 'paint':
      return studio.repaint(ask.asset, ask.note ?? '');
    case 'group':
      return studio.repaintGroup(ask.group);
    case 'view':
      return studio.paintView(ask.walker, ask.direction, ask.prompt, ask.from);
    case 'ways':
      return studio.paintWays(ask.walker);
    case 'clip':
      return studio.makeClip(ask.walker, ask.body, ask.direction, ask.prompt);
    case 'sound':
      return studio.sound(ask.sound, ask.note ?? '');
    case 'normal':
      return studio.paintNormal(ask.asset, ask.prompt);
    case 'sheet':
      return studio.paintSheet(ask.look, ask.textures ?? [], ask.note ?? '');
  }
}

function defaultLabel(ask: ArtAsk): string {
  switch (ask.kind) {
    case 'paint':
      return `Paint ${ask.asset}`;
    case 'group':
      return `Paint group ${ask.group}`;
    case 'view':
      return `Standing view: ${ask.walker} (${ask.direction})`;
    case 'ways':
      return ask.walker ? `4-way turnaround: ${ask.walker}` : '4-way turnarounds (all missing)';
    case 'clip':
      return `Walk clip: ${ask.walker} (${ask.direction})`;
    case 'sound':
      return `Sound: ${ask.sound}`;
    case 'normal':
      return `Normal map: ${ask.asset}`;
    case 'sheet':
      return `Texture sheet: ${ask.look}`;
  }
}

function defaultUsd(ask: ArtAsk): number {
  if (ask.kind === 'clip') return 0.4;
  return 0.039;
}

function targetIdOf(ask: ArtAsk): string {
  switch (ask.kind) {
    case 'paint':
    case 'normal':
      return ask.asset;
    case 'group':
      return ask.group;
    case 'view':
    case 'clip':
      return ask.walker;
    case 'ways':
      return ask.walker ?? 'all';
    case 'sound':
      return ask.sound;
    case 'sheet':
      return ask.look;
  }
}

function normalizeItem(item: UpNextItem): UpNextItem {
  const ask = item.ask;
  const kind = item.kind || (ask.kind === 'group' ? 'paint-group' : ask.kind);
  const targetId = item.targetId || targetIdOf(ask);
  const direction = item.direction ?? (ask.kind === 'view' || ask.kind === 'clip' ? ask.direction : undefined);
  const body = item.body ?? (ask.kind === 'clip' ? ask.body : undefined);
  const note = item.note ?? (ask.kind === 'paint' || ask.kind === 'sound' || ask.kind === 'sheet' ? ask.note : undefined);
  const prompt = item.prompt ?? (ask.kind === 'view' || ask.kind === 'clip' || ask.kind === 'normal' ? ask.prompt : undefined);
  return {
    ...item,
    kind,
    targetId,
    ...(direction ? { direction } : {}),
    ...(body ? { body } : {}),
    ...(note ? { note } : {}),
    ...(prompt ? { prompt } : {}),
    status: item.status ?? 'staged',
  };
}
