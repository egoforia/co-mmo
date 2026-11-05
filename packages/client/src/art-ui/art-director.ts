// The AI Art Director Tab (#art-director) & Inline Co-Pilot:
// - Living Style Bible (Faceted Low-Poly Aesthetic, Negative Guardrails, 6+4 Biome Palettes, 6 Region Fashion Styles)
// - Golden Reference Anchors per category with live sprite previews
// - Pre-Paint Prompt Harmonizer & Reference Selector
// - 5-Point Multimodal Coherence Audit & Side-by-Side "Coherence Wall"
// - Interactive Art Director Consultation

import type { Facing } from '@co-mmo/shared';
import { openReview } from './dialogs.ts';
import {
  type DeniedWalkClip,
  type UpNextState,
  type WalkerView,
  artState,
  esc,
  usd,
  when,
} from './state.ts';

export interface CoherenceScore {
  asset: string;
  at?: number;
  auditedAt?: number;
  score: number;
  status: 'coherent' | 'minor-drift' | 'off-style';
  rubric?: {
    facets: number;
    palette: number;
    projection: number;
    scale: number;
    silhouette: number;
  };
  dimensions?: {
    facets: number;
    palette: number;
    isometric: number;
    scale: number;
    silhouette: number;
  };
  findings?: string[];
  suggestedNote?: string;
  correctiveNote?: string;
}

export type ConsultationItem =
  | { id?: string; at: number; question: string; answer: string; usd?: number }
  | { role: 'user' | 'director'; text: string; at: number; references?: string[]; suggestedNote?: string };

export interface StyleDirectorOverview {
  version: string;
  basePrompt: string;
  negatives: string[];
  biomes: Record<string, { name: string; colors: string[]; mood: string; anchors: string[] }>;
  fashionStyles: Record<string, { name: string; region?: string; biome?: string; colors: string[]; feel: string; anchors: string[] }>;
  goldenAnchors: Record<string, string[]>;
  audits: Record<string, CoherenceScore>;
  consultations: ConsultationItem[];
  overallScore: number;
  auditedCount: number;
  flaggedCount: number;
}

function normalizeRubric(audit: CoherenceScore): {
  facets: number;
  palette: number;
  projection: number;
  scale: number;
  silhouette: number;
} {
  if (audit.rubric) {
    return {
      facets: audit.rubric.facets ?? 0,
      palette: audit.rubric.palette ?? 0,
      projection: audit.rubric.projection ?? 0,
      scale: audit.rubric.scale ?? 0,
      silhouette: audit.rubric.silhouette ?? 0,
    };
  }
  if (audit.dimensions) {
    return {
      facets: (audit.dimensions.facets ?? 0) * 5,
      palette: (audit.dimensions.palette ?? 0) * 5,
      projection: (audit.dimensions.isometric ?? 0) * 5,
      scale: (audit.dimensions.scale ?? 0) * 5,
      silhouette: (audit.dimensions.silhouette ?? 0) * 5,
    };
  }
  return { facets: 0, palette: 0, projection: 0, scale: 0, silhouette: 0 };
}

function normalizeConsultations(list: ConsultationItem[] | undefined): {
  at: number;
  question: string;
  answer: string;
  usd?: number;
}[] {
  if (!Array.isArray(list) || !list.length) return [];
  const out: { at: number; question: string; answer: string; usd?: number }[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i]!;
    if ('question' in item && 'answer' in item) {
      out.push({ at: item.at, question: item.question, answer: item.answer, usd: item.usd });
    } else if ('role' in item && item.role === 'user') {
      const next = list[i + 1];
      const answer = next && 'role' in next && next.role === 'director' ? next.text : '';
      out.push({ at: item.at, question: item.text, answer });
      if (answer) i++;
    } else if ('role' in item && item.role === 'director') {
      out.push({ at: item.at, question: 'Style Consultation', answer: item.text });
    }
  }
  return out;
}

let directorState: StyleDirectorOverview | null = null;
let wallFilter = 'all';
let lastHarmonized: {
  asset?: string;
  harmonizedNote: string;
  harmonizedPrompt: string;
  references: string[];
  checklist: { facets: boolean; palette: boolean; isometric: boolean; scale: boolean; negatives: boolean };
  usd: number;
} | null = null;

export async function loadArtDirector(): Promise<StyleDirectorOverview> {
  directorState = await artState.ctx.api<StyleDirectorOverview>('art/director');
  return directorState;
}

function findAssetThumb(id: string): { name: string; url?: string } {
  const item = artState.data?.items.find((i) => i.id === id);
  if (item) return { name: item.name, url: item.url };
  const walker = artState.data?.walkers.find((w) => w.id === id);
  if (walker) return { name: walker.name, url: walker.url };
  return { name: id };
}

export function artDirectorPage(): string {
  const d = directorState;
  if (!d) return '<p class="note">Loading AI Art Director…</p>';
  const data = artState.data!;

  // Assets for Coherence Wall
  const paintedItems = data.items.filter((i) => i.url);
  const filteredWall = paintedItems.filter((i) => {
    if (wallFilter === 'all') return true;
    if (wallFilter === 'flagged') {
      const a = d.audits[i.id];
      return (a && a.status !== 'coherent') || (i.check && !i.check.pass);
    }
    if (wallFilter === 'hud') return i.place.tab === 'hud';
    return i.place.tab === wallFilter || i.biome === wallFilter || i.fashionStyle === wallFilter;
  });

  const auditTargets = filteredWall.slice(0, 12).map((i) => i.id);

  const renderAnchorChips = (ids: string[]) =>
    ids
      .map((id) => {
        const a = findAssetThumb(id);
        return `<span class="anchor-chip" title="${esc(id)}">${a.url ? `<img src="${esc(a.url)}" alt="">` : ''}<code>${esc(a.name)}</code></span>`;
      })
      .join('');

  return `
    <div class="studio-split-header">
      <div>
        <h2>✦ AI Art Director · Style Coherence &amp; Living Style Bible</h2>
        <p class="note">Keeps all characters, monsters, NPCs, regional garments, craft tools, biome props, buildings, and HUD FX unified under the game's faceted low-poly 2:1 isometric aesthetic.</p>
      </div>
      <div class="stats director-stats">
        <div class="stat"><b>${d.overallScore}/100</b><span>Coherence Score</span></div>
        <div class="stat"><b>${d.auditedCount}</b><span>Audited Sprites</span></div>
        <div class="stat ${d.flaggedCount ? 'warn' : ''}"><b>${d.flaggedCount}</b><span>Drift / Off-Style</span></div>
      </div>
    </div>

    ${(() => {
      const deniedWalksList: { walker: WalkerView; direction: Facing; denied: DeniedWalkClip }[] = [];
      for (const w of data.walkers) {
        if (w.denied) {
          for (const [dir, denied] of Object.entries(w.denied)) {
            if (denied) deniedWalksList.push({ walker: w, direction: dir as Facing, denied });
          }
        }
      }
      if (!deniedWalksList.length) return '';
      return `
        <section class="studio-card" style="border-left: 4px solid var(--bad, #d9534f); margin-bottom: 20px;">
          <div class="studio-split-header">
            <div>
              <h3 style="color: var(--bad, #d9534f); margin: 0;">⚠️ Flagged / Denied Walk Animations (${deniedWalksList.length})</h3>
              <p class="note">These walk animations were generated by the video model but held back by automated consistency checks. You can inspect the video clip and review findings, then choose whether to approve anyway into the game or work with the AI Art Director to repaint with corrective guidance.</p>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; margin-top: 12px;">
            ${deniedWalksList
              .map(
                ({ walker, direction, denied }) => `
              <div style="padding: 12px; border: 1px solid var(--rim, #444); border-radius: 6px; background: rgba(0, 0, 0, 0.2);">
                <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                  <b>${esc(walker.name)}</b>
                  <small class="tag-pill">${esc(direction)}</small>
                </div>
                <p style="font-size: 12px; color: var(--bad, #d9534f); margin: 4px 0 8px;">${esc(denied.problems[0] ?? denied.reason ?? 'Failed consistency check')}</p>
                <button type="button" class="quiet" data-review-denied="${esc(JSON.stringify({ walker: walker.id, direction }))}" style="font-size: 12px;">Review Video &amp; Decide →</button>
              </div>`,
              )
              .join('')}
          </div>
        </section>`;
    })()}

    <div class="director-grid">
      <!-- Left Column: Pre-Paint Harmonizer + Director Consultation -->
      <section class="studio-card">
        <h3>✦ Pre-Paint Prompt Harmonizer &amp; Reference Selector</h3>
        <p class="note">Turn any rough idea or repaint note into a Style-Bible-compliant prompt with automatically selected Golden Reference Anchors.</p>
        <form id="director-harmonize-form" class="form">
          <label>Target Asset (optional)
            <span>
              <select name="asset">
                <option value="">Custom / New Asset Brief</option>
                ${data.items.map((i) => `<option value="${esc(i.id)}"${lastHarmonized?.asset === i.id ? ' selected' : ''}>${esc(i.name)} (${esc(i.id)})</option>`).join('')}
              </select>
            </span>
          </label>
          <div class="cols-2">
            <label>Biome Palette
              <span>
                <select name="biome">
                  <option value="">Auto from asset</option>
                  ${Object.entries(d.biomes).map(([id, b]) => `<option value="${esc(id)}">${esc(b.name)}</option>`).join('')}
                </select>
              </span>
            </label>
            <label>Region Fashion Style
              <span>
                <select name="fashionStyle">
                  <option value="">None / Auto</option>
                  ${Object.entries(d.fashionStyles).map(([id, f]) => `<option value="${esc(id)}">${esc(f.name)} (${esc(f.region ?? f.biome ?? '')})</option>`).join('')}
                </select>
              </span>
            </label>
          </div>
          <label>Rough Note or Visual Idea
            <span><textarea name="note" rows="3" placeholder="e.g. Frostpeak lantern-staff with pale blue rime crystal and warm amber core">${esc(lastHarmonized?.harmonizedNote ?? '')}</textarea></span>
          </label>
          <div class="card-actions">
            <button type="submit">✦ Harmonize with Art Director</button>
            ${
              lastHarmonized?.asset
                ? `<button type="button" class="quiet" data-director-paint="${esc(lastHarmonized.asset)}" data-director-note="${esc(lastHarmonized.harmonizedNote)}">Review &amp; Paint with Harmonized Brief</button>`
                : ''
            }
          </div>
        </form>
        ${
          lastHarmonized
            ? `<div class="harmonized-box">
                <div class="checklist-row">
                  <span class="check-pill ${lastHarmonized.checklist?.facets ? 'ok' : ''}">✓ Unlit Facets</span>
                  <span class="check-pill ${lastHarmonized.checklist?.palette ? 'ok' : ''}">✓ Biome/Fashion Palette</span>
                  <span class="check-pill ${lastHarmonized.checklist?.isometric ? 'ok' : ''}">✓ 2:1 Isometric</span>
                  <span class="check-pill ${lastHarmonized.checklist?.scale ? 'ok' : ''}">✓ Height-Tier Scale</span>
                  <span class="check-pill ${lastHarmonized.checklist?.negatives ? 'ok' : ''}">✓ Negative Guardrails</span>
                </div>
                <p><small>Selected Golden Reference Anchors:</small> ${renderAnchorChips(lastHarmonized.references ?? [])}</p>
                <pre class="prompt">${esc(lastHarmonized.harmonizedPrompt)}</pre>
              </div>`
            : ''
        }

        <h3>Consult the AI Art Director</h3>
        <form id="director-consult-form" class="form">
          <label>Ask about palette unity, silhouette contrast, or visual direction
            <span>
              <input name="question" placeholder="How should Sporeweave garments contrast against Mushroom Hollow's violet moss?" />
              <button type="submit" class="quiet">Ask Director</button>
            </span>
          </label>
        </form>
        ${(() => {
          const pairs = normalizeConsultations(d.consultations);
          return pairs.length
            ? `<div class="consult-list">
                ${[...pairs]
                  .reverse()
                  .slice(0, 4)
                  .map(
                    (c) => `
                  <div class="consult-item">
                    <small>${when(c.at)}${c.usd !== undefined ? ` · ${usd(c.usd)}` : ''}</small>
                    <p><b>Q:</b> ${esc(c.question)}</p>
                    <p class="director-answer"><b>Director:</b> ${esc(c.answer)}</p>
                  </div>`,
                  )
                  .join('')}
              </div>`
            : '';
        })()}
      </section>

      <!-- Right Column: Living Style Bible & Palettes -->
      <section class="studio-card">
        <h3>Living Style Bible &amp; Negative Guardrails (v${esc(d.version)})</h3>
        <form id="director-bible-form" class="form">
          <label>Core Low-Poly Faceted Style Mandate
            <span><textarea name="basePrompt" rows="4">${esc(d.basePrompt)}</textarea></span>
          </label>
          <label>Negative Prompt Guardrails (comma-separated)
            <span><input name="negatives" value="${esc((d.negatives ?? []).join(', '))}" /></span>
          </label>
          <button type="submit" class="quiet">Save Style Bible</button>
        </form>

        <h3>6 Region Fashion Styles (Garments &amp; Equipment)</h3>
        <div class="palette-grid">
          ${Object.entries(d.fashionStyles)
            .map(
              ([id, f]) => `
            <div class="palette-card">
              <div class="palette-head">
                <b>${esc(f.name)}</b> <small>${esc(f.region ?? f.biome ?? '')}</small>
              </div>
              <div class="swatches">
                ${(f.colors ?? []).map((c) => `<span class="swatch" style="background:${esc(c)}" title="${esc(c)}"></span>`).join('')}
              </div>
              <small class="note">${esc(f.feel)}</small>
              <div class="anchor-row">${renderAnchorChips(f.anchors ?? [])}</div>
              <button type="button" class="quiet mini-btn" data-director-filter="${esc(id)}">Inspect on Wall</button>
            </div>`,
            )
            .join('')}
        </div>

        <h3>Biome Palettes &amp; Golden Anchors</h3>
        <div class="palette-grid">
          ${Object.entries(d.biomes)
            .map(
              ([id, b]) => `
            <div class="palette-card">
              <div class="palette-head">
                <b>${esc(b.name)}</b> <small><code>${esc(id)}</code></small>
              </div>
              <div class="swatches">
                ${b.colors.map((c) => `<span class="swatch" style="background:${esc(c)}" title="${esc(c)}"></span>`).join('')}
              </div>
              <small class="note">${esc(b.mood)}</small>
              <div class="anchor-row">${renderAnchorChips(b.anchors)}</div>
              <button type="button" class="quiet mini-btn" data-director-filter="${esc(id)}">Inspect on Wall</button>
            </div>`,
            )
            .join('')}
        </div>
      </section>
    </div>

    <!-- Coherence Wall & 5-Point Multimodal Audit -->
    <section class="studio-card coherence-wall-section">
      <div class="studio-split-header">
        <div>
          <h3>Coherence Wall &amp; 5-Point Style Audit</h3>
          <p class="note">Inspect sprites side-by-side on a neutral studio ground. Each audit scores 5 dimensions (0–20 each): <b>Unlit Facets</b>, <b>Palette Harmony</b>, <b>2:1 Isometric</b>, <b>Height-Tier Scale</b>, and <b>Silhouette Clarity</b>.</p>
        </div>
        <div class="card-actions">
          <button type="button" data-director-audit="${esc(JSON.stringify(auditTargets))}"${auditTargets.length ? '' : ' disabled'}>
            🔍 Audit ${auditTargets.length} Shown Sprites
          </button>
        </div>
      </div>

      <nav class="pages">
        ${[
          ['all', 'All Painted'],
          ['flagged', 'Drift / Flagged'],
          ['characters', 'Characters'],
          ['monsters', 'Monsters'],
          ['items', 'Items'],
          ['biomes', 'Biomes & Props'],
          ['hud', 'HUD & Skill FX'],
          ['frostpeak', 'Frostpeak'],
          ['mushroom-hollow', 'Mushroom Hollow'],
        ]
          .map(
            ([id, label]) =>
              `<button type="button" class="quiet${wallFilter === id ? ' active-pill' : ''}" data-director-filter="${esc(id)}">${esc(label)}</button>`,
          )
          .join('')}
      </nav>

      <div class="coherence-wall">
        ${filteredWall
          .slice(0, 48)
          .map((item) => {
            const audit = d.audits[item.id];
            const r = audit ? normalizeRubric(audit) : undefined;
            const note = audit?.suggestedNote ?? audit?.correctiveNote;
            const scoreBadge = audit
              ? `<span class="coherence-badge ${audit.status}">${audit.score}/100 · ${audit.status}</span>`
              : '<span class="coherence-badge unaudited">Not audited yet</span>';
            return `
              <div class="wall-tile ${audit?.status ?? ''}">
                <div class="wall-canvas">
                  <img src="${esc(item.url!)}" alt="${esc(item.name)}" loading="lazy">
                </div>
                <div class="wall-meta">
                  <b>${esc(item.name)}</b>
                  ${scoreBadge}
                  ${
                    audit && r
                      ? `<div class="dim-bars" title="Facets ${r.facets}/100 · Palette ${r.palette}/100 · Iso ${r.projection}/100 · Scale ${r.scale}/100 · Silhouette ${r.silhouette}/100">
                          <span style="width:${r.facets}%"></span>
                          <span style="width:${r.palette}%"></span>
                          <span style="width:${r.projection}%"></span>
                          <span style="width:${r.scale}%"></span>
                          <span style="width:${r.silhouette}%"></span>
                        </div>
                        <small class="note">${esc((audit.findings ?? []).join(' · '))}</small>`
                      : `<small class="note">${esc(item.place.page)}${item.fashionStyle ? ` · ${esc(item.fashionStyle)}` : ''}</small>`
                  }
                  <div class="card-actions">
                    <button type="button" class="quiet" data-director-audit="${esc(JSON.stringify([item.id]))}">Audit</button>
                    ${
                      note && item.repaintable
                        ? `<button type="button" class="quiet warn-btn" data-director-fix="${esc(item.id)}" data-director-note="${esc(note)}">+ Queue Fix</button>`
                        : ''
                    }
                  </div>
                </div>
              </div>`;
          })
          .join('')}
      </div>
    </section>`;
}

export function handleDirectorClick(t: HTMLButtonElement): boolean {
  if (t.dataset.directorFilter !== undefined) {
    wallFilter = t.dataset.directorFilter;
    artState.ctx.rerender();
    return true;
  }

  if (t.dataset.directorAudit !== undefined) {
    const assets = JSON.parse(t.dataset.directorAudit) as string[];
    if (!assets.length) return true;
    t.disabled = true;
    t.textContent = 'Auditing…';
    void artState.ctx.api('art/director', 'POST', { action: 'audit', assets }).then(
      async () => {
        await loadArtDirector();
        artState.ctx.toast(`Audited ${assets.length} sprite${assets.length === 1 ? '' : 's'}.`);
        artState.ctx.rerender();
      },
      (err: Error) => {
        t.disabled = false;
        t.textContent = 'Audit';
        artState.ctx.toast(err.message);
      },
    );
    return true;
  }

  if (t.dataset.directorPaint !== undefined) {
    const asset = t.dataset.directorPaint;
    const note = t.dataset.directorNote ?? '';
    void openReview({ what: 'paint', asset }, true, note);
    return true;
  }

  if (t.dataset.directorFix !== undefined) {
    const asset = t.dataset.directorFix;
    const note = t.dataset.directorNote ?? '';
    const item = artState.data?.items.find((i) => i.id === asset);
    t.disabled = true;
    void artState.ctx
      .api<UpNextState>('art/queue', 'POST', {
        action: 'add',
        items: [
          {
            kind: 'paint',
            targetId: asset,
            label: `Corrective Repaint: ${item?.name ?? asset}`,
            category: 'Art Director Fix',
            note,
            estimateUsd: item?.estimateUsd ?? 0.04,
          },
        ],
      })
      .then(
        (state) => {
          artState.upNext = state;
          t.textContent = '✓ Queued Fix';
          artState.ctx.toast(`Queued corrective repaint for ${item?.name ?? asset}.`);
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

export function handleDirectorSubmit(form: HTMLFormElement): boolean {
  if (form.id === 'director-harmonize-form') {
    const fd = new FormData(form);
    const asset = String(fd.get('asset') ?? '').trim() || undefined;
    const biome = String(fd.get('biome') ?? '').trim() || undefined;
    const fashionStyle = String(fd.get('fashionStyle') ?? '').trim() || undefined;
    const note = String(fd.get('note') ?? '').trim() || undefined;
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '✦ Harmonizing…';
    }
    void artState.ctx
      .api<{
        harmonizedNote: string;
        harmonizedPrompt: string;
        references: string[];
        checklist: { facets: boolean; palette: boolean; isometric: boolean; scale: boolean; negatives: boolean };
        usd: number;
      }>('art/director', 'POST', { action: 'harmonize', asset, biome, fashionStyle, note })
      .then(
        (res) => {
          lastHarmonized = { asset, ...res };
          artState.ctx.toast('Brief harmonized with Style Bible & Golden Anchors.');
          artState.ctx.rerender();
        },
        (err: Error) => {
          if (btn) {
            btn.disabled = false;
            btn.textContent = '✦ Harmonize with Art Director';
          }
          artState.ctx.toast(err.message);
        },
      );
    return true;
  }

  if (form.id === 'director-consult-form') {
    const question = String(new FormData(form).get('question') ?? '').trim();
    if (!question) return true;
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Asking…';
    }
    void artState.ctx.api('art/director', 'POST', { action: 'consult', question }).then(
      async () => {
        await loadArtDirector();
        artState.ctx.rerender();
      },
      (err: Error) => {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Ask Director';
        }
        artState.ctx.toast(err.message);
      },
    );
    return true;
  }

  if (form.id === 'director-bible-form') {
    const fd = new FormData(form);
    const basePrompt = String(fd.get('basePrompt') ?? '').trim();
    const negatives = String(fd.get('negatives') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    void artState.ctx.api('art/director', 'POST', { action: 'update-bible', basePrompt, negatives }).then(
      async () => {
        await loadArtDirector();
        artState.ctx.toast('Saved Living Style Bible.');
        artState.ctx.rerender();
      },
      (err: Error) => artState.ctx.toast(err.message),
    );
    return true;
  }

  return false;
}
