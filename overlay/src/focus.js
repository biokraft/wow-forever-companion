// How to hand focus back to WoW after the chat hides. Activating WoW (like clicking its
// Dock icon) keeps the launcher button visible; app.hide() would hide every overlay window.
import { execFile, spawn } from 'node:child_process';

export const WOW_BUNDLE_ID = 'com.blizzard.worldofwarcraft';

export function focusBackPlan({ platform, wowRunning }) {
  if (platform !== 'darwin') return { command: null, hideApp: false };
  if (wowRunning) return { command: ['open', ['-b', WOW_BUNDLE_ID]], hideApp: false };
  return { command: null, hideApp: true };
}

export function isWowRunning() {
  return new Promise((resolve) => {
    execFile('pgrep', ['-x', 'World of Warcraft'], (err) => resolve(!err));
  });
}

export async function focusBack({ app, platform = process.platform }) {
  const plan = focusBackPlan({ platform, wowRunning: platform === 'darwin' ? await isWowRunning() : false });
  if (plan.command) spawn(plan.command[0], plan.command[1], { stdio: 'ignore' }).on('error', () => app.hide());
  else if (plan.hideApp) app.hide();
}
