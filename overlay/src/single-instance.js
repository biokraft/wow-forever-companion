// One overlay at a time. Starting the overlay again (`node bin/wowf overlay`) restarts the
// running one, so it picks up new code after an update: the new process exits at once
// without creating a window, and the running one relaunches itself. The relaunched overlay
// goes through the normal start, which stays hidden: no window is shown or focused here.

/**
 * @param {{ app: { requestSingleInstanceLock(): boolean, on(event: string, fn: () => void): void,
 *   relaunch(): void, exit(code: number): void, quit(): void }, beforeRestart?: () => void }} o
 *   beforeRestart stops what `app.exit` skips (it fires no will-quit): child processes,
 *   live reads, the hotkey.
 * @returns {boolean} true when this process is the overlay and should start; false when it
 *   only asked the running overlay to restart and is exiting.
 */
export function claimSingleInstance({ app, beforeRestart = () => {} }) {
  if (!app.requestSingleInstanceLock()) {
    app.quit(); // as Electron's own example does before ready; the caller starts nothing
    return false;
  }
  let restarting = false;
  app.on('second-instance', () => {
    if (restarting) return;
    restarting = true;
    try { beforeRestart(); } catch { /* restart anyway */ }
    app.relaunch();
    app.exit(0);
  });
  return true;
}
