import { ITEMS, STATUSES } from '@co-mmo/shared';
import { afflictPlayer } from '../statuses.ts';
import type { SkillRule } from './types.ts';

/** Shield Bash stuns this long without a shield in the off hand. */
const BARE_BASH_SECONDS = 0.5;
/** Hold the Line: the share of each blow its allies are spared, in percent. */
const HOLD_THE_LINE_GUARD = 20;

/** The Warden's skills (docs/classes/warden.md) where data is not enough. */
export const WARDEN_RULES: Record<string, SkillRule> = {
  'shield-bash': {
    run: (kit, cast, effect) => {
      const off = cast.p.character.equipment.offhand;
      const shield = off && ITEMS[off]?.offhand === 'shield';
      effect.run(kit, shield ? cast : { ...cast, a: { ...cast.a, duration: BARE_BASH_SECONDS } });
    },
  },
  // Guarded allies take less; each blow they take gives the Warden Resolve (region/minds.ts).
  'hold-the-line': {
    run: (kit, { p, a }) => {
      const near = kit.partyNear(p, a.radius ?? 0);
      for (const m of near) {
        afflictPlayer(kit.s, m, 'guarded', a.duration, { by: p.info.id, amount: HOLD_THE_LINE_GUARD });
        if (m !== p) kit.s.notice(m, `${p.info.name} holds the line: you are ${STATUSES.guarded.name}.`);
      }
      kit.s.notice(p, near.length > 1 ? `You hold the line for ${near.length - 1} beside you.` : 'You hold the line.');
    },
  },
};
