// Interactive Attack & Skill Preview Stage (skill-stage.ts):
// Live 2-entity isometric combat preview stage for Characters, Monsters & NPCs:
// - 4-way attack strip playback + in-game lunge(toward) tween + held weapon swing
// - Melee arc (fx-slash) & ranged projectile flight (item-firebolt)
// - Calling skill bursts (fx-ember, fx-tide, fx-gale, fx-bell)
// - Persistent ground & floating marks (fx-hallowed-ground, fx-trap, fx-echo)
// - Summoned companions (spirit-hawk, sandstorm-double)
// - Overhead status effect badges (status-*) & Hunter's Mark (fx-mark)
// - Target hit flash, floating damage numbers, and defeat/corpse state (fadeOut + makeBody)

import {
  HELD_SIZE,
  facingSide,
  heldBehind,
  type Facing,
  type IsoWay,
} from '@co-mmo/shared';
import { queueButtonHtml } from './queue.ts';
import {
  WAYS,
  type ArtItem,
  type WalkerView,
  artState,
  esc,
  usd,
} from './state.ts';

export interface SkillPreset {
  id: string;
  label: string;
  group: 'Melee & Ranged' | 'Emberward' | 'Tidecaller' | 'Gale Strider' | 'Bellbinder' | 'World Marks & Summons';
  burstAsset?: string;
  projectileAsset?: string;
  groundAsset?: string;
  companionAsset?: string;
  statusAsset?: string;
  damageText: string;
  isCrit?: boolean;
}

export const SKILL_PRESETS: SkillPreset[] = [
  { id: 'melee-slash', label: 'Basic Strike (Melee Slash)', group: 'Melee & Ranged', burstAsset: 'fx-slash', damageText: '-24' },
  { id: 'firebolt', label: 'Firebolt (Ranged Projectile)', group: 'Melee & Ranged', projectileAsset: 'item-firebolt', burstAsset: 'fx-ember', statusAsset: 'status-burning', damageText: '-32' },
  { id: 'ember-lash', label: 'Flame Lash (Emberward)', group: 'Emberward', burstAsset: 'fx-ember', statusAsset: 'status-burning', damageText: '-38' },
  { id: 'cinder-nova', label: 'Cinder Nova (AoE Burst)', group: 'Emberward', burstAsset: 'fx-ember', statusAsset: 'status-burning', damageText: 'CRIT -64!', isCrit: true },
  { id: 'molten-ward', label: 'Molten Ward (Shield)', group: 'Emberward', burstAsset: 'fx-ember', statusAsset: 'status-warded', damageText: '+Ward' },
  { id: 'riptide', label: 'Riptide Bolt (Tidecaller)', group: 'Tidecaller', projectileAsset: 'fx-tide', burstAsset: 'fx-tide', statusAsset: 'status-soaked', damageText: '-30' },
  { id: 'healing-swell', label: 'Healing Swell (Mend)', group: 'Tidecaller', burstAsset: 'fx-tide', statusAsset: 'status-blessed', damageText: '+42 HP' },
  { id: 'undertow', label: 'Undertow (Root & Slow)', group: 'Tidecaller', burstAsset: 'fx-tide', statusAsset: 'status-rooted', damageText: '-22' },
  { id: 'windshot', label: 'Windshot (Gale Strider)', group: 'Gale Strider', projectileAsset: 'fx-gale', burstAsset: 'fx-gale', statusAsset: 'status-hasted', damageText: '-29' },
  { id: 'hawk-mark', label: "Mark of the Hawk + Spirit Hawk", group: 'Gale Strider', burstAsset: 'fx-gale', companionAsset: 'spirit-hawk', statusAsset: 'fx-mark', damageText: 'CRIT -58!', isCrit: true },
  { id: 'toll-mending', label: 'Toll of Mending (Bellbinder)', group: 'Bellbinder', burstAsset: 'fx-bell', statusAsset: 'status-blessed', damageText: '+36 HP' },
  { id: 'hallowed-ground', label: 'Hallowed Ground (Sanctum Ring)', group: 'Bellbinder', burstAsset: 'fx-bell', groundAsset: 'fx-hallowed-ground', statusAsset: 'status-shielded', damageText: '+Sanctuary' },
  { id: 'resonant-echo', label: 'Resonant Echo + Sandstorm Double', group: 'World Marks & Summons', burstAsset: 'fx-bell', groundAsset: 'fx-echo', companionAsset: 'sandstorm-double', statusAsset: 'status-silenced', damageText: '-44' },
  { id: 'woods-trap', label: 'Snare Trap (Whispering Woods)', group: 'World Marks & Summons', groundAsset: 'fx-trap', burstAsset: 'fx-slash', statusAsset: 'status-stunned', damageText: 'SNARED -26' },
];

export const ALL_STATUS_ICONS = [
  'status-burning',
  'status-poisoned',
  'status-blessed',
  'status-shielded',
  'status-hasted',
  'status-slowed',
  'status-stunned',
  'status-soaked',
  'status-warded',
  'status-silenced',
  'status-rooted',
  'status-marked',
  'fx-mark',
] as const;

export interface SkillStageState {
  walkerId: string;
  targetWalkerId: string;
  facing: IsoWay;
  presetId: string;
  activeStatuses: Set<string>;
  defeatState: boolean;
  lungeMotion: boolean;
  looping: boolean;
  lastTriggeredAt: number;
}

const stageByWalker = new Map<string, SkillStageState>();

export function getSkillStageState(w: WalkerView): SkillStageState {
  let st = stageByWalker.get(w.id);
  if (!st) {
    const defaultTarget =
      artState.data?.walkers.find((x) => x.id !== w.id && x.place.tab === 'monsters')?.id ??
      artState.data?.walkers.find((x) => x.id !== w.id)?.id ??
      w.id;
    st = {
      walkerId: w.id,
      targetWalkerId: defaultTarget,
      facing: 'front-right',
      presetId: 'melee-slash',
      activeStatuses: new Set(['status-burning']),
      defeatState: false,
      lungeMotion: true,
      looping: true,
      lastTriggeredAt: Date.now(),
    };
    stageByWalker.set(w.id, st);
  }
  return st;
}

function findArtItem(id: string | undefined): ArtItem | undefined {
  if (!id) return undefined;
  return artState.data?.items.find((i) => i.id === id);
}

export function skillStageHtml(w: WalkerView): string {
  const st = getSkillStageState(w);
  const preset = SKILL_PRESETS.find((p) => p.id === st.presetId) ?? SKILL_PRESETS[0]!;
  const walkers = artState.data?.walkers ?? [];

  const referencedAssets = [
    preset.burstAsset,
    preset.projectileAsset,
    preset.groundAsset,
    preset.companionAsset,
    preset.statusAsset,
  ]
    .filter((x, i, a): x is string => !!x && a.indexOf(x) === i)
    .map((id) => ({ id, item: findArtItem(id) }));

  return `
    <section class="studio-card skill-stage-card" data-ss-walker="${esc(w.id)}">
      <div class="studio-split-header">
        <div>
          <h4>⚔️ Interactive Attack, Skill &amp; Status Effect Stage</h4>
          <p class="note">Preview how <b>${esc(w.name)}</b> performs basic attacks, ranged projectiles, Calling skill bursts, ground marks, summoned companions, overhead status badges, and defeat/corpse states across all 4 isometric facings.</p>
        </div>
        <div class="wb-selectors">
          <div class="btn-group">
            ${WAYS.map(
              ([d, lbl]) =>
                `<button type="button" class="quiet${st.facing === d ? ' active-pill' : ''}" data-ss-facing="${d}" data-ss-walker="${esc(w.id)}" title="${esc(lbl)}">${esc(d)}</button>`,
            ).join('')}
          </div>
          <button type="button" data-ss-cast="${esc(w.id)}">⚡ Cast / Strike Now</button>
        </div>
      </div>

      <div class="ss-controls-grid">
        <label>Attack / Calling Skill Preset
          <span>
            <select data-ss-preset="${esc(w.id)}">
              ${(['Melee & Ranged', 'Emberward', 'Tidecaller', 'Gale Strider', 'Bellbinder', 'World Marks & Summons'] as const)
                .map(
                  (grp) =>
                    `<optgroup label="${esc(grp)}">${SKILL_PRESETS.filter((p) => p.group === grp)
                      .map((p) => `<option value="${esc(p.id)}"${p.id === st.presetId ? ' selected' : ''}>${esc(p.label)}</option>`)
                      .join('')}</optgroup>`,
                )
                .join('')}
            </select>
          </span>
        </label>

        <label>Target Dummy Entity
          <span>
            <select data-ss-target="${esc(w.id)}">
              ${walkers.map((t) => `<option value="${esc(t.id)}"${t.id === st.targetWalkerId ? ' selected' : ''}>${esc(t.name)} (${esc(t.kind)})</option>`).join('')}
            </select>
          </span>
        </label>

        <div class="ss-toggles">
          <label class="check"><input type="checkbox" data-ss-toggle="lungeMotion" data-ss-walker="${esc(w.id)}"${st.lungeMotion ? ' checked' : ''}> Lunge tween</label>
          <label class="check"><input type="checkbox" data-ss-toggle="defeatState" data-ss-walker="${esc(w.id)}"${st.defeatState ? ' checked' : ''}> Target Defeated / Corpse</label>
          <label class="check"><input type="checkbox" data-ss-toggle="looping" data-ss-walker="${esc(w.id)}"${st.looping ? ' checked' : ''}> Auto-loop</label>
        </div>
      </div>

      <div class="ss-main-row">
        <canvas class="ss-canvas" data-ss-canvas="${esc(w.id)}" width="520" height="260"></canvas>
        <div class="ss-side-panel">
          <h5>Overhead Status Icons on Target</h5>
          <div class="ss-status-pills">
            ${ALL_STATUS_ICONS.map((sId) => {
              const item = findArtItem(sId);
              const on = st.activeStatuses.has(sId);
              return `<button type="button" class="quiet status-toggle-btn${on ? ' active-pill' : ''}" data-ss-status="${esc(sId)}" data-ss-walker="${esc(w.id)}">
                ${item?.url ? `<img src="${esc(item.url)}" alt="">` : '<span class="mini-ph">?</span>'}
                <span>${esc(sId.replace(/^(status-|fx-)/, ''))}</span>
              </button>`;
            }).join('')}
          </div>

          <h5>Skill FX Assets Used in This Preview</h5>
          <div class="ss-fx-list">
            ${referencedAssets
              .map(({ id, item }) => {
                const painted = !!item?.url;
                return `
                  <div class="ss-fx-row ${painted ? 'ok' : 'missing'}">
                    ${painted ? `<img src="${esc(item!.url!)}" alt="">` : '<span class="mini-ph">?</span>'}
                    <div>
                      <b>${esc(item?.name ?? id)}</b>
                      <small>${painted ? 'Painted' : 'Using procedural fallback until painted'}</small>
                    </div>
                    ${
                      item?.repaintable
                        ? `<div class="card-actions">
                            <button type="button" class="quiet" data-art-review="${esc(JSON.stringify({ what: 'paint', asset: id }))}" data-note="yes">${painted ? 'Repaint' : 'Paint'} (${usd(item.estimateUsd)})</button>
                            ${queueButtonHtml({ kind: 'paint', targetId: id, label: `Paint FX: ${item.name}`, category: 'HUD & Skill FX', estimateUsd: item.estimateUsd })}
                          </div>`
                        : ''
                    }
                  </div>`;
              })
              .join('')}
          </div>
        </div>
      </div>
    </section>`;
}

const ssImgCache = new Map<string, HTMLImageElement>();
function getStageImage(url: string | undefined): HTMLImageElement | undefined {
  if (!url) return undefined;
  let img = ssImgCache.get(url);
  if (img) return img.complete ? img : undefined;
  img = new Image();
  ssImgCache.set(url, img);
  img.src = url;
  return undefined;
}

let ssAnimTimer: number | undefined;

export function mountSkillStages(): void {
  if (!ssAnimTimer) {
    ssAnimTimer = window.setInterval(() => {
      for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-ss-canvas]')) {
        const walkerId = canvas.dataset.ssCanvas!;
        const w = artState.data?.walkers.find((x) => x.id === walkerId);
        if (w) drawSkillStageCanvas(canvas, w);
      }
    }, 50);
  }
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-ss-canvas]')) {
    const walkerId = canvas.dataset.ssCanvas!;
    const w = artState.data?.walkers.find((x) => x.id === walkerId);
    if (w) drawSkillStageCanvas(canvas, w);
  }
}

function drawSkillStageCanvas(canvas: HTMLCanvasElement, attacker: WalkerView): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const st = getSkillStageState(attacker);
  const preset = SKILL_PRESETS.find((p) => p.id === st.presetId) ?? SKILL_PRESETS[0]!;
  const target = artState.data?.walkers.find((x) => x.id === st.targetWalkerId) ?? attacker;

  const now = Date.now();
  const cycleMs = 1800;
  const elapsed = st.looping ? (now - st.lastTriggeredAt) % cycleMs : Math.min(cycleMs, now - st.lastTriggeredAt);
  const t = elapsed / cycleMs; // 0..1

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 2:1 Isometric studio floor grid
  ctx.fillStyle = '#181425';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.strokeStyle = 'rgba(90, 105, 136, 0.25)';
  ctx.lineWidth = 1;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2 + 24;
  for (let i = -5; i <= 5; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * 44 - 140, cy + i * 22 - 70);
    ctx.lineTo(cx + i * 44 + 140, cy + i * 22 + 70);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + i * 44 + 140, cy + i * 22 - 70);
    ctx.lineTo(cx + i * 44 - 140, cy + i * 22 + 70);
    ctx.stroke();
  }
  ctx.restore();

  // Compute Attacker and Target positions along the chosen isometric facing vector
  const dirVec: Record<IsoWay, [number, number]> = {
    'front-right': [1, 0.5],
    'front-left': [-1, 0.5],
    'back-right': [1, -0.5],
    'back-left': [-1, -0.5],
  };
  const [vx, vy] = dirVec[st.facing];
  const baseAx = cx - vx * 72;
  const baseAy = cy - vy * 72;
  const tx = cx + vx * 72;
  const ty = cy + vy * 72;

  // Lunge offset during strike window (t in 0.15..0.45)
  let lunge = 0;
  if (st.lungeMotion && t >= 0.12 && t <= 0.48) {
    const phase = (t - 0.12) / 0.36;
    lunge = Math.sin(phase * Math.PI) * 22;
  }
  const ax = baseAx + vx * lunge;
  const ay = baseAy + vy * lunge;

  // 1. Persistent Ground Mark (fx-hallowed-ground, fx-trap, fx-echo)
  if (preset.groundAsset) {
    const gItem = findArtItem(preset.groundAsset);
    const gImg = getStageImage(gItem?.url);
    const gx = preset.groundAsset === 'fx-hallowed-ground' ? ax : tx;
    const gy = preset.groundAsset === 'fx-hallowed-ground' ? ay + 16 : ty + 16;
    ctx.save();
    if (gImg) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(gImg, gx - 48, gy - 28, 96, 56);
    } else {
      ctx.strokeStyle = preset.groundAsset === 'fx-hallowed-ground' ? '#f2dc6b' : '#a7f070';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(gx, gy, 44, 22, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Draw entities in depth order (back-to-front by Y)
  const drawEntity = (entity: WalkerView, x: number, y: number, isAttacker: boolean) => {
    const facing: Facing = isAttacker
      ? st.facing
      : st.facing === 'front-right'
        ? 'back-left'
        : st.facing === 'front-left'
          ? 'back-right'
          : st.facing === 'back-right'
            ? 'front-left'
            : 'front-right';
    const attackStrip = isAttacker ? entity.attacks?.[facing] : undefined;
    const walkStrip = entity.walks[facing];
    const standUrl = entity.standing[facing]?.url ?? entity.url;

    ctx.save();
    // Defeat / Corpse rotation & fade on target
    if (!isAttacker && st.defeatState) {
      ctx.translate(x, y + 12);
      ctx.rotate(Math.PI / 2.2);
      ctx.globalAlpha = 0.65;
      x = 0;
      y = 0;
    }

    // Shadow ellipse
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 22, 24, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    const drawH = 96;
    if (attackStrip) {
      const img = getStageImage(attackStrip.url);
      if (img) {
        const fIdx = Math.min(attackStrip.frames - 1, Math.floor(t * attackStrip.frames));
        const fw = attackStrip.width / attackStrip.frames;
        const drawW = (fw * drawH) / attackStrip.height;
        ctx.drawImage(img, fIdx * fw, 0, fw, attackStrip.height, x - drawW / 2, y - drawH + 24, drawW, drawH);
      }
    } else if (walkStrip && isAttacker) {
      const img = getStageImage(walkStrip.url);
      if (img) {
        const fIdx = Math.floor(t * walkStrip.frames) % walkStrip.frames;
        const fw = walkStrip.width / walkStrip.frames;
        const drawW = (fw * drawH) / walkStrip.height;
        ctx.drawImage(img, fIdx * fw, 0, fw, walkStrip.height, x - drawW / 2, y - drawH + 24, drawW, drawH);
      }
    } else if (standUrl) {
      const img = getStageImage(standUrl);
      if (img) {
        const scale = Math.min(84 / img.naturalWidth, drawH / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        ctx.drawImage(img, x - w / 2, y - h + 24, w, h);
      }
    }

    // Draw tried-on weapon on attacker
    if (isAttacker && artState.tryOn.right) {
      const wItem = findArtItem(artState.tryOn.right);
      const wImg = getStageImage(wItem?.url);
      if (wImg) {
        const scale = (drawH * HELD_SIZE) / Math.max(wImg.naturalWidth, wImg.naturalHeight);
        const ww = wImg.naturalWidth * scale;
        const wh = wImg.naturalHeight * scale;
        const flip = facingSide(facing) === 'left';
        const heldX = x + (flip ? -16 : 16);
        const heldY = y - 18;
        ctx.save();
        if (!heldBehind(facing, 'right')) {
          ctx.translate(heldX, heldY);
          if (t >= 0.2 && t <= 0.5) ctx.rotate((flip ? -1 : 1) * Math.sin(((t - 0.2) / 0.3) * Math.PI) * 0.65);
          ctx.drawImage(wImg, -ww / 2, -wh / 2, ww, wh);
        }
        ctx.restore();
      }
    }

    // Target hit flash during impact window (t in 0.35..0.55)
    if (!isAttacker && !st.defeatState && t >= 0.35 && t <= 0.55) {
      ctx.fillStyle = 'rgba(255, 110, 110, 0.35)';
      ctx.beginPath();
      ctx.arc(x, y - 18, 32, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Overhead status effect badges on target
    if (!isAttacker) {
      const statuses = [...st.activeStatuses];
      if (preset.statusAsset && !statuses.includes(preset.statusAsset)) statuses.unshift(preset.statusAsset);
      const badgeSize = 20;
      const totalW = statuses.length * (badgeSize + 4);
      statuses.forEach((sId, idx) => {
        const bx = x - totalW / 2 + idx * (badgeSize + 4);
        const by = y - 82;
        const sItem = findArtItem(sId);
        const sImg = getStageImage(sItem?.url);
        ctx.fillStyle = 'rgba(24, 20, 37, 0.88)';
        ctx.strokeStyle = '#f2dc6b';
        ctx.lineWidth = 1;
        ctx.fillRect(bx, by, badgeSize, badgeSize);
        ctx.strokeRect(bx, by, badgeSize, badgeSize);
        if (sImg) {
          ctx.drawImage(sImg, bx + 2, by + 2, badgeSize - 4, badgeSize - 4);
        } else {
          ctx.fillStyle = '#feae34';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(sId.replace(/^(status-|fx-)/, '').slice(0, 2).toUpperCase(), bx + badgeSize / 2, by + 13);
        }
      });
    }
  };

  if (ay <= ty) {
    drawEntity(attacker, ax, ay, true);
    drawEntity(target, tx, ty, false);
  } else {
    drawEntity(target, tx, ty, false);
    drawEntity(attacker, ax, ay, true);
  }

  // 2. Summoned Companion (spirit-hawk, sandstorm-double)
  if (preset.companionAsset) {
    const cItem = findArtItem(preset.companionAsset);
    const cImg = getStageImage(cItem?.url);
    const compX = ax - vx * 26;
    const compY = ay - 46 + Math.sin(t * Math.PI * 2) * 6;
    if (cImg) {
      ctx.drawImage(cImg, compX - 24, compY - 24, 48, 48);
    } else {
      ctx.fillStyle = '#73eff7';
      ctx.beginPath();
      ctx.arc(compX, compY, 12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3. Projectile Flight (item-firebolt, fx-tide, fx-gale) during t in 0.18..0.42
  if (preset.projectileAsset && t >= 0.18 && t <= 0.42) {
    const pFrac = (t - 0.18) / 0.24;
    const px = ax + (tx - ax) * pFrac;
    const py = ay - 22 + (ty - 22 - (ay - 22)) * pFrac;
    const pItem = findArtItem(preset.projectileAsset);
    const pImg = getStageImage(pItem?.url);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(ty - ay, tx - ax));
    if (pImg) {
      ctx.drawImage(pImg, -18, -18, 36, 36);
    } else {
      ctx.fillStyle = '#feae34';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 4. Skill / Melee Burst at impact (t in 0.35..0.68)
  if (preset.burstAsset && t >= 0.35 && t <= 0.68) {
    const bFrac = (t - 0.35) / 0.33;
    const bItem = findArtItem(preset.burstAsset);
    const bImg = getStageImage(bItem?.url);
    const bx = preset.damageText.startsWith('+') ? ax : tx;
    const by = (preset.damageText.startsWith('+') ? ay : ty) - 20;
    ctx.save();
    ctx.globalAlpha = 1 - bFrac * 0.6;
    ctx.translate(bx, by);
    if (preset.burstAsset === 'fx-slash') {
      ctx.rotate(Math.atan2(ty - ay, tx - ax));
    }
    const sz = 52 + bFrac * 24;
    if (bImg) {
      ctx.drawImage(bImg, -sz / 2, -sz / 2, sz, sz);
    } else {
      ctx.strokeStyle = '#feae34';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, sz / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 5. Floating Damage / Heal Number (t in 0.38..0.85)
  if (t >= 0.38 && t <= 0.85) {
    const dFrac = (t - 0.38) / 0.47;
    const dx = preset.damageText.startsWith('+') ? ax : tx;
    const dy = (preset.damageText.startsWith('+') ? ay : ty) - 48 - dFrac * 24;
    ctx.save();
    ctx.font = preset.isCrit ? 'bold 16px ui-monospace, monospace' : 'bold 13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = preset.damageText.startsWith('+') ? '#a7f070' : preset.isCrit ? '#ffd23f' : '#f6757a';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(preset.damageText, dx, dy);
    ctx.fillText(preset.damageText, dx, dy);
    ctx.restore();
  }
}

export function rerenderSkillStage(w: WalkerView): void {
  const box = document.querySelector<HTMLElement>(`.skill-stage-card[data-ss-walker="${w.id}"]`);
  if (!box) return;
  box.outerHTML = skillStageHtml(w);
  mountSkillStages();
}

export function handleSkillStageClick(t: HTMLButtonElement): boolean {
  const walkerId = t.dataset.ssWalker ?? t.dataset.ssCast;
  if (!walkerId) return false;
  const w = artState.data?.walkers.find((x) => x.id === walkerId);
  if (!w) return false;
  const st = getSkillStageState(w);

  if (t.dataset.ssFacing) {
    st.facing = t.dataset.ssFacing as IsoWay;
    st.lastTriggeredAt = Date.now();
    rerenderSkillStage(w);
    return true;
  }
  if (t.dataset.ssCast) {
    st.lastTriggeredAt = Date.now();
    rerenderSkillStage(w);
    return true;
  }
  if (t.dataset.ssStatus) {
    const sId = t.dataset.ssStatus;
    if (st.activeStatuses.has(sId)) st.activeStatuses.delete(sId);
    else st.activeStatuses.add(sId);
    rerenderSkillStage(w);
    return true;
  }
  return false;
}

export function handleSkillStageChange(target: HTMLElement): boolean {
  if (target.dataset.ssPreset) {
    const w = artState.data?.walkers.find((x) => x.id === target.dataset.ssPreset);
    if (!w) return false;
    const st = getSkillStageState(w);
    st.presetId = (target as HTMLSelectElement).value;
    st.lastTriggeredAt = Date.now();
    rerenderSkillStage(w);
    return true;
  }
  if (target.dataset.ssTarget) {
    const w = artState.data?.walkers.find((x) => x.id === target.dataset.ssTarget);
    if (!w) return false;
    const st = getSkillStageState(w);
    st.targetWalkerId = (target as HTMLSelectElement).value;
    rerenderSkillStage(w);
    return true;
  }
  if (target.dataset.ssToggle && target.dataset.ssWalker) {
    const w = artState.data?.walkers.find((x) => x.id === target.dataset.ssWalker);
    if (!w) return false;
    const st = getSkillStageState(w);
    const key = target.dataset.ssToggle as 'lungeMotion' | 'defeatState' | 'looping';
    st[key] = (target as HTMLInputElement).checked;
    st.lastTriggeredAt = Date.now();
    rerenderSkillStage(w);
    return true;
  }
  return false;
}
