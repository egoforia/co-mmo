import {
  ABILITIES,
  CALLINGS,
  RACES,
  STYLES,
  armor,
  attackCooldown,
  attackPower,
  attackReach,
  creatorXpToNext,
  critChance,
  dodgeChance,
  fullStyles,
  styleBonusWords,
  totalStats,
  ward,
  type Character,
  type Stats,
} from '@co-mmo/shared';
import { pathSheetHtml } from '../path-ui.ts';
import { escapeHtml } from '../ui.ts';

/** A defence value with at most one decimal (half of Vigor can be 1.5). */
const one = (n: number): string => String(Math.round(n * 10) / 10);
/** A chance as a whole percent. */
const percent = (n: number): string => `${Math.round(n * 100)}%`;

/** The character sheet: people and Calling, full styles, attributes, derived numbers, Path and abilities. */
export function sheetHtml(c: Character): string {
  const s = c.stats;
  const t = totalStats(c);
  const free = c.calling ? c.freePoints : 0;
  const place = (k: keyof Stats) => free > 0 ? `<button type="button" class="place" data-stat="${k}" title="Place a free point here">+</button>` : '';
  const stat = (name: string, k: keyof typeof s) => `<div><dt>${name}</dt><dd>${t[k]}${t[k] > s[k] ? `<small>+${t[k] - s[k]}</small>` : ''}${place(k)}</dd></div>`;
  const who = c.race && c.calling ? `${RACES[c.race].name} ${CALLINGS[c.calling].name}` : '';
  const calling = who ? `<p class="calling">${escapeHtml(who)}${free > 0 ? ` · <b>${free} free point${free > 1 ? 's' : ''}</b> to place with +` : ''}</p>` : '';
  const abilities = c.abilities.filter((a) => ABILITIES[a]).map((a) => {
    const key = c.hotbar.indexOf(a) + 1;
    return `<li>${key ? `<kbd>${key}</kbd> ` : ''}<b>${escapeHtml(ABILITIES[a]!.name)}</b> ${escapeHtml(ABILITIES[a]!.description)}</li>`;
  }).join('');
  return `
      ${calling}
      ${fullStyles(c).map((st) => `<p class="calling">Full ${escapeHtml(STYLES[st]!.name)} style: ${escapeHtml(styleBonusWords(st))}</p>`).join('')}
      <dl class="sheet">
        ${stat('Might', 'might')}${stat('Agility', 'agility')}${stat('Wit', 'wit')}${stat('Spirit', 'spirit')}${stat('Vigor', 'vigor')}
        <div><dt>Damage</dt><dd>${attackPower(c)}</dd></div><div><dt>Reach</dt><dd>${one(attackReach(c))}<small>steps</small></dd></div><div><dt>Attack every</dt><dd>${attackCooldown(c).toFixed(2)}<small>s</small></dd></div><div><dt>Armour</dt><dd>${one(armor(c))}</dd></div><div><dt>Ward</dt><dd>${one(ward(c))}</dd></div>
        <div><dt>Critical hit</dt><dd>${percent(critChance(c))}</dd></div><div><dt>Dodge</dt><dd>${percent(dodgeChance(c))}</dd></div>
        <div class="wide"><dt>Creator level</dt><dd>${c.creatorLevel}<small>${c.creatorXp} / ${creatorXpToNext(c.creatorLevel)}</small></dd></div>
      </dl>
      ${pathSheetHtml(c)}
      ${abilities ? `<h3>Abilities</h3><ul class="abilities">${abilities}</ul>` : '<p class="note">No abilities yet. Trainers, scrolls and quests teach them.</p>'}`;
}
