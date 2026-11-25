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

const MIN_CHAT = { width: 300, height: 200 };
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Where the chat window opens: the place and size the player left it (`saved`, from the
 * config), else the default spot. `workAreas` are the screens' work areas, the primary one
 * first. A saved place stays on the screen that holds its top-left corner; when that screen
 * is gone it moves onto the first one. The window always ends up fully visible, no larger
 * than its screen and no smaller than a usable chat.
 */
export function chatBounds(saved, workAreas) {
  const [first] = workAreas;
  const { width, height } = windowOptions();
  const ok = saved && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(saved[k]));
  if (!ok) return { ...chatPosition(first), width, height };
  const inside = (a) => saved.x >= a.x && saved.x < a.x + a.width && saved.y >= a.y && saved.y < a.y + a.height;
  const area = workAreas.find(inside) ?? first;
  const w = Math.round(clamp(saved.width, MIN_CHAT.width, area.width));
  const h = Math.round(clamp(saved.height, MIN_CHAT.height, area.height));
  return {
    x: Math.round(clamp(saved.x, area.x, area.x + area.width - w)),
    y: Math.round(clamp(saved.y, area.y, area.y + area.height - h)),
    width: w,
    height: h,
  };
}

export function clampButton(pos, workArea) {
  const x = Math.min(Math.max(pos.x, workArea.x), workArea.x + workArea.width - BUTTON_SIZE);
  const y = Math.min(Math.max(pos.y, workArea.y), workArea.y + workArea.height - BUTTON_SIZE);
  return { x: Math.round(x), y: Math.round(y) };
}
