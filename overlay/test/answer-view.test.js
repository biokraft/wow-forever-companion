import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorLine, settlePending, activityLabel, workingHtml, elapsedText } from '../src/answer-view.js';

test('error lines carry the same prefix, live or reopened', () => {
  assert.equal(errorLine('Pi exited (code 1)'), 'Could not get an answer: Pi exited (code 1)');
});

test('a pending bubble that received text stays as it is', () => {
  assert.deepEqual(settlePending({ raw: 'Hel', ok: true, answer: 'Hello' }), { action: 'keep' });
  assert.deepEqual(settlePending({ raw: 'Hel', ok: false }), { action: 'keep' }, 'a partial answer is kept above the error');
});

test('an answer that arrived without any deltas is shown in the pending bubble', () => {
  assert.deepEqual(settlePending({ raw: '', ok: true, answer: 'Hello' }), { action: 'fill', text: 'Hello' });
});

test('an empty pending bubble is removed when there is nothing to show', () => {
  assert.deepEqual(settlePending({ raw: '', ok: false }), { action: 'remove' }, 'failed send');
  assert.deepEqual(settlePending({ raw: '' }), { action: 'remove' }, 'rejected call: no result at all');
  assert.deepEqual(settlePending({ raw: undefined, ok: false, answer: 'x' }), { action: 'remove' });
  assert.deepEqual(settlePending({ raw: '', ok: true, answer: '' }), { action: 'remove' }, 'an empty answer');
  assert.deepEqual(settlePending({ raw: '', ok: true }), { action: 'remove' });
});

test('tool names become plain words the player understands', () => {
  assert.equal(activityLabel('wow_quests'), 'Looking up quests');
  assert.equal(activityLabel('wow_npc'), 'Finding NPCs');
  assert.equal(activityLabel('wow_state'), 'Reading your character');
  assert.equal(activityLabel('Read'), 'Reading your data');
  assert.equal(activityLabel('Bash'), 'Running the toolkit');
  assert.equal(activityLabel('WebSearch'), 'Researching');
  assert.equal(activityLabel('wow_web_fetch'), 'Researching');
  assert.equal(activityLabel('Edit'), 'Saving notes');
  assert.equal(activityLabel('wow_plan_write'), 'Writing your plan');
  assert.equal(activityLabel('wow_gameplan'), 'Saving your plan');
  assert.equal(activityLabel(undefined), 'Working');
  assert.equal(activityLabel('SomethingNew'), 'Working');
});

test('the working line shows the activity, animated dots and the time so far, escaped', () => {
  const h = workingHtml('Looking up quests', 14);
  assert.match(h, /class="working"/);
  assert.match(h, /Looking up quests/);
  assert.match(h, /class="dots"/);
  assert.match(h, /14s/);
  assert.doesNotMatch(workingHtml('<img src=x>', 0), /<img/, 'labels are escaped');
});

test('elapsed time reads as seconds, then minutes', () => {
  assert.equal(elapsedText(0), '0s');
  assert.equal(elapsedText(59), '59s');
  assert.equal(elapsedText(61), '1m 1s');
  assert.equal(elapsedText(-3), '0s');
});

test('compacting has its own plain label', async () => {
  const { activityLabel } = await import('../src/answer-view.js');
  assert.equal(activityLabel('compact'), 'Summarising earlier messages');
});

test('the chat counts as at the bottom within a small slack, so it stays pinned when the area shrinks', async () => {
  const { nearBottom } = await import('../src/answer-view.js');
  assert.equal(nearBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 }), true, 'exactly at the bottom');
  assert.equal(nearBottom({ scrollHeight: 1000, scrollTop: 680, clientHeight: 300 }), true, 'a few pixels above');
  assert.equal(nearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 300 }), false, 'scrolled up to read');
  assert.equal(nearBottom({ scrollHeight: 200, scrollTop: 0, clientHeight: 300 }), true, 'nothing to scroll');
});

test('a stopped answer shows what the session kept, not the raw stream', () => {
  // The stream may end inside a chip block; the session hands back the text without it.
  assert.deepEqual(settlePending({ raw: 'Pick one.\n<choices>\nFast', ok: true, answer: 'Pick one.', stopped: true }), { action: 'fill', text: 'Pick one.' });
  assert.deepEqual(settlePending({ raw: '', ok: true, answer: '', stopped: true }), { action: 'remove' });
  assert.deepEqual(settlePending({ raw: '<cho', ok: true, answer: '', stopped: true }), { action: 'remove' });
});
