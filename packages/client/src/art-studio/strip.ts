// The strip along the bottom: the jobs painting and waiting, newest last,
// each opening its asset. A walker's frames have their own strip above it
// (frame-strip.ts).

import { assetHref, isOpen, type ArtJob, STATUS } from '../art-ui/state.ts';
import { escapeHtml } from '../ui.ts';

/** The jobs the strip shows: open ones, then the last few that ended in the past ten minutes. */
export function stripJobs(jobs: readonly ArtJob[], now: number): ArtJob[] {
  const open = jobs.filter(isOpen);
  const ended = jobs.filter((j) => !isOpen(j) && j.endedAt && now - j.endedAt < 10 * 60_000).slice(-4);
  return [...ended, ...open];
}

/** The strip's HTML. */
export function stripHtml(jobs: readonly ArtJob[], now = Date.now()): string {
  const shown = stripJobs(jobs, now);
  const chips = shown.map((j) => {
    const href = assetHref(j.asset, j.media);
    const body = `<b>${escapeHtml(j.label)}</b><small>${escapeHtml(STATUS[j.status])}</small>`;
    return `<li class="job ${j.status}">${href ? `<a href="${escapeHtml(href)}">${body}</a>` : `<span>${body}</span>`}</li>`;
  }).join('');
  return `<span class="strip-title">Painting</span>${chips ? `<ol class="strip-jobs">${chips}</ol>` : '<span class="note">Nothing is painting. Paints wait for your review and approval first.</span>'}<a class="strip-queue" href="#art/queue">Queue and jobs</a>`;
}
