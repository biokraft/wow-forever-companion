import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampOpacity, MIN_OPACITY } from '../src/opacity.js';

test('opacity stays between the floor and fully solid', () => {
  assert.equal(clampOpacity(0.7), 0.7);
  assert.equal(clampOpacity(0.1), MIN_OPACITY);
  assert.equal(clampOpacity(3), 1);
});

test('a missing or broken saved value means fully solid', () => {
  for (const v of [undefined, null, 'abc', NaN]) assert.equal(clampOpacity(v), 1);
});

test('the floor keeps the text readable', () => {
  assert.equal(MIN_OPACITY, 0.4);
});

test('review: empty and boolean values fall back to fully opaque', () => {
  for (const v of ['', ' ', false, true]) assert.equal(clampOpacity(v), 1, JSON.stringify(v));
});
