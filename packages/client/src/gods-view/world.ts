// The World tab: the world grid with every region's map, and what needs attention.

import { escapeHtml } from '../ui.ts';
import { api, usd, when, type Budget, type Entry, type Tab } from './core.ts';

interface Region {
  id: string;
  name: string;
  biome: string;
  /** Its square on the world grid. */
  at: { x: number; y: number };
  /** Wished regions: who wished it, and how dangerous it is. */
  wisher?: string;
  danger?: number;
  /** The hour and the weather there now. */
  sky?: string;
  width: number;
  height: number;
  players: { id: string; name: string; x: number; y: number; level?: number }[];
  creatures: { kind: string; x: number; y: number; alive: boolean }[];
  npcs: { name: string; x: number; y: number }[];
  landmarks: { asset: string; x: number; y: number }[];
}

let regions: Region[] = [];

async function world(): Promise<string> {
  const o = await api<{ regions: Region[]; online: number; recent: Entry[]; queue: number; reports: number; rules: number; budget: Budget | null; update: { behind: number; blocked?: string } | null; building: number }>('overview');
  regions = o.regions;
  // The world grid, one square per region; it grows as regions are wished.
  const xs = regions.map((r) => r.at.x);
  const ys = regions.map((r) => r.at.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const columns = Math.max(...xs) + 1 - left;
  const rows = Math.max(...ys) + 1 - top;
  const byCell = new Map(regions.map((r) => [`${r.at.x},${r.at.y}`, r]));
  const cell = (x: number, y: number) => {
    const r = byCell.get(`${x},${y}`);
    if (!r) return '<div></div>';
    const alive = r.creatures.filter((c) => c.alive).length;
    const credit = r.wisher ? `<br><small>wished by ${escapeHtml(r.wisher)} · danger ${r.danger}</small>` : '';
    return `<figure class="region ${r.id} ${escapeHtml(r.biome)}"><canvas data-region="${r.id}" width="${r.width * 4}" height="${r.height * 4}"></canvas>
      <figcaption><b>${escapeHtml(r.name)}</b> · ${r.players.length} here · ${alive} creatures${r.sky ? ` · ${escapeHtml(r.sky)}` : ''}${credit}</figcaption></figure>`;
  };
  const grid: string[] = [];
  for (let y = top; y < top + rows; y++) for (let x = left; x < left + columns; x++) grid.push(cell(x, y));
  const b = o.budget;
  const budgetCard = b
    ? `<div class="stat ${b.over ? 'bad' : b.warn ? 'warn' : ''}"><b>${usd(b.spentUsd)}</b><span>spent of ${usd(b.monthlyUsd)} this month</span></div>`
    : '';
  return `
    <div class="stats">
      <div class="stat"><b>${o.online}</b><span>online now</span></div>
      <div class="stat ${o.queue ? 'warn' : ''}"><b>${o.queue}</b><span>wishes waiting for review</span></div>
      <div class="stat ${o.reports ? 'warn' : ''}"><b>${o.reports}</b><span>open reports</span></div>
      <div class="stat"><b>${o.rules}</b><span>scripted rules live</span></div>
      ${o.building ? `<a class="stat" href="#wishes"><b>${o.building}</b><span>wish${o.building === 1 ? '' : 'es'} being built</span></a>` : ''}
      ${budgetCard}
      ${o.update?.behind ? `<a class="stat warn" href="#updates"><b>${o.update.behind}</b><span>new commit${o.update.behind === 1 ? '' : 's'} on main</span></a>` : ''}
    </div>
    <div class="map" style="grid-template-columns: repeat(${columns}, minmax(0, 1fr)); max-width: ${columns * 300}px">${grid.join('')}</div>
    <p class="legend"><i class="p"></i> players <i class="c"></i> creatures <i class="n"></i> people <i class="l"></i> landmarks</p>
    <h2>Latest wishes</h2>
    ${o.recent.length ? `<ul class="recent">${o.recent.map((e) => `<li><b>${escapeHtml(e.title)}</b> by ${escapeHtml(e.wisher.name)} · ${when(e.at)}</li>`).join('')}</ul>` : '<p class="note">No wishes granted yet.</p>'}`;
}

function drawMaps(): void {
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-region]')) {
    const r = regions.find((x) => x.id === canvas.dataset.region);
    if (!r) continue;
    const ctx = canvas.getContext('2d')!;
    const s = canvas.width / r.width;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dot = (x: number, y: number, size: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x * s, y * s, size, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const l of r.landmarks) dot(l.x, l.y, 5, 'rgba(255,255,255,0.35)');
    for (const n of r.npcs) dot(n.x, n.y, 4, '#6fc3df');
    for (const c of r.creatures) if (c.alive) dot(c.x, c.y, 3, '#f6757a');
    for (const p of r.players) {
      dot(p.x, p.y, 5, '#feae34');
      ctx.fillStyle = '#fff';
      ctx.font = '11px sans-serif';
      ctx.fillText(p.name, p.x * s + 7, p.y * s + 4);
    }
  }
}

export const worldTab: Tab = { id: 'world', label: 'World', page: world, after: drawMaps, refreshMs: 3000 };
