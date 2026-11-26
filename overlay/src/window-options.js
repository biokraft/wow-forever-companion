// BrowserWindow settings for the overlay. Pure, so it can be tested without Electron.
import { fileURLToPath } from 'node:url';

export const COLLAPSED_HEIGHT = 36;

export function windowOptions() {
  return {
    width: 398,
    height: 654,
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

// The default places are the maintainer's own layout of 2026-11-26 on a 2560x1440 screen,
// measured from the right and top edges of the usable screen area so they carry over to
// other screen sizes.
// Button: right edge, just below the minimap's zoom buttons.
const BUTTON_FROM_RIGHT = 57;
const BUTTON_FROM_TOP = 248;
// Chat: left of the minimap and the quest tracker, clear of the button.
const CHAT_GAP_RIGHT = 302;
const CHAT_FROM_TOP = 349;

export function defaultButtonPosition(workArea) {
  return { x: workArea.x + workArea.width - BUTTON_FROM_RIGHT, y: workArea.y + BUTTON_FROM_TOP };
}

// Where the chat opens the first time. On a screen too small for it, chatBounds moves and
// shrinks it until it fits.
export function chatPosition(workArea) {
  return { x: workArea.x + workArea.width - CHAT_GAP_RIGHT - windowOptions().width, y: workArea.y + CHAT_FROM_TOP };
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
  if (!ok) saved = { ...chatPosition(first), width, height };
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
