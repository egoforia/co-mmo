// A world for the robot playtester: the real server on a random port, with
// fake AI (the offline God and a fake painter, no video or sound), so a
// playtest never pays for anything. Bots join it as real players would.

import { afterEach } from 'vitest';
import { generateRegion, newCharacter, regionDef, type Character, type Role } from '@co-mmo/shared';
import { account, start } from '../test/helpers.ts';
import { Bot } from './bot.ts';

/** Server errors written to the log while a playtest runs: each is a finding. */
const serverErrors: string[] = [];
const original = console.error;
let capturing = false;

afterEach(() => {
  console.error = original;
  capturing = false;
  serverErrors.length = 0;
});

export interface BotOptions {
  role?: Exclude<Role, 'player'> | 'player';
  /** Where it starts: a region id (its spawn point) or the Sanctum. */
  region?: string;
  /** Changes to a new character: more Favor for wishes, a level for fights. */
  character?: Partial<Character>;
}

/** Starts the game with fake AI. Options go to the test server as they are. */
export async function playWorld(options: Parameters<typeof start>[0] = {}) {
  if (!capturing) {
    capturing = true;
    console.error = (...args: unknown[]) => {
      serverErrors.push(args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(' '));
      original(...args);
    };
  }
  const world = await start(options);
  const bots: Bot[] = [];
  return {
    ...world,
    /** What the server logged as errors so far. */
    serverErrors,
    /** Everything every bot found wrong, then the server's errors. */
    problems: () => [...bots.flatMap((b) => b.problems), ...serverErrors.map((e) => `The server logged an error: ${e}`)],
    /** Makes an account and joins the world with it as a robot player. */
    async bot(name: string, opts: BotOptions = {}): Promise<Bot> {
      const { id, token } = account(world.store, name, opts.role ?? 'player');
      if (opts.region || opts.character) {
        const regionId = opts.region ?? 'sanctum';
        const def = regionDef(regionId);
        if (!def) throw new Error(`There is no region ${regionId}.`);
        const spawn = generateRegion(def).spawn;
        world.store.savePosition(id, spawn.x, spawn.y, regionId, { ...newCharacter(), ...opts.character });
      }
      const bot = await Bot.join(world.ws, token, name);
      bots.push(bot);
      return bot;
    },
  };
}

export type PlayWorld = Awaited<ReturnType<typeof playWorld>>;

/** Chooses a world editor tool the way an editor does: its group on the rail, then the tool in the options bar. */
export async function chooseTool(page: import('playwright').Page, tool: string, root = '#editor'): Promise<void> {
  await page.click(`${root} [data-tools~="${tool}"]`);
  await page.click(`${root} [data-tool="${tool}"]`);
}

/** Makes the world editor's changes go live at once (the drafts pill's menu). */
export async function goLive(page: import('playwright').Page): Promise<void> {
  await page.click('#editor .publish-menu summary');
  // Ticking it draws the bar again, which folds the menu away.
  await page.check('#editor input[name="live"]');
}

/** Selects the building at a point of the screen and gives it floors from the inspector's Floors section. */
export async function giveFloors(page: import('playwright').Page, at: { x: number; y: number }, up: number, down: number): Promise<void> {
  await page.mouse.click(at.x, at.y);
  await page.click('#editor details[data-section="floors"] summary');
  await page.selectOption('#editor select[name="insp.floors.up"]', String(up));
  await page.selectOption('#editor select[name="insp.floors.down"]', String(down));
  await page.click('#editor [data-pick="apply:floors"]');
}

/** Chooses a thing to place from the asset picker's pictures, as an editor does. */
export async function pickAsset(page: import('playwright').Page, field: string, id: string, root = '#editor'): Promise<void> {
  await page.click(`${root} [data-asset-field="${field}"]`);
  await page.click(`.asset-picker [data-asset="${id}"]`);
}

export interface FrameStabilityStats {
  frameCount: number;
  settledFrames: number;
  canvasLum: number;
  litLum: number;
  pixelDiffPct: number;
  chunksLoaded: number;
  expectedChunks: number;
  fadeRunning: boolean;
  cam: { scrollX: number; scrollY: number; midX: number; midY: number } | null;
}

export interface StabilizeOptions {
  /** Minimum active Phaser render frames to wait before considering settled. */
  minFrames?: number;
  /** Minimum consecutive stable frames required (< maxDiffPct and >= minLuminance). */
  consecutiveStableFrames?: number;
  /** Minimum daylight luminance threshold (0-255). Default 120. */
  minLuminance?: number;
  /** Maximum allowed pixel change percentage between consecutive frames. Default 1.0 (1%). */
  maxDiffPct?: number;
  /** Timeout in milliseconds. Default 30_000. */
  timeoutMs?: number;
}

/**
 * Installs a lightweight Phaser POST_RENDER frame monitor on the page and runs
 * an initial shader/lighting warm-up sequence until high-noon sunlight uniforms,
 * normal maps, and ground chunks have rendered and stabilized.
 */
export async function warmUpSceneLighting(
  page: import('playwright').Page,
  opts: StabilizeOptions = {},
): Promise<FrameStabilityStats> {
  const minFrames = opts.minFrames ?? 10;
  const consecutiveStableFrames = opts.consecutiveStableFrames ?? 2;
  const minLuminance = opts.minLuminance ?? 120;
  const maxDiffPct = opts.maxDiffPct ?? 1.0;
  const timeoutMs = opts.timeoutMs ?? 45_000;

  // Allow initial preload, shader compilation, and region generation to complete before polling
  await page.waitForTimeout(6000);

  await page.waitForFunction(
    () => {
      const w = window as any;
      const scene = w.scene;
      return Boolean(scene?.shown && scene?.me?.body && scene?.drawn?.size > 0);
    },
    undefined,
    { timeout: timeoutMs },
  );

  // Install the POST_RENDER frame sampler on game.renderer (right after WebGL flush) and lock high-noon sky
  await page.evaluate(
    (cfg) => {
      const w = window as any;
      const game = w.game;
      const scene = w.scene;

      if (!w.__playtestFrameMonitor) {
        // Single contiguous 16x16 readPixels patch in the viewport center (256 pixels, 1 WebGL flush)
        const patchW = 16;
        const patchH = 16;
        const totalSamples = patchW * patchH;
        const patchBuf = new Uint8Array(totalSamples * 4);
        let prevLums: Float32Array | null = null;

        const monitor = {
          frameCount: 0,
          startFrame: 0,
          stableRun: 0,
          canvasLum: 0,
          litLum: 0,
          pixelDiffPct: 100,
          minFrames: 2,
          targetStable: 1,
          minLuminance: 120,
          maxDiffPct: 1.0,
          active: false,
          reset(minF = 2, targetS = 1, minLum = 120, maxDiff = 1.0) {
            this.startFrame = this.frameCount;
            this.stableRun = 0;
            this.pixelDiffPct = 100;
            this.minFrames = minF;
            this.targetStable = targetS;
            this.minLuminance = minLum;
            this.maxDiffPct = maxDiff;
            this.active = true;
            prevLums = null;
          },
        };

        // Ensure PRE_RENDER clears any camera fade-in before WebGL draws the fade overlay
        scene.events.on('prerender', () => {
          const sc = w.scene;
          sc?.previewSky?.({ phase: 0.5, weather: 'clear' });
          const cam = sc?.cameras?.main;
          if (cam?.fadeEffect) {
            cam.fadeEffect.reset();
            cam.fadeEffect.alpha = 0;
          }
        });

        const onPostRender = () => {
          const sc = w.scene;
          const cam = sc?.cameras?.main;
          if (cam?.fadeEffect) {
            cam.fadeEffect.reset();
            cam.fadeEffect.alpha = 0;
          }

          monitor.frameCount++;
          if (!monitor.active) return;

          const rendered = monitor.frameCount - monitor.startFrame;
          // Skip pixel readback during early warm-up frames; only sample once approaching minFrames
          const sampleStartFrame = Math.max(1, monitor.minFrames - monitor.targetStable);
          if (rendered < sampleStartFrame) return;

          const gl: WebGLRenderingContext | undefined = game.renderer?.gl;
          if (!gl) return;

          const width = gl.drawingBufferWidth || game.canvas.width || 1280;
          const height = gl.drawingBufferHeight || game.canvas.height || 800;

          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          const px = Math.max(0, Math.floor(width / 2 + 24));
          const py = Math.max(0, Math.floor(height / 2 - patchH / 2));
          gl.readPixels(px, py, patchW, patchH, gl.RGBA, gl.UNSIGNED_BYTE, patchBuf);

          const curLums = new Float32Array(totalSamples);
          let sumLum = 0;
          let litSumLum = 0;
          let litCount = 0;
          let diffSum = 0;

          for (let p = 0; p < totalSamples; p++) {
            const off = p * 4;
            const red = patchBuf[off]!;
            const green = patchBuf[off + 1]!;
            const blue = patchBuf[off + 2]!;
            const lum = 0.299 * red + 0.587 * green + 0.114 * blue;
            curLums[p] = lum;
            sumLum += lum;
            // Exclude subterranean void background (#181425 = rgb(24, 20, 37)) when computing lit foreground luminance
            if (Math.abs(red - 24) > 5 || Math.abs(green - 20) > 5 || Math.abs(blue - 37) > 5) {
              litSumLum += lum;
              litCount++;
            }
            if (prevLums) {
              diffSum += Math.abs(lum - prevLums[p]!);
            }
          }

          monitor.canvasLum = sumLum / totalSamples;
          monitor.litLum = litCount > 0 ? litSumLum / litCount : monitor.canvasLum;
          monitor.pixelDiffPct = prevLums ? (diffSum / (totalSamples * 255)) * 100 : 100;
          prevLums = curLums;

          const floor = sc?.floor ?? 0;
          const effectiveLum = floor >= 0 ? monitor.canvasLum : monitor.litLum;
          const fadeClear = !cam?.fadeEffect?.isRunning;
          if (fadeClear && monitor.pixelDiffPct < monitor.maxDiffPct && effectiveLum >= monitor.minLuminance) {
            monitor.stableRun++;
            if (rendered >= monitor.minFrames && monitor.stableRun >= monitor.targetStable) {
              monitor.active = false;
            }
          } else {
            monitor.stableRun = 0;
          }
        };

        if (game.renderer?.on) {
          game.renderer.on('postrender', onPostRender);
        } else {
          game.events.on('postrender', onPostRender);
        }
        w.__playtestFrameMonitor = monitor;
      }

      // Lock high-noon clear sky on the client and fast-forward SkyClock easing
      scene.previewSky?.({ phase: 0.5, weather: 'clear' });
      scene.sky?.tint?.(60_000);
      scene.sky?.sun?.(60_000);
      if (scene.cameras?.main?.fadeEffect) {
        scene.cameras.main.fadeEffect.reset();
        scene.cameras.main.fadeEffect.alpha = 0;
      }
      scene.nearAt = '';
      scene.drawNear?.(true);
      scene.revealBuildings?.(true);
      scene.applyFloor?.();
      w.__playtestFrameMonitor.reset(cfg.minFrames, cfg.consecutiveStableFrames, cfg.minLuminance, cfg.maxDiffPct);
    },
    { minFrames, consecutiveStableFrames, minLuminance, maxDiffPct },
  );

  const handle = await page.waitForFunction(
    (cfg) => {
      const w = window as any;
      const scene = w.scene;
      const mon = w.__playtestFrameMonitor;
      if (!scene || !mon) return false;

      const cam = scene.cameras?.main;
      const rendered = mon.frameCount - mon.startFrame;
      if (rendered < cfg.minFrames || mon.stableRun < cfg.consecutiveStableFrames) return false;

      const regions = [...(scene.drawn?.values() ?? [])];
      const chunksLoaded = regions.reduce((n: number, r: any) => n + (r.chunks?.size ?? 0), 0);
      return {
        frameCount: mon.frameCount,
        settledFrames: rendered,
        canvasLum: Math.round(mon.canvasLum * 10) / 10,
        litLum: Math.round(mon.litLum * 10) / 10,
        pixelDiffPct: Math.round(mon.pixelDiffPct * 100) / 100,
        chunksLoaded,
        expectedChunks: chunksLoaded,
        fadeRunning: Boolean(cam?.fadeEffect?.isRunning),
        cam: cam
          ? {
              scrollX: Math.round(cam.scrollX),
              scrollY: Math.round(cam.scrollY),
              midX: Math.round(cam.midPoint?.x ?? 0),
              midY: Math.round(cam.midPoint?.y ?? 0),
            }
          : null,
      };
    },
    { minFrames, consecutiveStableFrames },
    { timeout: timeoutMs },
  );

  return (await handle.jsonValue()) as FrameStabilityStats;
}

/**
 * Waits for the player avatar to arrive at a target waypoint, forces surrounding
 * ground chunks within DRAW_REACH to stream in, centers the camera with zero fade,
 * and waits for adaptive visual stabilization (< 1% frame diff and daylight luminance >= 120).
 */
export async function settleWaypointAndStabilize(
  page: import('playwright').Page,
  target: { x: number; y: number; floor: number; regionId?: string },
  opts: StabilizeOptions = {},
): Promise<FrameStabilityStats> {
  const minFrames = opts.minFrames ?? 2;
  const consecutiveStableFrames = opts.consecutiveStableFrames ?? 2;
  const minLuminance = opts.minLuminance ?? 120;
  const maxDiffPct = opts.maxDiffPct ?? 1.0;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const regionId = target.regionId ?? 'arch-testbed';

  // 1. Wait until client snapshot reconciliation places the avatar at the target coordinates and floor
  await page.waitForFunction(
    (t) => {
      const scene = (window as any).scene;
      if (!scene?.shown || !scene?.predictor?.position) return false;
      const pdx = Math.abs(scene.predictor.position.x - t.x);
      const pdy = Math.abs(scene.predictor.position.y - t.y);
      const sdx = Math.abs(scene.shown.x - t.x);
      const sdy = Math.abs(scene.shown.y - t.y);
      return (
        pdx < 0.2 &&
        pdy < 0.2 &&
        sdx < 0.2 &&
        sdy < 0.2 &&
        scene.predictor.position.floor === t.floor &&
        scene.floor === t.floor
      );
    },
    { x: target.x, y: target.y, floor: target.floor },
    { timeout: timeoutMs },
  );

  // 2. Snap avatar, stream surrounding chunks within DRAW_REACH, apply instant building cutaways, and center camera
  await page.evaluate(
    (t) => {
      const w = window as any;
      const scene = w.scene;
      if (!scene) return;

      // Ensure high-noon lighting uniforms are locked and eased to 100%
      scene.previewSky?.({ phase: 0.5, weather: 'clear' });
      scene.sky?.tint?.(60_000);
      scene.sky?.sun?.(60_000);

      // Snap exact coordinates and floor so update() does not trigger another changeFloor() fadeIn
      scene.floor = t.floor;
      scene.shown = { x: t.x, y: t.y };
      if (scene.me) {
        scene.placeAvatar?.(scene.me, t.x, t.y);
      }

      // Prune distant chunks from previous bays beyond DRAW_REACH (36) before streaming new ones
      const region = scene.drawn?.get(t.regionId);
      if (region?.map && region?.chunks) {
        const CHUNK = 32;
        const DRAW_REACH = 36;
        const map = region.map;
        const ox = map.def.at.x * map.width;
        const oy = map.def.at.y * map.height;
        const wx = ox + t.x;
        const wy = oy + t.y;
        const across = Math.ceil(map.width / CHUNK);
        for (const [index, chunk] of [...region.chunks.entries()]) {
          const cx = index % across;
          const cy = Math.floor(index / across);
          const left = ox + cx * CHUNK;
          const top = oy + cy * CHUNK;
          const dx = Math.max(left - wx, 0, wx - (left + CHUNK));
          const dy = Math.max(top - wy, 0, wy - (top + CHUNK));
          if (Math.hypot(dx, dy) > DRAW_REACH) {
            for (const o of chunk.objects ?? []) o.destroy?.();
            chunk.tilemap?.destroy?.();
            region.chunks.delete(index);
          }
        }
      }

      // Trigger chunk streaming around the new coordinates and instant cutaway/floor visibility
      scene.nearAt = '';
      scene.drawNear?.(true);
      scene.revealBuildings?.(true);
      scene.applyFloor?.();

      // Center camera directly onto avatar body and cancel any floor-transition fadeIn
      const cam = scene.cameras?.main;
      const me = scene.me;
      if (me?.body && cam) {
        cam.startFollow(me.body, true, 1, 1);
        cam.centerOn(me.body.x, me.body.y);
        if (cam.fadeEffect) {
          cam.fadeEffect.reset();
          cam.fadeEffect.alpha = 0;
        }
      }

      w.__playtestFrameMonitor?.reset(t.minFrames, t.consecutiveStableFrames, t.minLuminance, t.maxDiffPct);
    },
    { x: target.x, y: target.y, floor: target.floor, regionId, minFrames, consecutiveStableFrames, minLuminance, maxDiffPct },
  );

  // 3. Wait until all chunks within DRAW_REACH (36 tiles) are loaded & lit and consecutive frames stabilize
  const handle = await page.waitForFunction(
    (cfg) => {
      const w = window as any;
      const scene = w.scene;
      const mon = w.__playtestFrameMonitor;
      if (!scene || !mon) return false;

      // Ensure camera stays centered and any late fadeEffect is immediately cleared
      const cam = scene.cameras?.main;
      const me = scene.me;
      if (me?.body && cam) {
        cam.centerOn(me.body.x, me.body.y);
        if (cam.fadeEffect?.isRunning) {
          cam.fadeEffect.reset();
          cam.fadeEffect.alpha = 0;
        }
      }

      const region = scene.drawn?.get(cfg.regionId);
      if (!region?.map || !region?.chunks) return false;

      const CHUNK = 32;
      const DRAW_REACH = 36;
      const map = region.map;
      const ox = map.def.at.x * map.width;
      const oy = map.def.at.y * map.height;
      const wx = ox + cfg.x;
      const wy = oy + cfg.y;
      const across = Math.ceil(map.width / CHUNK);
      const down = Math.ceil(map.height / CHUNK);
      let expectedChunks = 0;
      let readyChunks = 0;

      for (let cy = 0; cy < down; cy++) {
        for (let cx = 0; cx < across; cx++) {
          const left = ox + cx * CHUNK;
          const top = oy + cy * CHUNK;
          const dx = Math.max(left - wx, 0, wx - (left + CHUNK));
          const dy = Math.max(top - wy, 0, wy - (top + CHUNK));
          if (Math.hypot(dx, dy) <= DRAW_REACH) {
            expectedChunks++;
            const chunk = region.chunks.get(cy * across + cx);
            if (!chunk?.layer) continue;
            const visibleOk = cfg.floor >= 0 ? Boolean(chunk.layer.visible) : !chunk.layer.visible;
            const litOk = !scene.lit || chunk.layer.pipeline?.name === 'Lit';
            if (visibleOk && litOk) readyChunks++;
          }
        }
      }

      if (readyChunks < expectedChunks) {
        scene.drawNear?.(true);
        return false;
      }

      const rendered = mon.frameCount - mon.startFrame;
      if (rendered < cfg.minFrames || mon.stableRun < cfg.consecutiveStableFrames) return false;

      return {
        frameCount: mon.frameCount,
        settledFrames: rendered,
        canvasLum: Math.round(mon.canvasLum * 10) / 10,
        litLum: Math.round(mon.litLum * 10) / 10,
        pixelDiffPct: Math.round(mon.pixelDiffPct * 100) / 100,
        chunksLoaded: region.chunks.size as number,
        expectedChunks,
        fadeRunning: Boolean(cam?.fadeEffect?.isRunning),
        cam: cam
          ? {
              scrollX: Math.round(cam.scrollX),
              scrollY: Math.round(cam.scrollY),
              midX: Math.round(cam.midPoint?.x ?? 0),
              midY: Math.round(cam.midPoint?.y ?? 0),
            }
          : null,
      };
    },
    {
      x: target.x,
      y: target.y,
      floor: target.floor,
      regionId,
      minFrames,
      consecutiveStableFrames,
    },
    { timeout: timeoutMs },
  );

  return (await handle.jsonValue()) as FrameStabilityStats;
}

