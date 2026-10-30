import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  deleteProfile,
  getProfileFile,
  getProfilerConfig,
  listProfiles,
  pruneProfiles,
  recordCpuProfile,
  recordHeapSnapshotToFile,
  recordProfileLocally,
} from '../src/debug/profiler-session.ts';
import { account, api, start } from './helpers.ts';

async function until(test: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('CPU profile and heap snapshot session', () => {
  it('records a CPU profile using inspector with valid V8 nodes, samples, and timeDeltas', async () => {
    // Perform some minor computation while recording so there are samples
    const promise = recordCpuProfile(0.15);
    const start = Date.now();
    let sum = 0;
    while (Date.now() - start < 100) {
      sum += Math.sqrt(Math.random());
    }
    expect(sum).toBeGreaterThan(0);

    const jsonStr = await promise;
    expect(typeof jsonStr).toBe('string');
    const profile = JSON.parse(jsonStr);

    expect(profile).toHaveProperty('nodes');
    expect(Array.isArray(profile.nodes)).toBe(true);
    expect(profile.nodes.length).toBeGreaterThan(0);

    const rootNode = profile.nodes[0];
    expect(rootNode).toHaveProperty('id');
    expect(rootNode).toHaveProperty('callFrame');
    expect(rootNode.callFrame).toHaveProperty('functionName');

    expect(profile).toHaveProperty('samples');
    expect(Array.isArray(profile.samples)).toBe(true);

    expect(profile).toHaveProperty('timeDeltas');
    expect(Array.isArray(profile.timeDeltas)).toBe(true);

    expect(profile).toHaveProperty('startTime');
    expect(profile).toHaveProperty('endTime');
    expect(profile.endTime).toBeGreaterThanOrEqual(profile.startTime);
  });

  it('takes a heap snapshot and writes valid JSON to file', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(tmpdir(), 'heap-'));
    const filePath = path.join(tempDir, 'test.heapsnapshot');

    const size = await recordHeapSnapshotToFile(filePath);
    expect(size).toBeGreaterThan(0);

    const content = await fs.promises.readFile(filePath, 'utf8');
    const snapshot = JSON.parse(content);

    expect(snapshot).toHaveProperty('snapshot');
    expect(snapshot.snapshot).toHaveProperty('meta');
    expect(snapshot).toHaveProperty('nodes');
    expect(Array.isArray(snapshot.nodes)).toBe(true);
    expect(snapshot).toHaveProperty('edges');
    expect(Array.isArray(snapshot.edges)).toBe(true);
    expect(snapshot).toHaveProperty('strings');
    expect(Array.isArray(snapshot.strings)).toBe(true);

    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }, 30_000);

  it('enforces retention limits and auto-pruning (max files and prune hours)', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(tmpdir(), 'retention-'));
    const config = { dir: tempDir, maxFiles: 3, pruneHours: 1 };

    const now = Date.now();
    const files = [
      { name: `gateway-${now - 3 * 3600 * 1000}.cpuprofile`, mtime: now - 3 * 3600 * 1000 }, // 3h old (should prune)
      { name: `gateway-${now - 2 * 3600 * 1000}.heapsnapshot`, mtime: now - 2 * 3600 * 1000 }, // 2h old (should prune)
      { name: `gateway-${now - 40 * 60 * 1000}.cpuprofile`, mtime: now - 40 * 60 * 1000 }, // 40m old (excess, should prune)
      { name: `r1-${now - 30 * 60 * 1000}.cpuprofile`, mtime: now - 30 * 60 * 1000 }, // 30m old (excess, should prune)
      { name: `r1-${now - 15 * 60 * 1000}.heapsnapshot`, mtime: now - 15 * 60 * 1000 }, // 15m old (keep)
      { name: `gateway-${now - 5 * 60 * 1000}.cpuprofile`, mtime: now - 5 * 60 * 1000 }, // 5m old (keep)
      { name: `gateway-${now - 1 * 60 * 1000}.cpuprofile`, mtime: now - 1 * 60 * 1000 }, // 1m old (keep)
    ];

    for (const f of files) {
      const p = path.join(tempDir, f.name);
      await fs.promises.writeFile(p, JSON.stringify({ test: true }), 'utf8');
      const timeSec = f.mtime / 1000;
      await fs.promises.utimes(p, timeSec, timeSec);
    }

    const initial = await fs.promises.readdir(tempDir);
    expect(initial).toHaveLength(7);

    // Prune files
    await pruneProfiles(config, now);

    const remaining = await fs.promises.readdir(tempDir);
    expect(remaining).toHaveLength(3);
    expect(remaining).toContain(`r1-${now - 15 * 60 * 1000}.heapsnapshot`);
    expect(remaining).toContain(`gateway-${now - 5 * 60 * 1000}.cpuprofile`);
    expect(remaining).toContain(`gateway-${now - 1 * 60 * 1000}.cpuprofile`);

    // List profiles
    const profiles = await listProfiles(config, now);
    expect(profiles).toHaveLength(3);
    expect(profiles[0]!.startedAt).toBe(now - 1 * 60 * 1000);
    expect(profiles[1]!.startedAt).toBe(now - 5 * 60 * 1000);
    expect(profiles[2]!.startedAt).toBe(now - 15 * 60 * 1000);
    expect(profiles[2]!.host).toBe('r1');
    expect(profiles[2]!.kind).toBe('heap');

    // Get profile file
    const file = await getProfileFile(`gateway-${now - 1 * 60 * 1000}`, config);
    expect(file).not.toBeNull();
    expect(file!.filename).toBe(`gateway-${now - 1 * 60 * 1000}.cpuprofile`);

    // Delete profile
    const deleted = await deleteProfile(`gateway-${now - 1 * 60 * 1000}`, config);
    expect(deleted).toBe(true);
    expect(await getProfileFile(`gateway-${now - 1 * 60 * 1000}`, config)).toBeNull();

    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }, 30_000);
});

describe('Admin profiling HTTP endpoints', () => {
  it('allows only the Owner to record, inspect status, download, and delete profiles', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(tmpdir(), 'admin-profiles-'));

    const { store, base } = await start({
      env: {
        PROFILE_DIR: tempDir,
        PROFILE_MAX_FILES: '5',
        PROFILE_PRUNE_HOURS: '1',
      },
    });
    const owner = account(store, 'egoforia', 'owner');
    const steward = account(store, 'Mara', 'steward');

    // Server health includes retention policy
    const health = await api(base, '/api/admin/servers', owner.token);
    expect(health.body.profileRetention).toEqual({
      dir: tempDir,
      maxFiles: 5,
      pruneHours: 1,
    });
    expect(health.body.profiles).toEqual([]);

    // Non-owner is forbidden
    expect((await api(base, '/api/admin/servers/profile', steward.token, 'POST', { host: 'gateway' })).status).toBe(403);
    expect((await api(base, '/api/admin/servers/profile/status', steward.token)).status).toBe(403);
    expect((await api(base, '/api/admin/servers/profile/nonexistent', steward.token)).status).toBe(403);
    expect((await api(base, '/api/admin/servers/profile/nonexistent', steward.token, 'DELETE')).status).toBe(403);

    // Initial status: not recording
    const statusBefore = await api(base, '/api/admin/servers/profile/status', owner.token);
    expect(statusBefore.body).toEqual({ recording: false });

    // Start recording CPU profile on gateway
    const startRes = await api(base, '/api/admin/servers/profile', owner.token, 'POST', {
      host: 'gateway',
      kind: 'cpu',
      durationSeconds: 0.15,
    });
    expect(startRes.status).toBe(200);
    expect(startRes.body.started).toBe(true);
    const profileId = startRes.body.profile.id;
    expect(profileId).toContain('gateway-');

    // Trying to start another profile while recording returns 409
    const conflictRes = await api(base, '/api/admin/servers/profile', owner.token, 'POST', {
      host: 'gateway',
      kind: 'cpu',
    });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error).toBe('already_recording');

    // Active status
    const statusDuring = await api(base, '/api/admin/servers/profile/status', owner.token);
    expect(statusDuring.body.recording).toBe(true);
    expect(statusDuring.body.profile.id).toBe(profileId);

    // Wait for profile to finish
    await until(async () => !(await api(base, '/api/admin/servers/profile/status', owner.token)).body.recording);
    const statusAfter = await api(base, '/api/admin/servers/profile/status', owner.token);
    expect(statusAfter.body.recording).toBe(false);

    // Download profile
    const downloadRes = await fetch(`${base}/api/admin/servers/profile/${encodeURIComponent(profileId)}`, {
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get('content-type')).toContain('application/json');
    expect(downloadRes.headers.get('content-disposition')).toContain('.cpuprofile');
    const profileData = await downloadRes.json();
    expect(profileData).toHaveProperty('nodes');

    // Take heap snapshot
    const heapRes = await api(base, '/api/admin/servers/profile', owner.token, 'POST', {
      host: 'gateway',
      kind: 'heap',
    });
    expect(heapRes.status).toBe(200);
    const heapId = heapRes.body.profile.id;

    await until(async () => !(await api(base, '/api/admin/servers/profile/status', owner.token)).body.recording, 15_000);

    // List profiles now shows both
    const updatedHealth = await api(base, '/api/admin/servers', owner.token);
    expect(updatedHealth.body.profiles.length).toBeGreaterThanOrEqual(2);

    // Delete heap snapshot
    const deleteRes = await api(base, `/api/admin/servers/profile/${encodeURIComponent(heapId)}`, owner.token, 'DELETE');
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body).toEqual({ deleted: true, id: heapId });

    // Download after delete gives 404
    const notFoundRes = await fetch(`${base}/api/admin/servers/profile/${encodeURIComponent(heapId)}`, {
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(notFoundRes.status).toBe(404);

    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }, 30_000);
});
