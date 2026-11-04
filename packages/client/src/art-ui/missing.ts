// Missing & Stand-In Art Navigator (#missing):
// Comprehensive completeness audit across all game art & audio categories:
// - Missing static pictures
// - Items & Gathering Spots currently using a shared Stand-In picture (materialIconAnchors, Craft Tools, Gather Spots, Garments, Boss Uniques)
// - Missing 4-way standing turnarounds
// - Missing 4-way walk, run, and attack animation strips
// - Missing hand coordinates on frames & held-item grips
// - Missing HUD status icons & combat/skill FX
// - Failing/missing building kit textures
// - Missing sound effects & region music tracks
// - Style-check flagged assets

import { ISO_WAYS, walkStandArt, type Facing } from '@co-mmo/shared';
import { queueButtonHtml } from './queue.ts';
import {
  HOLDABLE,
  WAYS,
  type UpNextEntry,
  type UpNextState,
  artState,
  esc,
  go,
  usd,
} from './state.ts';

export interface MissingGapItem {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  badge: string;
  badgeClass: 'missing' | 'standin' | 'flagged' | 'hands';
  studioHref: string;
  thumbUrl?: string;
  standInUrl?: string;
  standInName?: string;
  queueEntry?: {
    kind: UpNextEntry['kind'];
    targetId: string;
    label: string;
    category: string;
    direction?: Facing;
    body?: string;
    estimateUsd: number;
  };
  handsFindIds?: string[];
}

export function collectMissingGaps(): MissingGapItem[] {
  const data = artState.data;
  if (!data) return [];
  const gaps: MissingGapItem[] = [];

  // 1. Missing static pictures & HUD/Skill FX & Stand-In pictures & Style-flagged pictures
  for (const item of data.items) {
    const tabHref =
      item.place.tab === 'hud'
        ? go('hud-fx', item.place.page)
        : item.place.tab === 'characters' || item.place.tab === 'monsters'
          ? go('entities', item.place.page)
          : go(item.place.tab, item.place.page);

    if (item.source === 'missing') {
      const cat = item.place.tab === 'hud' ? 'HUD & Skill FX' : 'Missing Pictures';
      gaps.push({
        id: `missing-${item.id}`,
        title: item.name,
        subtitle: `${item.place.tab.toUpperCase()} · ${item.place.page}${item.place.section ? ` › ${item.place.section}` : ''} (${item.id})`,
        category: cat,
        badge: 'Not painted yet',
        badgeClass: 'missing',
        studioHref: tabHref,
        ...(item.repaintable
          ? {
              queueEntry: {
                kind: 'paint',
                targetId: item.id,
                label: `Paint ${item.name}`,
                category: cat,
                estimateUsd: item.estimateUsd,
              },
            }
          : {}),
      });
    } else if (item.standIn) {
      gaps.push({
        id: `standin-${item.id}`,
        title: item.name,
        subtitle: `${item.place.page} · currently borrowing stand-in "${item.standIn.name ?? item.standIn.id}" (${item.id})`,
        category: 'Using Stand-In',
        badge: `Stand-in: ${item.standIn.name ?? item.standIn.id}`,
        badgeClass: 'standin',
        studioHref: tabHref,
        thumbUrl: item.url,
        standInUrl: item.standIn.url,
        standInName: item.standIn.name ?? item.standIn.id,
        ...(item.repaintable
          ? {
              queueEntry: {
                kind: 'paint',
                targetId: item.id,
                label: `Paint dedicated icon for ${item.name} (replace stand-in ${item.standIn.id})`,
                category: 'Using Stand-In',
                estimateUsd: item.estimateUsd,
              },
            }
          : {}),
      });
    }

    if (item.check && !item.check.pass) {
      gaps.push({
        id: `flagged-${item.id}`,
        title: item.name,
        subtitle: `Failed style check after ${item.check.tries} tries: ${item.check.why ?? 'style mismatch'}`,
        category: 'Style-Flagged',
        badge: 'Style Flagged',
        badgeClass: 'flagged',
        studioHref: tabHref,
        thumbUrl: item.url,
        ...(item.repaintable
          ? {
              queueEntry: {
                kind: 'paint',
                targetId: item.id,
                label: `Repaint flagged ${item.name}`,
                category: 'Style-Flagged',
                estimateUsd: item.estimateUsd,
              },
            }
          : {}),
      });
    }

    // Held item missing grip point
    if (item.url && item.place.tab === 'items' && HOLDABLE.includes(item.place.page) && !artState.points[item.id]?.grip) {
      gaps.push({
        id: `grip-${item.id}`,
        title: `${item.name} (Grip point)`,
        subtitle: `${item.place.page} · held item has no grip point in art-points.json`,
        category: 'Missing Hands & Grips',
        badge: 'Missing Grip',
        badgeClass: 'hands',
        studioHref: go('items', item.place.page),
        thumbUrl: item.url,
        handsFindIds: [item.id],
      });
    }
  }

  // 2. Walkers: missing 4-way standing turnarounds, walk clips, run/attack strips, and hand points
  for (const w of data.walkers) {
    const entityHref = `${go('entities', w.place.page)}?walker=${encodeURIComponent(w.id)}`;
    const missingWays = ISO_WAYS.filter((d) => !w.standing[d]?.url);
    if (missingWays.length > 0) {
      gaps.push({
        id: `ways-${w.id}`,
        title: `${w.name} (4-Way Turnaround)`,
        subtitle: `${w.kind} · missing ${missingWays.length} of 4 isometric standing views (${missingWays.join(', ')})`,
        category: 'Missing 4-Way Views',
        badge: `${4 - missingWays.length}/4 Views`,
        badgeClass: 'missing',
        studioHref: entityHref,
        thumbUrl: w.url,
        queueEntry: {
          kind: 'ways',
          targetId: w.id,
          label: `Paint 4-way turnaround for ${w.name}`,
          category: 'Missing 4-Way Views',
          estimateUsd: w.viewUsd,
        },
      });
    }

    for (const [d, dirLabel] of WAYS) {
      if (w.standing[d]?.url && !w.walks[d]) {
        gaps.push({
          id: `walk-${w.id}-${d}`,
          title: `${w.name} · Walk (${dirLabel})`,
          subtitle: `${w.kind} · standing view ready, walk clip not generated yet`,
          category: 'Missing Walk Clips',
          badge: 'No Walk Clip',
          badgeClass: 'missing',
          studioHref: entityHref,
          thumbUrl: w.standing[d].url,
          queueEntry: {
            kind: 'clip',
            targetId: w.id,
            direction: d,
            body: w.body ?? 'two-legged',
            label: `Walk clip: ${w.name} (${dirLabel})`,
            category: 'Missing Walk Clips',
            estimateUsd: w.clipUsd,
          },
        });
      }

      // Check hands on existing walk/run/attack strips
      for (const [prop, noun, label] of [
        ['walks', 'walk', 'Walk'],
        ['runs', 'run', 'Run'],
        ['attacks', 'attack', 'Attack'],
      ] as const) {
        const strip = w[prop]?.[d];
        if (!strip) continue;
        const artId = `${w.id}-${noun}-${d}`;
        const pts = artState.points[artId];
        if (!pts?.hands || !pts?.leftHands) {
          gaps.push({
            id: `hands-${artId}`,
            title: `${w.name} · ${label} (${dirLabel}) Hands`,
            subtitle: !pts?.hands ? 'Neither hand located yet' : 'Left hand not located yet',
            category: 'Missing Hands & Grips',
            badge: !pts?.hands ? 'No Hands' : 'No Left Hand',
            badgeClass: 'hands',
            studioHref: entityHref,
            thumbUrl: w.standing[d]?.url ?? w.url,
            handsFindIds: [artId],
          });
        }
      }

      // Standing view hand check
      if (w.standing[d]?.url) {
        const standId = walkStandArt(w.id, d);
        const pts = artState.points[standId];
        if (!pts?.hands) {
          gaps.push({
            id: `hands-${standId}`,
            title: `${w.name} · Standing (${dirLabel}) Hands`,
            subtitle: 'Standing turnaround view has no hand points yet',
            category: 'Missing Hands & Grips',
            badge: 'No Standing Hands',
            badgeClass: 'hands',
            studioHref: entityHref,
            thumbUrl: w.standing[d].url,
            handsFindIds: [standId],
          });
        }
      }
    }
  }

  // 3. Building Kit texture sheets
  for (const sheet of data.sheets ?? []) {
    const failing = sheet.textures.filter((t) => !t.ok);
    if (failing.length > 0) {
      gaps.push({
        id: `sheet-${sheet.look}`,
        title: `${sheet.name} (Building Kit Sheet)`,
        subtitle: `${failing.length} of ${sheet.textures.length} textures missing or failing (${failing.map((f) => f.name).join(', ')})`,
        category: 'Building Kit Textures',
        badge: `${failing.length} Failing`,
        badgeClass: 'flagged',
        studioHref: go('looks'),
        queueEntry: {
          kind: 'sheet',
          targetId: sheet.look,
          label: `Paint building kit sheet: ${sheet.name}`,
          category: 'Building Kit Textures',
          estimateUsd: data.items[0]?.estimateUsd ?? 0.04,
        },
      });
    }
  }

  // 4. Sounds & Music
  for (const s of data.sounds) {
    if (!s.url) {
      gaps.push({
        id: `sound-${s.id}`,
        title: s.name,
        subtitle: `${s.kind === 'music' ? 'Region Music Track' : 'Sound Effect'} · not generated yet`,
        category: 'Sounds & Music',
        badge: 'Missing Audio',
        badgeClass: 'missing',
        studioHref: go('sounds'),
        ...(s.makeable
          ? {
              queueEntry: {
                kind: 'sound',
                targetId: s.id,
                label: `Generate ${s.kind}: ${s.name}`,
                category: 'Sounds & Music',
                estimateUsd: s.estimateUsd,
              },
            }
          : {}),
      });
    }
  }

  return gaps;
}

const CATEGORIES = [
  'All',
  'Using Stand-In',
  'Missing Pictures',
  'HUD & Skill FX',
  'Missing 4-Way Views',
  'Missing Walk Clips',
  'Missing Hands & Grips',
  'Building Kit Textures',
  'Sounds & Music',
  'Style-Flagged',
] as const;

export function missingPage(selectedCategory?: string): string {
  const gaps = collectMissingGaps();
  const activeCat = selectedCategory && CATEGORIES.includes(selectedCategory as (typeof CATEGORIES)[number]) ? selectedCategory : 'All';
  const filtered = activeCat === 'All' ? gaps : gaps.filter((g) => g.category === activeCat);

  const counts = new Map<string, number>();
  counts.set('All', gaps.length);
  for (const c of CATEGORIES.slice(1)) {
    counts.set(c, gaps.filter((g) => g.category === c).length);
  }

  const queueableInView = filtered.map((g) => g.queueEntry).filter((e): e is NonNullable<MissingGapItem['queueEntry']> => !!e);
  const totalViewUsd = queueableInView.reduce((s, e) => s + e.estimateUsd, 0);
  const handsInView = filtered.flatMap((g) => g.handsFindIds ?? []);

  const grouped = new Map<string, MissingGapItem[]>();
  for (const g of filtered) {
    const list = grouped.get(g.category) ?? [];
    list.push(g);
    grouped.set(g.category, list);
  }

  const renderGroup = (cat: string, items: MissingGapItem[]) => {
    const catQueue = items.map((i) => i.queueEntry).filter((e): e is NonNullable<MissingGapItem['queueEntry']> => !!e);
    const catUsd = catQueue.reduce((s, e) => s + e.estimateUsd, 0);
    const catHands = items.flatMap((i) => i.handsFindIds ?? []);
    return `
      <section class="missing-group">
        <div class="studio-split-header">
          <h3>${esc(cat)} <span class="count-pill">${items.length}</span></h3>
          <div class="card-actions">
            ${
              catQueue.length
                ? `<button type="button" class="quiet" data-missing-queue-batch="${esc(JSON.stringify(catQueue))}">+ Queue All ${catQueue.length} in ${esc(cat)} (about ${usd(catUsd)})</button>`
                : ''
            }
            ${
              catHands.length
                ? `<button type="button" class="quiet" data-hands-find="${esc(JSON.stringify({ ids: catHands }))}">🔍 Find All ${catHands.length} Hands/Grips</button>`
                : ''
            }
          </div>
        </div>
        <div class="missing-list">
          ${items
            .map(
              (item) => `
            <div class="missing-card ${item.badgeClass}">
              <div class="missing-thumb">
                ${
                  item.thumbUrl
                    ? `<img src="${esc(item.thumbUrl)}" alt="" loading="lazy">`
                    : '<span class="ph">?</span>'
                }
              </div>
              <div class="missing-info">
                <div class="missing-title-row">
                  <b>${esc(item.title)}</b>
                  <span class="badge-pill ${item.badgeClass}">${esc(item.badge)}</span>
                </div>
                <small class="note">${esc(item.subtitle)}</small>
              </div>
              <div class="card-actions">
                <a class="button quiet" href="${esc(item.studioHref)}" data-art-go>Open in Studio →</a>
                ${item.queueEntry ? queueButtonHtml(item.queueEntry, `+ Queue (${usd(item.queueEntry.estimateUsd)})`) : ''}
                ${
                  item.handsFindIds?.length
                    ? `<button type="button" class="quiet" data-hands-find="${esc(JSON.stringify({ ids: item.handsFindIds }))}">Find Hands/Grip</button>`
                    : ''
                }
              </div>
            </div>`,
            )
            .join('')}
        </div>
      </section>`;
  };

  return `
    <div class="studio-split-header">
      <div>
        <h2>Missing &amp; Stand-In Art Navigator</h2>
        <p class="note">Every unshipped sprite, shared stand-in icon (materials, Craft Tools, Gathering Spots, Regional Garments, Boss Uniques), missing 4-way view, walk clip, hand/grip coordinate, HUD status icon, and sound effect in one place.</p>
      </div>
      <div class="card-actions">
        ${
          queueableInView.length
            ? `<button type="button" data-missing-queue-batch="${esc(JSON.stringify(queueableInView))}">+ Queue All ${queueableInView.length} Shown · about ${usd(totalViewUsd)}</button>`
            : ''
        }
        ${
          handsInView.length
            ? `<button type="button" class="quiet" data-hands-find="${esc(JSON.stringify({ ids: handsInView }))}">🔍 Find All ${handsInView.length} Missing Hands/Grips</button>`
            : ''
        }
      </div>
    </div>
    <div class="stats missing-stats">
      <div class="stat"><b>${counts.get('Using Stand-In') ?? 0}</b><span>Using Stand-In Art</span></div>
      <div class="stat"><b>${(counts.get('Missing Pictures') ?? 0) + (counts.get('HUD & Skill FX') ?? 0)}</b><span>Missing Pictures &amp; FX</span></div>
      <div class="stat"><b>${(counts.get('Missing 4-Way Views') ?? 0) + (counts.get('Missing Walk Clips') ?? 0)}</b><span>Missing Views &amp; Clips</span></div>
      <div class="stat"><b>${counts.get('Missing Hands & Grips') ?? 0}</b><span>Missing Hands / Grips</span></div>
      <div class="stat"><b>${counts.get('Sounds & Music') ?? 0}</b><span>Missing Sounds</span></div>
    </div>
    <nav class="pages">
      ${CATEGORIES.map(
        (c) =>
          `<a href="${go('missing', c)}" data-art-go${c === activeCat ? ' aria-current="page"' : ''}>${esc(c)} <span class="count-inline">(${counts.get(c) ?? 0})</span></a>`,
      ).join('')}
    </nav>
    ${
      filtered.length
        ? [...grouped.entries()].map(([cat, list]) => renderGroup(cat, list)).join('')
        : '<p class="note ok">Everything in this category is painted and ready!</p>'
    }`;
}

export function handleMissingClick(t: HTMLButtonElement): boolean {
  if (t.dataset.missingQueueBatch !== undefined) {
    const items = JSON.parse(t.dataset.missingQueueBatch) as NonNullable<MissingGapItem['queueEntry']>[];
    if (!items.length) return true;
    t.disabled = true;
    void artState.ctx.api<UpNextState>('art/queue', 'POST', { action: 'add', items }).then(
      (state) => {
        artState.upNext = state;
        artState.ctx.toast(`Queued ${items.length} items in Up Next.`);
        artState.ctx.rerender();
      },
      (err: Error) => {
        t.disabled = false;
        artState.ctx.toast(err.message);
      },
    );
    return true;
  }
  return false;
}
