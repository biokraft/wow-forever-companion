import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchWow } from '../src/wow-watch.js';

// Drives the watcher by hand: each tick() runs one poll with the next answer.
function harness(answers) {
  let poll;
  const seen = [];
  const stop = watchWow({
    isRunning: () => answers.shift()(),
    onChange: (running) => seen.push(running),
    setTimer: (fn) => { poll = fn; return 1; },
    clearTimer: () => { poll = async () => {}; },
  });
  return { tick: () => poll(), seen, stop };
}
const yes = async () => true;
const no = async () => false;

test('the first check reports whether WoW is running, without waiting for the timer', async () => {
  const h = harness([no]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(h.seen, [false]);
});

test('WoW quitting and starting again are each reported once', async () => {
  const h = harness([yes, yes, no, no, yes]);
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 4; i++) await h.tick();
  assert.deepEqual(h.seen, [true, false, true]);
});

test('a failed check is not taken as WoW quitting', async () => {
  const h = harness([yes, async () => { throw new Error('pgrep failed'); }, yes]);
  await new Promise((r) => setImmediate(r));
  await h.tick(); await h.tick();
  assert.deepEqual(h.seen, [true]);
});

test('nothing is reported after the watcher is stopped', async () => {
  const h = harness([yes, no]);
  await new Promise((r) => setImmediate(r));
  h.stop();
  await h.tick();
  assert.deepEqual(h.seen, [true]);
});
