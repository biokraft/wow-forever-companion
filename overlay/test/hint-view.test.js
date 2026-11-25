import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleHints } from '../src/hint-view.js';
import { STARTERS } from '../src/hints.js';

const hint = (n) => ({ key: `k${n}`, kind: 'rested', label: `label ${n}`, text: `text ${n}`, prompt: `prompt ${n}` });
const live = [1, 2, 3, 4, 5, 6].map(hint);

test('empty chat shows at most four rows and keeps the starters', () => {
  const v = visibleHints({ live, starters: STARTERS, dismissed: new Set(), empty: true });
  assert.deepEqual(v.rows.map((h) => h.key), ['k1', 'k2', 'k3', 'k4']);
  assert.deepEqual(v.chips, []);
  assert.deepEqual(v.starters, STARTERS);
});

test('mid-chat shows at most three chips and drops the starters', () => {
  const v = visibleHints({ live, starters: STARTERS, dismissed: new Set(), empty: false });
  assert.deepEqual(v.rows, []);
  assert.deepEqual(v.chips.map((h) => h.key), ['k1', 'k2', 'k3']);
  assert.deepEqual(v.starters, []);
});

test('dismissed keys are filtered out before the cap', () => {
  const dismissed = new Set(['k1', 'k3']);
  const empty = visibleHints({ live, starters: STARTERS, dismissed, empty: true });
  assert.deepEqual(empty.rows.map((h) => h.key), ['k2', 'k4', 'k5', 'k6']);
  const mid = visibleHints({ live, starters: STARTERS, dismissed, empty: false });
  assert.deepEqual(mid.chips.map((h) => h.key), ['k2', 'k4', 'k5']);
});

test('nothing live mid-chat leaves every list empty', () => {
  const v = visibleHints({ live: [], starters: STARTERS, dismissed: new Set(), empty: false });
  assert.deepEqual(v, { rows: [], chips: [], starters: [] });
});
