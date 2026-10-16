// The wish compiler for scripted rules: turns a confirmed Major wish ("let me
// fish at the shore") into a rule definition, a script plus its items, for
// the sandbox in rules.ts. Like the God, it goes through any chat model, and
// an offline version knows a few rules by heart so the game works with no
// paid service.

import { ITEMS, LAUNCH_BIOMES, MAX_RULE_ITEMS, MAX_SCRIPT_LENGTH, WishError, validateRule, type RuleWish } from '@co-mmo/shared';
import { parseJsonObject, type ChatModel, type ChatRequest, type ChatResult, type ChatTurn } from './ai/chat.ts';
import { LIMITS } from './rules.ts';

export interface CompileRequest {
  title: string;
  summary: string;
  /** The God conversation that led to the wish. */
  conversation: ChatTurn[];
  /** For a wish shaped in the Wish Workshop: the player's brief, one "Label: answer" line each. */
  brief?: string[];
  /** A Steward's note, and the draft it is about, when asking for a revision. */
  revise?: { note: string; previous?: RuleWish; problems?: string[] };
}

export type CompileResult =
  | { ok: true; definition: RuleWish; model: ChatModel }
  | { ok: false; reason: string; impossible: boolean; model?: ChatModel };

const API = `You write scripted rules for co-MMO, a 2D hand-painted online RPG. A rule adds a new verb to the world (fishing, foraging, a shrine that blesses, a daily gift). It is plain JavaScript run in a sandbox with no network, files, timers, require or import. It only reacts to events and acts through the "game" object.

Events (handler gets e = {type, player, region, biome, x, y, ...}):
- on('join', e): the player entered the world (also fired for everyone online when the rule goes live).
- on('enter', e): the player walked into another region (e.region).
- on('use', e): the player clicked an item in their bag; e.item is the item key (this rule's keys) or a built-in item id.
- on('interact', e): the player pressed E with no person nearby; e.tile is the nearest of "water", "tree", "rock", else "ground" or "path".
- on('defeat', e): the player defeated a creature; e.creature is its kind (${'%CREATURES%'}).
- on('<your-event>', e): your own event, fired by game.after; e.data is the data you passed (put the player id in data.player and e.player is set too).

game API (p is a player id, always e.player or e.data.player):
- game.tell(p, text): a line in that player's log. game.announce(p, text): a line for everyone in p's region (use rarely).
- game.give(p, item, qty=1), game.take(p, item, qty=1) -> boolean, game.has(p, item) -> count. Items: this rule's own keys, or built-in ids (${'%ITEMS%'}).
- game.heal(p, n<=${LIMITS.perCall.heal}), game.hurt(p, n<=${LIMITS.perCall.hurt}, never below 1 health), game.gold(p, n) (n<=${LIMITS.perCall.gold}; negative to charge, false if they cannot pay), game.xp(p, n<=${LIMITS.perCall.xp}).
- game.where(p) -> {region, biome, x, y}; game.near(p, tile, radius<=3) -> boolean; game.name(p) -> name or null if they left.
- game.after(seconds 0.5-600, 'event-name', data): fire your own event later. Timers are lost if the server restarts.
- game.get(p, key), game.set(p, key, value): small JSON state per player (2 KB), or shared with p = null (8 KB); set null to delete. Survives restarts.
- game.random(), game.chance(probability) -> boolean, game.pick([[value, weight], ...]), game.now() -> ms.
Limits: ${LIMITS.eventMs} ms and ${LIMITS.callsPerEvent} game calls per event; per player per hour at most ${LIMITS.perHour.gold} gold, ${LIMITS.perHour.xp} XP and ${LIMITS.perHour.items} items from this rule (past that, calls quietly return false). A rule that keeps throwing errors is paused.
Biomes: ${'%BIOMES%'}. The Sanctum (pond), the Sunlit Shore (the sea) and the Mirage Desert (an oasis) have water; the Whispering Woods has none, only trees and rocks.

Write small, readable scripts (under ${MAX_SCRIPT_LENGTH} characters), with one comment line per handler. Give players clear feedback with game.tell. Guard against a player having left (game.name(p) === null) in timer events. Keep rewards modest: a few XP, common items often, rare ones rarely. Rule items are up to ${MAX_RULE_ITEMS}; consumables heal 5-50.

Reply with one JSON object:
{"name": "<a few words>", "description": "<one or two sentences for the Chronicle>", "howTo": "<one line telling players how to play it>", "items": {"<key>": {"name": "...", "description": "...", "itemKind": "consumable|material|trinket", "heal": <consumables only>, "look": {"hook": "<the one feature you would recognise it by>", "body": "<shape in a sentence>", "color": "#rrggbb", "mood": "<a few words>"}}}, "script": "<the JavaScript>"}
If the wish cannot be done with these events and effects (it needs new graphics, physics, maps or UI), reply {"impossible": "<one sentence why, for the Stewards>"}.

Example (berry bushes):
{"name":"Berry Picking","description":"Ripe berries grow on the trees of the Whispering Woods.","howTo":"Press E beside a tree in the Whispering Woods.","items":{"berries":{"name":"Wild Berries","description":"A handful of sweet forest berries.","itemKind":"consumable","heal":10,"look":{"hook":"a cluster of glossy purple berries on a leaf","body":"small round berries heaped on a green leaf","color":"#6b3fa0","mood":"fresh, sweet"}}},"script":"// Pick berries from woodland trees, once every two minutes per player.\\non('interact', (e) => {\\n  if (e.tile !== 'tree' || e.biome !== 'whispering-woods') return;\\n  const last = game.get(e.player, 'picked') || 0;\\n  if (game.now() - last < 120000) return game.tell(e.player, 'The branches are bare. Come back later.');\\n  game.set(e.player, 'picked', game.now());\\n  game.give(e.player, 'berries', game.chance(0.3) ? 2 : 1);\\n  game.tell(e.player, 'You pick a handful of Wild Berries.');\\n});"}`;

export function compilerPrompt(): string {
  const items = Object.entries(ITEMS).filter(([id, d]) => !d.bound && !/^w[0-9a-z]{6,}/.test(id)).map(([id]) => id).join(', ');
  const biomes = LAUNCH_BIOMES.map((b) => `${b.id} (${b.name})`).join(', ');
  return API.replace('%ITEMS%', items).replace('%BIOMES%', biomes).replace('%CREATURES%', 'walking-mushroom, crab-knight, sun-scarab, and wished kinds');
}

function userMessage(req: CompileRequest): string {
  const talk = req.conversation.map((t) => `${t.role === 'user' ? 'Player' : 'God'}: ${t.content}`).join('\n');
  const brief = req.brief?.length ? ['', "The player's brief, written in the Wish Workshop:", ...req.brief] : [];
  const lines = [`Wish: ${req.title}`, `Summary: ${req.summary}`, ...brief, '', 'The conversation:', talk || '(none)'];
  if (req.revise) {
    lines.push('', 'A Steward asks for a revision of the draft below.', `Steward's note: ${req.revise.note || '(none)'}`);
    if (req.revise.problems?.length) lines.push(`Problems found in the test run: ${req.revise.problems.join(' | ')}`);
    if (req.revise.previous) lines.push(`Previous draft: ${JSON.stringify(req.revise.previous)}`);
  }
  return lines.join('\n');
}

/** Asks each model in turn for a rule; the last is normally the offline compiler. */
export async function compileRule(
  models: ChatModel[],
  req: CompileRequest,
  onCost: (result: ChatResult, model: ChatModel) => void,
): Promise<CompileResult> {
  const request: ChatRequest = { system: compilerPrompt(), messages: [{ role: 'user', content: userMessage(req) }], json: true, maxTokens: 6000, purpose: 'Writing a rule' };
  let last: CompileResult = { ok: false, reason: 'No model could draft this rule.', impossible: false };
  for (const model of models) {
    let result: ChatResult;
    try {
      result = await model.complete(request);
    } catch (err) {
      console.warn(`Compiler ${model.provider}/${model.model} failed: ${(err as Error).message}`);
      continue;
    }
    onCost(result, model);
    const json = parseJsonObject(result.text);
    if (!json) {
      last = { ok: false, reason: `${model.provider} did not reply with a rule.`, impossible: false, model };
      continue;
    }
    if (typeof json.impossible === 'string') return { ok: false, reason: json.impossible.slice(0, 300), impossible: true, model };
    try {
      return { ok: true, definition: validateRule(json), model };
    } catch (err) {
      if (!(err instanceof WishError)) throw err;
      last = { ok: false, reason: err.message, impossible: false, model };
    }
  }
  return last;
}

/**
 * Knows a few rules by heart (fishing, so far) so scripted wishes work
 * without any AI service; says it cannot draft anything else.
 */
export class OfflineCompiler implements ChatModel {
  readonly provider = 'offline';
  readonly model = 'scripted';

  async complete(req: ChatRequest): Promise<ChatResult> {
    const wish = (req.messages.at(-1)?.content ?? '').toLowerCase();
    const reply = /\bfish(ing)?\b|\bangl(e|ing)\b/.test(wish)
      ? FISHING
      : { impossible: 'The offline God only knows how to make fishing. Choose an AI model in God\'s View to draft other rules.' };
    return { text: JSON.stringify(reply), inputTokens: 0, outputTokens: 0, usd: 0 };
  }
}

/** The first scripted rule, and the offline compiler's template. */
export const FISHING = {
  name: 'Fishing',
  description: 'Every pond, pool, oasis and the sea now holds fish, and every traveller is given a rod.',
  howTo: 'Press E beside water with a Fishing Rod in your bag, then wait for a bite.',
  items: {
    rod: {
      name: 'Fishing Rod',
      description: 'A bamboo rod with a cork float. Press E beside water to cast.',
      itemKind: 'trinket',
      look: { hook: 'a bent bamboo rod with a red and white cork float', body: 'a long thin rod with a line and float', color: '#c8a26a', mood: 'patient, homely' },
    },
    minnow: {
      name: 'Silver Minnow',
      description: 'A small bright fish. Eat it for a little health.',
      itemKind: 'consumable',
      heal: 10,
      look: { hook: 'a tiny shining silver fish', body: 'a slim small fish', color: '#b9c0cc', mood: 'quick, glinting' },
    },
    trout: {
      name: 'Moss Trout',
      description: 'A speckled trout from the woodland pools.',
      itemKind: 'consumable',
      heal: 20,
      look: { hook: 'green and gold speckles along its back', body: 'a plump trout', color: '#4f9a4e', mood: 'cool, shady' },
    },
    bream: {
      name: 'Sea Bream',
      description: 'A pink-silver fish from the Sunlit Shore.',
      itemKind: 'consumable',
      heal: 25,
      look: { hook: 'a rosy silver body with a turquoise sheen', body: 'a deep-bodied sea fish', color: '#e7a3a6', mood: 'bright, salty' },
    },
    'sand-eel': {
      name: 'Oasis Eel',
      description: 'A sandy eel that hides in desert oases.',
      itemKind: 'consumable',
      heal: 15,
      look: { hook: 'a long amber eel with sand-coloured stripes', body: 'a coiled slender eel', color: '#e8c66a', mood: 'sly, sun-warmed' },
    },
    'golden-carp': {
      name: 'Golden Carp',
      description: 'A legendary fish said to grant good fortune. Very rare.',
      itemKind: 'trinket',
      look: { hook: 'gleaming golden scales and long flowing fins', body: 'a large regal carp', color: '#f2dc6b', mood: 'radiant, lucky' },
    },
  },
  script: `// Fishing: E beside water casts, a bite comes a few seconds later.
const CATCH = {
  'sunlit-shore': [['bream', 6], ['minnow', 3], ['golden-carp', 0.3]],
  'whispering-woods': [['trout', 6], ['minnow', 3], ['golden-carp', 0.3]],
  'mirage-desert': [['sand-eel', 6], ['minnow', 2], ['golden-carp', 0.3]],
  sanctum: [['minnow', 6], ['trout', 2], ['golden-carp', 0.5]],
};

// Everyone gets one rod, once.
on('join', (e) => {
  if (game.has(e.player, 'rod') || game.get(e.player, 'given-rod')) return;
  game.give(e.player, 'rod');
  game.set(e.player, 'given-rod', true);
  game.tell(e.player, 'A Fishing Rod appears in your bag. Press E beside water to fish.');
});

// Clicking the rod explains how to fish.
on('use', (e) => {
  if (e.item !== 'rod') return;
  game.tell(e.player, game.near(e.player, 'water', 2) ? 'Press E to cast your line.' : 'Find water first: a pond, a pool, an oasis or the sea.');
});

// E beside water casts the line.
on('interact', (e) => {
  if (e.tile !== 'water') return;
  if (!game.has(e.player, 'rod')) return game.tell(e.player, 'You need a Fishing Rod to fish here.');
  if ((game.get(e.player, 'casting') || 0) > game.now()) return game.tell(e.player, 'Your line is already in the water.');
  const wait = 3 + game.random() * 4;
  game.set(e.player, 'casting', game.now() + wait * 1000);
  game.tell(e.player, 'You cast your line and wait...');
  game.after(wait, 'bite', { player: e.player, biome: e.biome });
});

// A bite: a fish, sometimes nothing, very rarely the Golden Carp.
on('bite', (e) => {
  const p = e.data.player;
  if (game.name(p) === null) return;
  game.set(p, 'casting', null);
  if (!game.near(p, 'water', 2.5)) return game.tell(p, 'You wandered off, and the fish swam away.');
  if (game.chance(0.15)) return game.tell(p, 'Nothing bites. Try again.');
  const fish = game.pick(CATCH[e.data.biome] || CATCH.sanctum);
  game.give(p, fish);
  if (fish === 'golden-carp') {
    game.xp(p, 20);
    game.announce(p, game.name(p) + ' landed a Golden Carp!');
  } else {
    game.xp(p, 3);
    game.tell(p, 'Something tugs at the line. You caught a fish!');
  }
});
`,
};
