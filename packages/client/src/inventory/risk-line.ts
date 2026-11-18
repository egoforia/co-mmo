import { deathRisk, deathRiskWords, type Character } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';

// The "If you fall here" line at the top of the bag (inventory refactor,
// step 7), after Old School RuneScape's Items Kept on Death: what falling
// would cost right now, from the same numbers the server uses
// (shared/death.ts), so the words never drift from the rules.

/** The Bible chapter that explains dying. */
export const DEATH_CHAPTER = 'first-steps';

/** The risk line's HTML; `safe` when the player stands in a safe area. */
export function riskLineHtml(c: Character, safe: boolean): string {
  const words = deathRiskWords(deathRisk(c, safe));
  return `<p class="risk-line${safe ? ' safe' : ''}" role="status">${escapeHtml(words)}
    <button type="button" class="why" data-chapter="${DEATH_CHAPTER}">Why?</button></p>`;
}
