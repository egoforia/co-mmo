// The Combat tab (Owner): how fights play in every land, the Owner's choices
// rather than the code's (shared combat-rules.ts, docs/combat.md).

import { api, toast, type Handled, type Tab } from './core.ts';

interface CombatRules {
  bodiesBlockShots: boolean;
}

async function combat(): Promise<string> {
  const { rules } = await api<{ rules: CombatRules }>('combat');
  return `
    <h2>Combat</h2>
    <p class="note">Everyone moves on tiles. Swords and claws reach the eight tiles around you, spears and greatswords two tiles straight ahead, and bows, wands and spells as far as they say, as long as nothing tall stands in the way.</p>
    <form id="combat-form" class="form">
      <label class="check"><input type="checkbox" name="bodiesBlockShots"${rules.bodiesBlockShots ? ' checked' : ''}> Bodies block arrows and spells: a shot stops at the first creature, player or person in its line, so a friend standing in front of a monster shields it</label>
      <button type="submit">Save</button>
    </form>`;
}

async function submit(form: HTMLFormElement, f: Record<string, string>): Promise<Handled> {
  if (form.id !== 'combat-form') return false;
  await api('combat', 'PUT', { bodiesBlockShots: f.bodiesBlockShots === 'on' });
  toast(f.bodiesBlockShots === 'on' ? 'Saved. Bodies now block arrows and spells in every land.' : 'Saved. Arrows and spells now fly over everyone.');
  return true;
}

export const combatTab: Tab = { id: 'combat', label: 'Combat', ownerOnly: true, page: combat, submit };
