import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimSingleInstance } from '../src/single-instance.js';

// A stand-in for Electron's app: records every call in order, and lets the test fire events.
function fakeApp({ gotLock }) {
  const calls = [];
  const handlers = {};
  return {
    calls,
    fire: (event) => handlers[event]?.(),
    requestSingleInstanceLock: () => { calls.push('requestSingleInstanceLock'); return gotLock; },
    on: (event, fn) => { calls.push(`on:${event}`); handlers[event] = fn; },
    relaunch: () => calls.push('relaunch'),
    exit: (code) => calls.push(`exit:${code}`),
    quit: () => calls.push('quit'),
    // None of these may ever be called: nothing pops up or takes focus over the game.
    focus: () => calls.push('focus'),
    show: () => calls.push('show'),
  };
}

test('the first overlay keeps running and starts', () => {
  const app = fakeApp({ gotLock: true });
  assert.equal(claimSingleInstance({ app, beforeRestart: () => app.calls.push('cleanup') }), true);
  assert.deepEqual(app.calls, ['requestSingleInstanceLock', 'on:second-instance']);
});

test('a second overlay exits at once and starts nothing', () => {
  const app = fakeApp({ gotLock: false });
  assert.equal(claimSingleInstance({ app, beforeRestart: () => app.calls.push('cleanup') }), false);
  assert.deepEqual(app.calls, ['requestSingleInstanceLock', 'quit']);
});

test('starting it again restarts the running overlay: clean up, relaunch, exit; never show or focus', () => {
  const app = fakeApp({ gotLock: true });
  claimSingleInstance({ app, beforeRestart: () => app.calls.push('cleanup') });
  app.calls.length = 0;
  app.fire('second-instance');
  assert.deepEqual(app.calls, ['cleanup', 'relaunch', 'exit:0']);
});

test('a cleanup that throws still restarts the overlay', () => {
  const app = fakeApp({ gotLock: true });
  claimSingleInstance({ app, beforeRestart: () => { throw new Error('child already gone'); } });
  app.calls.length = 0;
  app.fire('second-instance');
  assert.deepEqual(app.calls, ['relaunch', 'exit:0']);
});

test('a second start while a restart is under way restarts only once', () => {
  const app = fakeApp({ gotLock: true });
  claimSingleInstance({ app });
  app.calls.length = 0;
  app.fire('second-instance');
  app.fire('second-instance');
  assert.deepEqual(app.calls, ['relaunch', 'exit:0']);
});
