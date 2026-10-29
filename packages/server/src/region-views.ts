import { heldItem, maxHp, offHandItem, type BodyState, type Character, type CreatureDef, type CreatureMood, type CreatureState, type EntityState, type NpcState, type PlayerInfo, type StatusId } from '@co-mmo/shared';

// What players see of each thing in a region, as sent in snapshots and
// across a split region's cell borders. One builder per kind, so both
// places always send the same shape.

/** Positions and health shares are sent to a thousandth, which is plenty and keeps snapshots small. */
export function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** The floor a thing is on, sent only off the ground so snapshots stay small. */
function floorOf(floor: number | undefined): { floor?: number } {
  return floor ? { floor } : {};
}

/** Running statuses, sent only when there are some. */
function statusesOf(statuses: StatusId[] | undefined): { statuses?: StatusId[] } {
  return statuses?.length ? { statuses } : {};
}

/** Another player as seen by those nearby, with their running statuses (statusIds). */
export function playerView(p: { info: PlayerInfo; x: number; y: number; floor?: number; character: Character }, statuses?: StatusId[]): EntityState {
  const held = heldItem(p.character);
  const offHeld = offHandItem(p.character);
  return {
    id: p.info.id, name: p.info.name, color: p.info.color, x: round(p.x), y: round(p.y), ...floorOf(p.floor), health: round(p.character.hp / maxHp(p.character)),
    ...(held ? { held } : {}),
    ...(offHeld ? { offHeld } : {}),
    ...(p.character.hp <= 0 ? { fallen: true as const } : {}),
    ...statusesOf(statuses),
  };
}

/** A living creature, what it is up to when that shows (asleep, running away), and its running statuses. */
export function creatureView(c: { id: string; kind: string; def: CreatureDef; x: number; y: number; floor?: number; hp: number }, mood?: CreatureMood, statuses?: StatusId[]): CreatureState {
  return { id: c.id, kind: c.kind, asset: c.def.art, name: c.def.name, x: round(c.x), y: round(c.y), ...floorOf(c.floor), health: round(c.hp / c.def.hp), ...(mood ? { mood } : {}), ...statusesOf(statuses) };
}

/** A defeated creature's body; `loot` says whether the viewer may search it here. */
export function bodyView(b: { id: string; kind: string; def: CreatureDef; x: number; y: number; floor?: number }, loot: boolean): BodyState {
  return { id: b.id, kind: b.kind, asset: b.def.art, name: b.def.name, x: round(b.x), y: round(b.y), ...floorOf(b.floor), loot };
}

/** A person of the region. */
export function npcView(n: { id: string; name: string; asset: string; x: number; y: number; floor?: number; asleep?: boolean }): NpcState {
  return { id: n.id, name: n.name, asset: n.asset, x: round(n.x), y: round(n.y), ...floorOf(n.floor), ...(n.asleep ? { asleep: true } : {}) };
}
