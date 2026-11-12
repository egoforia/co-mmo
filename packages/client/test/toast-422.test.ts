import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { api, formatError, toast } from '../src/gods-view/core.ts';
import { notifyFailedJobs, resetNotifiedFailedJobs } from '../src/art-ui/pages.ts';
import type { ArtJob } from '../src/art-ui/state.ts';

describe('formatError', () => {
  it('formats Replicate input validation failures with invalid_fields', () => {
    const raw = {
      detail: '- input.resolution: resolution must be one of the following: "480P", "768P"\n',
      status: 422,
      title: 'Input validation failed',
      invalid_fields: [
        {
          type: 'enum',
          field: 'input.resolution',
          description: 'resolution must be one of the following: "480P", "768P"',
        },
      ],
    };
    const result = formatError(raw, 422);
    expect(result).toBe('Validation failed (422): input.resolution: resolution must be one of the following: "480P", "768P"');
  });

  it('formats detail string if invalid_fields is not present', () => {
    const raw = {
      detail: '- input.resolution: resolution must be 480P',
      status: 422,
    };
    const result = formatError(raw, 422);
    expect(result).toBe('Validation failed (422): input.resolution: resolution must be 480P');
  });

  it('formats message if provided', () => {
    const raw = {
      message: 'Resolution 720p is not supported for minimax/h3-lite',
      status: 422,
    };
    const result = formatError(raw, 422);
    expect(result).toBe('Validation failed (422): Resolution 720p is not supported for minimax/h3-lite');
  });

  it('avoids double validation prefix if text already mentions 422 or validation', () => {
    const raw = {
      message: 'Validation failed (422): bad aspect ratio',
      status: 422,
    };
    expect(formatError(raw, 422)).toBe('Validation failed (422): bad aspect ratio');
  });

  it('handles empty or non-object bodies for 422', () => {
    expect(formatError(null, 422)).toBe('Validation failed (422)');
    expect(formatError({}, 422)).toBe('Validation failed (422)');
  });

  it('formats regular non-422 errors without validation prefix', () => {
    expect(formatError({ message: 'Internal Server Error' }, 500)).toBe('Internal Server Error');
    expect(formatError({ error: 'rate_limited', title: 'Too Many Requests' }, 429)).toBe('rate_limited');
  });
});

describe('toast', () => {
  let mockEl: { textContent: string; hidden: boolean; classList: { toggle: (cls: string, val: boolean) => void; contains: (cls: string) => boolean; classes: Set<string> } };

  beforeEach(() => {
    const classes = new Set<string>();
    mockEl = {
      textContent: '',
      hidden: true,
      classList: {
        toggle: (cls: string, val: boolean) => (val ? classes.add(cls) : classes.delete(cls)),
        contains: (cls: string) => classes.has(cls),
        classes,
      },
    };
    vi.stubGlobal('document', {
      getElementById: (id: string) => (id === 'toast' ? mockEl : null),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('displays message and marks bad on 422 errors', () => {
    toast('Validation failed (422): invalid resolution');
    expect(mockEl.textContent).toBe('Validation failed (422): invalid resolution');
    expect(mockEl.hidden).toBe(false);
    expect(mockEl.classList.contains('bad')).toBe(true);
  });

  it('displays regular message without bad class for friendly notices', () => {
    toast('Saved. Players see it at once.');
    expect(mockEl.textContent).toBe('Saved. Players see it at once.');
    expect(mockEl.hidden).toBe(false);
    expect(mockEl.classList.contains('bad')).toBe(false);
  });

  it('marks bad when explicit bad flag is passed', () => {
    toast('Custom failure', true);
    expect(mockEl.classList.contains('bad')).toBe(true);
  });
});

describe('api() on 422', () => {
  let mockEl: { textContent: string; hidden: boolean; classList: { toggle: (cls: string, val: boolean) => void; contains: (cls: string) => boolean; classes: Set<string> } };

  beforeEach(() => {
    const classes = new Set<string>();
    mockEl = {
      textContent: '',
      hidden: true,
      classList: {
        toggle: (cls: string, val: boolean) => (val ? classes.add(cls) : classes.delete(cls)),
        contains: (cls: string) => classes.has(cls),
        classes,
      },
    };
    vi.stubGlobal('document', {
      getElementById: (id: string) => (id === 'toast' ? mockEl : null),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('automatically triggers a toast error and throws with status 422', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 422,
      json: async () => ({
        detail: '- input.resolution: resolution must be one of the following: "480P", "768P"',
        invalid_fields: [{ field: 'input.resolution', description: 'must be 480P or 768P' }],
      }),
    }));

    await expect(api('art/clip', 'POST', {})).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('must be 480P or 768P'),
    });

    expect(mockEl.hidden).toBe(false);
    expect(mockEl.classList.contains('bad')).toBe(true);
    expect(mockEl.textContent).toContain('Validation failed (422)');
    expect(mockEl.textContent).toContain('must be 480P or 768P');
  });
});

describe('notifyFailedJobs', () => {
  beforeEach(() => {
    resetNotifiedFailedJobs();
  });

  it('suppresses toasts for historical failed jobs on initial load', () => {
    const toasts: string[] = [];
    const historicalJobs: ArtJob[] = [
      {
        id: 'job-1',
        asset: 'matriarch-walk',
        label: 'Matriarch Walk',
        media: 'clip',
        source: 'gods-view',
        status: 'failed',
        statusCode: 422,
        reason: 'Input validation failed',
        estimateUsd: 0.2,
        queuedAt: 1000,
      },
    ];

    notifyFailedJobs(historicalJobs, (msg) => toasts.push(msg));
    expect(toasts).toHaveLength(0);
  });

  it('toasts when a job later fails with 422 statusCode or reason', () => {
    const toasts: string[] = [];
    // Initial poll
    notifyFailedJobs([], (msg) => toasts.push(msg));

    // Next poll brings a newly failed job
    const newJobs: ArtJob[] = [
      {
        id: 'job-2',
        asset: 'matriarch-walk',
        label: 'Deep Crag Matriarch walking',
        media: 'clip',
        source: 'gods-view',
        status: 'failed',
        statusCode: 422,
        reason: '- input.resolution: resolution must be one of the following: "480P", "768P"',
        estimateUsd: 0.2,
        queuedAt: 2000,
      },
    ];

    notifyFailedJobs(newJobs, (msg) => toasts.push(msg));
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain('480P');

    // Polling again should not repeat the toast
    notifyFailedJobs(newJobs, (msg) => toasts.push(msg));
    expect(toasts).toHaveLength(1);
  });

  it('ignores non-422 failures', () => {
    const toasts: string[] = [];
    notifyFailedJobs([], (msg) => toasts.push(msg));

    const non422: ArtJob[] = [
      {
        id: 'job-3',
        asset: 'spider-attack',
        label: 'Spider Attack',
        media: 'clip',
        source: 'gods-view',
        status: 'failed',
        statusCode: 504,
        reason: 'The video took too long',
        estimateUsd: 0.2,
        queuedAt: 3000,
      },
    ];

    notifyFailedJobs(non422, (msg) => toasts.push(msg));
    expect(toasts).toHaveLength(0);
  });
});
