// Sub-tab renderers for God's View's Art tab: Painting now (jobs), Items,
// Biomes (scenery & buildings), Building looks (texture sheets), Sounds &
// music, and item/normal-map cards.

import { BUILDING_STYLES } from '@co-mmo/shared';
import {
  ASKED,
  type ArtContext,
  type ArtItem,
  type ArtJob,
  type Budget,
  ITEM_ORDER,
  type KitSheetView,
  MEDIA,
  SOURCE,
  STATUS,
  type SoundItem,
  artState,
  budgetLine,
  esc,
  isOpen,
  lightButton,
  pagesNav,
  usd,
  when,
} from './state.ts';

export function nowPage(): string {
  const data = artState.data!;
  return `<div id="art-jobs">${jobsHtml(data.jobs, data.budget)}</div>`;
}

export function jobsHtml(jobs: ArtJob[], b: Budget): string {
  const open = jobs.filter(isOpen);
  const done = jobs.filter((j) => !open.includes(j)).slice(0, 30);
  const waiting = open.reduce((n, j) => n + j.estimateUsd, 0);
  const row = (j: ArtJob) => `
    <tr class="${j.status}">
      <td>${when(j.endedAt ?? j.startedAt ?? j.queuedAt)}</td>
      <td><b>${esc(j.label)}</b><br><small>${MEDIA[j.media]} · asked by ${ASKED[j.source]}</small></td>
      <td><span class="job ${j.status}">${STATUS[j.status]}</span>${j.reason ? `<br><small>${esc(j.reason)}</small>` : ''}</td>
      <td>${j.usd !== undefined ? usd(j.usd) : `about ${usd(j.estimateUsd)}`}</td>
    </tr>`;
  return `
    <p class="note">Each model is asked only as often as Google allows (video: 2 clips a minute, one at a time), so some requests wait their turn. Requests still waiting when the server restarts are painted after it starts again.</p>
    <p>${budgetLine(b)}${open.length ? ` · ${open.length} waiting or painting, about ${usd(waiting)} more` : ''}</p>
    ${open.length ? `<table class="log jobs">${open.map(row).join('')}</table>` : '<p class="note">Nothing is being painted right now.</p>'}
    ${done.length ? `<details${open.length ? '' : ' open'}><summary>Painted lately (${done.length})</summary><table class="log jobs">${done.map(row).join('')}</table></details>` : '<p class="note">Nothing painted since the server started.</p>'}`;
}

/** Keeps Painting now fresh without touching anything else on the page. */
export async function refreshArtJobs(context: ArtContext): Promise<void> {
  const box = document.getElementById('art-jobs');
  if (!box) return;
  const r = await context.api<{ jobs: ArtJob[]; budget: Budget }>('art/jobs').catch(() => null);
  if (!r || !document.body.contains(box)) return;
  const open = box.querySelector('details')?.open;
  box.innerHTML = jobsHtml(r.jobs, r.budget);
  const details = box.querySelector('details');
  if (details && open !== undefined) details.open = open;
}

export function itemsPage(page?: string): string {
  const items = artState.data!.items.filter((i) => i.place.tab === 'items');
  const kinds = ITEM_ORDER.filter((k) => items.some((i) => i.place.page === k));
  if (!kinds.length) return '<p class="note">No items yet.</p>';
  const chosen = page && kinds.includes(page) ? page : kinds[0]!;
  return `${pagesNav('items', kinds, chosen)}${sectionHtml(chosen, items.filter((i) => i.place.page === chosen))}`;
}

export function biomesPage(page?: string): string {
  const items = artState.data!.items.filter((i) => i.place.tab === 'biomes');
  const lands = [...new Set(items.map((i) => i.place.page))];
  if (!lands.length) return '<p class="note">No lands yet.</p>';
  const chosen = page && lands.includes(page) ? page : lands[0]!;
  const here = items.filter((i) => i.place.page === chosen);
  const scenery = here.filter((i) => i.place.section === 'Scenery');
  const buildings = [...new Set(here.filter((i) => i.place.section !== 'Scenery').map((i) => i.place.section!))];
  return `
    ${pagesNav('biomes', lands, chosen)}
    ${scenery.length ? `<h2>Scenery</h2>${sectionHtml(null, scenery)}` : ''}
    ${buildings.length ? `<h2>Buildings</h2><p class="note">The inside of a building is painted to match its outside, so after painting the outside again you may want the inside again too.</p>
      ${buildings.map((b) => sectionHtml(b, here.filter((i) => i.place.section === b), 'h3')).join('')}` : ''}`;
}

/** A heading's pictures, with a button to paint them all again when there are several. */
export function sectionHtml(title: string | null, items: ArtItem[], tag = 'h2'): string {
  const first = items[0];
  const group = first && artState.data!.groups.find((g) => g.items.some((i) => i.id === first.id));
  const again = items.filter((i) => i.repaintable && i.source !== 'missing');
  const button = group && again.length > 1 ? `<button type="button" class="quiet" data-art-review="${esc(JSON.stringify({ what: 'paint-group', group: group.id }))}">Paint all ${again.length} again · about ${usd(again.reduce((n, i) => n + i.estimateUsd, 0))}</button>` : '';
  return `${title ? `<${tag}>${esc(title)}</${tag}>` : ''}${button}<div class="art-grid">${items.map(itemHtml).join('')}</div>`;
}

export function itemHtml(item: ArtItem): string {
  const picture = item.url ? `<img src="${esc(item.url)}" alt="" loading="lazy">` : '<span class="ph">?</span>';
  const model = item.recipe?.steps.at(-1)?.model;
  const check = item.reused ? `<br><small>Shows the picture of ${esc(item.reused)}</small>`
    : item.check && !item.check.pass ? `<br><small class="bad">Style check not passed after ${item.check.tries} ${item.check.tries === 1 ? 'try' : 'tries'}: ${esc(item.check.why ?? '')}</small>`
    : item.check ? `<br><small>Style check passed${item.check.tries > 1 ? ` on try ${item.check.tries}` : ''}</small>` : '';
  const older = (item.versions?.length ?? 0) + (item.shipped ? 1 : 0);
  const paint = item.repaintable
    ? `<button type="button" data-art-review="${esc(JSON.stringify({ what: 'paint', asset: item.id }))}" data-note="${item.takesNote ? 'yes' : ''}">${item.source === 'missing' ? 'Paint' : 'Paint again'} · about ${usd(item.estimateUsd)}</button>`
    : item.why ? `<small>${esc(item.why)}</small>` : '';
  const details = item.source !== 'missing' ? `<button type="button" class="quiet" data-art-versions="${esc(item.id)}">${older ? `Versions (${older + 1})` : 'What made it'}</button>` : '';
  return `<figure class="art-item ${item.source}${item.check && !item.check.pass ? ' flagged' : ''}">${picture}<figcaption><b>${esc(item.name)}</b><br><small>${SOURCE[item.source]}${model ? ` · ${esc(model)}` : ''}</small>${check}<div class="card-actions">${paint}${details}</div>${normalHtml(item)}</figcaption></figure>`;
}

/** Its normal map: worked out by the game, or painted, with buttons to paint one or go back. */
export function normalHtml(item: ArtItem): string {
  if (!item.normalPaintable) return '';
  const paint = `<button type="button" class="quiet" data-art-review="${esc(JSON.stringify({ what: 'normal', asset: item.id }))}">${item.normalMap ? 'Paint the normal map again' : 'Paint a normal map'} · about ${usd(item.estimateUsd)}</button>`;
  const back = item.normalMap ? `<button type="button" class="quiet" data-normal-drop="${esc(item.id)}">Use the worked-out map</button>` : '';
  const look = item.normalMap
    ? `<a href="${esc(item.normalMap)}" target="_blank" rel="noopener"><img class="normal-map" src="${esc(item.normalMap)}" alt="Its painted normal map" loading="lazy"></a>`
    : item.url ? `<button type="button" class="quiet" data-normal-show="${esc(item.url)}">Show the worked-out map</button>` : '';
  const light = item.url ? lightButton(item.url, item.normalMap, false) : '';
  return `<div class="normal">${look}<small>${item.normalMap ? 'Normal map: painted' : 'Normal map: worked out by the game, free'}</small><div class="card-actions">${light}${paint}${back}</div></div>`;
}

/** The building kit's looks: what each paints, how its textures fared, and buttons to paint a sheet. */
export function looksPage(): string {
  const looks = artState.data!.sheets ?? [];
  if (!looks.length) return '<p class="note">This server has no building looks.</p>';
  const look = (v: KitSheetView) => {
    const usedBy = Object.values(BUILDING_STYLES).filter((b) => b.kit === v.look).map((b) => b.name);
    const failing = v.textures.filter((t) => !t.ok);
    const state = v.checking ? 'Still being checked; look again shortly.' : failing.length ? `${failing.length} of ${v.textures.length} textures still to paint or fix: no building in this look is shown until all pass.` : 'Every texture passed: buildings in this look are shown.';
    const texture = (t: KitSheetView['textures'][number]) => `<li class="${t.ok ? '' : 'bad'}">${esc(t.name)}${t.ok ? ` <small>from ${esc(t.painting ?? '')}</small>` : v.checking ? '' : ` <small>${esc(t.failed.join(', '))}</small>`}</li>`;
    const again = !v.checking && failing.length && failing.length < v.textures.length
      ? `<button type="button" class="quiet" data-art-review="${esc(JSON.stringify({ what: 'sheet', look: v.look, textures: failing.map((t) => t.name) }))}" data-note="yes">Paint the ${failing.length} failing again</button>`
      : '';
    return `
      <div class="look">
        <h3>${esc(v.name)}</h3>
        <p class="note">${usedBy.length ? `Builds ${usedBy.map(esc).join(', ')}. ` : ''}${v.paintings.length} sheet${v.paintings.length === 1 ? '' : 's'} painted. ${state}</p>
        <ul class="textures">${v.textures.map(texture).join('')}</ul>
        <div class="card-actions"><button type="button" data-art-review="${esc(JSON.stringify({ what: 'sheet', look: v.look }))}" data-note="yes">Paint a sheet</button>${again}</div>
      </div>`;
  };
  return `
    <p class="note">The building kit builds houses from their layout and paints every surface with flat textures from one sheet per look. The review shows the guide sent with the words and what it costs before anything is painted.</p>
    <div class="looks">${looks.map(look).join('')}</div>`;
}

export function soundsPage(): string {
  const o = artState.data!;
  const sound = (s: SoundItem) => `
    <div class="sound ${s.url ? '' : 'missing'}">
      <b>${esc(s.name)}</b> <small>${s.kind === 'music' ? 'music' : 'effect'}${s.url ? '' : ' · not made yet'}</small>
      ${s.url ? `<audio controls preload="none" src="${esc(s.url)}"${s.kind === 'music' ? ' loop' : ''}></audio>` : ''}
      <div class="card-actions">
        ${s.makeable ? `<button type="button" data-art-review="${esc(JSON.stringify({ what: 'sound', sound: s.id }))}" data-note="yes">${s.url ? 'Make again' : 'Make'} · about ${usd(s.estimateUsd)}</button>` : `<small>${esc(s.why ?? '')}</small>`}
        ${s.url ? `<button type="button" class="quiet" data-sound-versions="${esc(s.id)}">${s.versions.length ? `Versions (${s.versions.length + 1})` : 'What made it'}</button>` : ''}
      </div>
    </div>`;
  return `
    <p class="note">Effects: ${o.effectsModel ? `<b>${esc(o.effectsModel)}</b>` : '<b class="bad">no service set</b> (AI models tab; ElevenLabs needs ELEVENLABS_API_KEY)'} · Music: ${o.musicModel ? `<b>${esc(o.musicModel)}</b>` : '<b class="bad">no service set</b> (AI models tab)'}. Each land has its own looping track.</p>
    <h2>Sound effects</h2><div class="sounds">${o.sounds.filter((s) => s.kind === 'effect').map(sound).join('')}</div>
    <h2>Music</h2><div class="sounds">${o.sounds.filter((s) => s.kind === 'music').map(sound).join('')}</div>`;
}
