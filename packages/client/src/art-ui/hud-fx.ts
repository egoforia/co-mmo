// HUD Elements, Status Icons & Skill FX Studio (#hud-fx):
// - Status Effect Icons (status-burning, status-poisoned, status-blessed, etc.)
// - Combat & Calling Skill Effects (fx-slash, fx-ember, fx-tide, fx-gale, fx-bell, fx-mark, fx-hallowed-ground, fx-trap, fx-echo)
// - Live In-Context HUD Preview:
//   1. #stats-line Status Icon Bar (at 18px/24px against dark HUD & bright biome backdrops)
//   2. Overhead Entity Nameplate + Status Badges
//   3. 1-6 Ability Hotbar with Calling Skill Icons
//   4. 7-Slot Equipment Paperdoll (Head, Body, Cloak, Feet, Weapon, Off-hand, Charm)

import { sectionHtml } from './pages.ts';
import {
  type ArtItem,
  artState,
  esc,
  pagesNav,
} from './state.ts';

const WEAR_SLOTS: [string, string, string[]][] = [
  ['head', 'Head', ['item-pilgrim-hood', 'item-barkwarden-antler-helm', 'item-pearlcoat-tricorne', 'item-sunwrap-veil', 'item-windfelt-ushanka', 'item-sporeweave-mitre', 'item-iron-helm']],
  ['body', 'Body', ['item-pilgrim-tabard', 'item-barkwarden-jerkin', 'item-pearlcoat-brigandine', 'item-sunwrap-kaftan', 'item-windfelt-parka', 'item-sporeweave-vestment', 'item-chainmail']],
  ['cloak', 'Cloak', ['item-pilgrim-mantle', 'item-barkwarden-mosscloak', 'item-pearlcoat-cape', 'item-sunwrap-shawl', 'item-windfelt-furcloak', 'item-sporeweave-shroud']],
  ['feet', 'Feet', ['item-pilgrim-sandals', 'item-barkwarden-greaves', 'item-pearlcoat-sea-boots', 'item-sunwrap-wraps', 'item-windfelt-crampons', 'item-sporeweave-slippers']],
  ['weapon', 'Weapon', ['item-sword', 'item-bow', 'item-staff', 'item-rime-cleaver', 'item-rootheart-maul', 'item-tool-pickaxe', 'item-tool-axe']],
  ['shield', 'Off-hand', ['item-shield', 'item-glacier-bulwark', 'item-lantern-shield', 'item-tool-ladle']],
  ['charm', 'Charm', ['item-charm', 'item-bell-charm', 'item-mycelial-censer', 'item-ember-talisman']],
];

let selectedPaperdollStyle = 'all';

export function hudFxPage(page?: string): string {
  const data = artState.data!;
  const hudItems = data.items.filter((i) => i.place.tab === 'hud');
  const statusIcons = hudItems.filter((i) => i.place.page === 'Status icons');
  const skillFx = hudItems.filter((i) => i.place.page === 'Skill and combat effects');

  // Include projectile & summoned companion sprites in the Skill FX gallery for convenience
  const extraSkillSprites = data.items.filter((i) =>
    ['item-firebolt', 'spirit-hawk', 'sandstorm-double'].includes(i.id),
  );

  const pages = ['All HUD & FX', 'Status icons', 'Skill and combat effects', '7-Slot Equipment Paperdoll'];
  const chosen = page && pages.includes(page) ? page : 'All HUD & FX';

  return `
    ${pagesNav('hud-fx', pages, chosen)}
    ${hudLivePreviewHtml(statusIcons, [...skillFx, ...extraSkillSprites])}
    ${
      chosen === 'All HUD & FX' || chosen === 'Status icons'
        ? sectionHtml('Status Effect Icons (#stats-line & Overhead Badges)', statusIcons)
        : ''
    }
    ${
      chosen === 'All HUD & FX' || chosen === 'Skill and combat effects'
        ? sectionHtml('Combat & Calling Skill Effects (Bursts, Marks & Summons)', [...skillFx, ...extraSkillSprites])
        : ''
    }
    ${chosen === 'All HUD & FX' || chosen === '7-Slot Equipment Paperdoll' ? paperdollPreviewHtml() : ''}`;
}

function hudLivePreviewHtml(statusIcons: ArtItem[], skillFx: ArtItem[]): string {
  const hotbarKeys: [string, string, string][] = [
    ['1', 'Strike', 'fx-slash'],
    ['2', 'Firebolt', 'item-firebolt'],
    ['3', 'Emberward', 'fx-ember'],
    ['4', 'Tidecaller', 'fx-tide'],
    ['5', 'Gale Strider', 'fx-gale'],
    ['6', 'Bellbinder', 'fx-bell'],
  ];

  const findFx = (id: string) => skillFx.find((x) => x.id === id) ?? artState.data?.items.find((x) => x.id === id);

  return `
    <section class="studio-card hud-context-preview">
      <h3>Live In-Context Game HUD Preview</h3>
      <p class="note">See how status icons, hotbar ability slots, and overhead combat badges read at their actual in-game pixel sizes (18px–36px) against the dark HUD panel and biome backdrops.</p>

      <div class="hud-preview-grid">
        <!-- 1. Player #stats HUD Mockup -->
        <div class="hud-mock-box">
          <h4>Player HUD (#stats &amp; #stats-line)</h4>
          <div class="hud-mock-stats">
            <div class="hud-bar hp"><span style="width:82%"></span><b>HP 148 / 180</b></div>
            <div class="hud-bar energy"><span style="width:65%"></span><b>Energy 65 / 100</b></div>
            <div class="hud-bar xp"><span style="width:45%"></span><b>Level 7 · Emberward</b></div>
            <div class="hud-stats-line">
              ${statusIcons
                .map(
                  (s) => `
                <span class="hud-status-chip ${s.url ? 'painted' : 'fallback'}" title="${esc(s.name)} (${esc(s.id)})">
                  ${s.url ? `<img src="${esc(s.url)}" alt="${esc(s.name)}">` : `<i>${esc(s.name.replace(/^Status:\s*/i, ''))}</i>`}
                </span>`,
                )
                .join('')}
            </div>
          </div>
        </div>

        <!-- 2. 1-6 Ability Hotbar (#abilities) Mockup -->
        <div class="hud-mock-box">
          <h4>Ability Hotbar (#abilities · Keys 1–6)</h4>
          <div class="hud-hotbar">
            ${hotbarKeys
              .map(([key, label, fxId]) => {
                const item = findFx(fxId);
                return `
                  <div class="hud-slot" title="${esc(label)} (${esc(fxId)})">
                    <kbd>${key}</kbd>
                    ${item?.url ? `<img src="${esc(item.url)}" alt="${esc(label)}">` : `<span class="mini-ph">${esc(label[0]!)}</span>`}
                    <small>${esc(label)}</small>
                  </div>`;
              })
              .join('')}
          </div>
        </div>
      </div>
    </section>`;
}

function paperdollPreviewHtml(): string {
  const data = artState.data!;
  const fashionStyles = [
    ['all', 'All Styles'],
    ['pilgrim', 'Pilgrim (Sanctum)'],
    ['barkwarden', 'Barkwarden (Whispering Woods)'],
    ['pearlcoat', 'Pearlcoat (Sunlit Shore)'],
    ['sunwrap', 'Sunwrap (Mirage Desert)'],
    ['windfelt', 'Windfelt (Frostpeak)'],
    ['sporeweave', 'Sporeweave (Mushroom Hollow)'],
  ] as const;

  const pickSlotItem = (_slot: string, candidates: string[]): ArtItem | undefined => {
    const items = candidates
      .map((id) => data.items.find((i) => i.id === id))
      .filter((i): i is ArtItem => !!i);
    if (selectedPaperdollStyle !== 'all') {
      const styled = items.find((i) => i.id.includes(selectedPaperdollStyle) || i.fashionStyle === selectedPaperdollStyle);
      if (styled) return styled;
    }
    return items.find((i) => i.url && !i.standIn) ?? items[0];
  };

  return `
    <section class="studio-card">
      <div class="studio-split-header">
        <div>
          <h3>7-Slot Equipment Paperdoll &amp; Regional Fashion Preview</h3>
          <p class="note">Preview how all 7 equipment slots (<b>Head, Body, Cloak, Feet, Weapon, Off-hand, Charm</b>) and the 6 Regional Fashion Sets look inside the player's inventory paperdoll.</p>
        </div>
        <div class="btn-group">
          ${fashionStyles
            .map(
              ([id, label]) =>
                `<button type="button" class="quiet${selectedPaperdollStyle === id ? ' active-pill' : ''}" data-hud-fashion="${id}">${esc(label)}</button>`,
            )
            .join('')}
        </div>
      </div>

      <div class="paperdoll-grid">
        ${WEAR_SLOTS.map(([slotId, slotName, candidates]) => {
          const item = pickSlotItem(slotId, candidates);
          return `
            <div class="paperdoll-slot ${item?.standIn ? 'standin' : item?.url ? 'painted' : 'missing'}">
              <header>
                <b>${esc(slotName)}</b>
                <small><code>${esc(slotId)}</code></small>
              </header>
              <div class="paperdoll-icon">
                ${item?.url ? `<img src="${esc(item.url)}" alt="${esc(item.name)}">` : '<span class="ph">?</span>'}
              </div>
              <div class="paperdoll-meta">
                <b>${esc(item?.name ?? 'None')}</b>
                ${
                  item?.standIn
                    ? `<small class="warn">Stand-in: ${esc(item.standIn.name ?? item.standIn.id)}</small>`
                    : item?.url
                      ? '<small class="ok">Dedicated icon</small>'
                      : '<small class="bad">Missing</small>'
                }
              </div>
            </div>`;
        }).join('')}
      </div>
    </section>`;
}

export function handleHudFxClick(t: HTMLButtonElement): boolean {
  if (t.dataset.hudFashion !== undefined) {
    selectedPaperdollStyle = t.dataset.hudFashion;
    artState.ctx.rerender();
    return true;
  }
  return false;
}
