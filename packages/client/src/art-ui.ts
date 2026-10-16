// God's View's Art tab: every picture, walk and sound in the game, sorted the
// way the Owner thinks of them (characters, monsters, items by kind, lands
// with their scenery and buildings, sounds and music), plus what is being
// painted now. Nothing is painted until the Owner has seen exactly what will
// be sent to the AI model and approved it, and every version keeps that same
// information so an old one can be compared with today's and put back.

import { HELD_SIZE, heldBehind, type ArtPoint, type ArtPointsManifest } from '@co-mmo/shared';
import { escapeHtml } from './ui.ts';

/** What the Art tab needs from God's View. */
export interface ArtContext {
  api<T>(path: string, method?: string, body?: unknown): Promise<T>;
  toast(text: string): void;
  /** Draws the open tab again. */
  rerender(): void;
}

interface Budget {
  spentUsd: number;
  monthlyUsd: number;
  warn: boolean;
  paused?: boolean;
  why?: string;
}

interface ArtJob {
  id: string;
  asset: string;
  label: string;
  media: 'picture' | 'clip' | 'sound';
  source: 'start-up' | 'gods-view' | 'wish';
  status: 'queued' | 'waiting' | 'painting' | 'done' | 'failed' | 'skipped';
  estimateUsd: number;
  usd?: number;
  reason?: string;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
}

interface RecipePicture { name: string; url?: string; later?: boolean }
interface RecipeStep { label: string; media: 'picture' | 'clip' | 'sound'; provider: string; model: string; prompt: string; note?: string; pictures: RecipePicture[]; settings: string[]; usd: number }
interface Recipe { at: number; steps: RecipeStep[]; notes?: string[]; partial?: boolean }

type Tab = 'characters' | 'monsters' | 'items' | 'biomes';
interface Place { tab: Tab; page: string; section?: string }

interface ArtItem {
  id: string;
  name: string;
  url?: string;
  source: 'shipped' | 'painted' | 'redone' | 'missing';
  place: Place;
  recipe?: Recipe;
  estimateUsd: number;
  repaintable: boolean;
  why?: string;
  takesNote: boolean;
  versions?: { id: string; url: string; recipe?: Recipe }[];
  shipped?: { url: string; recipe?: Recipe };
  check?: { pass: boolean; why?: string; tries: number };
  reused?: string;
}

type Direction = 'front' | 'right' | 'back' | 'left';
interface WalkVersion { id: string; url: string; frames: number; width: number; height: number; cycleSeconds: number; recipe?: Recipe }
interface WalkStrip { url: string; frames: number; width: number; height: number; cycleSeconds: number; recipe?: Recipe; versions: WalkVersion[] }
interface StandingView { url?: string; approved: boolean; recipe?: Recipe; versions: { id: string; url: string; recipe?: Recipe }[] }

interface WalkerView {
  id: string;
  name: string;
  kind: string;
  url?: string;
  place: Place;
  walks: Partial<Record<Direction, WalkStrip>>;
  lost: Partial<Record<Direction, WalkVersion[]>>;
  standing: Record<Direction, StandingView>;
  estimateUsd: number;
  clipUsd: number;
  viewUsd: number;
}

interface SoundItem {
  id: string;
  name: string;
  kind: 'effect' | 'music';
  url?: string;
  prompt: string;
  recipe?: Recipe;
  versions: { id: string; url: string; recipe: Recipe }[];
  estimateUsd: number;
  makeable: boolean;
  why?: string;
}

interface ArtOverview {
  imageModel: string | null;
  videoModel: string | null;
  budget: Budget;
  jobs: ArtJob[];
  items: ArtItem[];
  groups: { id: string; title: string; items: ArtItem[] }[];
  walkers: WalkerView[];
  bodies: { id: string; name: string }[];
  sounds: SoundItem[];
  effectsModel: string | null;
  musicModel: string | null;
}

/** A paid request, as the server's review and approval take it. */
type Ask =
  | { what: 'paint'; asset: string }
  | { what: 'paint-group'; group: string }
  | { what: 'walk'; walker: string; body: string; directions?: Direction[]; views?: boolean }
  | { what: 'view'; walker: string; direction: Direction; prompt?: string; from?: string[] }
  | { what: 'clip'; walker: string; body: string; direction: Direction; prompt?: string }
  | { what: 'sound'; sound: string };

interface Review {
  title: string;
  parts: { name: string; recipe: Recipe }[];
  estimateUsd: number;
  fingerprint: string;
}

const SUBTABS = [['now', 'Painting now'], ['characters', 'Characters'], ['monsters', 'Monsters'], ['items', 'Items'], ['biomes', 'Biomes'], ['sounds', 'Sounds and music']] as const;
type Subtab = (typeof SUBTABS)[number][0];
const ITEM_ORDER = ['Consumables', 'Weapons', 'Shields', 'Armour', 'Charms', 'Materials', 'Books and scrolls', 'Other'];
const DIRECTIONS: [Direction, string][] = [['front', 'towards us'], ['right', 'right'], ['back', 'away'], ['left', 'left']];
/** The way a walker faces after turning round. */
const TURNED: Record<Direction, Direction> = { front: 'back', back: 'front', left: 'right', right: 'left' };
const SOURCE: Record<ArtItem['source'], string> = { shipped: 'shipped with the game', painted: 'painted here', redone: 'painted again here', missing: 'not painted yet' };
const STATUS: Record<ArtJob['status'], string> = { queued: 'In line', waiting: 'Waiting for a turn', painting: 'Painting now', done: 'Done', failed: 'Failed', skipped: 'Not painted' };
const MEDIA: Record<ArtJob['media'], string> = { picture: 'picture', clip: 'video clip', sound: 'sound' };
const ASKED: Record<ArtJob['source'], string> = { 'start-up': 'start-up', 'gods-view': "God's View", wish: 'a wish' };

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const when = (at: number) => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const esc = escapeHtml;

let data: ArtOverview | null = null;
/** Where the hand finder found each look's hands, frame by frame, and each item's grip, by art id. */
let points: ArtPointsManifest = {};
/** The questions the hand finder asks, one per way of facing. */
interface HandQuestion { facing: Direction; prompt: string; usual: string; own: boolean; system: string }
let questions: HandQuestion[] = [];
/** Walks whose hands were mirrored from another walk: the walk they came from, by art id. */
let mirrored: Record<string, string> = {};
let ctx: ArtContext;

/** Where the Art tab is: its sub-tab and page, from the address (#art/<sub-tab>/<page>). */
function where(): { sub: Subtab; page?: string } {
  const [, sub, ...page] = location.hash.slice(1).split('/');
  const known = SUBTABS.some(([id]) => id === sub);
  return { sub: known ? (sub as Subtab) : 'now', ...(page.length ? { page: decodeURIComponent(page.join('/')) } : {}) };
}

function go(sub: Subtab, page?: string): string {
  return `#art/${sub}${page ? `/${encodeURIComponent(page)}` : ''}`;
}

/** The Art tab, as HTML. */
export async function artPage(context: ArtContext): Promise<string> {
  ctx = context;
  let asked: { questions: HandQuestion[]; mirrored?: Record<string, string> };
  [data, points, asked] = await Promise.all([
    ctx.api<ArtOverview>('art'),
    fetch('/api/art-points').then((r) => (r.ok ? r.json() : {}), () => ({})),
    ctx.api<{ questions: HandQuestion[] }>('art/hands').catch(() => ({ questions: [] })),
  ]);
  questions = asked.questions;
  mirrored = asked.mirrored ?? {};
  const o = data;
  const { sub, page } = where();
  const pages: Record<Subtab, () => string> = { now: nowPage, characters: () => peoplePage('characters', page), monsters: () => peoplePage('monsters', page), items: () => itemsPage(page), biomes: () => biomesPage(page), sounds: soundsPage };
  return `
    <p>${o.imageModel ? `Pictures: <b>${esc(o.imageModel)}</b>` : '<b class="bad">No image model is set</b> (AI models tab)'} · ${o.videoModel ? `Walks: <b>${esc(o.videoModel)}</b>` : 'Walks need Google AI Studio as the image model'} · ${budgetLine(o.budget)}</p>
    <nav class="subtabs">${SUBTABS.map(([id, label]) => `<a href="${go(id)}" data-art-go${id === sub ? ' aria-current="page"' : ''}>${label}${id === 'now' ? openCount(o.jobs) : ''}</a>`).join('')}</nav>
    ${pages[sub]()}`;
}

function openCount(jobs: ArtJob[]): string {
  const n = jobs.filter(isOpen).length;
  return n ? ` <span class="count">${n}</span>` : '';
}

function isOpen(j: ArtJob): boolean {
  return j.status === 'queued' || j.status === 'waiting' || j.status === 'painting';
}

function budgetLine(b: Budget): string {
  return `${usd(b.spentUsd)} of ${usd(b.monthlyUsd)} spent this month${b.paused ? ` · <b class="bad">${esc(b.why ?? 'Nothing more is painted for now.')}</b>` : b.warn ? ' · past the warning line' : ''}`;
}

// --- Pages ----------------------------------------------------------------------

function nowPage(): string {
  return `<div id="art-jobs">${jobsHtml(data!.jobs, data!.budget)}</div>`;
}

function jobsHtml(jobs: ArtJob[], b: Budget): string {
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

/** Page buttons along the top of a tab, with the chosen one marked. */
function pagesNav(sub: Subtab, pages: string[], chosen: string): string {
  return `<nav class="pages">${pages.map((p) => `<a href="${go(sub, p)}" data-art-go${p === chosen ? ' aria-current="page"' : ''}>${esc(p)}</a>`).join('')}</nav>`;
}

/** Characters or Monsters: one page each, with its pictures and its walking animations. */
function peoplePage(tab: 'characters' | 'monsters', page?: string): string {
  const items = data!.items.filter((i) => i.place.tab === tab);
  const walkers = data!.walkers.filter((w) => w.place.tab === tab);
  // Player looks first, then everyone else as the game lists them.
  const looks = new Set(walkers.filter((w) => w.kind.endsWith('look')).map((w) => w.place.page));
  const names = [...new Set([...items.map((i) => i.place.page), ...walkers.map((w) => w.place.page)])].sort((a, b) => Number(looks.has(b)) - Number(looks.has(a)));
  if (!names.length) return `<p class="note">No ${tab} yet.</p>`;
  const chosen = page && names.includes(page) ? page : names[0]!;
  const own = items.filter((i) => i.place.page === chosen);
  const walking = walkers.filter((w) => w.place.page === chosen);
  return `
    ${pagesNav(tab, names, chosen)}
    <h2>${esc(chosen)}</h2>
    ${own.length ? `<h3>Pictures</h3><div class="art-grid">${own.map(itemHtml).join('')}</div>` : ''}
    ${walking.map((w) => `<h3>Walking animations</h3>${walkerHtml(w)}`).join('')}`;
}

function itemsPage(page?: string): string {
  const items = data!.items.filter((i) => i.place.tab === 'items');
  const kinds = ITEM_ORDER.filter((k) => items.some((i) => i.place.page === k));
  if (!kinds.length) return '<p class="note">No items yet.</p>';
  const chosen = page && kinds.includes(page) ? page : kinds[0]!;
  return `${pagesNav('items', kinds, chosen)}${sectionHtml(chosen, items.filter((i) => i.place.page === chosen))}`;
}

function biomesPage(page?: string): string {
  const items = data!.items.filter((i) => i.place.tab === 'biomes');
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
function sectionHtml(title: string | null, items: ArtItem[], tag = 'h2'): string {
  const first = items[0];
  const group = first && data!.groups.find((g) => g.items.some((i) => i.id === first.id));
  const again = items.filter((i) => i.repaintable && i.source !== 'missing');
  const button = group && again.length > 1 ? `<button type="button" class="quiet" data-art-review="${esc(JSON.stringify({ what: 'paint-group', group: group.id }))}">Paint all ${again.length} again · about ${usd(again.reduce((n, i) => n + i.estimateUsd, 0))}</button>` : '';
  return `${title ? `<${tag}>${esc(title)}</${tag}>` : ''}${button}<div class="art-grid">${items.map(itemHtml).join('')}</div>`;
}

function itemHtml(item: ArtItem): string {
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
  return `<figure class="art-item ${item.source}${item.check && !item.check.pass ? ' flagged' : ''}">${picture}<figcaption><b>${esc(item.name)}</b><br><small>${SOURCE[item.source]}${model ? ` · ${esc(model)}` : ''}</small>${check}<div class="card-actions">${paint}${details}</div></figcaption></figure>`;
}

function stripHtml(strip: { url: string; frames: number; width: number; height: number; cycleSeconds: number } | undefined, label: string, height = 72): string {
  if (!strip) return `<div class="walk none" title="${label}: no walk yet"><span>${label}</span></div>`;
  const frameWidth = strip.width / strip.frames;
  const width = Math.round((frameWidth * height) / strip.height);
  return `<div class="walk" title="${label}"><i style="width:${width}px;height:${height}px;background-image:url('${esc(strip.url)}');background-size:${strip.frames * 100}% 100%;animation-duration:${strip.cycleSeconds}s;--steps:${strip.frames}"></i><span>${label}</span></div>`;
}

function walkerHtml(w: WalkerView): string {
  const made = DIRECTIONS.filter(([d]) => w.walks[d]).length;
  const bodyPick = `<label>Body<span><select name="body">${data!.bodies.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></span></label>`;
  const direction = ([d, label]: [Direction, string]) => {
    const strip = w.walks[d];
    const view = w.standing[d];
    const older = (strip?.versions.length ?? 0) || (w.lost[d]?.length ?? 0);
    const walkVersions = strip || older ? `<button type="button" class="quiet" data-walk-versions="${esc(w.id)}" data-direction="${d}">${older ? `Walk versions (${older + (strip ? 1 : 0)})` : 'What made the walk'}</button>` : '';
    const viewVersions = (view.url && !view.approved) || view.versions.length ? `<button type="button" class="quiet" data-view-versions="${esc(w.id)}" data-direction="${d}">${view.versions.length ? `Picture versions (${view.versions.length + 1})` : 'What made the picture'}</button>` : '';
    const paintView = `<button type="button" data-art-review="${esc(JSON.stringify({ what: 'view', walker: w.id, direction: d }))}">${view.url && !view.approved ? 'Paint picture again' : 'Paint standing picture'} · about ${usd(w.viewUsd)}</button>`;
    const clip = view.url
      ? `<button type="button" data-art-review="${esc(JSON.stringify({ what: 'clip', walker: w.id, body: 'two-legged', direction: d }))}" data-walker-body>${strip ? 'Make clip again' : 'Make walk clip'} · about ${usd(w.clipUsd)}</button>`
      : '<small>Paint its standing picture first.</small>';
    return `
      <div class="direction">
        <div class="standing">${view.url ? `<img src="${esc(view.url)}" alt="" loading="lazy">` : '<span class="ph">?</span>'}<small>${view.approved ? 'approved picture' : view.url ? 'standing picture' : 'no standing picture'}</small></div>
        ${stripHtml(strip, label, 110)}
        <div class="card-actions">${paintView}${viewVersions}${clip}${walkVersions}</div>
      </div>`;
  };
  return `
    <div class="walker">
      <header>${w.url ? `<img src="${esc(w.url)}" alt="">` : ''}<div><b>${esc(w.name)}</b><br><small>${esc(w.kind)} · ${made === 4 ? 'walks every way' : made ? `walks ${made} of 4 ways` : 'no walks yet'}</small></div>
        <form class="form walker-body">${bodyPick}</form></header>
      <p class="note">Each direction has a standing picture, and a short clip that starts and ends on it. Paint the picture first and look at it (paint it again until you like it), then make the clip from it. Both prompts can be edited before anything is sent.</p>
      <div class="walks">${DIRECTIONS.map(direction).join('')}</div>
      ${handsHtml(w)}
      ${made < 4 ? `
        <details><summary>Or make all the missing walks in one go</summary>
          <form class="form art-walk" data-walker="${esc(w.id)}">
            <button type="submit">Review ${made ? 'the missing walks' : 'making walks'} · about ${usd(w.estimateUsd)}</button>
          </form>
        </details>` : ''}
      ${made ? `
        <details><summary>Paint several directions again in one go</summary>
          <form class="form art-walk" data-walker="${esc(w.id)}" data-redo="yes">
            <span class="dirs">${DIRECTIONS.map(([d, label]) => `<label class="check"><input type="checkbox" name="dir-${d}"> ${label}</label>`).join('')}</span>
            <label class="check"><input type="checkbox" name="views"> Paint their standing pictures again too (about ${usd(w.viewUsd)} each)</label>
            <button type="submit">Review · about ${usd(w.clipUsd)} a direction</button>
          </form>
        </details>` : ''}
    </div>`;
}

/** Items tried in each hand in the hands preview, by art id; the same for every character while God's View is open. */
const tryOn: { right?: string; left?: string } = {};
/** Item pictures' sizes once loaded, by url, so a tried item is drawn at its game size. */
const sizes = new Map<string, [number, number]>();
/** Item pages whose items can be held. */
const HOLDABLE = ['Weapons', 'Shields', 'Charms'];

function holdable(): ArtItem[] {
  return data!.items.filter((i) => i.url && i.place.tab === 'items' && HOLDABLE.includes(i.place.page));
}

/**
 * The item tried in one hand, drawn on a frame as the game draws it: its
 * grip on the hand, its longest side a set share of the frame's height,
 * turned the way the walker faces, and behind the body when that hand is.
 */
function triedHtml(direction: Direction, side: 'right' | 'left', hand: ArtPoint | null | undefined, height: number): string {
  const item = holdable().find((i) => i.id === tryOn[side]);
  const grip = item ? points[item.id]?.grip : undefined;
  const size = item?.url ? sizes.get(item.url) : undefined;
  if (!item?.url || !hand || !grip || !size) return '';
  const scale = (height * HELD_SIZE) / Math.max(...size);
  const [w, h] = [size[0] * scale, size[1] * scale];
  const flip = direction === 'left';
  const gx = flip ? 1 - grip[0] : grip[0];
  return `<img class="held ${heldBehind(direction, side) ? 'behind' : 'front'}" src="${esc(item.url)}" alt="" style="width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;left:calc(${(hand[0] * 100).toFixed(1)}% - ${(gx * w).toFixed(1)}px);top:calc(${(hand[1] * 100).toFixed(1)}% - ${(grip[1] * h).toFixed(1)}px)${flip ? ';transform:scaleX(-1)' : ''}">`;
}

/** The pickers for the items tried in each hand. */
function tryOnHtml(): string {
  const items = holdable();
  if (!items.length) return '';
  const options = (side: 'right' | 'left') => `<option value="">Nothing</option>${HOLDABLE.map((page) => {
    const here = items.filter((i) => i.place.page === page);
    return here.length ? `<optgroup label="${page}">${here.map((i) => `<option value="${esc(i.id)}"${tryOn[side] === i.id ? ' selected' : ''}>${esc(i.name)}${points[i.id]?.grip ? '' : ' (grip not found yet)'}</option>`).join('')}</optgroup>` : '';
  }).join('')}`;
  return `<div class="try-on"><label>Try in the right hand <select data-try-on="right">${options('right')}</select></label>
    <label>Try in the left hand <select data-try-on="left">${options('left')}</select></label></div>`;
}

/**
 * Where the hand finder put both hands, frame by frame: R is where a held
 * weapon or charm is gripped, L where a shield or other off-hand item is.
 * A frame where it found none borrows the nearest frame's hand in the game.
 */
function handsHtml(w: WalkerView): string {
  const ids = DIRECTIONS.filter(([d]) => w.walks[d]).map(([d]) => `${w.id}-walk-${d}`);
  const find = (body: { ids: string[]; frame?: number }, label: string, cls = 'quiet') => `<button type="button" class="${cls}" data-hands-find="${esc(JSON.stringify(body))}">${label}</button>`;
  const rows = DIRECTIONS.flatMap(([d, label]) => {
    const strip = w.walks[d];
    const id = `${w.id}-walk-${d}`;
    const hands = points[id]?.hands;
    const lefts = points[id]?.leftHands;
    if (!strip) return [];
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
    const question = questions.find((q) => q.facing === d);
    const ask = question ? `
      <details class="hand-question"><summary>The question asked${question.own ? ' (your words)' : ''}</summary>
        <form class="form hand-question" data-facing="${d}">
          <textarea name="prompt" rows="3" maxlength="2000">${esc(question.prompt)}</textarea>
          <p class="note">Always sent with it: “${esc(question.system)}”</p>
          <div class="card-actions"><button type="submit" class="quiet">Keep these words</button>${question.own ? `<button type="button" class="quiet" data-hands-usual="${d}">Back to the usual words</button>` : ''}</div>
          <p class="note">The same question is asked for every character walking ${label}. Nothing is looked at again until you ask.</p>
        </form>
      </details>` : '';
    const missing = !hands ? ' · not looked at yet' : !lefts ? ' · left hand not looked for yet: it is found by itself after Pull and restart, or use Find again' : '';
    // Turning round mirrors the picture, so the opposite walk's hands, mirrored, can stand in for this one's.
    const [turned, turnedLabel] = DIRECTIONS.find(([o]) => o === TURNED[d])!;
    const from = `${w.id}-walk-${turned}`;
    const copied = mirrored[id] ? ` · mirrored from the ${DIRECTIONS.find(([o]) => mirrored[id] === `${w.id}-walk-${o}`)?.[1] ?? 'other'} walk` : '';
    const mirror = w.walks[turned] && points[from]?.hands ? `<button type="button" class="quiet" data-hands-mirror="${esc(JSON.stringify({ from, to: id }))}" data-label="${esc(`${label} walk`)}" data-from-label="${esc(`${turnedLabel} walk`)}">Use the ${turnedLabel} walk's hands, mirrored</button>` : '';
    return [`<div class="hand-row"><div class="hand-head"><small>${label}${missing}${copied}</small>${find({ ids: [id] }, 'Find again for this walk')}${mirror}</div><div class="frames">${frames}</div>${ask}</div>`];
  });
  if (!rows.length) return '';
  return `<details class="hands"${openHands.has(w.id) ? ' open' : ''} data-walker="${esc(w.id)}"><summary>Where the hands were found (right hand: weapons and charms; left hand: shields and off-hand items)</summary>
    <p class="note">The hand finder looks at every frame once, after a walk is painted. R is the character's right hand, L their left. Click a frame to look at just that frame again; each look is a small vision-model call. A walk can instead take the hands found in the walk facing the other way, mirrored, for free.</p>
    ${tryOnHtml()}
    <p class="note">Pick an item to see it in that hand on every frame, as the game draws it. Trying items is free and changes nothing for players.</p>
    ${find({ ids: [...ids, w.id] }, `Find again for every walk of ${esc(w.name)}`, '')}
    ${rows.join('')}</details>`;
}

/** Hand panels left open, so they stay open when the page is drawn again after a look. */
const openHands = new Set<string>();

function soundsPage(): string {
  const o = data!;
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

// --- What was sent ----------------------------------------------------------------

/** What one recipe sent, step by step; with `other`, prompt lines that differ from it are marked. */
function recipeHtml(recipe: Recipe | undefined, other?: Recipe, planned = false): string {
  if (!recipe) return '<p class="note">Nothing is known about what made this one: it was painted before God\'s View kept that.</p>';
  const otherLines = new Set(other?.steps.flatMap((s) => s.prompt.split('\n')) ?? []);
  const prompt = (text: string) => text.split('\n').map((line) => (other && !otherLines.has(line) ? `<mark>${esc(line)}</mark>` : esc(line))).join('\n');
  const step = (s: RecipeStep, i: number) => `
    <section class="step">
      <h4>${recipe.steps.length > 1 ? `${i + 1}. ` : ''}${esc(s.label)}</h4>
      <p class="meta"><b>${esc(s.model)}</b> <small>(${esc(s.provider === 'gemini' ? 'Google AI Studio' : s.provider)})</small> · ${MEDIA[s.media]}${s.settings.length ? ` · ${s.settings.map(esc).join(' · ')}` : ''} · ${planned || recipe.partial ? 'about' : 'cost'} ${usd(s.usd)}</p>
      ${s.pictures.length ? `<div class="sent">${s.pictures.map((p) => `<figure>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="" loading="lazy"></a>` : `<span class="ph">${p.later ? '↑' : '?'}</span>`}<figcaption>${esc(p.name)}${p.later ? '<br><small>painted in the step above</small>' : p.url ? '' : '<br><small>not kept</small>'}</figcaption></figure>`).join('')}</div>` : '<p class="note">No pictures sent along.</p>'}
      ${s.note ? `<p class="note">Sent with the pictures: “${esc(s.note)}”<br><small>The pictures here are only examples of the style, so this keeps the model from painting them again instead of what the prompt asks for. It is left out when a picture sent is the subject itself, such as a walk's standing picture.</small></p>` : ''}
      <pre class="prompt">${prompt(s.prompt)}</pre>
    </section>`;
  return `
    ${recipe.steps.map(step).join('')}
    ${recipe.notes?.length ? `<ul class="recipe-notes">${recipe.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    ${recipe.partial ? '<p class="note">Kept from before God\'s View saved everything: the pictures sent along are shown as the game has them now.</p>' : ''}`;
}

// --- Dialogs ----------------------------------------------------------------------

function dialog(): HTMLDialogElement {
  let d = document.getElementById('art-dialog') as HTMLDialogElement | null;
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'art-dialog';
  document.body.append(d);
  d.addEventListener('click', (e) => {
    // A click on the backdrop closes it.
    if (e.target === d) d!.close();
  });
  return d;
}

/** Asks the server what a request will send, and shows it for approval; `note` lets the Owner add words first. */
async function openReview(ask: Ask, takesNote: boolean, note = ''): Promise<void> {
  const d = dialog();
  d.innerHTML = '<p class="note">Working out exactly what will be sent…</p>';
  if (!d.open) d.showModal();
  let review: Review;
  // A walk's standing picture or clip takes the Owner's own prompt in place of the usual one.
  const editable = ask.what === 'view' || ask.what === 'clip' ? ask : undefined;
  try {
    review = await ctx.api<Review>('art/review', 'POST', { ...ask, ...(note ? { note } : {}) });
  } catch (err) {
    d.innerHTML = `<div class="dialog-body"><p class="bad">${esc((err as Error).message)}</p></div><footer><button type="button" class="quiet" data-close>Close</button></footer>`;
    d.querySelector('[data-close]')!.addEventListener('click', () => d.close());
    return;
  }
  const many = review.parts.length > 1;
  d.innerHTML = `
    <header><h2>${esc(review.title)}</h2><button type="button" class="quiet" data-close aria-label="Close">✕</button></header>
    <div class="dialog-body">
      <p class="note">This is everything that will be sent to the AI model${many ? 's' : ''}. Nothing is painted until you approve it.</p>
      ${ask.what === 'view' ? sourcesHtml(ask) : ''}
      ${editable ? `<form class="form review-prompt"><label>Prompt${editable.prompt ? ' (your own words)' : ' (the usual words; edit them if you like)'}<span><textarea name="prompt" rows="8" maxlength="4000">${esc(review.parts[0]?.recipe.steps[0]?.prompt ?? '')}</textarea></span></label>
        <div class="card-actions"><button type="submit" class="quiet">Show with this prompt</button>${editable.prompt ? '<button type="button" class="quiet" data-usual>Back to the usual prompt</button>' : ''}</div></form>` : ''}
      ${takesNote ? `<form class="form review-note"><label>Anything to change? (optional; added to the prompt)<span><textarea name="note" rows="2" maxlength="1000" placeholder="warmer light, a mossier roof">${esc(note)}</textarea></span></label><button type="submit" class="quiet">Show with these words</button></form>` : ''}
      ${review.parts.map((p) => `${many ? `<details><summary><b>${esc(p.name)}</b> · about ${usd(p.recipe.steps.reduce((n, s) => n + s.usd, 0))}</summary>${recipeHtml(p.recipe, undefined, true)}</details>` : recipeHtml(p.recipe, undefined, true)}`).join('')}
    </div>
    <footer>
      <span>About <b>${usd(review.estimateUsd)}</b> · ${budgetLine(data!.budget)}</span>
      <button type="button" class="quiet" data-close>Cancel</button>
      <button type="button" data-approve>Approve and paint</button>
    </footer>`;
  for (const b of d.querySelectorAll('[data-close]')) b.addEventListener('click', () => d.close());
  d.querySelector('form.review-sources')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const from = new FormData(e.target as HTMLFormElement).getAll('from').map(String);
    if (!from.length) return ctx.toast('Pick at least one picture to paint from.');
    void openReview({ ...(ask as Extract<Ask, { what: 'view' }>), from }, false);
  });
  d.querySelector('form.review-prompt')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const words = String(new FormData(e.target as HTMLFormElement).get('prompt') ?? '').trim();
    void openReview({ ...editable!, ...(words ? { prompt: words } : {}) }, false);
  });
  d.querySelector('[data-usual]')?.addEventListener('click', () => {
    const { prompt: _, ...usual } = editable!;
    void openReview(usual, false);
  });
  d.querySelector('form.review-note')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const words = String(new FormData(e.target as HTMLFormElement).get('note') ?? '').trim();
    void openReview(ask, takesNote, words);
  });
  d.querySelector<HTMLButtonElement>('[data-approve]')!.addEventListener('click', async (e) => {
    const button = e.target as HTMLButtonElement;
    button.disabled = true;
    try {
      await ctx.api(`art/${ask.what}`, 'POST', { ...ask, ...(note ? { note } : {}), approved: review.fingerprint });
      d.close();
      ctx.toast(ask.what === 'walk' || ask.what === 'clip' ? 'Approved. Clips take a minute or two each; follow them under Painting now.' : ask.what === 'view' ? 'Approved. The picture shows here once it is painted; then make the clip from it.' : 'Approved. Follow it under Painting now.');
      ctx.rerender();
    } catch (err) {
      button.disabled = false;
      ctx.toast((err as Error).message);
    }
  });
}

/** Which pictures a standing picture is painted from: the approved picture and any standing pictures already kept. */
function sourcesHtml(ask: Extract<Ask, { what: 'view' }>): string {
  const w = data!.walkers.find((x) => x.id === ask.walker);
  if (!w) return '';
  const from = ask.from ?? ['approved'];
  const options: [string, string, string | undefined][] = [['approved', 'The approved picture', w.url]];
  for (const [d, label] of DIRECTIONS) {
    const view = w.standing[d];
    if (view.url && !view.approved) options.push([d, `Standing, ${label}`, view.url]);
  }
  if (options.length < 2) return '';
  return `<form class="form review-sources"><p class="note">Paint it from these pictures (the approved one alone does not show everything, such as how a scarf hangs at the back):</p>
    <div class="source-picks">${options.map(([id, label, url]) => `<label class="check">${url ? `<img src="${esc(url)}" alt="">` : ''}<span><input type="checkbox" name="from" value="${id}"${from.includes(id) ? ' checked' : ''}> ${esc(label)}</span></label>`).join('')}</div>
    <button type="submit" class="quiet">Show with these pictures</button></form>`;
}

/** One version in a comparison: how it looks and what made it. */
interface Shown { id: string; label: string; look: string; recipe?: Recipe }

/** Shows the version in use beside an earlier one, with what made each, and puts the chosen one back. */
function openVersions(title: string, now: Shown, earlier: Shown[], restore: (id: string) => Promise<void>, pick = 0): void {
  const d = dialog();
  const chosen = earlier[pick];
  d.innerHTML = `
    <header><h2>${esc(title)}</h2><button type="button" class="quiet" data-close aria-label="Close">✕</button></header>
    <div class="dialog-body">
      ${earlier.length ? `<p class="note">Pick an earlier version to compare with the one in use. Lines of its prompt that differ are marked.</p>
        <div class="version-picks">${earlier.map((v, i) => `<button type="button" class="quiet${i === pick ? ' chosen' : ''}" data-pick="${i}">${v.look}<small>${esc(v.label)}</small></button>`).join('')}</div>` : '<p class="note">There are no earlier versions yet. Painting it again keeps this one here, so it can be put back.</p>'}
      <div class="compare${chosen ? '' : ' single'}">
        <section><h3>In use now · ${esc(now.label)}</h3><div class="look">${now.look}</div>${recipeHtml(now.recipe, chosen?.recipe)}</section>
        ${chosen ? `<section><h3>${esc(chosen.label)}</h3><div class="look">${chosen.look}</div>${recipeHtml(chosen.recipe, now.recipe)}</section>` : ''}
      </div>
    </div>
    <footer>
      <button type="button" class="quiet" data-close>Close</button>
      ${chosen ? '<button type="button" data-restore>Use this version</button>' : ''}
    </footer>`;
  if (!d.open) d.showModal();
  for (const b of d.querySelectorAll('[data-close]')) b.addEventListener('click', () => d.close());
  for (const b of d.querySelectorAll<HTMLButtonElement>('[data-pick]')) b.addEventListener('click', () => openVersions(title, now, earlier, restore, Number(b.dataset.pick)));
  d.querySelector<HTMLButtonElement>('[data-restore]')?.addEventListener('click', async (e) => {
    (e.target as HTMLButtonElement).disabled = true;
    try {
      await restore(chosen!.id);
      d.close();
      ctx.toast('Put back. The one it replaced is kept as an earlier version. Players see it after they reload.');
      ctx.rerender();
    } catch (err) {
      (e.target as HTMLButtonElement).disabled = false;
      ctx.toast((err as Error).message);
    }
  });
}

const picture = (url: string) => `<img src="${esc(url)}" alt="">`;
const madeOn = (recipe: Recipe | undefined, fallback: string) => (recipe?.at ? when(recipe.at) : fallback);
/** A version id is when it was put aside, in base 36. */
const putAside = (id: string) => when(Number.parseInt(id, 36));

function pictureVersions(item: ArtItem): void {
  const earlier: Shown[] = (item.versions ?? []).map((v) => ({ id: v.id, label: `Put aside ${putAside(v.id)}`, look: picture(v.url), recipe: v.recipe }));
  if (item.shipped) earlier.push({ id: 'shipped', label: 'Shipped with the game', look: picture(item.shipped.url), recipe: item.shipped.recipe });
  const now: Shown = { id: 'now', label: madeOn(item.recipe, SOURCE[item.source]), look: item.url ? picture(item.url) : '', recipe: item.recipe };
  openVersions(item.name, now, earlier, (version) => ctx.api('art/restore', 'POST', { asset: item.id, version }));
}

function walkVersions(w: WalkerView, direction: Direction): void {
  const label = DIRECTIONS.find(([d]) => d === direction)![1];
  const strip = w.walks[direction];
  const earlier: Shown[] = (strip?.versions ?? w.lost[direction] ?? []).map((v) => ({ id: v.id, label: `Put aside ${putAside(v.id)}`, look: stripHtml(v, label, 160), recipe: v.recipe }));
  const now: Shown = { id: 'now', label: strip ? madeOn(strip.recipe, 'shipped with the game') : 'no walk now', look: stripHtml(strip, label, 160), recipe: strip?.recipe };
  openVersions(`${w.name} walking ${label === 'towards us' ? 'towards us' : label === 'away' ? 'away' : label}`, now, earlier, (version) => ctx.api('art/restore-walk', 'POST', { walker: w.id, direction, version }));
}

function viewVersions(w: WalkerView, direction: Direction): void {
  const label = DIRECTIONS.find(([d]) => d === direction)![1];
  const view = w.standing[direction];
  const earlier: Shown[] = view.versions.map((v) => ({ id: v.id, label: v.id === 'approved' ? 'The approved picture' : `Put aside ${putAside(v.id)}`, look: picture(v.url), recipe: v.recipe }));
  const now: Shown = { id: 'now', label: view.approved ? 'the approved picture' : madeOn(view.recipe, 'painted here'), look: view.url ? picture(view.url) : '', recipe: view.recipe };
  openVersions(`${w.name} standing, facing ${label}`, now, earlier, (version) => ctx.api('art/restore-view', 'POST', { walker: w.id, direction, version }));
}

function soundVersions(s: SoundItem): void {
  const audio = (url: string) => `<audio controls preload="none" src="${esc(url)}"></audio>`;
  const earlier: Shown[] = s.versions.map((v) => ({ id: v.id, label: `Made ${when(v.recipe.at)}`, look: audio(v.url), recipe: v.recipe }));
  const now: Shown = { id: 'now', label: madeOn(s.recipe, 'made here'), look: s.url ? audio(s.url) : '', recipe: s.recipe };
  openVersions(s.name, now, earlier, (version) => ctx.api('art/restore-sound', 'POST', { sound: s.id, version }));
}

// --- Events -----------------------------------------------------------------------

/** Handles a click on one of the Art tab's buttons or links; false when it was not one. */
export function artClick(target: HTMLElement): boolean {
  const link = target.closest<HTMLAnchorElement>('a[data-art-go]');
  if (link) {
    // The link lets go of focus, or the page keeps itself as it is for what is being typed.
    link.blur();
    return true;
  }
  const t = target.closest<HTMLButtonElement>('button');
  if (!t || !data) return false;
  if (t.dataset.artReview) {
    const ask = JSON.parse(t.dataset.artReview) as Ask;
    // A walk clip moves the way the body picked on its card does.
    const body = t.closest('.walker')?.querySelector<HTMLSelectElement>('select[name=body]')?.value;
    if (ask.what === 'clip' && t.dataset.walkerBody !== undefined && body) ask.body = body;
    void openReview(ask, t.dataset.note === 'yes');
  } else if (t.dataset.artVersions) {
    const item = data.items.find((i) => i.id === t.dataset.artVersions);
    if (item) pictureVersions(item);
  } else if (t.dataset.walkVersions) {
    const w = data.walkers.find((x) => x.id === t.dataset.walkVersions);
    if (w) walkVersions(w, t.dataset.direction as Direction);
  } else if (t.dataset.handsFind) {
    const panel = t.closest<HTMLElement>('details.hands');
    if (panel?.dataset.walker) openHands.add(panel.dataset.walker);
    t.disabled = true;
    t.classList.add('busy');
    void ctx.api<{ looked: number }>('art/hands/find', 'POST', JSON.parse(t.dataset.handsFind)).then(
      (r) => { ctx.toast(`Looked again at ${r.looked} ${r.looked === 1 ? 'frame' : 'frames'}. Players see it after they reload.`); ctx.rerender(); },
      (err: Error) => { t.disabled = false; t.classList.remove('busy'); ctx.toast(err.message); },
    );
  } else if (t.dataset.handsMirror) {
    if (!confirm(`Replace the hands of the ${t.dataset.label} with the ${t.dataset.fromLabel}'s, mirrored? This is free; "Find again" looks for them in this walk again.`)) return true;
    const panel = t.closest<HTMLElement>('details.hands');
    if (panel?.dataset.walker) openHands.add(panel.dataset.walker);
    void ctx.api('art/hands/mirror', 'POST', JSON.parse(t.dataset.handsMirror)).then(
      () => { ctx.toast('Mirrored. Players see it after they reload.'); ctx.rerender(); },
      (err: Error) => ctx.toast(err.message),
    );
  } else if (t.dataset.handsUsual) {
    const panel = t.closest<HTMLElement>('details.hands');
    if (panel?.dataset.walker) openHands.add(panel.dataset.walker);
    void ctx.api('art/hands/question', 'POST', { facing: t.dataset.handsUsual, prompt: '' }).then(() => { ctx.toast('Back to the usual words.'); ctx.rerender(); }, (err: Error) => ctx.toast(err.message));
  } else if (t.dataset.viewVersions) {
    const w = data.walkers.find((x) => x.id === t.dataset.viewVersions);
    if (w) viewVersions(w, t.dataset.direction as Direction);
  } else if (t.dataset.soundVersions) {
    const s = data.sounds.find((x) => x.id === t.dataset.soundVersions);
    if (s) soundVersions(s);
  } else return false;
  t.blur();
  return true;
}

/** Handles the Art tab's pickers; false when the change was not one of them. */
export function artChange(target: HTMLElement): boolean {
  const side = target.dataset.tryOn;
  if (side !== 'right' && side !== 'left') return false;
  tryOn[side] = (target as HTMLSelectElement).value || undefined;
  const url = holdable().find((i) => i.id === tryOn[side])?.url;
  if (url && !sizes.has(url)) {
    const img = new Image();
    img.onload = () => { sizes.set(url, [img.naturalWidth, img.naturalHeight]); redrawHands(); };
    img.src = url;
  } else redrawHands();
  return true;
}

/** Draws the open hands panels again, for a newly tried item. */
function redrawHands(): void {
  for (const panel of document.querySelectorAll<HTMLElement>('details.hands')) {
    const w = data?.walkers.find((x) => x.id === panel.dataset.walker);
    if (!w) continue;
    if (panel.hasAttribute('open')) openHands.add(w.id);
    else openHands.delete(w.id);
    panel.outerHTML = handsHtml(w);
  }
}

/** Handles the walk forms; false when the form was not one of the Art tab's. */
export function artSubmit(form: HTMLFormElement): boolean {
  if (form.classList.contains('hand-question')) {
    const panel = form.closest<HTMLElement>('details.hands');
    if (panel?.dataset.walker) openHands.add(panel.dataset.walker);
    const prompt = String(new FormData(form).get('prompt') ?? '');
    void ctx.api('art/hands/question', 'POST', { facing: form.dataset.facing, prompt }).then(() => { ctx.toast('Kept. Use "Find again" to look with these words.'); ctx.rerender(); }, (err: Error) => ctx.toast(err.message));
    return true;
  }
  if (!form.classList.contains('art-walk')) return false;
  const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
  f.body = form.closest('.walker')?.querySelector<HTMLSelectElement>('select[name=body]')?.value ?? 'two-legged';
  const directions = DIRECTIONS.map(([d]) => d).filter((d) => f[`dir-${d}`] === 'on');
  if (form.dataset.redo && !directions.length) {
    ctx.toast('Pick at least one direction.');
    return true;
  }
  void openReview({ what: 'walk', walker: form.dataset.walker!, body: f.body ?? 'two-legged', ...(form.dataset.redo ? { directions, views: f.views === 'on' } : {}) }, false);
  return true;
}
