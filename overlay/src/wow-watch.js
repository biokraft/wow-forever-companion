// Tells the overlay when WoW starts and quits, so it can show its button only while the
// game is up. It checks once right away, then on a timer, and reports only changes.
// Timers are passed in for tests.
export const WOW_POLL_MS = 5000;

export function watchWow({ isRunning, onChange, intervalMs = WOW_POLL_MS, setTimer = setInterval, clearTimer = clearInterval }) {
  let last;
  let done = false;
  const check = async () => {
    if (done) return;
    let running;
    try { running = Boolean(await isRunning()); } catch { return; } // a failed check proves nothing
    if (done || running === last) return;
    last = running;
    onChange(running);
  };
  const timer = setTimer(check, intervalMs);
  check();
  return () => { done = true; clearTimer(timer); };
}
