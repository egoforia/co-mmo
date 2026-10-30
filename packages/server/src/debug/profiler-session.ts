import fs from 'node:fs';
import path from 'node:path';
import inspector from 'node:inspector';
import type { ActiveProfileRecording, ProfileInfo, ProfileRetentionPolicy, ProfileStatusResponse } from '@co-mmo/shared';
import type { RegionServers } from '../region-servers.ts';

export interface ProfilerConfig {
  dir: string;
  maxFiles: number;
  pruneHours: number;
}

/** Reads profile storage and retention settings from environment variables. */
export function getProfilerConfig(env: Record<string, string | undefined> = process.env): ProfilerConfig {
  const dir = env.PROFILE_DIR || 'data/profiles';
  const maxFiles = parseInt(env.PROFILE_MAX_FILES || '5', 10) || 5;
  const pruneHours = parseFloat(env.PROFILE_PRUNE_HOURS || '1') || 1;
  return { dir, maxFiles, pruneHours };
}

/** Parses profile metadata from a filename and its file stats. */
export function parseProfileFilename(filename: string, stat: { size: number; mtimeMs: number }): ProfileInfo | null {
  const isCpu = filename.endsWith('.cpuprofile');
  const isHeap = filename.endsWith('.heapsnapshot');
  if (!isCpu && !isHeap) return null;

  const ext = isCpu ? '.cpuprofile' : '.heapsnapshot';
  const id = filename.slice(0, -ext.length);
  const kind: 'cpu' | 'heap' = isCpu ? 'cpu' : 'heap';

  // Format: <host>-<timestamp> or <host>-<timestamp>-<kind>
  const match = id.match(/^(.*)-(\d+)(?:-(?:cpu|heap))?$/);
  const host = match ? match[1]! : 'gateway';
  const startedAt = match ? parseInt(match[2]!, 10) : Math.round(stat.mtimeMs);

  return {
    id,
    host,
    kind,
    startedAt,
    sizeBytes: stat.size,
  };
}

/** Enforces the retention policy by deleting old and excess profile files. */
export async function pruneProfiles(config: ProfilerConfig, now = Date.now()): Promise<string[]> {
  const dir = config.dir;
  if (!fs.existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return [];
  }

  const profiles: { filename: string; path: string; mtimeMs: number }[] = [];
  for (const file of entries) {
    if (file.endsWith('.cpuprofile') || file.endsWith('.heapsnapshot')) {
      const fullPath = path.join(dir, file);
      try {
        const stat = await fs.promises.stat(fullPath);
        profiles.push({ filename: file, path: fullPath, mtimeMs: stat.mtimeMs });
      } catch {
        // Ignored if file was deleted concurrently
      }
    }
  }

  const deleted: string[] = [];
  const maxAgeMs = config.pruneHours * 3600 * 1000;

  // 1. Prune files older than the retention threshold
  const kept: typeof profiles = [];
  for (const p of profiles) {
    if (now - p.mtimeMs > maxAgeMs) {
      try {
        await fs.promises.unlink(p.path);
        deleted.push(p.filename);
      } catch {}
    } else {
      kept.push(p);
    }
  }

  // 2. Enforce the maximum file count limit (keep newest, delete oldest excess)
  kept.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (kept.length > config.maxFiles) {
    const excess = kept.slice(config.maxFiles);
    for (const p of excess) {
      try {
        await fs.promises.unlink(p.path);
        deleted.push(p.filename);
      } catch {}
    }
  }

  return deleted;
}

/** Lists all saved profiles sorted newest first. */
export async function listProfiles(config: ProfilerConfig, now = Date.now()): Promise<ProfileInfo[]> {
  await pruneProfiles(config, now);
  const dir = config.dir;
  if (!fs.existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return [];
  }

  const list: ProfileInfo[] = [];
  for (const file of entries) {
    if (file.endsWith('.cpuprofile') || file.endsWith('.heapsnapshot')) {
      const fullPath = path.join(dir, file);
      try {
        const stat = await fs.promises.stat(fullPath);
        const info = parseProfileFilename(file, stat);
        if (info) list.push(info);
      } catch {}
    }
  }

  return list.sort((a, b) => b.startedAt - a.startedAt);
}

/** Finds a saved profile file by ID or filename. */
export async function getProfileFile(id: string, config: ProfilerConfig): Promise<{ filePath: string; filename: string; sizeBytes: number } | null> {
  const safeId = path.basename(id);
  const dir = config.dir;

  const candidates = [
    safeId,
    `${safeId}.cpuprofile`,
    `${safeId}.heapsnapshot`,
  ];

  for (const name of candidates) {
    const fullPath = path.join(dir, name);
    try {
      const stat = await fs.promises.stat(fullPath);
      if (stat.isFile() && (name.endsWith('.cpuprofile') || name.endsWith('.heapsnapshot'))) {
        return { filePath: fullPath, filename: name, sizeBytes: stat.size };
      }
    } catch {}
  }

  return null;
}

/** Deletes a saved profile file by ID. */
export async function deleteProfile(id: string, config: ProfilerConfig): Promise<boolean> {
  const file = await getProfileFile(id, config);
  if (!file) return false;
  try {
    await fs.promises.unlink(file.filePath);
    return true;
  } catch {
    return false;
  }
}

/** Records a CPU profile for the specified duration using node:inspector. */
export async function recordCpuProfile(durationSeconds: number): Promise<string> {
  const session = new inspector.Session();
  session.connect();

  await new Promise<void>((resolve, reject) => {
    session.post('Profiler.enable', (err: Error | null) => (err ? reject(err) : resolve()));
  });

  await new Promise<void>((resolve, reject) => {
    session.post('Profiler.start', (err: Error | null) => (err ? reject(err) : resolve()));
  });

  await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));

  const profile = await new Promise<any>((resolve, reject) => {
    session.post('Profiler.stop', (err: Error | null, res: any) => {
      if (err) reject(err);
      else resolve(res?.profile);
    });
  });

  await new Promise<void>((resolve) => {
    session.post('Profiler.disable', () => resolve());
  });

  session.disconnect();
  return JSON.stringify(profile);
}

/** Takes a heap snapshot using node:inspector and streams it to disk. */
export async function recordHeapSnapshotToFile(filePath: string): Promise<number> {
  const session = new inspector.Session();
  session.connect();

  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const writeStream = fs.createWriteStream(filePath);

  session.on('HeapProfiler.addHeapSnapshotChunk', (m: { params: { chunk: string } }) => {
    writeStream.write(m.params.chunk);
  });

  return new Promise<number>((resolve, reject) => {
    session.post('HeapProfiler.takeHeapSnapshot', (err: Error | null) => {
      writeStream.end(async () => {
        session.disconnect();
        if (err) {
          reject(err);
        } else {
          try {
            const stat = await fs.promises.stat(filePath);
            resolve(stat.size);
          } catch (e) {
            reject(e);
          }
        }
      });
    });
  });
}

/** Records a CPU profile or heap snapshot locally to disk. */
export async function recordProfileLocally(
  filePath: string,
  kind: 'cpu' | 'heap',
  durationSeconds: number,
  config: ProfilerConfig,
): Promise<{ sizeBytes: number; data?: string }> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  if (kind === 'cpu') {
    const data = await recordCpuProfile(durationSeconds);
    await fs.promises.writeFile(filePath, data, 'utf8');
    const stat = await fs.promises.stat(filePath);
    await pruneProfiles(config);
    return { sizeBytes: stat.size, data };
  } else {
    const sizeBytes = await recordHeapSnapshotToFile(filePath);
    await pruneProfiles(config);
    return { sizeBytes };
  }
}

/**
 * Manages active profiling requests, file persistence, and remote region server profiling.
 */
export class ProfilerManager {
  private activeRecording?: ActiveProfileRecording & { watchdog?: NodeJS.Timeout };

  constructor(readonly config: ProfilerConfig) {}

  /** Returns the active retention configuration. */
  getRetentionPolicy(): ProfileRetentionPolicy {
    return {
      dir: this.config.dir,
      maxFiles: this.config.maxFiles,
      pruneHours: this.config.pruneHours,
    };
  }

  /** Returns current recording status. */
  getActiveStatus(): ProfileStatusResponse {
    if (!this.activeRecording) return { recording: false };
    const { id, host, kind, startedAt, durationSeconds } = this.activeRecording;
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const remainingSeconds = Math.max(0, Math.ceil(durationSeconds - elapsedSeconds));
    return {
      recording: true,
      profile: {
        id,
        host,
        kind,
        startedAt,
        durationSeconds,
        remainingSeconds,
      },
    };
  }

  /** Starts recording a CPU profile or heap snapshot. */
  async startProfile(
    options: { host: string; kind?: 'cpu' | 'heap'; durationSeconds?: number },
    regionServers?: RegionServers,
  ): Promise<ActiveProfileRecording> {
    if (this.activeRecording) {
      const err = new Error('A profile is already being recorded.');
      (err as any).code = 'already_recording';
      throw err;
    }

    const host = options.host || 'gateway';
    const kind: 'cpu' | 'heap' = options.kind === 'heap' ? 'heap' : 'cpu';
    const durationSeconds = kind === 'heap' ? 0 : (options.durationSeconds && options.durationSeconds > 0 ? options.durationSeconds : 10);
    const startedAt = Date.now();
    const id = `${host}-${startedAt}-${kind}`;

    const recording: ActiveProfileRecording = {
      id,
      host,
      kind,
      startedAt,
      durationSeconds,
      remainingSeconds: durationSeconds,
    };

    if (host === 'gateway') {
      this.activeRecording = recording;
      const ext = kind === 'cpu' ? 'cpuprofile' : 'heapsnapshot';
      const filePath = path.join(this.config.dir, `${id}.${ext}`);

      // Run asynchronously in the background so the endpoint can answer immediately
      void recordProfileLocally(filePath, kind, durationSeconds, this.config)
        .catch((err) => {
          console.error('Gateway profiling failed:', err);
        })
        .finally(() => {
          if (this.activeRecording?.id === id) {
            this.activeRecording = undefined;
          }
        });

      return recording;
    }

    // Remote region server
    if (!regionServers || !regionServers.list().some((s) => s.id === host)) {
      const err = new Error('That region server is not running.');
      (err as any).code = 'no_server';
      throw err;
    }

    // Safety watchdog: clear recording state if region server never finishes
    const watchdogTimeoutMs = (durationSeconds + 20) * 1000;
    const watchdog = setTimeout(() => {
      if (this.activeRecording?.id === id) {
        console.warn(`Remote profiling on ${host} timed out after ${watchdogTimeoutMs / 1000}s`);
        this.activeRecording = undefined;
      }
    }, watchdogTimeoutMs);
    watchdog.unref?.();

    this.activeRecording = { ...recording, watchdog };
    regionServers.startProfile(host, id, durationSeconds, kind);

    return recording;
  }

  /** Handles profile completion message from a remote region server. */
  async handleProfileDone(m: { profileId: string; error?: string; data?: string }): Promise<void> {
    if (this.activeRecording?.id === m.profileId) {
      if (this.activeRecording.watchdog) clearTimeout(this.activeRecording.watchdog);
      const { kind } = this.activeRecording;
      this.activeRecording = undefined;

      if (!m.error) {
        const ext = kind === 'cpu' ? 'cpuprofile' : 'heapsnapshot';
        const filePath = path.join(this.config.dir, `${m.profileId}.${ext}`);
        if (m.data) {
          await fs.promises.mkdir(this.config.dir, { recursive: true });
          await fs.promises.writeFile(filePath, m.data, 'utf8');
        }
        await pruneProfiles(this.config);
      } else {
        console.warn(`Remote profile ${m.profileId} finished with error: ${m.error}`);
      }
    }
  }

  /** Lists saved profiles. */
  async listProfiles(): Promise<ProfileInfo[]> {
    return listProfiles(this.config);
  }

  /** Retrieves a saved profile file for download. */
  async getProfileFile(id: string) {
    return getProfileFile(id, this.config);
  }

  /** Deletes a saved profile. */
  async deleteProfile(id: string): Promise<boolean> {
    return deleteProfile(id, this.config);
  }

  /** Cleans up any pending timers. */
  close(): void {
    if (this.activeRecording?.watchdog) {
      clearTimeout(this.activeRecording.watchdog);
      this.activeRecording = undefined;
    }
  }
}

let defaultManager: ProfilerManager | undefined;

/** Returns a shared ProfilerManager instance configured for the environment. */
export function getProfilerManager(env: Record<string, string | undefined> = process.env): ProfilerManager {
  if (!defaultManager) {
    defaultManager = new ProfilerManager(getProfilerConfig(env));
  }
  return defaultManager;
}
