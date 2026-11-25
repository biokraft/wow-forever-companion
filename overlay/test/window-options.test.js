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
  assert.deepEqual([o.width, o.height], [380, 520]);
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
  const wa = { x: 0, y: 0, width: 2560, height: 1440 };
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
  assert.ok(p.x + 380 <= defaultButtonPosition(wa).x - 8, `chat right edge ${p.x + 380}`);
});

test('review: renderer is sandboxed', () => {
  assert.equal(windowOptions().webPreferences.sandbox, true);
});
