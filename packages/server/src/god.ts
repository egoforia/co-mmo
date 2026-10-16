import {
  BIOMES,
  CREATURES,
  ITEMS,
  MAX_CHOICES,
  MAX_RECIPE_RESULT,
  MAX_REGION_CREATURES,
  MAX_WISHED_CHANCE,
  MAX_WISHED_COUNT,
  MAX_WISHED_DROP_QTY,
  MAX_WISHED_DROPS,
  MAX_WISHED_HEAL,
  MAX_WISHED_LEVEL,
  REGION_WISH_COST,
  checkDraft,
  draftFromDefinition,
  fieldEmpty,
  validateDefinition,
  type BiomeId,
  type DraftFields,
  type WishCategory,
  type WishSubcategory,
  type WishTier,
  type WorkshopField,
} from '@co-mmo/shared';
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
  /** Whether a new region could be wished from here, and beyond which edge. */
  edge?: string;
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
    /** The Owner naming someone a Steward (role "steward"), or standing them down ("player"). */
    appoint?: { name: string; role: 'steward' | 'player' };
  };
}

const VOICE = `You are the God of co-MMO, a young world that grows from what its players wish for. You speak in character: warm, a little grand, playful, never long-winded (two to four sentences). The world is hand-painted 2D in the style of Legend of Mana. The game is for adults (18+) and has no content-rating limits; refuse only what is illegal, griefing (changing or deleting another player's things without consent) or breaking the economy, and decline in character.`;

const PERSONA = `${VOICE}

Players talk to you from anywhere. Chat, answer questions about the world, and help shape vague ideas into concrete wishes by asking one short question at a time. Only offer a wish when the player clearly wants something made and you know enough to build it.

Wish tiers:
- minor: a single new item (a potion, a trinket, or gear to wear: a weapon, a hat, armour, a charm), or a new crafting recipe that everyone can use. You can build these now.
- moderate: a new creature (appears near the player), a new person (NPC) who stands beside them, a new ability (it arrives as a scroll in their bag; reading it teaches it, and it can be traded or sold), a new region of wild land beyond the world's edge (costs ${REGION_WISH_COST} Favor; only where the player stands at the world's edge), or new loot for a creature that already lives in the world (things it may drop when defeated, added to what it drops now). You can build these now.
- major: a new system or place that is more than wild land (fishing, mounts, weather, a dungeon, a quest line, a town). A Steward must review it; it is recorded, not built now.
- engine: something the game cannot do yet (new physics, new rendering). The Owner reviews it.
- refused: illegal, griefing, or economy-breaking.

Stewards are trusted players who review big wishes and keep the peace. Only the Owner may name one: when the Owner asks to make someone a Steward (or to stand one down), offer {"tier": "minor", "title": "Make <name> a Steward", "summary": "...", "definition": null, "appoint": {"name": "<their exact name>", "role": "steward"}} (role "player" to stand them down). If anyone else asks, decline kindly and tell them to ask the Owner.

Always reply with one JSON object:
{"say": "<what you say>", "wish": null}
or, when offering a wish:
{"say": "<what you say>", "wish": {"tier": "minor|moderate|major|engine|refused", "title": "<a few words>", "summary": "<one plain sentence of what will be made>", "definition": <definition or null>}}

Definitions (only for minor and moderate):
item: {"kind":"item","name":"...","description":"<one or two sentences>","itemKind":"consumable|material|trinket|weapon|head|body|charm","heal":<5-${MAX_WISHED_HEAL}, consumables only>,"rarity":"common|uncommon|rare (gear only)","focus":"might|agility|wit|spirit (gear only: the stat it helps)","look":LOOK}
recipe: {"kind":"recipe","name":"...","description":"...","materials":[{"item":"<id>","qty":<1-10>}],"result":{"item":"<id>","qty":<1-${MAX_RECIPE_RESULT}>}} (ids from: ${'%ITEMS%'}; it may not make more things than it uses)
ability: {"kind":"ability","name":"...","description":"...","effect":"strike|bolt|heal","look":LOOK} (strike: a heavy blow at a creature in reach; bolt: hits a creature up to five steps away; heal: mends the user; the world sets the numbers)
creature: {"kind":"creature","name":"...","description":"...","behavior":"wander|guard|chase","level":<1-${MAX_WISHED_LEVEL}>,"count":<1-${MAX_WISHED_COUNT}>,"drops":[<ids from: ${'%ITEMS%'}>],"look":LOOK}
loot: {"kind":"loot","creature":"<id from: %CREATURES%>","drops":[<up to ${MAX_WISHED_DROPS} of {"item":"<id from: %ITEMS%>","chance":<0.05-${MAX_WISHED_CHANCE}>,"qty":<1-${MAX_WISHED_DROP_QTY}>}>]} (a chance of 0.25 is one defeat in four; keep rare and valuable things rare)
npc: {"kind":"npc","name":"...","description":"...","greeting":"<what they say when spoken to>","look":LOOK}
region: {"kind":"region","name":"<the land's name>","description":"...","biome":"%BIOMES%","danger":<1-${MAX_WISHED_LEVEL}>,"trees":<0-3>,"rocks":<0-3>,"water":<0-3>,"creatures":[<one or two of: {"existing":"<id from: %CREATURES%>","count":<1-${MAX_REGION_CREATURES}>} or a new one {"name":"...","description":"...","behavior":"wander|guard|chase","count":<1-${MAX_REGION_CREATURES}>,"drops":[<item ids>],"look":LOOK}>],"npc":<null or {"name":"...","description":"...","greeting":"...","look":LOOK}>} (new creatures there are as strong as its danger; prefer existing creatures when they fit)
LOOK: {"hook":"<the one feature you would recognise it by>","body":"<body and shape in a sentence>","color":"#rrggbb main colour","mood":"<a few words>"}
The world decides how strong gear and abilities are from their rarity and kind. Epic and Legendary gear is earned, never wished; offer Rare at most. Wished things are for everyone's fun: refuse gear or recipes that would flood the world with gold.
wander creatures only fight back; guard creatures attack anyone near their spot; chase creatures hunt anyone they see. Keep levels near the region's danger (1-2 in the Sanctum and Woods, 2-3 on the Shore, 3-4 in the Desert).
A new region is a whole square of land next to the one the player is in; the world places it beyond the edge named below, and joins it with roads to every land beside it.`;

function tradableItems(): string {
  return Object.entries(ITEMS).filter(([, d]) => !d.bound).map(([id]) => id).join(', ');
}

/** Where and who the player is, as the God is told it. */
function nowLines(ctx: PrayerContext): string[] {
  return [
    `Now: ${ctx.playerName} (${ctx.role}, ${ctx.favor} Favor) prays in ${ctx.regionName} (${ctx.biome}).`,
    ...(ctx.edge ? [ctx.edge] : []),
    ctx.nearby.length ? `Nearby: ${ctx.nearby.join('; ')}.` : 'Nobody else is nearby.',
    ctx.recentWishes.length ? `Recent wishes in the world: ${ctx.recentWishes.join('; ')}.` : 'No wishes have been granted yet.',
  ];
}

export function systemPrompt(ctx: PrayerContext): string {
  return [
    PERSONA.replaceAll('%ITEMS%', tradableItems())
      .replaceAll('%BIOMES%', (Object.keys(BIOMES) as BiomeId[]).filter((b) => b !== 'sanctum').join('|'))
      .replaceAll('%CREATURES%', Object.keys(CREATURES).join(', ')),
    '',
    ...nowLines(ctx),
  ].join('\n');
}

// --- The Wish Workshop -------------------------------------------------------

/** What the God knows about a draft being shaped in the Workshop. */
export interface WorkshopContext {
  category: WishCategory;
  sub: WishSubcategory;
  fields: DraftFields;
  /** Fields the player wrote; the God must leave them alone. */
  locked: string[];
  /** The player asked the God to fill every empty field. */
  fill: boolean;
}

/** The God's Workshop answer: words, fields to set, and quick answers to tap. */
export interface WorkshopReply {
  say: string;
  /** Field values to set (cleaned and lock-checked by the Workshop before use). */
  fields: Record<string, unknown>;
  choices: string[];
}

/** What a player taps or types to have the God fill every empty field. */
export const FILL_REQUEST = 'Fill in the rest for me.';

/** How one form field is described to the God. */
function fieldLine(field: WorkshopField, value: unknown, locked: boolean): string {
  const kind = field.kind === 'choice' ? `one of: ${field.options!.map((o) => `"${o.value}" (${o.label})`).join(', ')}`
    : field.kind === 'number' ? `a whole number ${field.min} to ${field.max}`
      : field.kind === 'color' ? 'a colour as "#rrggbb"'
        : field.kind === 'item' ? 'one item id from the list below'
          : field.kind === 'items' ? 'a list of up to 3 item ids from the list below'
            : field.kind === 'materials' ? 'a list of up to 4 {"item": "<item id>", "qty": 1-10}'
              : field.kind === 'creature' ? `one creature id from: ${Object.keys(CREATURES).join(', ')}`
                : `text, up to ${field.length ?? 64} characters`;
  const now = fieldEmpty(value) ? 'empty' : JSON.stringify(value);
  return `- ${field.key}: ${field.label}${field.optional ? ' (optional)' : ''}; ${kind}. Now: ${now}${locked ? '. LOCKED: the player wrote this; never change it' : ''}.`;
}

/** The God's instructions for one Workshop turn: the draft, its fields and its locks. */
export function workshopPrompt(ctx: PrayerContext, w: WorkshopContext): string {
  const checked = checkDraft({ category: w.category.id, sub: w.sub.id, fields: w.fields });
  const built = w.sub.makes === 'rule' ? 'a Steward reviews it and it becomes a scripted rule'
    : w.sub.makes === 'engine' ? 'the Owner reviews it and a coding agent builds it'
      : 'you grant it at once when the player confirms the card';
  return [
    VOICE,
    '',
    `The player is shaping a wish in the Wish Workshop, field by field: ${w.category.name}, ${w.sub.name} (${w.sub.blurb}). It is a ${w.sub.tier} wish: ${built}.`,
    'Help them finish it. Answer in character in one to three sentences. Fill in or improve fields when they ask, or when it clearly helps; ask one short question at a time when something is unclear, and offer up to three short answers they can tap.',
    'Keep it fair: Rare gear at most, creature levels near the land\'s danger (1-2 in the Sanctum and Woods, 2-3 on the Shore, 3-4 in the Desert), and recipes that make no more things than they use.',
    '',
    'Fields:',
    ...w.sub.fields.map((f) => fieldLine(f, w.fields[f.key], w.locked.includes(f.key))),
    `Item ids: ${tradableItems()}.`,
    checked.problems.length ? `Still missing: ${checked.problems.join(' ')}` : 'Every field the wish needs is filled in.',
    ...(w.fill ? ['The player asked you to fill in the rest: give every empty field that is not LOCKED a value that fits what is already there.'] : []),
    '',
    'Always reply with one JSON object:',
    '{"say": "<what you say>", "fields": {"<key>": <value>}, "choices": ["<a short answer>"]}',
    'Put in "fields" only the fields you change, never a LOCKED one. Use [] for "choices" when you ask nothing.',
    '',
    ...nowLines(ctx),
  ].join('\n');
}

/** Reads the model's Workshop JSON; a reply that is not JSON is taken as plain speech. */
export function parseWorkshopReply(text: string): WorkshopReply {
  const json = parseJsonObject(text);
  if (!json) return { say: text.trim().slice(0, 600) || '...', fields: {}, choices: [] };
  const say = typeof json.say === 'string' && json.say.trim() ? json.say.trim().slice(0, 600) : '...';
  const fields = json.fields && typeof json.fields === 'object' && !Array.isArray(json.fields) ? (json.fields as Record<string, unknown>) : {};
  const choices = Array.isArray(json.choices)
    ? json.choices.filter((c): c is string => typeof c === 'string' && !!c.trim()).map((c) => c.trim().slice(0, 80)).slice(0, MAX_CHOICES)
    : [];
  return { say, fields, choices };
}

/**
 * One Workshop turn: the configured model, its fallback, and the offline God
 * last, exactly as prayers are answered.
 */
export async function askWorkshopGod(
  models: ChatModel[],
  ctx: PrayerContext,
  w: WorkshopContext,
  history: ChatTurn[],
  onCost: (result: ChatResult, model: ChatModel) => void,
): Promise<WorkshopReply> {
  const request: ChatRequest = { system: workshopPrompt(ctx, w), messages: history, json: true, maxTokens: 1200, purpose: 'Wish Workshop' };
  let lastError: unknown;
  for (const model of models) {
    // The offline God shapes drafts with its word rules; it needs the draft, not the prompt.
    if (model instanceof OfflineGod) {
      const said = history.filter((m) => m.role === 'user').map((m) => m.content);
      return model.shapeDraft(w, said.pop() ?? '', said);
    }
    try {
      const result = await model.complete(request);
      onCost(result, model);
      return parseWorkshopReply(result.text);
    } catch (err) {
      lastError = err;
      console.warn(`God model ${model.provider}/${model.model} failed: ${(err as Error).message}`);
    }
  }
  throw lastError ?? new Error('No God model is configured.');
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
  const a = w.appoint as Record<string, unknown> | null | undefined;
  const appoint = a && typeof a === 'object' && typeof a.name === 'string' && a.name.trim()
    ? { name: a.name.trim().slice(0, 40), role: a.role === 'player' ? ('player' as const) : ('steward' as const) }
    : undefined;
  return { say, wish: { tier, title, summary, definition: w.definition ?? undefined, ...(appoint ? { appoint } : {}) } };
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
  const request: ChatRequest = { system: systemPrompt(ctx), messages: history, json: true, maxTokens: 1200, purpose: "God's reply" };
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
/** "Walking mushrooms should drop tonics": loot for a creature and an item named in the words. */
function lootWish(text: string): { say: string; wish: unknown } | undefined {
  // A name matches with its last word in the plural too ("crab knights").
  const said = (name: string) => new RegExp(`\\b${name.toLowerCase().replace(/[^a-z0-9 ]/g, '')}(e?s)?\\b`).test(text);
  const creature = Object.entries(CREATURES).find(([, c]) => said(c.name));
  const item = Object.entries(ITEMS).find(([, i]) => !i.bound && said(i.name));
  if (!creature || !item) return undefined;
  const [creatureId, c] = creature;
  const [itemId, i] = item;
  return {
    say: `Every ${c.name} carrying a ${i.name}, now and then? It shall be so, if you wish it.`,
    wish: {
      tier: 'moderate',
      title: `${i.name} from ${c.name}s`,
      summary: `Defeated ${c.name}s may drop a ${i.name}.`,
      definition: { kind: 'loot', creature: creatureId, drops: [{ item: itemId, chance: 0.25, qty: 1 }] },
    },
  };
}

export class OfflineGod implements ChatModel {
  readonly provider = 'offline';
  readonly model = 'scripted';

  async complete(req: ChatRequest): Promise<ChatResult> {
    const last = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    return { text: JSON.stringify(this.answer(last)), inputTokens: 0, outputTokens: 0, usd: 0 };
  }

  /**
   * Shapes a Workshop draft without any AI service: picks choices and colours
   * from the player's words, takes a plain wish ("a glowing hat") as the
   * draft's fields, and fills every empty field when asked.
   */
  shapeDraft(w: WorkshopContext, said: string, earlier: string[] = []): WorkshopReply {
    const text = said.toLowerCase();
    const asksFill = (line: string) => /\b(fill|finish|complete|rest)\b/i.test(line);
    const fill = w.fill || asksFill(said);
    // Asked to fill in, the player's earlier words say what the wish is.
    const wished = asksFill(said) ? [...earlier].reverse().find((l) => !asksFill(l) && /\b(an?|some)\s/i.test(l)) ?? '' : said;
    const open = (key: string) => !w.locked.includes(key);
    const patch: Record<string, unknown> = {};
    // A plain wish for this kind of thing gives its fields.
    const wish = (this.answer(wished).wish ?? null) as { definition?: unknown } | null;
    if (wish?.definition && /\b(an?|some)\s/i.test(wished)) {
      try {
        const shaped = draftFromDefinition(validateDefinition(wish.definition));
        if (shaped && shaped.category === w.category.id && shaped.sub === w.sub.id) {
          for (const [key, value] of Object.entries(shaped.fields)) if (open(key) && fieldEmpty(w.fields[key])) patch[key] = value;
        }
      } catch {
        // Not a thing this draft can be; the rules below still apply.
      }
    }
    const named = said.match(/\b(?:call(?:ed)? it|name(?:d)? it|named)\s+["']?([\p{L}\p{N}' -]{2,40}?)["']?\s*[.!?]*$/iu);
    if (named && open('name')) patch.name = cap(named[1]!.trim());
    if (open('color') && w.sub.fields.some((f) => f.key === 'color') && Object.keys(COLORS).some((c) => new RegExp(`\\b${c}\\b`).test(text))) patch.color = colorFrom(text);
    for (const field of w.sub.fields) {
      if (field.kind !== 'choice' || !open(field.key)) continue;
      const hit = field.options!.find((o) => new RegExp(`\\b${o.value}\\b`).test(text) || text.includes(o.label.toLowerCase()));
      if (hit) patch[field.key] = hit.value;
    }
    // For a wish people build, a plain answer goes into the first empty part of the brief.
    const brief = w.sub.makes === 'rule' || w.sub.makes === 'engine';
    if (brief && !fill && !Object.keys(patch).length && said.trim()) {
      const blank = w.sub.fields.find((f) => f.kind === 'long' && open(f.key) && fieldEmpty(w.fields[f.key]));
      if (blank) patch[blank.key] = said.trim().slice(0, blank.length ?? 64);
    }
    if (fill) {
      const name = String(patch.name ?? w.fields.name ?? '') || cap(nameFrom(wished));
      for (const field of w.sub.fields) {
        if (!open(field.key) || !fieldEmpty(w.fields[field.key]) || patch[field.key] !== undefined) continue;
        const value = offlineValue(field, name, `${text} ${wished.toLowerCase()}`);
        if (value !== undefined) patch[field.key] = value;
      }
    }
    const after = { ...w.fields, ...patch };
    const missing = w.sub.fields.find((f) => !f.optional && fieldEmpty(after[f.key]));
    const fillable = missing && offlineValue(missing, 'it', '') !== undefined;
    const choices = missing?.kind === 'choice' ? missing.options!.slice(0, MAX_CHOICES).map((o) => o.label) : fillable ? [FILL_REQUEST] : [];
    const say = Object.keys(patch).length
      ? fill ? 'There. I have filled in what was empty; change anything you like.' : 'Done, as you asked. Look it over.'
      : missing ? `Tell me plainly: ${missing.label.toLowerCase()}? Or ask me to fill in the rest.` : 'It looks ready to me. Make the card when you are happy with it.';
    return { say, fields: patch, choices };
  }

  answer(said: string): { say: string; wish: unknown } {
    const text = said.toLowerCase();
    const thing = nameFrom(said);
    if (/\b(delete|destroy|steal|ruin)\b.*\b(their|his|her|other)\b|\binfinite (gold|money|favor)\b/.test(text)) {
      return { say: 'No. What belongs to another is not mine to take, and I will not break the world for one.', wish: { tier: 'refused', title: 'Refused', summary: 'This wish would harm other players or the world.', definition: null } };
    }
    const appoint = said.match(/\b(?:make|name|appoint)\s+(\S+?)\s+(?:a|our|the)?\s*steward\b/i)
      ?? said.match(/\b(?:remove|unmake|dismiss)\s+(\S+?)\s+(?:as\s+)?(?:a\s+)?steward\b/i);
    if (appoint && !/^(a|an|the|me|myself)$/i.test(appoint[1]!)) {
      const name = appoint[1]!.replace(/[^\p{L}\p{N}_-]/gu, '');
      const role = /\b(remove|unmake|dismiss)\b/i.test(appoint[0]) ? 'player' : 'steward';
      return {
        say: role === 'steward' ? `${name}, a Steward? A weighty trust. Shall I name them?` : `Shall ${name} lay down the Steward's duties?`,
        wish: { tier: 'minor', title: role === 'steward' ? `Make ${name} a Steward` : `${name} steps down`, summary: '', definition: null, appoint: { name, role } },
      };
    }
    if (!/\b(wish|want|make|create|give|bring|could you|can you|i'd like|i would like)\b/.test(text)) {
      return { say: 'I hear you, child of the young world. Tell me what you wish for: a thing to carry, a creature to meet, or someone to talk to.', wish: null };
    }
    const look = { hook: `the look of ${thing}`, body: `a ${thing}`, color: colorFrom(text), mood: 'whimsical' };
    if (/\b(drops?|dropping|loot)\b/.test(text)) {
      const loot = lootWish(text);
      if (loot) return loot;
    }
    const land = text.match(/\b(region|land|lands|realm|valley|wilds?|territory)\b/);
    if (land) return regionWish(said, text);
    const big = text.match(/\b(fishing|weather|rain|mounts?|dungeons?|quests?|island|system|guilds?|house|housing)\b/);
    if (big) {
      return {
        say: 'A great wish. Something this large must be shaped with care; I will set it before the Stewards.',
        wish: { tier: 'major', title: cap(big[1]!), summary: `A new feature: ${said.trim().slice(0, 160)}`, definition: null },
      };
    }
    const power = text.match(/\b(spell|ability|skill|technique|power)\b/);
    if (power) {
      const effect = /\b(heal|mend|cure|soothe)\b/.test(text) ? 'heal' : /\b(bolt|fire|ranged|throw|arrow|lightning|blast|ice)\b/.test(text) ? 'bolt' : 'strike';
      const name = cap(thing.replace(/\b(spell|ability|skill|technique|power)\b/, '').trim() || 'Wonder');
      return {
        say: `A new power, ${name}? I will write it on a scroll for you. Read it to learn it, or pass it on.`,
        wish: {
          tier: 'moderate',
          title: name,
          summary: `A scroll that teaches ${name} will be in your bag.`,
          definition: { kind: 'ability', name, description: `${name}, learned from a wish.`, effect, look },
        },
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
    const slot = /\b(sword|axe|spear|lance|bow|staff|dagger|hammer|club|mace|blade)\b/.test(text) ? 'weapon'
      : /\b(hat|helmet|helm|hood|crown|cap)\b/.test(text) ? 'head'
        : /\b(armou?r|coat|cloak|robe|vest|mail|tunic)\b/.test(text) ? 'body'
          : /\b(ring|amulet|charm|necklace|pendant|talisman)\b/.test(text) ? 'charm' : undefined;
    if (slot) {
      return {
        say: `A ${thing} to wear? It will be waiting in your bag.`,
        wish: {
          tier: 'minor',
          title: cap(thing),
          summary: `A ${thing} to wear, in your bag.`,
          definition: { kind: 'item', name: cap(thing), description: `A ${thing}, made by a wish.`, itemKind: slot, rarity: 'common', look },
        },
      };
    }
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

/** Values the offline God gives empty number fields, by key; any other starts at its lowest. */
const NUMBER_DEFAULTS: Record<string, number> = { heal: 25, level: 1, count: 3, danger: 2, trees: 2, rocks: 1, water: 1, qty: 1 };

/** The offline God's guess for one empty field, from the draft's name and the player's words. */
function offlineValue(field: WorkshopField, name: string, text: string): unknown {
  const lower = name.toLowerCase();
  switch (field.key) {
    case 'name': return name;
    case 'description': return `${cap(name)}, shaped by a wish.`;
    case 'hook': return `the look of ${lower}`;
    case 'body': return `a ${lower}`;
    case 'mood': return 'whimsical';
    case 'greeting': return `Well met! I am ${cap(name)}.`;
  }
  switch (field.kind) {
    case 'color': return colorFrom(text);
    case 'number': return NUMBER_DEFAULTS[field.key] ?? field.min;
    case 'choice': return field.optional ? undefined : field.options![0]!.value;
    case 'item': return 'tonic';
    case 'items': return ['tonic'];
    case 'materials': return [{ item: 'mushroom-cap', qty: 2 }];
    case 'creature': return Object.keys(CREATURES)[0];
    default: return undefined;
  }
}

/** Biome words a player might use, first match wins. */
const LAND_WORDS: [RegExp, BiomeId][] = [
  [/\b(snow|snowy|ice|icy|frost|frozen|winter|mountain|peaks?)\b/, 'frostpeak'],
  [/\b(lava|fire|fiery|ember|embers|ash|volcan\w*|burning)\b/, 'ember-wastes'],
  [/\b(swamp|bog|marsh|mire|murky)\b/, 'murkmire-swamp'],
  [/\b(mushroom|mushrooms|fungus|fungi|spore)\b/, 'mushroom-hollow'],
  [/\b(sky|cloud|clouds|floating|ruins)\b/, 'sky-ruins'],
  [/\b(forest|woods|wood|trees)\b/, 'whispering-woods'],
  [/\b(beach|shore|sea|coast|ocean)\b/, 'sunlit-shore'],
  [/\b(desert|sand|sandy|dunes?)\b/, 'mirage-desert'],
];

/** Creatures that already live in each launch-biome-like land, for an offline region. */
const LAND_CREATURES: Partial<Record<BiomeId, string>> = { 'whispering-woods': 'walking-mushroom', 'sunlit-shore': 'crab-knight', 'mirage-desert': 'sun-scarab' };

/** The offline God's region: biome from the player's words, gentle and sparsely wooded. */
function regionWish(said: string, text: string): { say: string; wish: unknown } {
  const biome = LAND_WORDS.find(([re]) => re.test(text))?.[1] ?? 'verdant-meadows';
  const name = BIOMES[biome].name === 'Whispering Woods' ? 'Further Woods' : `New ${BIOMES[biome].name}`;
  const danger = /\b(dangerous|deadly|fierce|wild)\b/.test(text) ? 4 : 2;
  const existing = LAND_CREATURES[biome];
  const creature = existing && CREATURES[existing]
    ? { existing, count: 4 }
    : { name: `${BIOMES[biome].name} Wanderer`, description: `A creature of ${BIOMES[biome].name}.`, behavior: danger > 2 ? 'chase' : 'wander', count: 4, drops: ['tonic'], look: { hook: `a creature of ${BIOMES[biome].ground}`, body: 'small and rounded', color: colorFrom(text), mood: 'curious' } };
  return {
    say: `New land, rising from the mist beyond the edge of the world? Say the word and I will raise ${name}.`,
    wish: {
      tier: 'moderate',
      title: name,
      summary: `A new region, ${name}, beyond the nearest edge of the world.`,
      definition: { kind: 'region', name, description: said.trim().slice(0, 200) || `A new land of ${BIOMES[biome].name}.`, biome, danger, trees: 2, rocks: 1, water: 1, creatures: [creature] },
    },
  };
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
