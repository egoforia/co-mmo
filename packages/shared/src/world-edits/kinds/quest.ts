import { ITEMS, QUESTS, type QuestDef } from '../../rpg.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, inside } from '../tiles.ts';
import { QUEST_TEXT } from '../types.ts';

// A quest one of the land's people gives: defeat so many of a monster, or
// bring so many of a thing, for experience and gold. Laid, it joins the
// game's quests (QUESTS) under the edit's name, as wished content does, on
// the server and in every browser that lays the land; the land lists it
// (`map.quests`), so a draft, or a quest taken back, is never offered.

/** The quest's name in QUESTS, from the edit that made it. */
export const questId = (editId: string) => `${editId}:quest`;

/** Gives the person clicked a quest. */
export const QUEST: EditKind<'quest'> = {
  kind: 'quest',
  name: 'Quest',
  hint: 'Write the quest and what it asks, then click the person who gives it. Players who talk to them are offered it, and hand it in to them.',
  pointer: 'click',
  onFloors: true,
  targets: 'person',
  fields: [
    { key: 'title', label: 'Title', type: 'text', max: QUEST_TEXT.title, default: 'A Small Favour' },
    { key: 'offer', label: 'How they ask', type: 'text', max: QUEST_TEXT.words, default: 'Would you help me with something?' },
    { key: 'thanks', label: 'How they thank you', type: 'text', max: QUEST_TEXT.words, default: 'Thank you, friend.' },
    { key: 'goal', label: 'It asks', type: 'choice', choices: () => [{ id: 'defeat', name: 'Defeat monsters' }, { id: 'gather', name: 'Bring things' }] },
    { key: 'creature', label: 'Monster to defeat', type: 'choice', choices: (ctx) => Object.entries(ctx.creatures).sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([id, c]) => ({ id, name: c.name })) },
    { key: 'item', label: 'Thing to bring', type: 'choice', choices: () => Object.entries(ITEMS).filter(([, d]) => !d.bound && !d.copy).sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([id, d]) => ({ id, name: d.name })) },
    { key: 'count', label: 'How many', type: 'number', min: 1, max: QUEST_TEXT.count, default: 4 },
    { key: 'xp', label: 'Experience', type: 'number', min: 0, max: QUEST_TEXT.reward, default: 40 },
    { key: 'gold', label: 'Gold', type: 'number', min: 0, max: QUEST_TEXT.reward, default: 15 },
  ],
  shape: '{"kind":"quest","at":[x,y],"target":"<person id>","title":"Wolves at the Gate","offer":"words","thanks":"words","goal":{"kind":"defeat","creature":"<creatureId>","count":4},"reward":{"xp":40,"gold":15}}',
  make: (use, v) => ({
    kind: 'quest',
    at: use.at,
    ...(use.target ? { target: use.target } : {}),
    title: String(v.title).trim(),
    offer: String(v.offer).trim(),
    thanks: String(v.thanks).trim(),
    goal: v.goal === 'gather' ? { kind: 'gather', items: [{ item: String(v.item), qty: Number(v.count) }] } : { kind: 'defeat', creature: String(v.creature), count: Number(v.count) },
    reward: { xp: Number(v.xp), gold: Number(v.gold) },
  }),
  check(map, edit, ctx) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    if (!edit.target || !map.npcs.some((n) => n.id === edit.target)) return 'Click the person who gives the quest.';
    const text = (s: unknown, max: number) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
    if (!text(edit.title, QUEST_TEXT.title)) return `Give the quest a title of 1 to ${QUEST_TEXT.title} letters.`;
    if (!text(edit.offer, QUEST_TEXT.words) || !text(edit.thanks, QUEST_TEXT.words)) return `Say how they ask and thank, in 1 to ${QUEST_TEXT.words} letters each.`;
    const count = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= QUEST_TEXT.count;
    const g = edit.goal;
    if (g?.kind === 'defeat') {
      if (!ctx.creatures[g.creature]) return 'There is no monster of that kind.';
      if (!count(g.count)) return `Ask for 1 to ${QUEST_TEXT.count} of them.`;
    } else if (g?.kind === 'gather') {
      if (!Array.isArray(g.items) || g.items.length !== 1 || !ITEMS[g.items[0]!.item] || ITEMS[g.items[0]!.item]!.bound) return 'Pick a thing players can bring.';
      if (!count(g.items[0]!.qty)) return `Ask for 1 to ${QUEST_TEXT.count} of them.`;
    } else return 'A quest asks players to defeat monsters or bring things.';
    const reward = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= QUEST_TEXT.reward;
    return reward(edit.reward?.xp) && reward(edit.reward?.gold) ? undefined : `A reward is 0 to ${QUEST_TEXT.reward} experience and gold.`;
  },
  apply(map, edit) {
    const giver = map.npcs.find((n) => n.id === edit.target);
    if (!giver) return false;
    const g = edit.goal;
    const what = g.kind === 'defeat' ? `${g.count} of them` : `${g.items[0]!.qty} ${ITEMS[g.items[0]!.item]?.name ?? 'of them'}`;
    const def: QuestDef = {
      title: edit.title,
      giver: giver.id,
      offer: edit.offer,
      waiting: g.kind === 'defeat' ? `Have you dealt with them yet? I asked for ${what}.` : `Have you found them yet? I asked for ${what}.`,
      thanks: edit.thanks,
      goal: structuredClone(g),
      reward: { xp: edit.reward.xp, gold: edit.reward.gold },
      edit: true,
    };
    QUESTS[questId(edit.id)] = def;
    (map.quests ??= []).push(questId(edit.id));
    return true;
  },
  keep: (d) => ({
    kind: 'quest',
    at: d.at,
    title: d.title.trim(),
    offer: d.offer.trim(),
    thanks: d.thanks.trim(),
    goal: d.goal.kind === 'defeat' ? { kind: 'defeat', creature: d.goal.creature, count: d.goal.count } : { kind: 'gather', items: d.goal.items.map((i) => ({ item: i.item, qty: i.qty })) },
    reward: { xp: d.reward.xp, gold: d.reward.gold },
  }),
  words: (e) => `Quest “${e.title}”, given at ${e.at.join(', ')}`,
};
