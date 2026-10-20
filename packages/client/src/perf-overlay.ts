import Phaser from 'phaser';
import type { PerfView } from '@co-mmo/shared';
import { biggestTextures, chartPoints, FrameStats, LONG_FRAME_MS, middle, Rate, textureMemory, whereTimeGoes, type TextureSize } from './perf-stats.ts';
import type { SceneCounts } from './world-scene.ts';
import { escapeHtml } from './ui.ts';

// The performance overlay (egoforia's ask of 2026-10-20): frame rate,
// memory, what is drawn, the network and the server running your part of
// the world, for the Owner and Stewards checking where the game is slow.
// F3 or Account switches it, kept in this browser like the camera preview.
// While it is off nothing is measured, so it costs players nothing.

const KEY = 'co-mmo.perf-overlay';
/** How often the numbers on screen change, and how often the server is asked. */
const REFRESH_MS = 500;
const PING_MS = 2000;
const SERVER_MS = 3000;
/** The chart's top: three frames at 60 a second. Slower frames stay at the top. */
const CHART_TOP_MS = 50;
const CHART_W = 260;
const CHART_H = 36;

/** True when the overlay was switched on in this browser. */
export function overlayOn(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

function remember(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, 'on');
    else localStorage.removeItem(KEY);
  } catch {
    // Storage is blocked: the overlay still switches, until the page reloads.
  }
}

/** What the overlay reads from the rest of the game. */
export interface PerfSources {
  game: Phaser.Game;
  /** The world scene's counts, once it has started. */
  counts: () => SceneCounts | undefined;
  /** Everything the game connection has received so far. */
  received: { messages: number; bytes: number; snapshots: number };
  /** Sends a ping; the overlay hears the pong through `pong`. */
  ping: (n: number) => void;
  /** The server's side, or undefined when it does not answer. */
  server: () => Promise<PerfView | undefined>;
  /** The camera's name and the region we are in. */
  camera: string;
  region: () => string;
}

/** Chrome's heap numbers; other browsers do not tell a page its memory. */
interface ChromeMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/** The on-screen panel of numbers, and the measuring behind it, which runs only while it shows. */
export class PerfOverlay {
  private readonly el: HTMLElement;
  private readonly frames = new FrameStats();
  private readonly messagesIn = new Rate();
  private readonly bytesIn = new Rate();
  private readonly snapshotsIn = new Rate();
  private lastReceived = { messages: 0, bytes: 0, snapshots: 0 };
  private stepAt = 0;
  private lastStep = 0;
  private drawCalls = 0;
  private lastDrawCalls = 0;
  private pings = new Map<number, number>();
  private trips: number[] = [];
  private pingCount = 0;
  private serverView?: PerfView;
  private serverQuiet = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private unwrapGl?: () => void;
  private report = '';

  constructor(private readonly sources: PerfSources) {
    this.el = document.createElement('div');
    this.el.id = 'perf';
    this.el.hidden = true;
    this.el.setAttribute('aria-live', 'off');
    // Just above the game, below every window, so it never covers one.
    const game = document.getElementById('game');
    if (game) game.after(this.el);
    else document.body.append(this.el);
    this.el.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('button');
      if (button?.dataset.perf === 'close') this.show(false);
      if (button?.dataset.perf === 'copy') void this.copy(button);
    });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'F3') return;
      // F3 is also the browser's find-again; here it belongs to the overlay.
      event.preventDefault();
      this.show(this.el.hidden);
    });
    if (overlayOn()) this.show(true);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Shows or hides the overlay, remembering the choice in this browser. */
  show(on: boolean): void {
    remember(on);
    if (on === this.open) return;
    this.el.hidden = !on;
    if (on) this.start();
    else this.stop();
  }

  /** A pong came back: one more round trip timed. */
  pong(n: number): void {
    const sent = this.pings.get(n);
    if (sent === undefined) return;
    this.pings.delete(n);
    this.trips.push(performance.now() - sent);
    if (this.trips.length > 5) this.trips.shift();
  }

  private start(): void {
    const events = this.sources.game.events;
    events.on(Phaser.Core.Events.PRE_STEP, this.preStep, this);
    events.on(Phaser.Core.Events.PRE_RENDER, this.preRender, this);
    events.on(Phaser.Core.Events.POST_RENDER, this.postRender, this);
    events.on(Phaser.Core.Events.VISIBLE, this.resume, this);
    this.unwrapGl = this.countDrawCalls();
    this.lastReceived = { ...this.sources.received };
    this.resume();
    this.timers = [
      setInterval(() => this.render(), REFRESH_MS),
      setInterval(() => this.sendPing(), PING_MS),
      setInterval(() => void this.askServer(), SERVER_MS),
    ];
    this.sendPing();
    void this.askServer();
    this.render();
  }

  private stop(): void {
    const events = this.sources.game.events;
    events.off(Phaser.Core.Events.PRE_STEP, this.preStep, this);
    events.off(Phaser.Core.Events.PRE_RENDER, this.preRender, this);
    events.off(Phaser.Core.Events.POST_RENDER, this.postRender, this);
    events.off(Phaser.Core.Events.VISIBLE, this.resume, this);
    this.unwrapGl?.();
    this.unwrapGl = undefined;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.pings.clear();
  }

  /** After a hidden tab, the first frame would read as one long stutter: start counting again. */
  private resume(): void {
    this.frames.clear();
    this.lastStep = 0;
  }

  private preStep(): void {
    this.stepAt = performance.now();
  }

  private preRender(): void {
    this.drawCalls = 0;
  }

  private postRender(): void {
    const now = performance.now();
    this.lastDrawCalls = this.drawCalls;
    if (this.lastStep) this.frames.frame(this.stepAt - this.lastStep, now - this.stepAt);
    this.lastStep = this.stepAt;
  }

  /**
   * Counts the WebGL draw calls each frame by wrapping the two calls that
   * draw. Undone when the overlay closes, so the game draws untouched.
   */
  private countDrawCalls(): (() => void) | undefined {
    const renderer = this.sources.game.renderer;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return undefined;
    const gl = renderer.gl;
    const elements = gl.drawElements;
    const arrays = gl.drawArrays;
    const overlay = this;
    gl.drawElements = function (this: WebGLRenderingContext, ...args: Parameters<WebGLRenderingContext['drawElements']>) {
      overlay.drawCalls++;
      return elements.apply(this, args);
    };
    gl.drawArrays = function (this: WebGLRenderingContext, ...args: Parameters<WebGLRenderingContext['drawArrays']>) {
      overlay.drawCalls++;
      return arrays.apply(this, args);
    };
    return () => {
      gl.drawElements = elements;
      gl.drawArrays = arrays;
    };
  }

  private sendPing(): void {
    const n = ++this.pingCount;
    this.pings.set(n, performance.now());
    // A ping lost in a reconnect is forgotten rather than kept forever.
    for (const old of this.pings.keys()) if (old < n - 5) this.pings.delete(old);
    this.sources.ping(n);
  }

  private async askServer(): Promise<void> {
    const view = await this.sources.server().catch(() => undefined);
    this.serverQuiet = !view;
    if (view) this.serverView = view;
  }

  private async copy(button: HTMLButtonElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.report);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy blocked';
    }
    setTimeout(() => (button.textContent = 'Copy'), 1500);
  }

  /** Lays out the numbers again, and the same as plain text for the Copy button. */
  private render(): void {
    const now = performance.now();
    const received = this.sources.received;
    this.messagesIn.add(received.messages - this.lastReceived.messages, now);
    this.bytesIn.add(received.bytes - this.lastReceived.bytes, now);
    this.snapshotsIn.add(received.snapshots - this.lastReceived.snapshots, now);
    this.lastReceived = { ...received };

    const game = this.sources.game;
    const f = this.frames.summary();
    const webgl = game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer ? game.renderer : undefined;
    const scene = game.scene.getScenes(true)[0];
    const cam = scene?.cameras.main;
    const objects = scene && cam ? countObjects(scene.children.list, cam.worldView) : { all: 0, onScreen: 0 };
    const lights = scene?.lights?.active ? { all: scene.lights.getLightCount(), lit: scene.lights.visibleLights, max: scene.lights.maxLights } : undefined;
    const sizes = textureSizes(game);
    const pictures = textureMemory(sizes);
    const memory = (performance as Performance & { memory?: ChromeMemory }).memory;
    const counts = this.sources.counts();
    const ping = this.trips.length ? middle(this.trips) : undefined;
    const s = this.serverView;
    const here = s?.here;

    const rows: [string, string, string][] = [];
    const row = (label: string, text: string, level = '') => rows.push([label, text, level]);
    row('Frames', `${f.fps.toFixed(0)} fps · slowest 1% ${f.lowFps.toFixed(0)} fps · ${f.frameMs.toFixed(1)} ms a frame (worst ${f.worstMs.toFixed(0)})`,
      f.fps && f.fps < 30 ? 'bad' : f.fps && f.fps < 50 ? 'warn' : '');
    row('Work', `${f.workMs.toFixed(1)} ms a frame working and drawing · ${f.longFrames} stutter${f.longFrames === 1 ? '' : 's'} over ${LONG_FRAME_MS} ms lately`,
      f.longFrames > 5 ? 'warn' : '');
    row('Drawing', `${webgl ? `WebGL · ${this.lastDrawCalls} draw calls` : 'Canvas'} · ${objects.all} objects, ${objects.onScreen} on screen${lights ? ` · ${lights.all} lights, ${lights.lit} of ${lights.max} lit` : ''}`,
      this.lastDrawCalls > 500 ? 'warn' : '');
    const hint = whereTimeGoes(f.fps, f.frameMs, f.workMs);
    if (hint) row('Hint', hint);
    row('Screen', `${game.canvas.width}×${game.canvas.height} px · zoom ${cam?.zoom.toFixed(2) ?? '?'} · ${this.sources.camera}`);
    row('Pictures', `${pictures.count} held · about ${pictures.mb.toFixed(0)} MB on the graphics card`, pictures.mb > 1024 ? 'warn' : '');
    row('Memory', memory
      ? `${mb(memory.usedJSHeapSize)} of ${mb(memory.jsHeapSizeLimit)} MB for the page's code and data`
      : 'This browser does not tell a page its memory (Chrome does)',
    memory && memory.usedJSHeapSize > memory.jsHeapSizeLimit * 0.7 ? 'warn' : '');
    row('Network', `${ping === undefined ? 'no answer yet' : `${ping.toFixed(0)} ms round trip`} · ${this.snapshotsIn.perSecond(now).toFixed(0)} snapshots/s · ${this.messagesIn.perSecond(now).toFixed(0)} messages/s · ${(this.bytesIn.perSecond(now) / 1024).toFixed(1)} kB/s in`,
      ping !== undefined && ping > 200 ? 'warn' : '');
    if (counts) {
      row('World', `${this.sources.region()}${counts.tile ? ` at ${counts.tile.x}, ${counts.tile.y}` : ''} · ${counts.players} player${counts.players === 1 ? '' : 's'}, ${counts.creatures} creatures, ${counts.npcs} people, ${counts.bodies} fallen`);
      row('Drawn', `${counts.regions} region${counts.regions === 1 ? '' : 's'}, ${counts.chunks} chunks of ground near you, ${counts.lamps} lamps`);
    }
    if (here) {
      const tickMs = 1000 / s.tickRate;
      row('Server', `${here.server}${here.parts ? `, part ${here.part} of ${here.parts}` : ''} · tick ${here.tickMs.toFixed(1)} ms (worst ${here.worstTickMs.toFixed(1)} of ${tickMs.toFixed(0)}) · ${here.ticksPerSecond.toFixed(0)} of ${s.tickRate} ticks/s`,
        here.worstTickMs >= tickMs || (here.ticksPerSecond && here.ticksPerSecond < s.tickRate * 0.9) ? 'bad' : here.tickMs >= tickMs / 2 ? 'warn' : '');
      row('', `waits ${here.lagMs.toFixed(1)} ms to run (worst ${here.worstLagMs.toFixed(0)}) · ${here.memoryMb} MB (${here.heapMb} MB of data) · ${here.players} player${here.players === 1 ? '' : 's'}, ${here.creatures} creature${here.creatures === 1 ? '' : 's'} in ${here.region}`,
        here.worstLagMs > tickMs ? 'warn' : '');
      row('', `${s.online} online · ${s.servers} server${s.servers === 1 ? '' : 's'}`);
    } else {
      row('Server', this.serverQuiet ? 'Not answering right now' : 'Asking...', this.serverQuiet ? 'warn' : '');
    }

    const gpu = webgl ? gpuName(webgl.gl) : undefined;
    const big = biggestTextures(sizes, 3).map((t) => `${t.key} ${t.width}×${t.height}`).join(', ');
    this.report = [
      `co-MMO performance, ${new Date().toISOString()}`,
      ...rows.map(([label, text]) => `${(label || '').padEnd(9)}${text}`),
      `Device   ${navigator.hardwareConcurrency ?? '?'} cores${gpu ? ` · ${gpu}` : ''} · pixel ratio ${window.devicePixelRatio}`,
      `Biggest  ${big || 'none'}`,
      `Browser  ${navigator.userAgent}`,
    ].join('\n');

    this.el.innerHTML = `
      <div class="perf-head"><b>Performance</b><span>F3 hides</span>
        <button type="button" data-perf="copy" title="Copy these numbers as text, to share">Copy</button>
        <button type="button" data-perf="close" aria-label="Close">×</button></div>
      <svg class="perf-chart" viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" aria-label="Time between frames, the last few seconds">
        <polyline class="perf-target" points="0,${(CHART_H - (1000 / 60 / CHART_TOP_MS) * CHART_H).toFixed(1)} ${CHART_W},${(CHART_H - (1000 / 60 / CHART_TOP_MS) * CHART_H).toFixed(1)}" />
        <polyline class="perf-line" points="${chartPoints(f.recent, CHART_W, CHART_H, CHART_TOP_MS)}" />
      </svg>
      <table>${rows.map(([label, text, level]) => `<tr class="${level}"><th>${escapeHtml(label)}</th><td>${escapeHtml(text)}</td></tr>`).join('')}</table>`;
  }
}

/**
 * Every game object in a display list, containers opened up, and how many
 * stand inside the camera's view, roughly (by their position): Phaser still
 * walks those off screen each frame.
 */
function countObjects(list: Phaser.GameObjects.GameObject[], view: Phaser.Geom.Rectangle): { all: number; onScreen: number } {
  let all = 0;
  let onScreen = 0;
  for (const o of list) {
    all++;
    const at = o as Phaser.GameObjects.GameObject & { x?: number; y?: number; visible?: boolean };
    const shown = at.visible !== false;
    if (shown && (o instanceof Phaser.Tilemaps.TilemapLayer || (typeof at.x === 'number' && typeof at.y === 'number' && view.contains(at.x, at.y)))) onScreen++;
    if (o instanceof Phaser.GameObjects.Container && shown) {
      // A container's children stand relative to it.
      const inside = countObjects(o.list, new Phaser.Geom.Rectangle(view.x - o.x, view.y - o.y, view.width, view.height));
      all += inside.all;
      onScreen += inside.onScreen;
    }
  }
  return { all, onScreen };
}


/** Every picture the game holds, by its size in pixels. */
function textureSizes(game: Phaser.Game): TextureSize[] {
  const list = game.textures.list as Record<string, Phaser.Textures.Texture>;
  return Object.entries(list).flatMap(([key, texture]) => texture.source.map((s) => ({ key, width: s.width, height: s.height })));
}

/** The graphics card's name, when the browser tells it: a laptop's own chip draws far less than a separate card. */
function gpuName(gl: WebGLRenderingContext): string | undefined {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : undefined;
  } catch {
    return undefined;
  }
}

const mb = (bytes: number) => (bytes / 1_048_576).toFixed(0);
