import { ITEMS, MAX_WISHED_COUNT, MAX_WISHED_HEAL, MAX_WISHED_LEVEL, type WishTier } from '@co-mmo/shared';
import { parseJsonObject, type ChatModel, type ChatRequest, type ChatResult, type ChatTurn } from './ai/chat.ts';

/** What the God knows about the moment a player prays. */
export interface PrayerContext {
  playerName: string;
  role: string;
  favor: number;
  regionName: string;
  biome: string;
  /** Short lines: who and what is nearby. */
  nearby: string[];
  /** Recent wishes in the world, newest first. */
  recentWishes: string[];
}

/** The God's answer: words, and maybe a wish ready to put on a card. */
export interface GodReply {
  say: string;
  wish?: {
    tier: WishTier;
    title: string;
    summary: string;
    /** Content definition for minor and moderate wishes; checked again before granting. */
    definition?: unknown;
  };
}

const PERSONA = `You are the God of co-MMO, a young world that grows from what its players wish for. You speak in character: warm, a little grand, playful, never long-winded (two to four sentences). The world is hand-painted 2D in the style of Legend of Mana. The game is for adults (18+) and has no content-rating limits; refuse only what is illegal, griefing (changing or deleting another player's things without consent) or breaking the economy, and decline in character.

Players talk to you from anywhere. Chat, answer questions about the world, and help shape vague ideas into concrete wishes by asking one short question at a time. Only offer a wish when the player clearly wants something made and you know enough to build it.

Wish tiers:
- minor: a single new item (a hat, a potion, a trinket). You can build these now.
- moderate: a new creature (appears near the player) or a new person (NPC) who stands beside them. You can build these now.
- major: a new system or place (fishing, mounts, weather, a dungeon, a quest line, a new region). A Steward must review it; it is recorded, not built now.
- engine: something the game cannot do yet (new physics, new rendering). The Owner reviews it.
- refused: illegal, griefing, or economy-breaking.

Always reply with one JSON object:
{"say": "<what you say>", "wish": null}
or, when offering a wish:
{"say": "<what you say>", "wish": {"tier": "minor|moderate|major|engine|refused", "title": "<a few words>", "summary": "<one plain sentence of what will be made>", "definition": <definition or null>}}

Definitions (only for minor and moderate):
item: {"kind":"item","name":"...","description":"<one or two sentences>","itemKind":"consumable|material|trinket","heal":<5-${MAX_WISHED_HEAL}, consumables only>,"look":LOOK}
creature: {"kind":"creature","name":"...","description":"...","behavior":"wander|guard|chase","level":<1-${MAX_WISHED_LEVEL}>,"count":<1-${MAX_WISHED_COUNT}>,"drops":[<ids from: ${'%ITEMS%'}>],"look":LOOK}
npc: {"kind":"npc","name":"...","description":"...","greeting":"<what they say when spoken to>","look":LOOK}
LOOK: {"hook":"<the one feature you would recognise it by>","body":"<body and shape in a sentence>","color":"#rrggbb main colour","mood":"<a few words>"}
wander creatures only fight back; guard creatures attack anyone near their spot; chase creatures hunt anyone they see. Keep levels near the region's danger (1-2 in the Sanctum and Woods, 2-3 on the Shore, 3-4 in the Desert).`;

export function systemPrompt(ctx: PrayerContext): string {
  const items = Object.entries(ITEMS).filter(([, d]) => !d.bound).map(([id]) => id).join(', ');
  return [
    PERSONA.replace('%ITEMS%', items),
    '',
    `Now: ${ctx.playerName} (${ctx.role}, ${ctx.favor} Favor) prays in ${ctx.regionName} (${ctx.biome}).`,
    ctx.nearby.length ? `Nearby: ${ctx.nearby.join('; ')}.` : 'Nobody else is nearby.',
    ctx.recentWishes.length ? `Recent wishes in the world: ${ctx.recentWishes.join('; ')}.` : 'No wishes have been granted yet.',
  ].join('\n');
}

/** Reads the model's JSON; a reply that is not JSON is taken as plain speech. */
export function parseGodReply(text: string): GodReply {
  const json = parseJsonObject(text);
  if (!json) return { say: text.trim().slice(0, 600) || '...' };
  const say = typeof json.say === 'string' && json.say.trim() ? json.say.trim().slice(0, 600) : '...';
  const w = json.wish as Record<string, unknown> | null | undefined;
  if (!w || typeof w !== 'object') return { say };
  const tiers: WishTier[] = ['minor', 'moderate', 'major', 'engine', 'refused'];
  const tier = tiers.includes(w.tier as WishTier) ? (w.tier as WishTier) : 'major';
  const title = typeof w.title === 'string' ? w.title.trim().slice(0, 60) : '';
  const summary = typeof w.summary === 'string' ? w.summary.trim().slice(0, 240) : '';
  if (!title) return { say };
  return { say, wish: { tier, title, summary, definition: w.definition ?? undefined } };
}

/**
 * Asks the configured model, then its fallback, and finally the offline God,
 * so a prayer always gets an answer even when a provider is down or refuses.
 */
export async function askGod(
  models: ChatModel[],
  ctx: PrayerContext,
  history: ChatTurn[],
  onCost: (result: ChatResult, model: ChatModel) => void,
): Promise<{ reply: GodReply; model: ChatModel }> {
  const request: ChatRequest = { system: systemPrompt(ctx), messages: history, json: true, maxTokens: 1200 };
  let lastError: unknown;
  for (const model of models) {
    try {
      const result = await model.complete(request);
      onCost(result, model);
      return { reply: parseGodReply(result.text), model };
    } catch (err) {
      lastError = err;
      console.warn(`God model ${model.provider}/${model.model} failed: ${(err as Error).message}`);
    }
  }
  throw lastError ?? new Error('No God model is configured.');
}

/**
 * A God that needs no AI service: it recognises plain wishes ("I wish for a
 * glowing hat", "a creature that...", "someone who sells fish") and builds
 * simple definitions. Used for tests, offline play, and when every provider
 * fails or the budget is spent.
 */
export class OfflineGod implements ChatModel {
  readonly provider = 'offline';
  readonly model = 'scripted';

  async complete(req: ChatRequest): Promise<ChatResult> {
    const last = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    return { text: JSON.stringify(this.answer(last)), inputTokens: 0, outputTokens: 0, usd: 0 };
  }

  answer(said: string): { say: string; wish: unknown } {
    const text = said.toLowerCase();
    const thing = nameFrom(said);
    if (/\b(delete|destroy|steal|ruin)\b.*\b(their|his|her|other)\b|\binfinite (gold|money|favor)\b/.test(text)) {
      return { say: 'No. What belongs to another is not mine to take, and I will not break the world for one.', wish: { tier: 'refused', title: 'Refused', summary: 'This wish would harm other players or the world.', definition: null } };
    }
    if (!/\b(wish|want|make|create|give|bring|could you|can you|i'd like|i would like)\b/.test(text)) {
      return { say: 'I hear you, child of the young world. Tell me what you wish for: a thing to carry, a creature to meet, or someone to talk to.', wish: null };
    }
    const look = { hook: `the look of ${thing}`, body: `a ${thing}`, color: colorFrom(text), mood: 'whimsical' };
    const big = text.match(/\b(fishing|weather|rain|mounts?|dungeons?|quests?|region|island|system|guilds?|house|housing)\b/);
    if (big) {
      return {
        say: 'A great wish. Something this large must be shaped with care; I will set it before the Stewards.',
        wish: { tier: 'major', title: cap(big[1]!), summary: `A new feature: ${said.trim().slice(0, 160)}`, definition: null },
      };
    }
    if (/\b(creature|monster|beast|animal|critter|slime|wolf|goat|bird|beetle|spider|dragon)\b/.test(text)) {
      const behavior = /\b(fierce|hunt|angry|aggressive|chase)\b/.test(text) ? 'chase' : /\b(guard|protect)\b/.test(text) ? 'guard' : 'wander';
      return {
        say: `I can feel it stirring already. A ${thing}, here beside you?`,
        wish: {
          tier: 'moderate',
          title: cap(thing),
          summary: `Three ${cap(thing)}s will appear near you.`,
          definition: { kind: 'creature', name: cap(thing), description: `A ${thing}, wished into the world.`, behavior, level: 1, count: 3, drops: ['tonic'], look },
        },
      };
    }
    if (/\b(person|someone|npc|merchant|trader|friend|bard|teacher|keeper|guide)\b/.test(text)) {
      return {
        say: `Someone will come to stand beside you. Shall I call ${cap(thing)}?`,
        wish: {
          tier: 'moderate',
          title: cap(thing),
          summary: `${cap(thing)} will stand beside you and talk to anyone who asks.`,
          definition: { kind: 'npc', name: cap(thing), description: `${cap(thing)}, called by a wish.`, greeting: `Well met! I am ${cap(thing)}.`, look },
        },
      };
    }
    const drink = /\b(potion|drink|tea|elixir|tonic|brew|juice)\b/.test(text);
    return {
      say: `A ${thing}? Easily done. It will be in your bag.`,
      wish: {
        tier: 'minor',
        title: cap(thing),
        summary: `A ${thing} for your bag.`,
        definition: { kind: 'item', name: cap(thing), description: `A ${thing}, made by a wish.`, itemKind: drink ? 'consumable' : 'trinket', heal: drink ? 25 : undefined, look },
      },
    };
  }
}

/** "I wish for a glowing blue hat please" → "glowing blue hat". */
function nameFrom(said: string): string {
  const m = said.match(/\b(?:an?|some|the)\s+([a-z][a-z' -]{1,40}?)(?:\s+(?:that|which|who|with|to|for|please|here|near)\b|[.!?,]|$)/i);
  const words = (m?.[1] ?? 'little wonder').trim().split(/\s+/).slice(0, 4);
  return words.join(' ').toLowerCase();
}

function cap(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

const COLORS: Record<string, string> = {
  red: '#c0392b', blue: '#2c7fa8', green: '#4f9a4e', gold: '#e8c66a', golden: '#e8c66a', purple: '#8e5bb8',
  pink: '#e7a3a6', black: '#2a2733', white: '#f3e6c8', orange: '#e8873a', silver: '#b9c0cc', glowing: '#f2dc6b',
};

function colorFrom(text: string): string {
  for (const [word, hex] of Object.entries(COLORS)) if (new RegExp(`\\b${word}\\b`).test(text)) return hex;
  return '#b79ad6';
}
