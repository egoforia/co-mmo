// AI Art Studio client facade over art-ui/:
// - art-ui/state.ts: shared interfaces, constants, formatters, and artState store
// - art-ui/queue.ts: "Up Next" staged priority queue & live ArtJobs monitor
// - art-ui/missing.ts: Missing & Stand-In Art Navigator with deep links & batch queuing
// - art-ui/art-director.ts: AI Art Director (Living Style Bible, 5-point Coherence Wall, Prompt Harmonizer, Consultation)
// - art-ui/walkers.ts: Unified Characters, Monsters & NPCs Studio (#entities), 4-way isometric views
// - art-ui/hand-editor.ts: Interactive Frame-by-Frame Hand & Grip Workbench
// - art-ui/skill-stage.ts: Interactive Attack, Skill & Status Effect Stage
// - art-ui/hud-fx.ts: HUD Elements, Status Icons, Skill FX, Hotbar & 7-Slot Equipment Paperdoll
// - art-ui/map-editor.ts: In-Studio Region Map Preview & Manual 10-tool + AI Map Architect Editor
// - art-ui/models.ts: Decoupled Art, Video, Sound, Music & AI Art Director models
// - art-ui/pages.ts: Items, Biomes (with Gathering Spots), Building looks, and Sounds & music
// - art-ui/buildings.ts: Buildings sub-tab (how each building stands, its kit views, furniture footprints)
// - art-ui/dialogs.ts: recipe diff formatter, review/approval modal (with Director Harmonize), and version comparison modal
// - art-ui/hand-status.ts: the "Finding hands" line and its link to the character page's hand finder

import type { Facing } from '@co-mmo/shared';
import {
  artDirectorPage,
  handleDirectorClick,
  handleDirectorSubmit,
  loadArtDirector,
} from './art-ui/art-director.ts';
import { buildingsPage, footprintSubmit, loadBuildings } from './art-ui/buildings.ts';
import {
  openReview,
  pictureVersions,
  soundVersions,
  viewVersions,
  walkVersions,
} from './art-ui/dialogs.ts';
import {
  handleWorkbenchChange,
  handleWorkbenchClick,
  mountHandWorkbenches,
} from './art-ui/hand-editor.ts';
import { focusHandFinder, followHandStatus, handStatusLine, loadHandStatus, refreshHandStatus } from './art-ui/hand-status.ts';
import { handleHudFxClick, hudFxPage } from './art-ui/hud-fx.ts';
import {
  handleMapEditorChange,
  handleMapEditorClick,
  handleMapEditorSubmit,
  loadMapEditorData,
  mapEditorPage,
  mountMapEditorCanvas,
} from './art-ui/map-editor.ts';
import { collectMissingGaps, handleMissingClick, missingPage } from './art-ui/missing.ts';
import {
  handleModelsChange,
  handleModelsSubmit,
  loadArtModels,
  modelsPage,
} from './art-ui/models.ts';
import {
  biomesPage,
  itemsPage,
  looksPage,
  nowPage,
  refreshArtJobs,
  soundsPage,
} from './art-ui/pages.ts';
import {
  handleQueueClick,
  handleQueueSubmit,
  loadUpNext,
  queuePage,
} from './art-ui/queue.ts';
import {
  handleSkillStageChange,
  handleSkillStageClick,
  mountSkillStages,
} from './art-ui/skill-stage.ts';
import {
  type ArtContext,
  type ArtOverview,
  type Ask,
  type HandQuestion,
  SUBTABS,
  type Subtab,
  artState,
  budgetLine,
  esc,
  go,
  openCount,
  where,
} from './art-ui/state.ts';
import { entitiesPage, handleEntityFilterClick, holdable, peoplePage, redrawHands } from './art-ui/walkers.ts';
import { lightPreviews } from './light-preview.ts';
import { workedOutNormalMap } from './normal-preview.ts';

export { focusHandFinder, refreshArtJobs, refreshHandStatus, type ArtContext };

/** Mounts interactive canvases (Hand Workbench, Attack/Skill Stage, Map Editor) after DOM render. */
export function afterArtRender(): void {
  focusHandFinder();
  mountHandWorkbenches();
  mountSkillStages();
  mountMapEditorCanvas();
}

/** Renders the AI Art Studio page as HTML. */
export async function artPage(context: ArtContext): Promise<string> {
  artState.ctx = context;
  let asked: { questions: HandQuestion[]; mirrored?: Record<string, string> };
  [artState.data, artState.points, asked] = await Promise.all([
    context.api<ArtOverview>('art'),
    fetch('/api/art-points').then((r) => (r.ok ? r.json() : {}), () => ({})),
    context.api<{ questions: HandQuestion[]; mirrored?: Record<string, string> }>('art/hands').catch(() => ({ questions: [] })),
    loadHandStatus(context),
    loadUpNext(),
  ]);
  artState.questions = asked.questions;
  artState.mirrored = asked.mirrored ?? {};
  const o = artState.data;
  const { sub, page } = where();
  if (sub === 'buildings') await loadBuildings();
  if (sub === 'art-director') await loadArtDirector();
  if (sub === 'map-editor') await loadMapEditorData();
  if (sub === 'models') await loadArtModels();

  const stagedCount = (artState.upNext?.items.filter((i) => i.status === 'staged').length ?? 0);
  const missingCount = collectMissingGaps().length;

  const pages: Record<Subtab, () => string> = {
    queue: queuePage,
    now: nowPage,
    missing: () => missingPage(page),
    'art-director': artDirectorPage,
    entities: () => entitiesPage(page),
    characters: () => peoplePage('characters', page),
    monsters: () => peoplePage('monsters', page),
    items: () => itemsPage(page),
    biomes: () => biomesPage(page),
    looks: looksPage,
    buildings: buildingsPage,
    'hud-fx': () => hudFxPage(page),
    sounds: soundsPage,
    'map-editor': mapEditorPage,
    models: modelsPage,
  };

  const tabBadge = (id: string) => {
    if (id === 'queue') {
      const jobsBadge = openCount(o.jobs);
      const qBadge = stagedCount ? ` <span class="count">${stagedCount}</span>` : '';
      return jobsBadge || qBadge;
    }
    if (id === 'missing' && missingCount) {
      return ` <span class="count warn">${missingCount}</span>`;
    }
    return '';
  };

  const activeNavId = sub === 'now' ? 'queue' : sub === 'characters' || sub === 'monsters' ? 'entities' : sub;

  return `
    <p class="studio-status-bar">${o.imageModel ? `Pictures: <b>${esc(o.imageModel)}</b>` : '<b class="bad">No image model is set</b> (<a href="#models" data-art-go>AI Models tab</a>)'} · ${o.videoModel ? `Walks: <b>${esc(o.videoModel)}</b>` : 'Walks need Google AI Studio as the image model'} · ${budgetLine(o.budget)}</p>
    ${handStatusLine()}
    <nav class="subtabs">${SUBTABS.map(([id, label]) => `<a href="${go(id)}" data-art-go${id === activeNavId ? ' aria-current="page"' : ''}>${label}${tabBadge(id)}</a>`).join('')}</nav>
    ${pages[sub]()}`;
}

/** Table-driven button action handlers, keyed by the button's data-* attribute name in dataset. */
const BUTTON_ACTIONS: Record<string, (t: HTMLButtonElement) => void> = {
  artReview: (t) => {
    const ask = JSON.parse(t.dataset.artReview!) as Ask;
    // A walk clip moves the way the body picked on its card does.
    const body = t.closest('.walker')?.querySelector<HTMLSelectElement>('select[name=body]')?.value;
    if (ask.what === 'clip' && t.dataset.walkerBody !== undefined && body) ask.body = body;
    void openReview(ask, t.dataset.note === 'yes');
  },
  normalShow: (t) => {
    t.disabled = true;
    t.textContent = 'Working it out…';
    void workedOutNormalMap(t.dataset.normalShow!).then(
      (src) => { t.outerHTML = `<a href="${esc(src)}" target="_blank" rel="noopener"><img class="normal-map" src="${esc(src)}" alt="Its worked-out normal map"></a>`; },
      () => { t.disabled = false; t.textContent = 'Show the worked-out map'; artState.ctx.toast('That normal map could not be worked out here.'); },
    );
  },
  lightPreview: (t) => {
    const ask = JSON.parse(t.dataset.lightPreview!) as { url: string; normal?: string; figure: boolean };
    t.disabled = true;
    t.textContent = 'Lighting it…';
    void (ask.normal ? Promise.resolve(ask.normal) : workedOutNormalMap(ask.url))
      .then((normal) => lightPreviews(ask.url, normal, ask.figure))
      .then(
        (shots) => { t.outerHTML = `<div class="light-previews">${shots.map((s) => `<figure><img src="${esc(s.src)}" alt="${esc(s.label)}"><figcaption>${esc(s.label)}</figcaption></figure>`).join('')}</div>`; },
        () => { t.disabled = false; t.textContent = 'Preview the light'; artState.ctx.toast('That picture could not be lit here.'); },
      );
  },
  normalDrop: (t) => {
    const item = artState.data!.items.find((i) => i.id === t.dataset.normalDrop);
    if (!confirm(`Go back to the normal map the game works out for ${item?.name ?? 'this picture'}? The painted one is kept and can be painted again.`)) return;
    void artState.ctx.api('art/normal-drop', 'POST', { asset: t.dataset.normalDrop }).then(
      () => { artState.ctx.toast('Done. Players see it after they reload.'); artState.ctx.rerender(); },
      (err: Error) => artState.ctx.toast(err.message),
    );
  },
  artVersions: (t) => {
    const item = artState.data!.items.find((i) => i.id === t.dataset.artVersions);
    if (item) pictureVersions(item);
  },
  walkVersions: (t) => {
    const w = artState.data!.walkers.find((x) => x.id === t.dataset.walkVersions);
    if (w) walkVersions(w, t.dataset.direction as Facing);
  },
  viewVersions: (t) => {
    const w = artState.data!.walkers.find((x) => x.id === t.dataset.viewVersions);
    if (w) viewVersions(w, t.dataset.direction as Facing);
  },
  soundVersions: (t) => {
    const s = artState.data!.sounds.find((x) => x.id === t.dataset.soundVersions);
    if (s) soundVersions(s);
  },
  handsFind: (t) => {
    const panel = t.closest<HTMLElement>('details.hands');
    if (panel?.dataset.walker) artState.openHands.add(panel.dataset.walker);
    t.disabled = true;
    t.classList.add('busy');
    void artState.ctx.api<{ looked: number }>('art/hands/find', 'POST', JSON.parse(t.dataset.handsFind!)).then(
      (r) => { artState.ctx.toast(`Looked again at ${r.looked} ${r.looked === 1 ? 'frame' : 'frames'}. Players see it after they reload.`); artState.ctx.rerender(); },
      (err: Error) => { t.disabled = false; t.classList.remove('busy'); artState.ctx.toast(err.message); },
    );
  },
  handsMirror: (t) => {
    if (!confirm(`Replace the hands of the ${t.dataset.label} with the ${t.dataset.fromLabel}'s, mirrored? This is free; "Find again" looks for them in this walk again.`)) return;
    const panel = t.closest<HTMLElement>('details.hands');
    if (panel?.dataset.walker) artState.openHands.add(panel.dataset.walker);
    void artState.ctx.api('art/hands/mirror', 'POST', JSON.parse(t.dataset.handsMirror!)).then(
      () => { artState.ctx.toast('Mirrored. Players see it after they reload.'); artState.ctx.rerender(); },
      (err: Error) => artState.ctx.toast(err.message),
    );
  },
  handsUsual: (t) => {
    const panel = t.closest<HTMLElement>('details.hands');
    if (panel?.dataset.walker) artState.openHands.add(panel.dataset.walker);
    void artState.ctx.api('art/hands/question', 'POST', { facing: t.dataset.handsUsual, prompt: '' }).then(
      () => { artState.ctx.toast('Back to the usual words.'); artState.ctx.rerender(); },
      (err: Error) => artState.ctx.toast(err.message),
    );
  },
  itemFashion: (t) => {
    artState.itemFashionFilter = t.dataset.itemFashion!;
    artState.ctx.rerender();
  },
};

/** Handles a click on one of the Art Studio's buttons or links; false when it was not one. */
export function artClick(target: HTMLElement): boolean {
  const link = target.closest<HTMLAnchorElement>('a[data-art-go]');
  if (link) {
    link.blur();
    if (link.dataset.handsFocus !== undefined) followHandStatus(link);
    return true;
  }
  const t = target.closest<HTMLButtonElement>('button');
  if (!t || !artState.data) return false;
  if (
    handleQueueClick(t) ||
    handleMissingClick(t) ||
    handleDirectorClick(t) ||
    handleWorkbenchClick(t) ||
    handleSkillStageClick(t) ||
    handleHudFxClick(t) ||
    handleMapEditorClick(t) ||
    handleEntityFilterClick(t)
  ) {
    t.blur();
    return true;
  }
  for (const [key, handler] of Object.entries(BUTTON_ACTIONS)) {
    if (t.dataset[key] !== undefined) {
      handler(t);
      t.blur();
      return true;
    }
  }
  return false;
}

/** Handles the Art Studio's pickers; false when the change was not one of them. */
export function artChange(target: HTMLElement): boolean {
  if (target.dataset.itemStandinOnly !== undefined) {
    artState.itemStandInOnly = (target as HTMLInputElement).checked;
    artState.ctx.rerender();
    return true;
  }
  if (
    handleWorkbenchChange(target) ||
    handleSkillStageChange(target) ||
    handleMapEditorChange(target) ||
    handleModelsChange(target)
  ) {
    return true;
  }
  const side = target.dataset.tryOn;
  if (side !== 'right' && side !== 'left') return false;
  artState.tryOn[side] = (target as HTMLSelectElement).value || undefined;
  const url = holdable().find((i) => i.id === artState.tryOn[side])?.url;
  if (url && !artState.sizes.has(url)) {
    const img = new Image();
    img.onload = () => {
      artState.sizes.set(url, [img.naturalWidth, img.naturalHeight]);
      redrawHands();
      mountHandWorkbenches();
    };
    img.src = url;
  } else {
    redrawHands();
    mountHandWorkbenches();
  }
  return true;
}

/** Handles the Art Studio's forms; false when the form was not one of them. */
export function artSubmit(form: HTMLFormElement): boolean {
  if (
    footprintSubmit(form) ||
    handleQueueSubmit(form) ||
    handleDirectorSubmit(form) ||
    handleMapEditorSubmit(form) ||
    handleModelsSubmit(form)
  ) {
    return true;
  }
  if (form.classList.contains('hand-question')) {
    const panel = form.closest<HTMLElement>('details.hands');
    if (panel?.dataset.walker) artState.openHands.add(panel.dataset.walker);
    const prompt = String(new FormData(form).get('prompt') ?? '');
    void artState.ctx.api('art/hands/question', 'POST', { facing: form.dataset.facing, prompt }).then(
      () => { artState.ctx.toast('Kept. Use "Find again" to look with these words.'); artState.ctx.rerender(); },
      (err: Error) => artState.ctx.toast(err.message),
    );
    return true;
  }
  return false;
}
