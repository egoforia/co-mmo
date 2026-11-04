// Characters, Monsters & NPCs Studio (#entities) and peoplePage:
// - Unified entity browser (Player Looks, NPCs, Monsters, including the 10 new Frostpeak & Mushroom Hollow walkers)
// - 4-way isometric standing turnarounds & walk/run/attack strips
// - Interactive Frame-by-Frame Hand & Grip Workbench (hand-editor.ts)
// - Interactive Attack, Skill & Status Effect Stage (skill-stage.ts)
// - Classic collapsible hand-finder overview for quick cross-strip comparison

import {
  HELD_SIZE,
  ISO_WAYS,
  TURNED,
  facingSide,
  heldBehind,
  walkStandArt,
  type ArtPoint,
  type Facing,
  type IsoWay,
} from '@co-mmo/shared';
import { handWorkbenchHtml } from './hand-editor.ts';
import { itemHtml } from './pages.ts';
import { queueButtonHtml } from './queue.ts';
import { skillStageHtml } from './skill-stage.ts';
import {
  type ArtItem,
  HOLDABLE,
  WAYS,
  type WalkerView,
  artState,
  esc,
  pagesNav,
  stripHtml,
  usd,
} from './state.ts';

let entityKindFilter: 'all' | 'looks' | 'npcs' | 'monsters' | 'homelands' = 'all';

/** Unified Characters, Monsters & NPCs Studio (#entities). */
export function entitiesPage(page?: string): string {
  const data = artState.data!;
  const allItems = data.items.filter((i) => i.place.tab === 'characters' || i.place.tab === 'monsters');
  const allWalkers = data.walkers;

  const matchesFilter = (w: WalkerView) => {
    if (entityKindFilter === 'all') return true;
    if (entityKindFilter === 'looks') return w.kind.includes('look');
    if (entityKindFilter === 'npcs') return w.place.tab === 'characters' && !w.kind.includes('look');
    if (entityKindFilter === 'monsters') return w.place.tab === 'monsters';
    if (entityKindFilter === 'homelands') return w.biome === 'frostpeak' || w.biome === 'mushroom-hollow';
    return true;
  };

  const walkers = allWalkers.filter(matchesFilter);
  const walkerPages = new Set(walkers.map((w) => w.place.page));
  const items = allItems.filter((i) => entityKindFilter === 'all' || walkerPages.has(i.place.page));

  const looks = new Set(allWalkers.filter((w) => w.kind.endsWith('look')).map((w) => w.place.page));
  const names = [...new Set([...items.map((i) => i.place.page), ...walkers.map((w) => w.place.page)])].sort(
    (a, b) => Number(looks.has(b)) - Number(looks.has(a)),
  );

  const filterBar = `
    <div class="studio-filter-bar">
      <div class="btn-group">
        ${(
          [
            ['all', `All Entities (${allWalkers.length})`],
            ['looks', 'Player Looks'],
            ['npcs', 'NPCs'],
            ['monsters', 'Monsters'],
            ['homelands', 'Frostpeak & Mushroom Hollow (10 New)'],
          ] as const
        )
          .map(
            ([id, label]) =>
              `<button type="button" class="quiet${entityKindFilter === id ? ' active-pill' : ''}" data-entity-filter="${id}">${esc(label)}</button>`,
          )
          .join('')}
      </div>
    </div>`;

  if (!names.length) return `${filterBar}<p class="note">No matching entities yet.</p>`;
  const chosen = page && names.includes(page) ? page : names[0]!;
  const own = allItems.filter((i) => i.place.page === chosen);
  const walking = allWalkers.filter((w) => w.place.page === chosen);
  const missing = allWalkers.filter((w) => ISO_WAYS.some((d) => !w.standing[d]?.url)).length;
  const ways = missing
    ? `<p class="note">${missing} walker${missing > 1 ? 's are' : ' is'} missing some of the four isometric ways; until they are painted, those walkers show their standing pictures.
    <button type="button" data-art-review="${esc(JSON.stringify({ what: 'ways' }))}">Paint their four ways, a sheet each · about ${usd(missing * (allWalkers[0]?.viewUsd ?? 0))}</button></p>`
    : '';

  return `
    ${filterBar}
    ${ways}
    ${pagesNav('entities', names, chosen)}
    <h2>${esc(chosen)}</h2>
    ${own.length ? `<h3>Base Concept Pictures</h3><div class="art-grid">${own.map(itemHtml).join('')}</div>` : ''}
    ${walking.map((w) => `<h3>Animations, Hand Workbench &amp; Skill Stage</h3>${walkerHtml(w)}`).join('')}`;
}

/** Characters or Monsters: one page each, with its pictures and its walking animations. */
export function peoplePage(tab: 'characters' | 'monsters', page?: string): string {
  const data = artState.data!;
  const items = data.items.filter((i) => i.place.tab === tab);
  const walkers = data.walkers.filter((w) => w.place.tab === tab);
  // Player looks first, then everyone else as the game lists them.
  const looks = new Set(walkers.filter((w) => w.kind.endsWith('look')).map((w) => w.place.page));
  const names = [...new Set([...items.map((i) => i.place.page), ...walkers.map((w) => w.place.page)])].sort((a, b) => Number(looks.has(b)) - Number(looks.has(a)));
  if (!names.length) return `<p class="note">No ${tab} yet.</p>`;
  const chosen = page && names.includes(page) ? page : names[0]!;
  const own = items.filter((i) => i.place.page === chosen);
  const walking = walkers.filter((w) => w.place.page === chosen);
  const missing = data.walkers.filter((w) => ISO_WAYS.some((d) => !w.standing[d]?.url)).length;
  const ways = missing ? `<p class="note">${missing} walker${missing > 1 ? 's are' : ' is'} missing some of the four isometric ways; until they are painted, those walkers show their standing pictures.
    <button type="button" data-art-review="${esc(JSON.stringify({ what: 'ways' }))}">Paint their four ways, a sheet each · about ${usd(missing * (data.walkers[0]?.viewUsd ?? 0))}</button></p>` : '';
  return `
    ${ways}
    ${pagesNav(tab, names, chosen)}
    <h2>${esc(chosen)}</h2>
    ${own.length ? `<h3>Pictures</h3><div class="art-grid">${own.map(itemHtml).join('')}</div>` : ''}
    ${walking.map((w) => `<h3>Animations</h3>${walkerHtml(w)}`).join('')}`;
}

export function walkerHtml(w: WalkerView): string {
  const data = artState.data!;
  const bodyPick = `<label>Body<span><select name="body">${data.bodies.map((b) => `<option value="${esc(b.id)}"${w.body === b.id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></span></label>`;
  const metaBadges = [
    w.tier ? `<span class="tag-pill">tier: ${esc(w.tier)}</span>` : '',
    w.biome && w.biome !== 'any' ? `<span class="tag-pill">${esc(w.biome)}</span>` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `
    <div class="walker" data-walker="${esc(w.id)}">
      <header>${w.url ? `<img src="${esc(w.url)}" alt="">` : '<span class="ph">?</span>'}<div><b>${esc(w.name)}</b> ${metaBadges}<br><small>${esc(w.kind)} · <code>${esc(w.id)}</code></small></div>
        <form class="form walker-body">${bodyPick}</form></header>
      ${waysHtml(w)}
      ${runsHtml(w)}
      ${attacksHtml(w)}
      ${handWorkbenchHtml(w)}
      ${skillStageHtml(w)}
      ${handsHtml(w)}
    </div>`;
}

/**
 * The isometric camera's four ways: a standing picture each, where their
 * hands were found in it, and the walk clip made from it (until then,
 * walkers glide in the picture).
 */
export function waysHtml(w: WalkerView): string {
  const missing = WAYS.filter(([d]) => !w.standing[d].url).length;
  const walking = WAYS.filter(([d]) => w.walks[d]).length;
  const way = ([d, label]: [IsoWay, string]) => {
    const view = w.standing[d];
    const strip = w.walks[d];
    const id = walkStandArt(w.id, d);
    const looked = artState.points[id];
    const [right, left] = [!!looked?.hands?.[0], !!looked?.leftHands?.[0]];
    const found = !view.url ? '' : !looked ? 'hands not looked at yet' : right && left ? 'both hands found' : right ? 'right hand found' : left ? 'left hand found' : 'no hands found';
    const versions = view.url || view.versions.length ? `<button type="button" class="quiet" data-view-versions="${esc(w.id)}" data-direction="${d}">${view.versions.length ? `Picture versions (${view.versions.length + 1})` : 'What made the picture'}</button>` : '';
    const older = (strip?.versions.length ?? 0) || (w.lost[d]?.length ?? 0);
    const walkVersions = strip || older ? `<button type="button" class="quiet" data-walk-versions="${esc(w.id)}" data-direction="${d}">${older ? `Walk versions (${older + (strip ? 1 : 0)})` : 'What made the walk'}</button>` : '';
    const clip = view.url ? `<button type="button" data-art-review="${esc(JSON.stringify({ what: 'clip', walker: w.id, body: w.body ?? 'two-legged', direction: d }))}" data-walker-body>${strip ? 'Make clip again' : 'Make walk clip'} · about ${usd(w.clipUsd)}</button>` : '';
    const queueClip = view.url && !strip ? queueButtonHtml({ kind: 'clip', targetId: w.id, direction: d, body: w.body ?? 'two-legged', label: `Walk clip: ${w.name} (${label})`, category: 'Walk Clips', estimateUsd: w.clipUsd }) : '';
    return `
      <div class="direction">
        <div class="standing">${view.url ? `<img src="${esc(view.url)}" alt="" loading="lazy">` : '<span class="ph">?</span>'}<small>${esc(label)}${found ? ` · ${found}` : ''}</small></div>
        ${stripHtml(strip, label, 110)}
        <div class="card-actions"><button type="button" data-art-review="${esc(JSON.stringify({ what: 'view', walker: w.id, direction: d }))}">${view.url ? 'Paint again' : 'Paint'} · about ${usd(w.viewUsd)}</button>${versions}${clip}${queueClip}${walkVersions}${view.url ? `<button type="button" class="quiet" data-hands-find="${esc(JSON.stringify({ ids: [id] }))}">Find hands again</button>` : ''}</div>
      </div>`;
  };
  const summary = [missing ? `${4 - missing} of 4 painted` : '', walking ? `walks ${walking} of 4` : ''].filter(Boolean).join(', ');
  return `
    <section class="ways"><h4>The isometric ways${summary ? ` · ${summary}` : ''}</h4>
      <p class="note">Walkers face four ways, halfway between the front or back and a side. The four are painted together on one sheet from the approved picture, so they keep one look, then cut into a standing picture each; one way can be painted again on its own, from the others. A way's walk clip is made from its picture; until then it glides in it.</p>
      <div class="card-actions">
        <button type="button" data-art-review="${esc(JSON.stringify({ what: 'ways', walker: w.id }))}">${missing === 4 ? 'Paint the four ways together' : 'Paint all four again, together'} · about ${usd(w.viewUsd)}</button>
        ${queueButtonHtml({ kind: 'ways', targetId: w.id, label: `4-Way Turnaround: ${w.name}`, category: '4-Way Views', estimateUsd: w.viewUsd }, '+ Queue 4-Way Sheet')}
      </div>
      <div class="walks">${WAYS.map(way).join('')}</div>
    </section>`;
}

/** Running animations in the four isometric directions. */
export function runsHtml(w: WalkerView): string {
  const running = WAYS.filter(([d]) => w.runs?.[d]).length;
  if (!running) return '';
  const way = ([d, label]: [IsoWay, string]) => {
    const strip = w.runs?.[d];
    return `
      <div class="direction">
        ${stripHtml(strip, label, 110)}
        <small class="note">${strip ? `${strip.frames} frames · ${strip.cycleSeconds}s` : 'no run yet'}</small>
      </div>`;
  };
  return `
    <section class="ways runs"><h4>Running animations · ${running} of 4</h4>
      <p class="note">Athletic 4-way running cycles, synchronized for isometric movement.</p>
      <div class="walks">${WAYS.map(way).join('')}</div>
    </section>`;
}

/** Basic attack animations in the four isometric directions. */
export function attacksHtml(w: WalkerView): string {
  const attacking = WAYS.filter(([d]) => w.attacks?.[d]).length;
  if (!attacking) return '';
  const way = ([d, label]: [IsoWay, string]) => {
    const strip = w.attacks?.[d];
    return `
      <div class="direction">
        ${stripHtml(strip, label, 110)}
        <small class="note">${strip ? `${strip.frames} frames · ${strip.cycleSeconds}s` : 'no attack yet'}</small>
      </div>`;
  };
  return `
    <section class="ways attacks"><h4>Basic attack animations · ${attacking} of 4</h4>
      <p class="note">Unarmed forward claw/fist strike animations in the four isometric directions.</p>
      <div class="walks">${WAYS.map(way).join('')}</div>
    </section>`;
}

export function holdable(): ArtItem[] {
  return artState.data!.items.filter((i) => i.url && i.place.tab === 'items' && HOLDABLE.includes(i.place.page));
}

/**
 * The item tried in one hand, drawn on a frame as the game draws it: its
 * grip on the hand, its longest side a set share of the frame's height,
 * turned the way the walker faces, and behind the body when that hand is.
 */
export function triedHtml(direction: Facing, side: 'right' | 'left', hand: ArtPoint | null | undefined, height: number): string {
  const item = holdable().find((i) => i.id === artState.tryOn[side]);
  const grip = item ? artState.points[item.id]?.grip : undefined;
  const size = item?.url ? artState.sizes.get(item.url) : undefined;
  if (!item?.url || !hand || !grip || !size) return '';
  const scale = (height * HELD_SIZE) / Math.max(...size);
  const [w, h] = [size[0] * scale, size[1] * scale];
  // Mirrored as the game mirrors it: whenever the walker faces to the left, turned fully or halfway.
  const flip = facingSide(direction) === 'left';
  const gx = flip ? 1 - grip[0] : grip[0];
  return `<img class="held ${heldBehind(direction, side) ? 'behind' : 'front'}" src="${esc(item.url)}" alt="" style="width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;left:calc(${(hand[0] * 100).toFixed(1)}% - ${(gx * w).toFixed(1)}px);top:calc(${(hand[1] * 100).toFixed(1)}% - ${(grip[1] * h).toFixed(1)}px)${flip ? ';transform:scaleX(-1)' : ''}">`;
}

/** The pickers for the items tried in each hand. */
export function tryOnHtml(): string {
  const items = holdable();
  if (!items.length) return '';
  const options = (side: 'right' | 'left') => `<option value="">Nothing</option>${HOLDABLE.map((page) => {
    const here = items.filter((i) => i.place.page === page);
    return here.length ? `<optgroup label="${page}">${here.map((i) => `<option value="${esc(i.id)}"${artState.tryOn[side] === i.id ? ' selected' : ''}>${esc(i.name)}${artState.points[i.id]?.grip ? '' : ' (grip not found yet)'}</option>`).join('')}</optgroup>` : '';
  }).join('')}`;
  return `<div class="try-on"><label>Try in the right hand <select data-try-on="right">${options('right')}</select></label>
    <label>Try in the left hand <select data-try-on="left">${options('left')}</select></label></div>`;
}

/**
 * Where the hand finder put both hands, frame by frame: R is where a held
 * weapon or charm is gripped, L where a shield or other off-hand item is.
 * A frame where it found none borrows the nearest frame's hand in the game.
 */
export function handsHtml(w: WalkerView): string {
  const find = (body: { ids: string[]; frame?: number }, label: string, cls = 'quiet') => `<button type="button" class="${cls}" data-hands-find="${esc(JSON.stringify(body))}">${label}</button>`;
  // Each way's question is shared by every animation, so it is shown once, under the first row facing that way.
  const asked = new Set<Facing>();
  const ids: string[] = [];
  const sections = ANIMATIONS.flatMap(([kind, title, noun]) => {
    const strips = w[kind];
    const rows = WAYS.flatMap(([d, label]) => {
      const strip = strips?.[d];
      if (!strip) return [];
      const id = `${w.id}-${noun}-${d}`;
      ids.push(id);
      return [handRowHtml(w, id, d, label, noun, strip, strips, asked, find)];
    });
    return rows.length ? [`<section class="hand-animation"><h4>${title}</h4>${rows.join('')}</section>`] : [];
  });
  if (!sections.length) return '';
  return `<details class="hands"${artState.openHands.has(w.id) ? ' open' : ''} data-walker="${esc(w.id)}"><summary>All-Directions Hand Overview (right hand: weapons, tools &amp; charms; left hand: shields &amp; off-hand)</summary>
    <p class="note">The hand finder looks at every frame once, after a walk, run or attack is painted. R is the character's right hand, L their left. Click a frame to look at just that frame again, or use the Interactive Hand Workbench above to drag hands manually for free.</p>
    ${tryOnHtml()}
    <p class="note">Pick an item to see it in that hand on every frame, as the game draws it. Trying items is free and changes nothing for players.</p>
    ${find({ ids: [...ids, w.id] }, `Find again for every animation of ${esc(w.name)}`, '')}
    ${sections.join('')}</details>`;
}

/** The animations hands are found in: where the walker keeps them, their heading, and the word in their art ids. */
const ANIMATIONS = [['walks', 'Walking', 'walk'], ['runs', 'Running', 'run'], ['attacks', 'Attacking', 'attack']] as const;

type Strips = WalkerView['walks'];

/** One animation facing one way: its frames with the hands found, and what can be done about them. */
function handRowHtml(w: WalkerView, id: string, d: Facing, label: string, noun: string, strip: NonNullable<Strips[Facing]>, strips: Strips | undefined, asked: Set<Facing>, find: (body: { ids: string[]; frame?: number }, label: string) => string): string {
  const hands = artState.points[id]?.hands;
  const lefts = artState.points[id]?.leftHands;
  const height = 96;
  const width = Math.round((strip.width / strip.frames) * (height / strip.height));
  const frames = Array.from({ length: strip.frames }, (_, i) => {
    const at = (hand: ArtPoint, side: string) => `<b class="dot ${side}" title="${side} hand" style="left:${(hand[0] * 100).toFixed(1)}%;top:${(hand[1] * 100).toFixed(1)}%">${side === 'right' ? 'R' : 'L'}</b>`;
    const right = hands?.[i];
    const left = lefts?.[i];
    const dot = right || left ? `${right ? at(right, 'right') : ''}${left ? at(left, 'left') : ''}` : '<small class="none">none</small>';
    const body = `<span class="body" style="background-image:url('${esc(strip.url)}');background-size:${strip.frames * 100}% 100%;background-position:${strip.frames > 1 ? (i * 100) / (strip.frames - 1) : 0}% 0"></span>`;
    return `<button type="button" class="frame" title="Frame ${i + 1}: look for the hands again" data-hands-find="${esc(JSON.stringify({ ids: [id], frame: i }))}" style="width:${width}px;height:${height}px">${body}${triedHtml(d, 'right', right, height)}${triedHtml(d, 'left', left, height)}${hands || lefts ? dot : ''}</button>`;
  }).join('');
  const question = asked.has(d) ? undefined : artState.questions.find((q) => q.facing === d);
  asked.add(d);
  const ask = question ? `
    <details class="hand-question"><summary>The question asked${question.own ? ' (your words)' : ''}</summary>
      <form class="form hand-question" data-facing="${d}">
        <textarea name="prompt" rows="3" maxlength="2000">${esc(question.prompt)}</textarea>
        <p class="note">Always sent with it: “${esc(question.system)}”</p>
        <div class="card-actions"><button type="submit" class="quiet">Keep these words</button>${question.own ? `<button type="button" class="quiet" data-hands-usual="${d}">Back to the usual words</button>` : ''}</div>
        <p class="note">The same question is asked for every character walking, running or attacking ${label}. Nothing is looked at again until you ask.</p>
      </form>
    </details>` : '';
  const missing = !hands ? ' · not looked at yet' : !lefts ? ' · left hand not looked for yet: it is found by itself after Pull and restart, or use Find again' : '';
  // Turning round mirrors the picture, so the opposite way's hands, mirrored, can stand in for this one's.
  const [turned, turnedLabel] = WAYS.find(([o]) => o === TURNED[d])!;
  const from = `${w.id}-${noun}-${turned}`;
  const copied = artState.mirrored[id] ? ` · mirrored from the ${WAYS.find(([o]) => artState.mirrored[id] === `${w.id}-${noun}-${o}`)?.[1] ?? 'other'} ${noun}` : '';
  const mirror = strips?.[turned] && artState.points[from]?.hands ? `<button type="button" class="quiet" data-hands-mirror="${esc(JSON.stringify({ from, to: id }))}" data-label="${esc(`${label} ${noun}`)}" data-from-label="${esc(`${turnedLabel} ${noun}`)}">Use the ${turnedLabel} ${noun}'s hands, mirrored</button>` : '';
  return `<div class="hand-row" data-art-id="${esc(id)}"><div class="hand-head"><small>${label}${missing}${copied}</small>${find({ ids: [id] }, `Find again for this ${noun}`)}${mirror}</div><div class="frames">${frames}</div>${ask}</div>`;
}

/** Draws the open hands panels again, for a newly tried item. */
export function redrawHands(): void {
  for (const panel of document.querySelectorAll<HTMLElement>('details.hands')) {
    const w = artState.data?.walkers.find((x) => x.id === panel.dataset.walker);
    if (!w) continue;
    if (panel.hasAttribute('open')) artState.openHands.add(w.id);
    else artState.openHands.delete(w.id);
    panel.outerHTML = handsHtml(w);
  }
}

export function handleEntityFilterClick(t: HTMLButtonElement): boolean {
  if (t.dataset.entityFilter !== undefined) {
    entityKindFilter = t.dataset.entityFilter as typeof entityKindFilter;
    artState.ctx.rerender();
    return true;
  }
  return false;
}
