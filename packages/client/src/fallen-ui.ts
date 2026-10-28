import { escapeHtml } from './ui.ts';

/** What the Fallen read (docs/callings-build-plan.md, step 8); the server says it in the log too. */
const FALLEN_WORDS = 'You have fallen. A friend may still ring you back, or you can wake at the shrine.';

/**
 * The box a Fallen player sees while they lie where they fell: the line,
 * how long until they wake at the shrine, and a button to wake there now.
 */
export class FallenUi {
  private readonly el = document.getElementById('fallen')!;
  private seconds: number | undefined;

  constructor(wake: () => void) {
    this.el.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('button')) return;
      wake();
    });
  }

  /** Shows the box with the seconds left, or hides it once we stand again (undefined). */
  show(seconds: number | undefined): void {
    if (seconds === this.seconds) return;
    this.seconds = seconds;
    this.el.hidden = seconds === undefined;
    if (seconds === undefined) return;
    this.el.innerHTML = `<p>${escapeHtml(FALLEN_WORDS)}</p>
      <p class="note">You wake at the shrine on your own in ${seconds} second${seconds === 1 ? '' : 's'}.</p>
      <button type="button">Wake at the shrine</button>`;
  }
}
