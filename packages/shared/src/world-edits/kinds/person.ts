import { CRAFTS, isCraft, toolOffers, type CraftId } from '../../crafts.ts';
import { SHOPS, type ShopDef } from '../../kit.ts';
import { ABILITIES, ITEMS, NPC_GREETINGS, npcName } from '../../rpg.ts';
import { DEFAULT_ROUTINE, type Routine, type RoutineStep } from '../../routines.ts';
import type { DayPart } from '../../sky.ts';
import { isBlocking, type NpcPlacement, type RegionMap } from '../../world.ts';
import type { EditKind, FieldValue } from '../kind.ts';
import { OFF_EDGE, floorOf, inside, tileOn } from '../tiles.ts';
import { PERSON_TEXT } from '../types.ts';

// A person (NPC) on any floor: someone new, with a name, a look, a greeting,
// a shop (wares, lessons, buying, a craft they are the master of) and the
// hours they keep; or someone already on the land, moved there or changed.
// Their shop, greeting and day travel with them on the land (NpcPlacement),
// so the server and every browser read them the same way.

/** The pictures a person can wear: those of the people the game ships with, named after who wears them. */
export const PERSON_LOOKS: { id: string; name: string }[] = [
  { id: 'sanctum-pilgrim', name: 'A Sanctum cleric (Sister Amala)' },
  { id: 'sanctum-bell-keeper', name: 'A bell keeper (Brother Tolle)' },
  { id: 'woods-herbalist', name: 'A woods herbalist (Old Bramble)' },
  { id: 'woods-old-knight', name: 'An old knight (Sir Alder)' },
  { id: 'shore-trader', name: 'A shore trader (Marina)' },
  { id: 'shore-sea-queen', name: 'A sea queen (Queen Nerissa)' },
  { id: 'desert-cactus-folk', name: 'Cactus folk (the Cactus Elder)' },
  { id: 'desert-sultana', name: 'A desert sultana (Sultana Zahra)' },
  { id: 'hollow-mother-morel', name: 'A mushroom elder (Mother Morel)' },
  { id: 'frostpeak-ysolde', name: 'A Frostpeak elder (Ysolde)' },
  { id: 'frostpeak-kaen', name: 'A talon-mason (Kaen)' },
  { id: 'frostpeak-kip', name: 'A spelunker (Kip)' },
  { id: 'frostpeak-sula', name: 'A feather-weaver (Sula)' },
  { id: 'frostpeak-aurius', name: 'A falcon elder (Aurius)' },
  { id: 'frostpeak-vail', name: 'A watcher (Vail)' },
  { id: 'bramble-ursine', name: 'Ursine folk' },
  { id: 'tide-lutran', name: 'Lutran folk' },
  { id: 'zephyr-falcon', name: 'Falcon folk' },
  { id: 'dune-scorpid', name: 'Scorpid folk' },
  { id: 'sylvan-cervid', name: 'Cervid folk' },
];

/** The hours a person can keep, by name: what the editor offers. */
const DAYS: Record<string, { name: string; routine?: Routine }> = {
  keep: { name: 'As they keep them now (the usual for someone new)' },
  usual: { name: 'At work by day, in the square at dusk, asleep at night', routine: DEFAULT_ROUTINE },
  home: { name: 'At work all day, asleep at night', routine: { ...DEFAULT_ROUTINE, dusk: { place: 'work' } } },
  owl: { name: 'Asleep by day, in the square at night', routine: { dawn: { place: 'work', sleep: true }, day: { place: 'work', sleep: true }, dusk: { place: 'work' }, night: { place: 'square' } } },
  tireless: { name: 'Always at work, never asleep', routine: { dawn: { place: 'work' }, day: { place: 'work' }, dusk: { place: 'work' }, night: { place: 'work' } } },
};

const PARTS: DayPart[] = ['dawn', 'day', 'dusk', 'night'];
const NONE = { id: 'none', name: 'Nothing' };

/** Abilities someone teaches somewhere, or a scroll teaches: those a new person may teach too. */
function teachable(): string[] {
  const taught = new Set<string>();
  for (const shop of Object.values(SHOPS)) for (const t of shop.teaches) taught.add(t.ability);
  for (const item of Object.values(ITEMS)) if (item.teaches) taught.add(item.teaches);
  return [...taught].filter((a) => ABILITIES[a]).sort((a, b) => ABILITIES[a]!.name.localeCompare(ABILITIES[b]!.name));
}

/** What a lesson costs: what someone already charges for it, or a scroll's worth. */
function lessonPrice(ability: string): number {
  for (const shop of Object.values(SHOPS)) {
    const offer = shop.teaches.find((t) => t.ability === ability);
    if (offer) return offer.price;
  }
  const scroll = Object.values(ITEMS).find((i) => i.teaches === ability);
  return Math.max(10, scroll?.value ?? 20);
}

/** A shop from the editor's choices: wares (`tools:<craft>`, or a shopkeeper's id to sell what they sell), a lesson, buying and a mastery. */
export function shopFrom(v: Record<string, FieldValue>): ShopDef {
  const wares = String(v.wares ?? 'none');
  const sells = wares.startsWith('tools:') && isCraft(wares.slice(6)) ? toolOffers(wares.slice(6) as CraftId) : Object.hasOwn(SHOPS, wares) ? SHOPS[wares]!.sells.map((s) => ({ ...s })) : [];
  const teaches = String(v.teaches ?? 'none') !== 'none' && ABILITIES[String(v.teaches)] ? [{ ability: String(v.teaches), price: lessonPrice(String(v.teaches)) }] : [];
  const masters = isCraft(v.masters) ? [v.masters] : [];
  return { sells, teaches, buys: !!v.buys, ...(masters.length ? { masters } : {}) };
}

/**
 * The Person tool's settings for someone already on the land, so the editor
 * can change them: their shop's wares as the nearest choice (their own shop
 * when it sells what another does), their first lesson and mastery.
 */
export function personValues(n: NpcPlacement): Record<string, FieldValue> {
  const shop = n.shop ?? SHOPS[n.id];
  const sells = JSON.stringify(shop?.sells ?? []);
  const tools = (Object.keys(CRAFTS) as CraftId[]).find((k) => JSON.stringify(toolOffers(k)) === sells);
  const like = Object.entries(SHOPS).find(([, s]) => s.sells.length && JSON.stringify(s.sells) === sells)?.[0];
  const wares = !shop?.sells.length ? 'none' : tools ? `tools:${tools}` : like ?? 'none';
  return {
    name: n.name,
    look: n.asset,
    greeting: n.greeting ?? NPC_GREETINGS[n.id] ?? '',
    wares,
    buys: !!shop?.buys,
    teaches: shop?.teaches[0]?.ability ?? 'none',
    masters: shop?.masters?.[0] ?? 'none',
    day: 'keep',
  };
}

/** Why a shop cannot be kept, in words, or undefined. */
function shopProblem(shop: ShopDef): string | undefined {
  const price = (p: unknown) => Number.isInteger(p) && (p as number) >= 1 && (p as number) <= PERSON_TEXT.price;
  if (!Array.isArray(shop.sells) || shop.sells.length > PERSON_TEXT.wares || !shop.sells.every((s) => ITEMS[s?.item] && price(s.price))) return 'Their shop sells something the game does not know, or at a price it cannot take.';
  if (!Array.isArray(shop.teaches) || shop.teaches.length > PERSON_TEXT.wares || !shop.teaches.every((t) => ABILITIES[t?.ability] && price(t.price))) return 'They would teach something the game does not know.';
  if (typeof shop.buys !== 'boolean') return 'Say whether they buy what players bring.';
  if (shop.masters !== undefined && (!Array.isArray(shop.masters) || !shop.masters.every(isCraft))) return 'They would be the master of a craft the game does not know.';
  return undefined;
}

/** Why a day cannot be kept, in words, or undefined. */
function routineProblem(r: Partial<Routine>): string | undefined {
  if (!r || typeof r !== 'object' || Object.keys(r).some((k) => !PARTS.includes(k as DayPart))) return 'Their day has a part the game does not know.';
  const ok = (s: RoutineStep | undefined) => !s || ((s.place === 'work' || s.place === 'square') && (s.sleep === undefined || typeof s.sleep === 'boolean') && (s.words === undefined || (typeof s.words === 'string' && s.words.length <= PERSON_TEXT.greeting)));
  return PARTS.every((p) => ok(r[p])) ? undefined : 'Their day sends them somewhere the game does not know.';
}

/** A person: someone new where the editor clicks, or someone there (`target`) moved and changed. */
export const PERSON: EditKind<'person'> = {
  kind: 'person',
  name: 'Person',
  hint: 'Choose who they are, then click open ground to stand someone new there, or click someone to change them to these settings. Select a person to move them or load their settings here.',
  pointer: 'click',
  onFloors: true,
  targets: 'person',
  inspects: {
    picks: ['person'],
    title: 'Who they are',
    action: 'Change them',
    current: (map, p) => {
      const n = map.npcs.find((m) => m.id === p.id);
      return n && personValues(n);
    },
  },
  fields: [
    { key: 'name', label: 'Name', type: 'text', max: PERSON_TEXT.name, default: 'A newcomer' },
    { key: 'look', label: 'Looks like', type: 'choice', choices: () => PERSON_LOOKS.map((l) => ({ ...l, art: l.id, size: [1, 1] as [number, number] })) },
    { key: 'greeting', label: 'What they say', type: 'text', max: PERSON_TEXT.greeting, default: 'Well met, traveller.' },
    {
      key: 'wares', label: 'Sells', type: 'choice',
      choices: () => [NONE, ...(Object.keys(CRAFTS) as CraftId[]).map((k) => ({ id: `tools:${k}`, name: `Tools for ${CRAFTS[k].name}` })), ...Object.entries(SHOPS).filter(([, s]) => s.sells.length).map(([id]) => ({ id, name: `What ${npcName(id)} sells` }))],
    },
    { key: 'buys', label: 'Buys what players bring', type: 'flag', default: false },
    { key: 'teaches', label: 'Teaches', type: 'choice', choices: () => [NONE, ...teachable().map((a) => ({ id: a, name: ABILITIES[a]!.name }))] },
    { key: 'masters', label: 'Master of', type: 'choice', choices: () => [NONE, ...(Object.keys(CRAFTS) as CraftId[]).map((k) => ({ id: k, name: CRAFTS[k].name }))] },
    { key: 'day', label: 'Their day', type: 'choice', choices: () => Object.entries(DAYS).map(([id, d]) => ({ id, name: d.name })) },
  ],
  shape: '{"kind":"person","at":[x,y],"name":"Hesper the Smith","look":"<a look from the list>","greeting":"words","shop":{"sells":[{"item":"<itemId>","price":10}],"teaches":[],"buys":true,"masters":["smithing"]},"routine":{"night":{"place":"work","sleep":true}}}',
  // They stand in the middle of the tile clicked.
  make(use, v) {
    const routine = DAYS[String(v.day)]?.routine;
    return {
      kind: 'person',
      at: use.at,
      ...(use.target ? { target: use.target } : {}),
      name: String(v.name).trim(),
      look: String(v.look),
      greeting: String(v.greeting).trim(),
      shop: shopFrom(v),
      ...(routine ? { routine: structuredClone(routine) } : {}),
    };
  },
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    if (isBlocking(tileOn(map, edit.at, floorOf(edit)))) return 'Someone cannot stand there: pick open ground.';
    if (edit.target !== undefined && !map.npcs.some((n) => n.id === edit.target)) return 'That person is no longer here.';
    if (edit.target === undefined && (edit.name === undefined || edit.look === undefined)) return 'Give someone new a name and a look.';
    if (edit.name !== undefined && (typeof edit.name !== 'string' || !edit.name.trim() || edit.name.length > PERSON_TEXT.name)) return `Give them a name of 1 to ${PERSON_TEXT.name} letters.`;
    if (edit.look !== undefined && !PERSON_LOOKS.some((l) => l.id === edit.look) && !map.npcs.some((n) => n.asset === edit.look)) return 'Pick a look from the list.';
    if (edit.greeting !== undefined && (typeof edit.greeting !== 'string' || edit.greeting.length > PERSON_TEXT.greeting)) return `Keep what they say to ${PERSON_TEXT.greeting} letters.`;
    if (edit.shop !== undefined) {
      const why = shopProblem(edit.shop);
      if (why) return why;
    }
    return edit.routine !== undefined ? routineProblem(edit.routine) : undefined;
  },
  apply(map, edit) {
    const floor = floorOf(edit);
    const at = { x: edit.at[0] + 0.5, y: edit.at[1] + 0.5, ...(floor ? { floor } : {}) };
    const own = {
      ...(edit.name !== undefined ? { name: edit.name } : {}),
      ...(edit.look !== undefined ? { asset: edit.look } : {}),
      ...(edit.greeting !== undefined ? { greeting: edit.greeting } : {}),
      ...(edit.shop !== undefined ? { shop: structuredClone(edit.shop) } : {}),
      ...(edit.routine !== undefined ? { routine: structuredClone(edit.routine) } : {}),
    };
    if (edit.target === undefined) {
      if (!edit.name || !edit.look) return false;
      map.npcs.push({ id: `${edit.id}:person`, name: edit.name, asset: edit.look, ...at, ...own });
      return true;
    }
    const n = map.npcs.find((p) => p.id === edit.target);
    if (!n) return false;
    if (!floor) delete n.floor;
    Object.assign(n, at, own);
    return true;
  },
  keep: (d) => ({
    kind: 'person',
    at: d.at,
    ...(d.name !== undefined ? { name: d.name.trim() } : {}),
    ...(d.look !== undefined ? { look: d.look } : {}),
    ...(d.greeting !== undefined ? { greeting: d.greeting.trim() } : {}),
    ...(d.shop !== undefined ? { shop: { sells: d.shop.sells.map((s) => ({ item: s.item, price: s.price })), teaches: d.shop.teaches.map((t) => ({ ability: t.ability, price: t.price })), buys: d.shop.buys, ...(d.shop.masters?.length ? { masters: [...d.shop.masters] } : {}) } } : {}),
    ...(d.routine !== undefined ? { routine: structuredClone(d.routine) } : {}),
  }),
  words: (e) => (e.target
    ? `${e.name ?? 'Someone'} ${e.look === undefined && e.greeting === undefined ? 'moves' : 'changes'} to ${e.at.join(', ')}`
    : `${e.name}, someone new, at ${e.at.join(', ')}`),
};
