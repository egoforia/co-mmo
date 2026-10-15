import type { PicturedWish } from '@co-mmo/shared';
import { parseJsonObject, type ChatModel } from '../ai/chat.ts';

// Reuse before painting (design doc, Keeping costs down: "the service
// searches the existing library first; a red mushroom may already exist").
// Words in the name and look find likely matches for free; a language model
// then confirms one picture really would serve both, so a blue mushroom never
// borrows a red one's picture.

/** A painted picture that a new wish might borrow. */
export interface LibraryPicture {
  /** Its picture id: the file is `<id>.png` in the wished-art directory. */
  id: string;
  def: PicturedWish;
}

const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'with', 'in', 'on', 'to', 'its', 'it', 'is', 'that', 'for', 'from', 'at', 'by', 'small', 'little', 'big', 'large']);

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(?<=[a-z]{3})s$/, '')));
}

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.max(1, Math.min(a.size, b.size));
}

function colourDistance(a: string, b: string): number {
  const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) || 0);
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
}

/** What the picture of a wished thing has to show, in one line. */
export function lookLine(def: PicturedWish): string {
  return `${def.name}: ${def.look.hook}; ${def.look.body}; main colour ${def.look.color}`;
}

/**
 * The library pictures most likely to show the same thing, best first: the
 * same kind of thing (an item for the same slot), close in colour, and
 * sharing most of the words of its name and recognisable feature. Players'
 * own looks are never shared.
 */
export function reuseCandidates(def: PicturedWish, library: LibraryPicture[], limit = 3): LibraryPicture[] {
  if (def.kind === 'player') return [];
  const name = words(def.name);
  const look = words(`${def.look.hook} ${def.look.body}`);
  return library
    .filter((p) => p.def.kind === def.kind && (def.kind !== 'item' || (p.def.kind === 'item' && p.def.itemKind === def.itemKind)))
    .filter((p) => colourDistance(p.def.look.color, def.look.color) < 90)
    .map((p) => ({ p, score: overlap(name, words(p.def.name)) + overlap(look, words(`${p.def.look.hook} ${p.def.look.body}`)) }))
    .filter((c) => c.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => c.p);
}

const CONFIRM_SYSTEM = [
  'You decide whether a game can show an existing sprite for a newly wished thing instead of painting a new one.',
  'Say yes only when a player who wished for the new thing would be happy to see the existing picture: the same kind of thing, the same colours and the same recognisable feature.',
  'Different names are fine when the look is the same. A different colour, shape or main feature means no.',
  'Reply with JSON: {"match": the number of the existing picture to use, or 0 for none}.',
].join('\n');

/**
 * Asks a language model which candidate, if any, would do for the new wish.
 * Any doubt (no answer, a model error) means paint a new one.
 */
export async function confirmReuse(model: ChatModel, def: PicturedWish, candidates: LibraryPicture[]): Promise<{ picture?: LibraryPicture; usd: number }> {
  if (!candidates.length) return { usd: 0 };
  const list = candidates.map((c, i) => `${i + 1}. ${lookLine(c.def)}`).join('\n');
  try {
    const result = await model.complete({
      system: CONFIRM_SYSTEM,
      messages: [{ role: 'user', content: `New wish: ${lookLine(def)}\n\nExisting pictures:\n${list}` }],
      json: true,
      maxTokens: 1000,
    });
    const match = Number(parseJsonObject(result.text)?.match);
    return { ...(Number.isInteger(match) && match >= 1 && match <= candidates.length ? { picture: candidates[match - 1] } : {}), usd: result.usd };
  } catch (err) {
    console.error('Could not ask whether a picture can be reused:', (err as Error).message);
    return { usd: 0 };
  }
}
