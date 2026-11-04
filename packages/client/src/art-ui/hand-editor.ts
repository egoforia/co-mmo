// Interactive Frame-by-Frame Hand & Grip Workbench (hand-editor.ts):
// - Magnified interactive frame canvas with click/drag placement for Right (R) and Left (L) hands
// - Onion-skinning (f-1 / f+1), hand trajectory curve across all frames, and height-tier scale ruler
// - Single-frame & full-strip mirroring across facings (front-left ↔ front-right, back-left ↔ back-right)
// - Copy from previous frame (f-1) & linear interpolation across missing frames
// - Live dual-hand item & Craft Tool try-on with inline item grip [gx, gy] calibration

import {
  ANIMATION_KINDS,
  HELD_SIZE,
  TURNED,
  animationArt,
  facingSide,
  heldBehind,
  type AnimationKind,
  type ArtPoint,
  type Facing,
  type IsoWay,
} from '@co-mmo/shared';
import {
  HOLDABLE,
  WAYS,
  type ArtItem,
  type WalkStrip,
  type WalkerView,
  artState,
  esc,
} from './state.ts';

export interface HandWorkbenchState {
  walkerId: string;
  animKind: AnimationKind;
  facing: IsoWay;
  frame: number;
  activeSide: 'right' | 'left';
  onionSkin: boolean;
  showTrajectory: boolean;
  showRuler: boolean;
  playing: boolean;
  fps: number;
  calibratingItemSide: 'right' | 'left' | null;
}

const workbenchByWalker = new Map<string, HandWorkbenchState>();

export function getWorkbenchState(w: WalkerView): HandWorkbenchState {
  let st = workbenchByWalker.get(w.id);
  if (!st) {
    st = {
      walkerId: w.id,
      animKind: 'walk',
      facing: 'front-left',
      frame: 0,
      activeSide: 'right',
      onionSkin: true,
      showTrajectory: true,
      showRuler: false,
      playing: true,
      fps: 8,
      calibratingItemSide: null,
    };
    workbenchByWalker.set(w.id, st);
  }
  return st;
}

export function getStripForKind(w: WalkerView, kind: AnimationKind, facing: Facing): WalkStrip | undefined {
  if (kind === 'walk') return w.walks[facing];
  if (kind === 'run') return w.runs?.[facing];
  if (kind === 'attack') return w.attacks?.[facing];
  return undefined;
}

export function holdableItems(): ArtItem[] {
  return (artState.data?.items ?? []).filter((i) => i.url && i.place.tab === 'items' && HOLDABLE.includes(i.place.page));
}

/** Renders the interactive Hand & Grip Workbench for a selected walker. */
export function handWorkbenchHtml(w: WalkerView): string {
  const st = getWorkbenchState(w);
  const strip = getStripForKind(w, st.animKind, st.facing);
  const artId = animationArt(w.id, st.animKind, st.facing);
  const pts = artState.points[artId];
  const frameCount = strip?.frames ?? 8;
  if (st.frame >= frameCount) st.frame = 0;

  const rightHand = pts?.hands?.[st.frame] ?? null;
  const leftHand = pts?.leftHands?.[st.frame] ?? null;

  const [turnedFacing, turnedLabel] = WAYS.find(([o]) => o === TURNED[st.facing])!;
  const turnedId = animationArt(w.id, st.animKind, turnedFacing);
  const hasTurned = !!(artState.points[turnedId]?.hands || artState.points[turnedId]?.leftHands);
  const facingLabel = WAYS.find(([o]) => o === st.facing)?.[1] ?? st.facing;

  const items = holdableItems();
  const tryOnSelect = (side: 'right' | 'left') => {
    const selectedId = artState.tryOn[side];
    return `
      <select data-try-on="${side}">
        <option value="">Nothing</option>
        ${HOLDABLE.map((page) => {
          const group = items.filter((i) => i.place.page === page);
          return group.length
            ? `<optgroup label="${esc(page)}">${group
                .map(
                  (i) =>
                    `<option value="${esc(i.id)}"${selectedId === i.id ? ' selected' : ''}>${esc(i.name)}${
                      artState.points[i.id]?.grip ? '' : ' (no grip)'
                    }</option>`,
                )
                .join('')}</optgroup>`
            : '';
        }).join('')}
      </select>`;
  };

  const calibSide = st.calibratingItemSide;
  const calibItemId = calibSide ? artState.tryOn[calibSide] : undefined;
  const calibItem = calibItemId ? items.find((i) => i.id === calibItemId) : undefined;
  const calibGrip = calibItem ? (artState.points[calibItem.id]?.grip ?? [0.5, 0.5]) : undefined;

  return `
    <section class="studio-card hand-workbench" data-wb-walker="${esc(w.id)}">
      <div class="studio-split-header">
        <div>
          <h4>✋ Interactive Frame-by-Frame Hand &amp; Grip Workbench</h4>
          <p class="note">Click or drag directly on the magnified frame canvas to place <b>Right (R)</b> or <b>Left (L)</b> hands for free, mirror single frames or full strips across facings, interpolate missing frames, and preview held weapons, shields, charms, and Craft Tools.</p>
        </div>
        <div class="wb-selectors">
          <div class="btn-group" role="group" aria-label="Animation kind">
            ${ANIMATION_KINDS.map(
              (def) =>
                `<button type="button" class="quiet${st.animKind === def.id ? ' active-pill' : ''}" data-wb-kind="${def.id}" data-wb-walker="${esc(w.id)}">${esc(def.label)}</button>`,
            ).join('')}
          </div>
          <div class="btn-group" role="group" aria-label="Facing direction">
            ${WAYS.map(
              ([d, lbl]) =>
                `<button type="button" class="quiet${st.facing === d ? ' active-pill' : ''}" data-wb-facing="${d}" data-wb-walker="${esc(w.id)}" title="${esc(lbl)}">${esc(d)}</button>`,
            ).join('')}
          </div>
        </div>
      </div>

      <!-- Dual-Hand Item & Craft Tool Try-On Bar -->
      <div class="wb-tryon-bar">
        <label>Right Hand (Weapon / Tool / Charm) ${tryOnSelect('right')}</label>
        ${
          artState.tryOn.right
            ? `<button type="button" class="quiet${st.calibratingItemSide === 'right' ? ' active-pill' : ''}" data-wb-calibrate="right" data-wb-walker="${esc(w.id)}">🎯 Calibrate Grip</button>`
            : ''
        }
        <label>Left Hand (Shield / Off-Hand / Tool) ${tryOnSelect('left')}</label>
        ${
          artState.tryOn.left
            ? `<button type="button" class="quiet${st.calibratingItemSide === 'left' ? ' active-pill' : ''}" data-wb-calibrate="left" data-wb-walker="${esc(w.id)}">🎯 Calibrate Grip</button>`
            : ''
        }
      </div>

      ${
        calibItem && calibGrip
          ? `<div class="wb-grip-calibrator">
              <div>
                <b>🎯 Grip Calibrator: ${esc(calibItem.name)}</b>
                <p class="note">Click on the item sprite to set the exact pixel where the character's hand grips it (currently <code>[${calibGrip[0].toFixed(3)}, ${calibGrip[1].toFixed(3)}]</code>).</p>
                <div class="card-actions">
                  <button type="button" class="quiet" data-hands-find="${esc(JSON.stringify({ ids: [calibItem.id] }))}">🔍 Auto-Find Grip with AI</button>
                  <button type="button" class="quiet" data-wb-calibrate="close" data-wb-walker="${esc(w.id)}">Done</button>
                </div>
              </div>
              <div class="wb-grip-box" data-wb-grip-item="${esc(calibItem.id)}" data-wb-walker="${esc(w.id)}">
                <img src="${esc(calibItem.url!)}" alt="${esc(calibItem.name)}">
                <b class="dot grip-dot" style="left:${(calibGrip[0] * 100).toFixed(1)}%;top:${(calibGrip[1] * 100).toFixed(1)}%">G</b>
              </div>
            </div>`
          : ''
      }

      ${
        !strip
          ? `<p class="note">No <b>${esc(ANIMATION_KINDS.find((d) => d.id === st.animKind)?.label ?? st.animKind)}</b> strip painted yet for <b>${esc(facingLabel)}</b>. Paint or generate the strip above to edit its frame hands.</p>`
          : `
      <div class="wb-main-grid">
        <!-- Left: Magnified Interactive Frame Canvas -->
        <div class="wb-canvas-col">
          <div class="wb-toolbar">
            <div class="btn-group">
              <button type="button" class="quiet${st.activeSide === 'right' ? ' active-pill right-pill' : ''}" data-wb-side="right" data-wb-walker="${esc(w.id)}">● Right Hand (R)</button>
              <button type="button" class="quiet${st.activeSide === 'left' ? ' active-pill left-pill' : ''}" data-wb-side="left" data-wb-walker="${esc(w.id)}">● Left Hand (L)</button>
            </div>
            <label class="check"><input type="checkbox" data-wb-toggle="onionSkin" data-wb-walker="${esc(w.id)}"${st.onionSkin ? ' checked' : ''}> Onion-skin (f±1)</label>
            <label class="check"><input type="checkbox" data-wb-toggle="showTrajectory" data-wb-walker="${esc(w.id)}"${st.showTrajectory ? ' checked' : ''}> Trajectory arc</label>
            <label class="check"><input type="checkbox" data-wb-toggle="showRuler" data-wb-walker="${esc(w.id)}"${st.showRuler ? ' checked' : ''}> Scale ruler</label>
          </div>

          <div class="wb-stage-wrap">
            <canvas class="wb-canvas" data-wb-canvas="${esc(w.id)}" width="288" height="288" title="Click or drag to place ${st.activeSide.toUpperCase()} hand on frame ${st.frame + 1}"></canvas>
            <div class="wb-live-preview-box">
              <small>Live Loop (${st.fps} fps)</small>
              <canvas class="wb-loop-canvas" data-wb-loop="${esc(w.id)}" width="144" height="144"></canvas>
              <div class="card-actions">
                <button type="button" class="quiet" data-wb-play="${esc(w.id)}">${st.playing ? '⏸ Pause' : '▶ Play'}</button>
              </div>
            </div>
          </div>

          <!-- Frame Coordinate Readout & Nudge Controls -->
          <div class="wb-coords-bar">
            <span>Frame <b>#${st.frame + 1} / ${strip.frames}</b> (${esc(artId)})</span>
            <span class="coord-pill right">R: ${rightHand ? `[${rightHand[0].toFixed(3)}, ${rightHand[1].toFixed(3)}]` : 'none'}</span>
            <span class="coord-pill left">L: ${leftHand ? `[${leftHand[0].toFixed(3)}, ${leftHand[1].toFixed(3)}]` : 'none'}</span>
            <div class="card-actions">
              <button type="button" class="quiet" data-wb-nudge="-0.01,0" data-wb-walker="${esc(w.id)}" title="Nudge left">←</button>
              <button type="button" class="quiet" data-wb-nudge="0.01,0" data-wb-walker="${esc(w.id)}" title="Nudge right">→</button>
              <button type="button" class="quiet" data-wb-nudge="0,-0.01" data-wb-walker="${esc(w.id)}" title="Nudge up">↑</button>
              <button type="button" class="quiet" data-wb-nudge="0,0.01" data-wb-walker="${esc(w.id)}" title="Nudge down">↓</button>
              <button type="button" class="quiet" data-wb-clear-hand="${esc(w.id)}">Clear ${st.activeSide === 'right' ? 'R' : 'L'} on Frame</button>
            </div>
          </div>
        </div>

        <!-- Right: Frame Operations & Mirroring Controls -->
        <div class="wb-ops-col">
          <h5>Frame #${st.frame + 1} Operations</h5>
          <div class="wb-ops-stack">
            <button type="button" class="quiet" data-wb-copy-prev="${esc(w.id)}"${st.frame === 0 ? ' disabled' : ''}>📋 Copy Hands from Frame #${st.frame} (f−1 → f)</button>
            <button type="button" class="quiet" data-wb-interpolate="${esc(w.id)}">📐 Interpolate Missing Frames in Strip</button>
            <button type="button" class="quiet" data-hands-find="${esc(JSON.stringify({ ids: [artId], frame: st.frame }))}">🔍 AI Vision Re-Find Frame #${st.frame + 1}</button>
            ${
              hasTurned
                ? `<button type="button" class="quiet" data-wb-mirror-frame="${esc(w.id)}" data-from="${esc(turnedId)}" data-to="${esc(artId)}">🪞 Mirror Frame #${st.frame + 1} from ${esc(turnedLabel)} (${esc(turnedFacing)})</button>`
                : ''
            }
          </div>

          <h5>Full Strip Operations (${esc(facingLabel)})</h5>
          <div class="wb-ops-stack">
            <button type="button" class="quiet" data-hands-find="${esc(JSON.stringify({ ids: [artId] }))}">🔍 AI Vision Find All ${strip.frames} Frames</button>
            ${
              hasTurned
                ? `<button type="button" class="quiet" data-wb-mirror-strip="${esc(w.id)}" data-from="${esc(turnedId)}" data-to="${esc(artId)}" data-from-label="${esc(turnedLabel)}" data-label="${esc(facingLabel)}">🪞 Mirror Entire Strip from ${esc(turnedLabel)} (across X)</button>`
                : `<small class="note">Find or place hands on <b>${esc(turnedLabel)}</b> first to enable free 1-click mirroring.</small>`
            }
          </div>
        </div>
      </div>

      <!-- Filmstrip Scrubber -->
      <div class="wb-filmstrip">
        ${Array.from({ length: strip.frames }, (_, i) => {
          const r = pts?.hands?.[i];
          const l = pts?.leftHands?.[i];
          const h = 88;
          const fw = Math.round((strip.width / strip.frames) * (h / strip.height));
          return `
            <button type="button" class="wb-frame-thumb${i === st.frame ? ' selected' : ''}" data-wb-frame="${i}" data-wb-walker="${esc(w.id)}" style="width:${fw}px;height:${h + 20}px">
              <div class="wb-thumb-sprite" style="width:${fw}px;height:${h}px;background-image:url('${esc(strip.url)}');background-size:${strip.frames * 100}% 100%;background-position:${strip.frames > 1 ? (i * 100) / (strip.frames - 1) : 0}% 0">
                ${r ? `<b class="dot right" style="left:${(r[0] * 100).toFixed(1)}%;top:${(r[1] * 100).toFixed(1)}%">R</b>` : ''}
                ${l ? `<b class="dot left" style="left:${(l[0] * 100).toFixed(1)}%;top:${(l[1] * 100).toFixed(1)}%">L</b>` : ''}
              </div>
              <small class="wb-thumb-label">#${i + 1} ${r && l ? 'R·L' : r ? 'R' : l ? 'L' : '—'}</small>
            </button>`;
        }).join('')}
      </div>`
      }
    </section>`;
}

const imageCache = new Map<string, HTMLImageElement>();
function loadCachedImage(url: string, onLoad: () => void): HTMLImageElement | undefined {
  let img = imageCache.get(url);
  if (img) {
    if (img.complete) return img;
    img.addEventListener('load', onLoad, { once: true });
    return undefined;
  }
  img = new Image();
  imageCache.set(url, img);
  img.addEventListener('load', onLoad, { once: true });
  img.src = url;
  return undefined;
}

let loopTimer: number | undefined;
let loopTick = 0;

/** Wires interactive canvas drag/click events and starts the animation loop for visible Hand Workbenches. */
export function mountHandWorkbenches(): void {
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-wb-canvas]')) {
    const walkerId = canvas.dataset.wbCanvas!;
    const w = artState.data?.walkers.find((x) => x.id === walkerId);
    if (!w) continue;
    drawWorkbenchCanvas(canvas, w);
    wireWorkbenchCanvasDrag(canvas, w);
  }

  for (const gripBox of document.querySelectorAll<HTMLElement>('[data-wb-grip-item]')) {
    gripBox.onclick = (e) => {
      const rect = gripBox.getBoundingClientRect();
      const gx = Math.max(0, Math.min(1, Number(((e.clientX - rect.left) / rect.width).toFixed(4))));
      const gy = Math.max(0, Math.min(1, Number(((e.clientY - rect.top) / rect.height).toFixed(4))));
      const itemId = gripBox.dataset.wbGripItem!;
      void saveItemGrip(itemId, [gx, gy]);
    };
  }

  if (!loopTimer) {
    loopTimer = window.setInterval(() => {
      loopTick++;
      for (const loopCanvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-wb-loop]')) {
        const walkerId = loopCanvas.dataset.wbLoop!;
        const w = artState.data?.walkers.find((x) => x.id === walkerId);
        if (w) drawLoopCanvas(loopCanvas, w);
      }
    }, 125);
  }
}

function drawHeldItemOnCanvas(
  ctx: CanvasRenderingContext2D,
  direction: Facing,
  side: 'right' | 'left',
  hand: ArtPoint | null | undefined,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  rerender: () => void,
): void {
  const itemId = artState.tryOn[side];
  if (!itemId || !hand) return;
  const item = holdableItems().find((i) => i.id === itemId);
  if (!item?.url) return;
  const img = loadCachedImage(item.url, rerender);
  if (!img) return;
  const grip = artState.points[item.id]?.grip ?? [0.5, 0.5];
  const scale = (boxH * HELD_SIZE) / Math.max(img.naturalWidth, img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  const flip = facingSide(direction) === 'left';
  const gx = flip ? 1 - grip[0] : grip[0];
  const hx = boxX + hand[0] * boxW;
  const hy = boxY + hand[1] * boxH;

  ctx.save();
  if (flip) {
    ctx.translate(hx + (1 - gx) * w, hy - grip[1] * h);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, w, h);
  } else {
    ctx.drawImage(img, hx - gx * w, hy - grip[1] * h, w, h);
  }
  ctx.restore();
}

function drawWorkbenchCanvas(canvas: HTMLCanvasElement, w: WalkerView): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const st = getWorkbenchState(w);
  const strip = getStripForKind(w, st.animKind, st.facing);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Subtle checkerboard/grid background
  ctx.fillStyle = '#181425';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(90, 105, 136, 0.22)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= canvas.width; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(canvas.width, i);
    ctx.stroke();
  }

  if (!strip) return;
  const img = loadCachedImage(strip.url, () => drawWorkbenchCanvas(canvas, w));
  if (!img) return;

  const fw = strip.width / strip.frames;
  const fh = strip.height;
  const scale = Math.min((canvas.width - 24) / fw, (canvas.height - 24) / fh);
  const drawW = fw * scale;
  const drawH = fh * scale;
  const ox = Math.round((canvas.width - drawW) / 2);
  const oy = Math.round((canvas.height - drawH) / 2);

  canvas.dataset.boxX = String(ox);
  canvas.dataset.boxY = String(oy);
  canvas.dataset.boxW = String(drawW);
  canvas.dataset.boxH = String(drawH);

  // Frame bounding box
  ctx.strokeStyle = 'rgba(242, 220, 107, 0.35)';
  ctx.strokeRect(ox, oy, drawW, drawH);

  // Height-tier scale ruler
  if (st.showRuler) {
    const tiers: [string, number][] = [
      ['small 64', 0.67],
      ['person 96', 1.0],
    ];
    ctx.save();
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = '#a7f070';
    ctx.strokeStyle = 'rgba(167, 240, 112, 0.4)';
    ctx.setLineDash([4, 4]);
    for (const [label, frac] of tiers) {
      const y = oy + drawH * (1 - Math.min(1, frac * 0.85));
      ctx.beginPath();
      ctx.moveTo(ox, y);
      ctx.lineTo(ox + drawW, y);
      ctx.stroke();
      ctx.fillText(label, ox + 4, y - 3);
    }
    ctx.restore();
  }

  // Onion-skinning: previous and next frames
  if (st.onionSkin && strip.frames > 1) {
    const prev = (st.frame - 1 + strip.frames) % strip.frames;
    const next = (st.frame + 1) % strip.frames;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.drawImage(img, prev * fw, 0, fw, fh, ox, oy, drawW, drawH);
    ctx.globalAlpha = 0.14;
    ctx.drawImage(img, next * fw, 0, fw, fh, ox, oy, drawW, drawH);
    ctx.restore();
  }

  const artId = animationArt(w.id, st.animKind, st.facing);
  const pts = artState.points[artId];
  const rHand = pts?.hands?.[st.frame] ?? null;
  const lHand = pts?.leftHands?.[st.frame] ?? null;

  // Behind-body held items
  if (heldBehind(st.facing, 'right')) drawHeldItemOnCanvas(ctx, st.facing, 'right', rHand, ox, oy, drawW, drawH, () => drawWorkbenchCanvas(canvas, w));
  if (heldBehind(st.facing, 'left')) drawHeldItemOnCanvas(ctx, st.facing, 'left', lHand, ox, oy, drawW, drawH, () => drawWorkbenchCanvas(canvas, w));

  // Current frame sprite
  ctx.drawImage(img, st.frame * fw, 0, fw, fh, ox, oy, drawW, drawH);

  // In-front-of-body held items
  if (!heldBehind(st.facing, 'right')) drawHeldItemOnCanvas(ctx, st.facing, 'right', rHand, ox, oy, drawW, drawH, () => drawWorkbenchCanvas(canvas, w));
  if (!heldBehind(st.facing, 'left')) drawHeldItemOnCanvas(ctx, st.facing, 'left', lHand, ox, oy, drawW, drawH, () => drawWorkbenchCanvas(canvas, w));

  // Hand Trajectory Arc across all frames
  if (st.showTrajectory && pts) {
    const drawCurve = (list: (ArtPoint | null)[] | undefined, color: string) => {
      if (!list) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      let started = false;
      list.forEach((pt, idx) => {
        if (!pt) return;
        const px = ox + pt[0] * drawW;
        const py = oy + pt[1] * drawH;
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else {
          ctx.lineTo(px, py);
        }
        if (idx !== st.frame) {
          ctx.fillStyle = color;
          ctx.fillRect(px - 2, py - 2, 4, 4);
        }
      });
      ctx.stroke();
      ctx.restore();
    };
    drawCurve(pts.hands, 'rgba(255, 210, 63, 0.65)');
    drawCurve(pts.leftHands, 'rgba(95, 208, 255, 0.65)');
  }

  // Active Frame R and L handles
  const drawHandle = (pt: ArtPoint | null, label: 'R' | 'L', color: string, active: boolean) => {
    if (!pt) return;
    const px = ox + pt[0] * drawW;
    const py = oy + pt[1] * drawH;
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, active ? 9 : 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = active ? 2.5 : 1.5;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, px, py);
    ctx.restore();
  };

  drawHandle(rHand, 'R', '#ffd23f', st.activeSide === 'right');
  drawHandle(lHand, 'L', '#5fd0ff', st.activeSide === 'left');
}

function drawLoopCanvas(canvas: HTMLCanvasElement, w: WalkerView): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const st = getWorkbenchState(w);
  const strip = getStripForKind(w, st.animKind, st.facing);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!strip) return;
  const img = loadCachedImage(strip.url, () => drawLoopCanvas(canvas, w));
  if (!img) return;

  const frameIdx = st.playing ? loopTick % strip.frames : st.frame;
  const fw = strip.width / strip.frames;
  const fh = strip.height;
  const scale = Math.min((canvas.width - 12) / fw, (canvas.height - 12) / fh);
  const drawW = fw * scale;
  const drawH = fh * scale;
  const ox = Math.round((canvas.width - drawW) / 2);
  const oy = Math.round((canvas.height - drawH) / 2);

  const artId = animationArt(w.id, st.animKind, st.facing);
  const pts = artState.points[artId];
  const rHand = pts?.hands?.[frameIdx] ?? null;
  const lHand = pts?.leftHands?.[frameIdx] ?? null;

  if (heldBehind(st.facing, 'right')) drawHeldItemOnCanvas(ctx, st.facing, 'right', rHand, ox, oy, drawW, drawH, () => drawLoopCanvas(canvas, w));
  if (heldBehind(st.facing, 'left')) drawHeldItemOnCanvas(ctx, st.facing, 'left', lHand, ox, oy, drawW, drawH, () => drawLoopCanvas(canvas, w));
  ctx.drawImage(img, frameIdx * fw, 0, fw, fh, ox, oy, drawW, drawH);
  if (!heldBehind(st.facing, 'right')) drawHeldItemOnCanvas(ctx, st.facing, 'right', rHand, ox, oy, drawW, drawH, () => drawLoopCanvas(canvas, w));
  if (!heldBehind(st.facing, 'left')) drawHeldItemOnCanvas(ctx, st.facing, 'left', lHand, ox, oy, drawW, drawH, () => drawLoopCanvas(canvas, w));
}

function wireWorkbenchCanvasDrag(canvas: HTMLCanvasElement, w: WalkerView): void {
  let dragging = false;
  const pointFromEvent = (e: MouseEvent): ArtPoint | null => {
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const ox = Number(canvas.dataset.boxX || 0);
    const oy = Number(canvas.dataset.boxY || 0);
    const bw = Number(canvas.dataset.boxW || canvas.width);
    const bh = Number(canvas.dataset.boxH || canvas.height);
    const nx = Math.max(0, Math.min(1, Number(((cx - ox) / bw).toFixed(4))));
    const ny = Math.max(0, Math.min(1, Number(((cy - oy) / bh).toFixed(4))));
    return [nx, ny];
  };

  const applyLocalPoint = (pt: ArtPoint) => {
    const st = getWorkbenchState(w);
    const strip = getStripForKind(w, st.animKind, st.facing);
    if (!strip) return;
    const artId = animationArt(w.id, st.animKind, st.facing);
    const existing = artState.points[artId] ?? {};
    const key = st.activeSide === 'right' ? 'hands' : 'leftHands';
    const arr = Array.from({ length: strip.frames }, (_, i) => existing[key]?.[i] ?? null);
    arr[st.frame] = pt;
    artState.points[artId] = { ...existing, [key]: arr };
    drawWorkbenchCanvas(canvas, w);
  };

  canvas.onmousedown = (e) => {
    const pt = pointFromEvent(e);
    if (!pt) return;
    dragging = true;
    applyLocalPoint(pt);
  };
  canvas.onmousemove = (e) => {
    if (!dragging) return;
    const pt = pointFromEvent(e);
    if (pt) applyLocalPoint(pt);
  };
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    const st = getWorkbenchState(w);
    const artId = animationArt(w.id, st.animKind, st.facing);
    const pts = artState.points[artId];
    if (!pts) return;
    void saveFrameHandPoint(w, artId, st.frame, pts.hands?.[st.frame] ?? null, pts.leftHands?.[st.frame] ?? null);
  };
  canvas.onmouseup = finish;
  canvas.onmouseleave = finish;
}

async function saveFrameHandPoint(
  w: WalkerView,
  artId: string,
  frame: number,
  right: ArtPoint | null,
  left: ArtPoint | null,
): Promise<void> {
  try {
    await artState.ctx.api('art/hands/set', 'POST', { id: artId, frame, right, left });
    rerenderWorkbench(w);
  } catch (err) {
    artState.ctx.toast((err as Error).message);
  }
}

async function saveItemGrip(itemId: string, grip: ArtPoint): Promise<void> {
  try {
    await artState.ctx.api('art/hands/set', 'POST', { id: itemId, grip });
    artState.points[itemId] = { ...(artState.points[itemId] ?? {}), grip };
    artState.ctx.toast(`Updated grip for ${itemId} to [${grip[0].toFixed(3)}, ${grip[1].toFixed(3)}].`);
    artState.ctx.rerender();
  } catch (err) {
    artState.ctx.toast((err as Error).message);
  }
}

export function rerenderWorkbench(w: WalkerView): void {
  const box = document.querySelector<HTMLElement>(`.hand-workbench[data-wb-walker="${w.id}"]`);
  if (!box) return;
  box.outerHTML = handWorkbenchHtml(w);
  mountHandWorkbenches();
}

/**Interpolates null gaps linearly between known hand keyframes across the strip. */
function interpolatePoints(points: (ArtPoint | null)[], totalFrames: number): (ArtPoint | null)[] {
  const out: (ArtPoint | null)[] = Array.from({ length: totalFrames }, (_, i) => points[i] ?? null);
  const knownIdx = out.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  if (knownIdx.length === 0) return out;
  if (knownIdx.length === 1) {
    const only = out[knownIdx[0]!]!;
    return out.map(() => [only[0], only[1]]);
  }
  for (let k = 0; k < knownIdx.length; k++) {
    const i0 = knownIdx[k]!;
    const i1 = knownIdx[(k + 1) % knownIdx.length]!;
    const p0 = out[i0]!;
    const p1 = out[i1]!;
    const span = i1 > i0 ? i1 - i0 : totalFrames - i0 + i1;
    for (let step = 1; step < span; step++) {
      const idx = (i0 + step) % totalFrames;
      const t = step / span;
      out[idx] = [Number((p0[0] + (p1[0] - p0[0]) * t).toFixed(4)), Number((p0[1] + (p1[1] - p0[1]) * t).toFixed(4))];
    }
  }
  return out;
}

export function handleWorkbenchClick(t: HTMLButtonElement): boolean {
  const walkerId = t.dataset.wbWalker ?? t.dataset.wbPlay ?? t.dataset.wbClearHand ?? t.dataset.wbCopyPrev ?? t.dataset.wbInterpolate ?? t.dataset.wbMirrorFrame ?? t.dataset.wbMirrorStrip;
  if (!walkerId) return false;
  const w = artState.data?.walkers.find((x) => x.id === walkerId);
  if (!w) return false;
  const st = getWorkbenchState(w);

  if (t.dataset.wbKind) {
    st.animKind = t.dataset.wbKind as AnimationKind;
    st.frame = 0;
    rerenderWorkbench(w);
    return true;
  }
  if (t.dataset.wbFacing) {
    st.facing = t.dataset.wbFacing as IsoWay;
    rerenderWorkbench(w);
    return true;
  }
  if (t.dataset.wbFrame !== undefined) {
    st.frame = Number(t.dataset.wbFrame);
    rerenderWorkbench(w);
    return true;
  }
  if (t.dataset.wbSide) {
    st.activeSide = t.dataset.wbSide as 'right' | 'left';
    rerenderWorkbench(w);
    return true;
  }
  if (t.dataset.wbPlay) {
    st.playing = !st.playing;
    rerenderWorkbench(w);
    return true;
  }
  if (t.dataset.wbCalibrate) {
    const side = t.dataset.wbCalibrate;
    st.calibratingItemSide = side === 'close' || st.calibratingItemSide === side ? null : (side as 'right' | 'left');
    rerenderWorkbench(w);
    return true;
  }
  if (t.dataset.wbNudge) {
    const [dx, dy] = t.dataset.wbNudge.split(',').map(Number);
    const artId = animationArt(w.id, st.animKind, st.facing);
    const pts = artState.points[artId];
    const key = st.activeSide === 'right' ? 'hands' : 'leftHands';
    const cur = pts?.[key]?.[st.frame] ?? [0.5, 0.5];
    const next: ArtPoint = [
      Math.max(0, Math.min(1, Number((cur[0] + dx!).toFixed(4)))),
      Math.max(0, Math.min(1, Number((cur[1] + dy!).toFixed(4)))),
    ];
    const right = st.activeSide === 'right' ? next : (pts?.hands?.[st.frame] ?? null);
    const left = st.activeSide === 'left' ? next : (pts?.leftHands?.[st.frame] ?? null);
    const strip = getStripForKind(w, st.animKind, st.facing);
    if (strip) {
      const existing = artState.points[artId] ?? {};
      const arr = Array.from({ length: strip.frames }, (_, i) => existing[key]?.[i] ?? null);
      arr[st.frame] = next;
      artState.points[artId] = { ...existing, [key]: arr };
      void saveFrameHandPoint(w, artId, st.frame, right, left);
    }
    return true;
  }
  if (t.dataset.wbClearHand) {
    const artId = animationArt(w.id, st.animKind, st.facing);
    const pts = artState.points[artId];
    const right = st.activeSide === 'right' ? null : (pts?.hands?.[st.frame] ?? null);
    const left = st.activeSide === 'left' ? null : (pts?.leftHands?.[st.frame] ?? null);
    const strip = getStripForKind(w, st.animKind, st.facing);
    if (strip) {
      const key = st.activeSide === 'right' ? 'hands' : 'leftHands';
      const existing = artState.points[artId] ?? {};
      const arr = Array.from({ length: strip.frames }, (_, i) => existing[key]?.[i] ?? null);
      arr[st.frame] = null;
      artState.points[artId] = { ...existing, [key]: arr };
      void saveFrameHandPoint(w, artId, st.frame, right, left);
    }
    return true;
  }
  if (t.dataset.wbCopyPrev) {
    if (st.frame <= 0) return true;
    const artId = animationArt(w.id, st.animKind, st.facing);
    const pts = artState.points[artId];
    const rPrev = pts?.hands?.[st.frame - 1] ?? null;
    const lPrev = pts?.leftHands?.[st.frame - 1] ?? null;
    const strip = getStripForKind(w, st.animKind, st.facing);
    if (strip) {
      const existing = artState.points[artId] ?? {};
      const rArr = Array.from({ length: strip.frames }, (_, i) => existing.hands?.[i] ?? null);
      const lArr = Array.from({ length: strip.frames }, (_, i) => existing.leftHands?.[i] ?? null);
      rArr[st.frame] = rPrev;
      lArr[st.frame] = lPrev;
      artState.points[artId] = { ...existing, hands: rArr, leftHands: lArr };
      void saveFrameHandPoint(w, artId, st.frame, rPrev, lPrev);
      artState.ctx.toast(`Copied frame #${st.frame} hands to frame #${st.frame + 1}.`);
    }
    return true;
  }
  if (t.dataset.wbInterpolate) {
    const strip = getStripForKind(w, st.animKind, st.facing);
    if (!strip) return true;
    const artId = animationArt(w.id, st.animKind, st.facing);
    const existing = artState.points[artId] ?? {};
    const hands = interpolatePoints(existing.hands ?? [], strip.frames);
    const leftHands = interpolatePoints(existing.leftHands ?? [], strip.frames);
    artState.points[artId] = { ...existing, hands, leftHands };
    void artState.ctx.api('art/hands/set', 'POST', { id: artId, hands, leftHands }).then(
      () => {
        artState.ctx.toast(`Interpolated hand positions across all ${strip.frames} frames.`);
        rerenderWorkbench(w);
      },
      (err: Error) => artState.ctx.toast(err.message),
    );
    return true;
  }
  if (t.dataset.wbMirrorFrame) {
    const from = t.dataset.from!;
    const to = t.dataset.to!;
    void artState.ctx.api('art/hands/mirror', 'POST', { from, to, frame: st.frame, side: 'both' }).then(
      async () => {
        artState.points = await fetch('/api/art-points').then((r) => (r.ok ? r.json() : artState.points));
        artState.ctx.toast(`Mirrored frame #${st.frame + 1} from ${from}.`);
        rerenderWorkbench(w);
      },
      (err: Error) => artState.ctx.toast(err.message),
    );
    return true;
  }
  if (t.dataset.wbMirrorStrip) {
    const from = t.dataset.from!;
    const to = t.dataset.to!;
    void artState.ctx.api('art/hands/mirror', 'POST', { from, to, side: 'both' }).then(
      async () => {
        artState.points = await fetch('/api/art-points').then((r) => (r.ok ? r.json() : artState.points));
        artState.ctx.toast(`Mirrored full strip from ${t.dataset.fromLabel ?? from}.`);
        rerenderWorkbench(w);
      },
      (err: Error) => artState.ctx.toast(err.message),
    );
    return true;
  }

  return false;
}

export function handleWorkbenchChange(target: HTMLElement): boolean {
  if (target.dataset.wbToggle && target.dataset.wbWalker) {
    const w = artState.data?.walkers.find((x) => x.id === target.dataset.wbWalker);
    if (!w) return false;
    const st = getWorkbenchState(w);
    const key = target.dataset.wbToggle as 'onionSkin' | 'showTrajectory' | 'showRuler';
    st[key] = (target as HTMLInputElement).checked;
    rerenderWorkbench(w);
    return true;
  }
  return false;
}
