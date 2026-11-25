// One flat list of everything the Art Studio's asset browser shows: every
// picture, walker and sound, sorted into the browser's groups, with its land,
// the tiles it stands on and whether it is painted. Built from the catalog
// the Art tab already caches (art-studio.ts overview), so it costs no extra
// reads; stairs and ladders come from the shipped manifest, since the catalog
// has no page for them yet.

import { BUILDING_STYLES, WORLD_REGIONS, generateRegion, type ArtManifest } from '@co-mmo/shared';
import type { SoundItem } from '../sound-maker.ts';
import type { ArtItem, WalkerView } from './types.ts';

/** The browser's groups, in the order its chips show them. */
export const ASSET_GROUPS = ['characters', 'monsters', 'items', 'scenery', 'pieces', 'spots', 'stairs', 'buildings', 'hud', 'sounds'] as const;
export type AssetGroup = (typeof ASSET_GROUPS)[number];

/** One entry of the asset browser. */
export interface StudioAsset {
  id: string;
  name: string;
  group: AssetGroup;
  /** The land it belongs to, when it belongs to one. */
  land?: string;
  /** The tiles it stands on, for pieces, furniture and stairs. */
  footprint?: { width: number; height: number };
  /** Painted (here or shipped), standing in for another, or not painted yet. */
  status: 'painted' | 'stand-in' | 'missing';
  /** Its picture, for the thumbnail. */
  thumb?: string;
  /** Where today's page for it is: tab, page, and the walker or asset to focus. */
  place: { tab: string; page?: string; walker?: string; asset?: string };
}

/** The group a picture belongs in. */
export function pictureGroup(item: Pick<ArtItem, 'id' | 'kind' | 'category' | 'place'>): AssetGroup {
  if (item.category === 'gathering-spot' || item.id.startsWith('spot-')) return 'spots';
  if (/^(stairs|ladder)-/.test(item.id)) return 'stairs';
  if (item.kind === 'building') return /-furniture-/.test(item.id) ? 'pieces' : 'buildings';
  if (item.kind === 'set-piece') return 'pieces';
  if (item.kind === 'prop' || item.kind === 'tile') return 'scenery';
  if (item.place.tab === 'hud' || item.kind === 'effect') return 'hud';
  if (item.place.tab === 'characters') return 'characters';
  if (item.place.tab === 'monsters') return 'monsters';
  if (item.place.tab === 'biomes') return 'scenery';
  return 'items';
}

let footprints: Map<string, { width: number; height: number }> | undefined;

/** Every built-in piece's and piece of furniture's footprint, by its picture's id: from the lands as laid out, then the building styles. */
export function pieceFootprints(): Map<string, { width: number; height: number }> {
  if (footprints) return footprints;
  const found = new Map<string, { width: number; height: number }>();
  for (const def of WORLD_REGIONS) {
    for (const l of generateRegion(def).landmarks) if (!found.has(l.asset)) found.set(l.asset, { ...l.footprint });
  }
  for (const style of Object.values(BUILDING_STYLES)) {
    for (const [key, f] of Object.entries(style.furniture)) {
      const id = `${style.id}-furniture-${key}`;
      if (!found.has(id)) found.set(id, { width: f.width, height: f.depth ?? 1 });
    }
  }
  return (footprints = found);
}

/** The tiles a flight of stairs or a ladder picture stands on: 1 × 1 for a ladder, 2 × 1 for stairs, as placeStairs lays them most often. */
function stairFootprint(id: string): { width: number; height: number } {
  return id.startsWith('ladder-') ? { width: 1, height: 1 } : { width: 2, height: 1 };
}

/** A stairs or ladder id's name: "stairs-frostpeak-east-up" is "Frostpeak stairs, east, up". */
export function stairName(id: string): string {
  const words = id.split('-');
  const kind = words.shift()!;
  const way = words.filter((w) => ['up', 'down', 'north', 'south', 'east', 'west'].includes(w));
  const land = words.filter((w) => !way.includes(w)).join(' ');
  const title = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
  return [land ? `${title(land)} ${kind}` : title(kind), ...way].join(', ');
}

/** The asset browser's list, from the Art tab's overview and the shipped manifest. */
export function studioAssets(o: { items: ArtItem[]; walkers: WalkerView[]; sounds: SoundItem[] }, shipped: ArtManifest): StudioAsset[] {
  const feet = pieceFootprints();
  const list: StudioAsset[] = [];
  for (const w of o.walkers) {
    const group: AssetGroup = w.place.tab === 'monsters' || w.kind === 'creature' ? 'monsters' : 'characters';
    list.push({
      id: w.id, name: w.name, group, status: w.url ? 'painted' : 'missing', ...(w.url ? { thumb: w.url } : {}),
      place: { tab: w.place.tab, page: w.place.page, walker: w.id },
    });
  }
  const walkers = new Set(o.walkers.map((w) => w.id));
  for (const item of o.items) {
    if (walkers.has(item.id)) continue;
    const group = pictureGroup(item);
    const status = item.source !== 'missing' ? 'painted' : item.standIn ? 'stand-in' : 'missing';
    const footprint = group === 'pieces' ? feet.get(item.id) : undefined;
    const thumb = item.url ?? item.standIn?.url;
    list.push({
      id: item.id, name: item.name, group, status,
      ...(item.biome ? { land: item.biome } : {}), ...(footprint ? { footprint } : {}), ...(thumb ? { thumb } : {}),
      place: { tab: item.place.tab, page: item.place.page, asset: item.id },
    });
  }
  for (const id of Object.keys(shipped).filter((k) => /^(stairs|ladder)-/.test(k)).sort()) {
    list.push({ id, name: stairName(id), group: 'stairs', status: 'painted', footprint: stairFootprint(id), thumb: `/${shipped[id]!.file}`.replace(/^\/+/, '/'), place: { tab: 'biomes' } });
  }
  for (const s of o.sounds) {
    list.push({ id: s.id, name: s.name, group: 'sounds', status: s.url ? 'painted' : 'missing', place: { tab: 'sounds', asset: s.id } });
  }
  return list;
}
