import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusBackPlan } from '../src/focus.js';

test('macOS with WoW running: activate WoW, keep the overlay app (and its button) visible', () => {
  assert.deepEqual(focusBackPlan({ platform: 'darwin', wowRunning: true }), { command: ['open', ['-b', 'com.blizzard.worldofwarcraft']], hideApp: false });
});

test('macOS without WoW: hide the app so focus returns to the previous app', () => {
  assert.deepEqual(focusBackPlan({ platform: 'darwin', wowRunning: false }), { command: null, hideApp: true });
});

test('other platforms: just hide the chat window', () => {
  assert.deepEqual(focusBackPlan({ platform: 'win32', wowRunning: true }), { command: null, hideApp: false });
});
