// Interactive Building Look Biome Preview Stage (look-preview.ts):
// Renders how each building look (and each building style using it) looks built
// directly on its biome's isometric ground tiles, path tiles, trees, rocks,
// and time-of-day / window-glow lighting.

import {
  BIOMES,
  BUILDING_STYLES,
  biomeLook,
  buildingKit,
  type BiomeId,
} from '@co-mmo/shared';
import type { BuildingView } from './buildings.ts';
import { type KitSheetView, artState, esc } from './state.ts';

export type PreviewTimeOfDay = 'midday' | 'dawn' | 'dusk' | 'night';

export interface LookPreviewState {
  lookId: string;
  buildingKey: string;
  view: string;
  biome: BiomeId;
  timeOfDay: PreviewTimeOfDay;
  showScenery: boolean;
}

const PREVIEW_BIOMES: BiomeId[] = [
  'sanctum',
  'whispering-woods',
  'sunlit-shore',
  'mirage-desert',
  'frostpeak',
  'mushroom-hollow',
];

const TIME_OPTIONS: [PreviewTimeOfDay, string][] = [
  ['midday', '☀ Midday'],
  ['dawn', '🌅 Dawn'],
  ['dusk', '🌇 Dusk'],
  ['night', '🌙 Night + Glow'],
];

const stateByLook = new Map<string, LookPreviewState>();
const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImg(url: string | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

function itemUrl(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return artState.data?.items.find((i) => i.id === id)?.url;
}

function hexCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function hexRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** Finds all world buildings (or style fallbacks) that use a given kit look ID. */
export function buildingsForLook(lookId: string, lookName: string): BuildingView[] {
  const all = artState.buildings ?? [];
  const matched = all.filter(
    (b) => BUILDING_STYLES[b.style]?.kit === lookId || b.look === lookName,
  );
  if (matched.length) return matched;

  // Fallback synthetic building entries from BUILDING_STYLES if world buildings aren't loaded yet
  return Object.values(BUILDING_STYLES)
    .filter((s) => s.kit === lookId)
    .map((s, index) => ({
      region: s.biome === 'any' ? 'sanctum' : s.biome,
      regionName: BIOMES[s.biome === 'any' ? 'sanctum' : s.biome]?.name ?? s.biome,
      index,
      style: s.id,
      name: s.name,
      floor: [6, 6] as [number, number],
      stands: 'kit' as const,
      look: lookName,
      note: '',
      furniture: [],
    }));
}

function nativeBiomeForBuilding(b: BuildingView | undefined): BiomeId {
  if (!b) return 'sanctum';
  const styleBiome = BUILDING_STYLES[b.style]?.biome;
  if (styleBiome && styleBiome !== 'any' && BIOMES[styleBiome]) return styleBiome;
  if (BIOMES[b.region as BiomeId]) return b.region as BiomeId;
  return 'sanctum';
}

export function getLookPreviewState(v: KitSheetView): LookPreviewState {
  const buildings = buildingsForLook(v.look, v.name);
  const first = buildings[0];
  const defaultKey = first ? `${first.region}:${first.index}:${first.style}` : v.look;
  let st = stateByLook.get(v.look);
  if (!st) {
    st = {
      lookId: v.look,
      buildingKey: defaultKey,
      view: 'outside',
      biome: nativeBiomeForBuilding(first),
      timeOfDay: 'midday',
      showScenery: true,
    };
    stateByLook.set(v.look, st);
  } else if (
    buildings.length &&
    !buildings.some((b) => `${b.region}:${b.index}:${b.style}` === st!.buildingKey)
  ) {
    st.buildingKey = defaultKey;
    st.biome = nativeBiomeForBuilding(first);
  }
  return st;
}

function selectedBuilding(v: KitSheetView, st: LookPreviewState): BuildingView | undefined {
  const buildings = buildingsForLook(v.look, v.name);
  return (
    buildings.find((b) => `${b.region}:${b.index}:${b.style}` === st.buildingKey) ??
    buildings[0]
  );
}

/** Renders the HTML controls and canvas for a Building Look's in-biome preview. */
export function lookBiomePreviewHtml(v: KitSheetView): string {
  const st = getLookPreviewState(v);
  const buildings = buildingsForLook(v.look, v.name);
  const b = selectedBuilding(v, st);
  const nativeBiome = nativeBiomeForBuilding(b);
  const views = b?.house?.views ? Object.keys(b.house.views) : ['outside'];
  if (!views.includes(st.view)) st.view = views[0] ?? 'outside';

  const viewLabel = (name: string) =>
    name === 'outside' ? 'Outside' : `Inside · Storey ${name.replace('storey-', '')}`;

  const biomeInfo = BIOMES[st.biome] ?? BIOMES.sanctum;
  const swatches = biomeInfo.keyColors
    .map((c) => `<span class="swatch" style="background:${hexCss(c)}" title="${hexCss(c)}"></span>`)
    .join('');

  return `
    <div class="look-biome-preview" data-look-preview="${esc(v.look)}">
      <div class="look-preview-toolbar">
        ${
          buildings.length > 1
            ? `<label class="look-ctrl"><span>Building:</span>
                <select data-look-building="${esc(v.look)}">
                  ${buildings
                    .map((x) => {
                      const k = `${x.region}:${x.index}:${x.style}`;
                      return `<option value="${esc(k)}"${k === st.buildingKey ? ' selected' : ''}>${esc(x.name)} (${x.floor[0]}×${x.floor[1]})</option>`;
                    })
                    .join('')}
                </select>
              </label>`
            : b
              ? `<span class="look-building-badge">🏠 <b>${esc(b.name)}</b> <small>(${b.floor[0]}×${b.floor[1]} tiles)</small></span>`
              : ''
        }
        <label class="look-ctrl"><span>Biome:</span>
          <select data-look-biome="${esc(v.look)}">
            ${PREVIEW_BIOMES.map(
              (id) =>
                `<option value="${id}"${id === st.biome ? ' selected' : ''}>${esc(BIOMES[id].name)}${id === nativeBiome ? ' (native)' : ''}</option>`,
            ).join('')}
          </select>
        </label>
        ${
          views.length > 1
            ? `<div class="btn-group">
                ${views
                  .map(
                    (vw) =>
                      `<button type="button" class="quiet${st.view === vw ? ' active-pill' : ''}" data-look-view="${esc(v.look)}" data-view="${esc(vw)}">${esc(viewLabel(vw))}</button>`,
                  )
                  .join('')}
              </div>`
            : ''
        }
      </div>
      <div class="look-preview-subbar">
        <div class="btn-group">
          ${TIME_OPTIONS.map(
            ([id, label]) =>
              `<button type="button" class="quiet${st.timeOfDay === id ? ' active-pill' : ''}" data-look-time="${esc(v.look)}" data-time="${id}">${label}</button>`,
          ).join('')}
        </div>
        <label class="look-scenery-toggle">
          <input type="checkbox" data-look-scenery="${esc(v.look)}"${st.showScenery ? ' checked' : ''} />
          <small>Trees, rocks &amp; path</small>
        </label>
        <span class="look-biome-meta"><span class="swatches">${swatches}</span> <small>${esc(biomeInfo.ground)}</small></span>
      </div>
      <div class="look-canvas-wrap">
        <canvas class="look-biome-canvas" data-look-canvas="${esc(v.look)}" width="560" height="360"></canvas>
      </div>
    </div>`;
}

/** Draws a single square tile texture as an isometric 2:1 diamond at world tile (tx, ty). */
function drawIsoDiamondTile(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  topX: number,
  topY: number,
  halfW: number,
  halfH: number,
): void {
  const w = img.naturalWidth || 128;
  const h = img.naturalHeight || 128;
  const bleed = 1.5;
  const bw = halfW + bleed;
  const bh = halfH + bleed * 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(topX, topY - bleed);
  ctx.lineTo(topX + bw, topY + bh);
  ctx.lineTo(topX, topY + bh * 2);
  ctx.lineTo(topX - bw, topY + bh);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(
    bw / w,
    bh / w,
    -bw / h,
    bh / h,
    topX,
    topY - bleed * 0.5,
  );
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/** Renders the isometric biome + building scene onto a Building Look's canvas. */
export async function renderLookBiomeCanvas(canvas: HTMLCanvasElement, v: KitSheetView): Promise<void> {
  const st = getLookPreviewState(v);
  const b = selectedBuilding(v, st);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const cw = canvas.width;
  const ch = canvas.height;
  const biome = BIOMES[st.biome] ?? BIOMES.sanctum;
  const bLook = biomeLook(st.biome);
  const sanctumLook = biomeLook('sanctum');

  // Resolve biome ground, path, water, tree, and rock URLs (falling back to Sanctum if a non-launch biome tile isn't painted yet)
  const groundUrl = itemUrl(bLook.ground) ?? itemUrl(sanctumLook.ground);
  const pathUrl = itemUrl(bLook.path) ?? groundUrl;
  const treeUrls = bLook.trees.map(itemUrl).filter((u): u is string => Boolean(u));
  const fallbackTrees = treeUrls.length ? treeUrls : sanctumLook.trees.map(itemUrl).filter((u): u is string => Boolean(u));
  const rockUrls = bLook.rocks.map(itemUrl).filter((u): u is string => Boolean(u));
  const fallbackRocks = rockUrls.length ? rockUrls : sanctumLook.rocks.map(itemUrl).filter((u): u is string => Boolean(u));

  const viewEntry = b?.house?.views?.[st.view] ?? b?.house?.views?.outside;
  const housePicUrl = viewEntry?.picture ?? (b ? itemUrl(`${b.style}-exterior`) : undefined);
  const houseGlowUrl = viewEntry?.glow;

  const [groundImg, pathImg, houseImg, glowImg, treeA, treeB, rockImg] = await Promise.all([
    loadImg(groundUrl),
    loadImg(pathUrl),
    loadImg(housePicUrl),
    st.timeOfDay === 'night' || st.timeOfDay === 'dusk' ? loadImg(houseGlowUrl) : Promise.resolve(null),
    loadImg(fallbackTrees[0]),
    loadImg(fallbackTrees[1] ?? fallbackTrees[0]),
    loadImg(fallbackRocks[0]),
  ]);

  // Ensure canvas is still mounted
  if (!document.body.contains(canvas)) return;

  // 1. Sky & Biome Atmosphere Backdrop
  const [r0, g0, b0] = hexRgb(biome.keyColors[0] ?? 0x8aa86b);
  const [r1, g1, b1] = hexRgb(biome.keyColors[2] ?? biome.keyColors[1] ?? 0x2f6b5e);
  const timeMul =
    st.timeOfDay === 'night' ? 0.24 : st.timeOfDay === 'dusk' ? 0.62 : st.timeOfDay === 'dawn' ? 0.78 : 0.95;

  const grad = ctx.createLinearGradient(0, 0, 0, ch);
  grad.addColorStop(
    0,
    `rgb(${Math.round(r1 * 0.35 * timeMul)}, ${Math.round(g1 * 0.38 * timeMul)}, ${Math.round((b1 * 0.48 + 28) * timeMul)})`,
  );
  grad.addColorStop(
    0.55,
    `rgb(${Math.round(r0 * 0.48 * timeMul)}, ${Math.round(g0 * 0.5 * timeMul)}, ${Math.round(b0 * 0.52 * timeMul)})`,
  );
  grad.addColorStop(
    1,
    `rgb(${Math.round(r0 * 0.28 * timeMul)}, ${Math.round(g0 * 0.3 * timeMul)}, ${Math.round(b0 * 0.34 * timeMul)})`,
  );
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);

  // 2. Isometric Yard & Building Footprint Geometry
  const floorW = b?.floor[0] ?? 6;
  const floorH = b?.floor[1] ?? 6;
  const margin = 3;
  const minX = -margin;
  const maxX = floorW + margin;
  const minY = -margin;
  const maxY = floorH + margin + 1;

  // Compute scale (halfW) so both the yard diamond and the building height fit nicely inside the canvas
  const totalSpanX = maxX - minX + (maxY - minY);
  const totalSpanY = maxX - minX + (maxY - minY);
  const frame = b?.house?.frame;
  const houseExtraTopTiles = frame
    ? Math.max(2, (frame.origin[1] / (frame.u * 0.5)) - (floorW + floorH) * 0.5)
    : 5;

  const halfW = Math.min(
    (cw * 0.86) / Math.max(8, totalSpanX),
    (ch * 0.82) / Math.max(8, (totalSpanY + houseExtraTopTiles) * 0.5),
    36,
  );
  const halfH = halfW / 2;

  // Center the south-east corner of the building floor `(floorW, floorH)` in the lower-middle of the canvas
  const cornerScreenX = cw * 0.5 + ((floorW - floorH) - ((minX + maxX) * 0.5 - (minY + maxY) * 0.5)) * halfW * 0.35;
  const cornerScreenY = ch * 0.72;

  const toScreen = (tx: number, ty: number) => ({
    x: cornerScreenX + (tx - floorW - (ty - floorH)) * halfW,
    y: cornerScreenY + (tx - floorW + (ty - floorH)) * halfH,
  });

  // 3. Draw Isometric Biome Ground & Front Door Path Diamonds
  const doorX = Math.floor(floorW / 2);
  for (let ty = minY; ty < maxY; ty++) {
    for (let tx = minX; tx < maxX; tx++) {
      const top = toScreen(tx, ty);
      const isPath =
        st.showScenery &&
        ((ty >= floorH && (tx === doorX || tx === doorX - 1)) ||
          (ty === floorH + margin - 1 && tx >= minX + 1 && tx <= maxX - 2));
      const tileImg = isPath && pathImg ? pathImg : groundImg;
      if (tileImg) {
        drawIsoDiamondTile(ctx, tileImg, top.x, top.y, halfW, halfH);
      } else {
        // Fallback diamond fill in biome key color
        ctx.fillStyle = hexCss(isPath ? (biome.keyColors[1] ?? 0xe8c66a) : (biome.keyColors[0] ?? 0x8aa86b));
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(top.x + halfW, top.y + halfH);
        ctx.lineTo(top.x, top.y + halfH * 2);
        ctx.lineTo(top.x - halfW, top.y + halfH);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // Subtle footprint shadow under the building walls
  const nw = toScreen(0, 0);
  const ne = toScreen(floorW, 0);
  const se = toScreen(floorW, floorH);
  const sw = toScreen(0, floorH);
  ctx.save();
  ctx.fillStyle = 'rgba(12, 10, 22, 0.26)';
  ctx.beginPath();
  ctx.moveTo(nw.x, nw.y);
  ctx.lineTo(ne.x, ne.y);
  ctx.lineTo(se.x, se.y);
  ctx.lineTo(sw.x, sw.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 4. Prepare Depth-Sorted Biome Scenery (Trees & Rocks) around the Building
  interface PropPlacement {
    img: HTMLImageElement | null;
    tx: number;
    ty: number;
    scale: number;
    flip: boolean;
  }
  const props: PropPlacement[] = st.showScenery
    ? [
        { img: treeA, tx: -1.8, ty: -1.4, scale: 1.0, flip: false },
        { img: treeB, tx: floorW + 1.1, ty: -1.5, scale: 0.95, flip: true },
        { img: rockImg, tx: -1.9, ty: floorH * 0.45, scale: 0.72, flip: false },
        { img: treeB, tx: -1.7, ty: floorH + 0.6, scale: 0.92, flip: true },
        { img: rockImg, tx: floorW + 1.2, ty: floorH * 0.55, scale: 0.76, flip: true },
        { img: treeA, tx: floorW + 1.4, ty: floorH + 0.8, scale: 0.9, flip: false },
      ]
    : [];

  const drawProp = (p: PropPlacement) => {
    if (!p.img) return;
    const at = toScreen(p.tx + 0.5, p.ty + 0.5);
    const targetW = halfW * 2.5 * p.scale;
    const targetH = (p.img.naturalHeight / Math.max(1, p.img.naturalWidth)) * targetW;
    ctx.save();
    ctx.translate(at.x, at.y);
    if (p.flip) ctx.scale(-1, 1);
    ctx.drawImage(p.img, -targetW * 0.5, -targetH * 0.95, targetW, targetH);
    ctx.restore();
  };

  const buildingDepth = floorW + floorH;
  for (const p of props.filter((x) => x.tx + x.ty < buildingDepth - 0.5).sort((a, b2) => a.tx + a.ty - (b2.tx + b2.ty))) {
    drawProp(p);
  }

  // 5. Draw the Kit Building at its Exact Isometric Origin & Bay Scale
  if (houseImg && frame) {
    const scale = (buildingKit.BAY_TILES * halfW) / frame.u;
    const drawW = frame.width * scale;
    const drawH = frame.height * scale;
    const drawX = se.x - frame.origin[0] * scale;
    const drawY = se.y - frame.origin[1] * scale;
    ctx.drawImage(houseImg, drawX, drawY, drawW, drawH);

    // If inside cutaway view, render interior furniture on the floor
    if (st.view !== 'outside' && b?.furniture?.length) {
      const storeyNum = Number(st.view.replace('storey-', '')) - 1;
      const furnOnFloor = b.furniture.filter((f) => f.floor === storeyNum || (storeyNum === 0 && f.floor === 0));
      const furnImgs = await Promise.all(furnOnFloor.map((f) => loadImg(itemUrl(f.asset))));
      if (!document.body.contains(canvas)) return;
      furnOnFloor.forEach((f, idx) => {
        const fImg = furnImgs[idx];
        if (!fImg) return;
        const fx = Math.min(floorW - 1, Math.max(1, (f.at[0] % floorW) + f.footprint[0] * 0.5));
        const fy = Math.min(floorH - 1, Math.max(1, (f.at[1] % floorH) + f.footprint[1] * 0.5));
        const fAt = toScreen(fx, fy);
        const fw = Math.max(1, f.footprint[0]) * halfW * 1.1;
        const fh = (fImg.naturalHeight / Math.max(1, fImg.naturalWidth)) * fw;
        ctx.drawImage(fImg, fAt.x - fw * 0.5, fAt.y - fh * 0.85, fw, fh);
      });
    }

    // Composite window/brazier glow map at dusk or night
    if (glowImg && (st.timeOfDay === 'night' || st.timeOfDay === 'dusk')) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = st.timeOfDay === 'night' ? 0.92 : 0.45;
      ctx.drawImage(glowImg, drawX, drawY, drawW, drawH);
      ctx.restore();
    }
  } else if (houseImg) {
    // Fallback for flat exterior art when house frame is not a kit frame
    const targetW = Math.max(halfW * (floorW + floorH) * 0.95, 180);
    const targetH = (houseImg.naturalHeight / Math.max(1, houseImg.naturalWidth)) * targetW;
    ctx.drawImage(houseImg, se.x - targetW * 0.5, se.y - targetH * 0.9, targetW, targetH);
  } else {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      b?.house?.status === 'building'
        ? 'Drawing 3D kit house views…'
        : 'Paint all passing kit textures to render the 3D house in this biome.',
      cw * 0.5,
      ch * 0.48,
    );
  }

  // 6. Draw Foreground Biome Scenery
  for (const p of props.filter((x) => x.tx + x.ty >= buildingDepth - 0.5).sort((a, b2) => a.tx + a.ty - (b2.tx + b2.ty))) {
    drawProp(p);
  }

  // 7. Apply Biome & Time-of-Day Lighting Pass
  if (st.timeOfDay !== 'midday') {
    ctx.save();
    if (st.timeOfDay === 'night') {
      ctx.fillStyle = 'rgba(18, 24, 58, 0.42)';
      ctx.fillRect(0, 0, cw, ch);
      // Warm lantern/doorway pool of light in front of the south door
      const doorScreen = toScreen(doorX, floorH + 0.4);
      const lanternGrad = ctx.createRadialGradient(
        doorScreen.x,
        doorScreen.y - halfH,
        4,
        doorScreen.x,
        doorScreen.y - halfH,
        halfW * 3.5,
      );
      lanternGrad.addColorStop(0, 'rgba(255, 214, 120, 0.38)');
      lanternGrad.addColorStop(0.5, 'rgba(254, 174, 52, 0.16)');
      lanternGrad.addColorStop(1, 'rgba(254, 174, 52, 0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = lanternGrad;
      ctx.fillRect(0, 0, cw, ch);
    } else if (st.timeOfDay === 'dusk') {
      ctx.fillStyle = 'rgba(92, 42, 68, 0.22)';
      ctx.fillRect(0, 0, cw, ch);
    } else if (st.timeOfDay === 'dawn') {
      ctx.fillStyle = 'rgba(255, 210, 175, 0.14)';
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.restore();
  }

  // 8. Ambient Biome Signature Particles & Corner Caption
  const accentHex = biome.keyColors[3] ?? biome.keyColors[1] ?? 0xf2dc6b;
  ctx.save();
  ctx.fillStyle = hexCss(accentHex);
  ctx.globalAlpha = st.timeOfDay === 'night' ? 0.75 : 0.45;
  for (let i = 0; i < 14; i++) {
    const px = ((i * 97 + 31) % (cw - 40)) + 20;
    const py = ((i * 61 + 19) % (ch - 50)) + 18;
    const r = (i % 3) + 1.5;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Caption overlay at bottom-left
  ctx.save();
  ctx.fillStyle = 'rgba(24, 20, 37, 0.78)';
  ctx.fillRect(8, ch - 28, cw - 16, 22);
  ctx.fillStyle = '#f2dc6b';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  const titleText = `${b?.name ?? v.name} · in ${biome.name}`;
  ctx.fillText(titleText, 14, ch - 13);
  ctx.fillStyle = '#c0cbdc';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`Particles: ${biome.particle}`, cw - 14, ch - 13);
  ctx.restore();
}

/** Mounts and renders all Building Look biome preview canvases currently in the DOM. */
export function mountLookBiomePreviews(): void {
  const sheets = artState.data?.sheets ?? [];
  const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas[data-look-canvas]');
  canvases.forEach((canvas) => {
    const lookId = canvas.dataset.lookCanvas;
    const v = sheets.find((s) => s.look === lookId);
    if (v) void renderLookBiomeCanvas(canvas, v);
  });
}

function rerenderSingleLookPreview(lookId: string): void {
  const v = artState.data?.sheets?.find((s) => s.look === lookId);
  const box = document.querySelector<HTMLElement>(`.look-biome-preview[data-look-preview="${CSS.escape(lookId)}"]`);
  if (!v || !box) return;
  box.outerHTML = lookBiomePreviewHtml(v);
  const newCanvas = document.querySelector<HTMLCanvasElement>(`canvas[data-look-canvas="${CSS.escape(lookId)}"]`);
  if (newCanvas) void renderLookBiomeCanvas(newCanvas, v);
}

/** Handles click events on Building Look biome preview buttons (view switch, time of day). */
export function handleLookPreviewClick(target: HTMLElement): boolean {
  const viewBtn = target.closest<HTMLButtonElement>('button[data-look-view]');
  if (viewBtn) {
    const lookId = viewBtn.dataset.lookView!;
    const v = artState.data?.sheets?.find((s) => s.look === lookId);
    if (v) {
      const st = getLookPreviewState(v);
      st.view = viewBtn.dataset.view ?? 'outside';
      rerenderSingleLookPreview(lookId);
    }
    return true;
  }

  const timeBtn = target.closest<HTMLButtonElement>('button[data-look-time]');
  if (timeBtn) {
    const lookId = timeBtn.dataset.lookTime!;
    const v = artState.data?.sheets?.find((s) => s.look === lookId);
    if (v) {
      const st = getLookPreviewState(v);
      st.timeOfDay = (timeBtn.dataset.time as PreviewTimeOfDay) ?? 'midday';
      rerenderSingleLookPreview(lookId);
    }
    return true;
  }

  return false;
}

/** Handles change events on Building Look biome preview selects and checkboxes. */
export function handleLookPreviewChange(target: HTMLElement): boolean {
  if (target instanceof HTMLSelectElement && target.dataset.lookBuilding) {
    const lookId = target.dataset.lookBuilding;
    const v = artState.data?.sheets?.find((s) => s.look === lookId);
    if (v) {
      const st = getLookPreviewState(v);
      st.buildingKey = target.value;
      const b = selectedBuilding(v, st);
      st.biome = nativeBiomeForBuilding(b);
      st.view = 'outside';
      rerenderSingleLookPreview(lookId);
    }
    return true;
  }

  if (target instanceof HTMLSelectElement && target.dataset.lookBiome) {
    const lookId = target.dataset.lookBiome;
    const v = artState.data?.sheets?.find((s) => s.look === lookId);
    if (v) {
      const st = getLookPreviewState(v);
      st.biome = target.value as BiomeId;
      rerenderSingleLookPreview(lookId);
    }
    return true;
  }

  if (target instanceof HTMLInputElement && target.dataset.lookScenery) {
    const lookId = target.dataset.lookScenery;
    const v = artState.data?.sheets?.find((s) => s.look === lookId);
    if (v) {
      const st = getLookPreviewState(v);
      st.showScenery = target.checked;
      const canvas = document.querySelector<HTMLCanvasElement>(`canvas[data-look-canvas="${CSS.escape(lookId)}"]`);
      if (canvas) void renderLookBiomeCanvas(canvas, v);
    }
    return true;
  }

  return false;
}
