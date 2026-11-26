import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowOptions, applyOverlayLevel, COLLAPSED_HEIGHT } from '../src/window-options.js';

test('overlay window is frameless, transparent, on top, and starts hidden', () => {
  const o = windowOptions();
  assert.equal(o.frame, false);
  assert.equal(o.transparent, false, 'opaque windows keep macOS sharp text rendering');
  assert.match(o.backgroundColor, /^#[0-9a-f]{6}$/i);
  assert.equal(o.alwaysOnTop, true);
  assert.equal(o.skipTaskbar, true);
  assert.equal(o.show, false);
  assert.deepEqual([o.width, o.height], [398, 654]);
  assert.equal(o.webPreferences.contextIsolation, true);
  assert.equal(o.webPreferences.nodeIntegration, false);
});

test('applyOverlayLevel floats above fullscreen apps', () => {
  const calls = [];
  const win = { setAlwaysOnTop: (...a) => calls.push(['top', ...a]), setVisibleOnAllWorkspaces: (...a) => calls.push(['ws', ...a]) };
  applyOverlayLevel(win);
  assert.deepEqual(calls, [['top', true, 'screen-saver'], ['ws', true, { visibleOnFullScreen: true }]]);
  assert.equal(COLLAPSED_HEIGHT, 36);
});

import { buttonOptions, BUTTON_SIZE } from '../src/window-options.js';

test('launcher button is a small, frameless, never-focused round window', () => {
  const o = buttonOptions();
  assert.deepEqual([o.width, o.height], [BUTTON_SIZE, BUTTON_SIZE]);
  assert.equal(o.frame, false);
  assert.equal(o.transparent, true);
  assert.equal(o.focusable, false, 'clicking the button must not take focus from WoW by itself');
  assert.equal(o.show, false);
  assert.equal(o.resizable, false);
});

import { defaultButtonPosition, clampButton } from '../src/window-options.js';

test('default button spot hugs the right edge just below the minimap zoom buttons', () => {
  const wa = { x: 0, y: 30, width: 2560, height: 1410 }; // 2560x1440 below the macOS menu bar
  const p = defaultButtonPosition(wa);
  assert.equal(p.x, 2503); // hand-placed spot on 2560x1440
  assert.equal(p.y, 278);
});

test('a saved button position is kept on screen', () => {
  const wa = { x: 0, y: 25, width: 1440, height: 875 };
  assert.deepEqual(clampButton({ x: 5000, y: -40 }, wa), { x: 1440 - BUTTON_SIZE, y: 25 });
  assert.deepEqual(clampButton({ x: 100, y: 200 }, wa), { x: 100, y: 200 });
});

import { chatPosition } from '../src/window-options.js';

test('review: the chat opens left of the launcher button, not on top of it', () => {
  const wa = { x: 0, y: 0, width: 2560, height: 1440 };
  const p = chatPosition(wa);
  assert.ok(p.x + windowOptions().width <= defaultButtonPosition(wa).x - 8, `chat right edge ${p.x + windowOptions().width}`);
});

test('the default chat place is the hand-set one on a 2560x1440 screen, measured from the right and top', () => {
  assert.deepEqual(chatBounds(undefined, [{ x: 0, y: 30, width: 2560, height: 1410 }]), { x: 1860, y: 379, width: 398, height: 654 });
  assert.deepEqual(chatBounds(undefined, [{ x: 0, y: 0, width: 1920, height: 1080 }]), { x: 1220, y: 349, width: 398, height: 654 });
});

test('on a screen too small for the default chat, it moves up and shrinks until it is fully visible', () => {
  const small = { x: 0, y: 25, width: 1440, height: 875 };
  assert.deepEqual(chatBounds(undefined, [small]), { x: 740, y: 246, width: 398, height: 654 });
  const tiny = { x: 0, y: 0, width: 640, height: 480 };
  assert.deepEqual(chatBounds(undefined, [tiny]), { x: 0, y: 0, width: 398, height: 480 });
});

test('review: renderer is sandboxed', () => {
  assert.equal(windowOptions().webPreferences.sandbox, true);
});

import { chatBounds } from '../src/window-options.js';

const PRIMARY = { x: 0, y: 25, width: 2560, height: 1415 };
const SECOND = { x: 2560, y: 0, width: 1920, height: 1080 };

test('without a saved place the chat opens at its default spot and size', () => {
  const def = { ...chatPosition(PRIMARY), width: 398, height: 654 };
  assert.deepEqual(chatBounds(undefined, [PRIMARY]), def);
  assert.deepEqual(chatBounds({ x: 'a', y: 1, width: 380, height: 520 }, [PRIMARY]), def, 'a damaged entry is ignored');
  assert.deepEqual(chatBounds({ x: 10, y: 40, width: 380, height: Infinity }, [PRIMARY]), def);
});

test('a saved place and size come back as they were, on any screen', () => {
  assert.deepEqual(chatBounds({ x: 100, y: 200, width: 500, height: 700 }, [PRIMARY, SECOND]), { x: 100, y: 200, width: 500, height: 700 });
  assert.deepEqual(chatBounds({ x: 3000, y: 100, width: 420, height: 600 }, [PRIMARY, SECOND]), { x: 3000, y: 100, width: 420, height: 600 });
});

test('a place on a screen that is gone moves onto the first screen, fully visible', () => {
  assert.deepEqual(chatBounds({ x: 3000, y: 100, width: 420, height: 600 }, [PRIMARY]), { x: 2140, y: 100, width: 420, height: 600 });
  assert.deepEqual(chatBounds({ x: -900, y: -50, width: 420, height: 600 }, [PRIMARY]), { x: 0, y: 25, width: 420, height: 600 });
});

test('a saved size never exceeds the screen or drops below the smallest usable chat', () => {
  assert.deepEqual(chatBounds({ x: 0, y: 25, width: 9000, height: 9000 }, [PRIMARY]), { x: 0, y: 25, width: 2560, height: 1415 });
  const small = chatBounds({ x: 50, y: 60, width: 10, height: 36 }, [PRIMARY]);
  assert.deepEqual([small.width, small.height], [300, 200], 'a collapsed height is never restored as the chat size');
});
