// BrowserWindow settings for the overlay. Pure, so it can be tested without Electron.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COLLAPSED_HEIGHT = 36;

export function windowOptions() {
  return {
    width: 380,
    height: 520,
    minWidth: 300,
    minHeight: COLLAPSED_HEIGHT,
    frame: false,
    // Opaque: transparent windows lose macOS's sharpest text rendering (blurry on 1x screens).
    transparent: false,
    backgroundColor: '#0c0b0e',
    roundedCorners: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: 'Forever Companion',
    webPreferences: {
      preload: fileURLToPath(new URL('../preload.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

// Float above other windows, including WoW in macOS fullscreen.
export function applyOverlayLevel(win) {
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

export const overlayRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

export const BUTTON_SIZE = 46;

// The small round launcher that sits over the game. It never takes focus itself;
// clicking it opens the chat window, which then takes focus.
export function buttonOptions() {
  return {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    title: 'Forever Companion button',
    webPreferences: windowOptions().webPreferences,
  };
}

// Right edge, just below the minimap's zoom buttons: placed by hand during testing on
// 2026-11-25 (57 points from the right, 278 from the top on a 2560x1440 screen).
export function defaultButtonPosition(workArea) {
  return { x: workArea.x + workArea.width - 57, y: workArea.y + 278 };
}

// The chat opens left of the launcher button so it never covers it or the minimap.
export function chatPosition(workArea) {
  return { x: workArea.x + workArea.width - 57 - 380 - 16, y: workArea.y + 80 };
}

export function clampButton(pos, workArea) {
  const x = Math.min(Math.max(pos.x, workArea.x), workArea.x + workArea.width - BUTTON_SIZE);
  const y = Math.min(Math.max(pos.y, workArea.y), workArea.y + workArea.height - BUTTON_SIZE);
  return { x: Math.round(x), y: Math.round(y) };
}
