import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { captureWow, captureWowBitmap } from '../src/capture.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const source = (name) => ({ name, thumbnail: { toPNG: () => png, isEmpty: () => false } });
const deps = (over = {}) => ({
  platform: 'darwin',
  systemPreferences: { getMediaAccessStatus: () => 'granted' },
  desktopCapturer: { getSources: async () => [source('Finder'), source('World of Warcraft')] },
  ...over,
});

test('returns the WoW window as PNG', async () => {
  const r = await captureWow(deps());
  assert.equal(r.ok, true);
  assert.deepEqual(r.png, png);
});

test('missing Screen Recording permission explains where to grant it', async () => {
  const r = await captureWow(deps({ systemPreferences: { getMediaAccessStatus: () => 'denied' } }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-permission');
  assert.match(r.text, /Screen Recording/);
});

test('WoW not running is reported', async () => {
  const r = await captureWow(deps({ desktopCapturer: { getSources: async () => [source('Finder')] } }));
  assert.equal(r.reason, 'not-running');
  assert.match(r.text, /isn't open|not open/);
});

test('a capture error never throws', async () => {
  const r = await captureWow(deps({ desktopCapturer: { getSources: async () => { throw new Error('boom'); } } }));
  assert.equal(r.ok, false);
  assert.match(r.text, /boom/);
});

test('review: only the window titled exactly World of Warcraft is captured', async () => {
  const r = await captureWow(deps({ desktopCapturer: { getSources: async () => [source('World of Warcraft Classic - Wowhead'), source('Finder')] } }));
  assert.equal(r.reason, 'not-running');
});

// captureWowBitmap: the top rows of the WoW window as raw BGRA pixels for the pixel bridge reader.
const raw = Buffer.alloc(16 * 9 * 4, 7);
const top = { bitmap: raw.subarray(0, 16 * 2 * 4), width: 16, height: 2, windowHeight: 9 };
const image = (over = {}) => ({ isEmpty: () => false, toBitmap: () => raw, getSize: () => ({ width: 16, height: 9 }), ...over });
function bitmapDeps(over = {}) {
  const calls = { sources: [], run: [], loaded: [], removed: [] };
  const deps = {
    platform: 'darwin',
    tmpDir: '/tmp-test',
    systemPreferences: { getMediaAccessStatus: () => 'granted' },
    screen: { getPrimaryDisplay: () => ({ size: { width: 1512, height: 982 }, scaleFactor: 2 }) },
    desktopCapturer: {
      getSources: async (opts) => {
        calls.sources.push(opts);
        return [{ id: 'window:11:0', name: 'Finder', thumbnail: image() }, { id: 'window:4242:0', name: 'World of Warcraft', thumbnail: image() }];
      },
    },
    run: async (cmd, args) => { calls.run.push([cmd, ...args]); },
    readTop: async (file) => { calls.loaded.push(file); return top; },
    removeFile: async (file) => { calls.removed.push(file); },
    ...over,
  };
  return { deps, calls };
}

test('on macOS only the WoW window is captured, as an uncompressed TIFF, with screencapture -l<id>', async () => {
  const { deps, calls } = bitmapDeps();
  const r = await captureWowBitmap(deps);
  assert.deepEqual(r, { ok: true, ...top });
  assert.deepEqual(calls.sources, [{ types: ['window'], thumbnailSize: { width: 0, height: 0 } }]);
  assert.equal(calls.run.length, 1);
  const [cmd, ...args] = calls.run[0];
  assert.equal(cmd, 'screencapture');
  assert.deepEqual(args.slice(0, 5), ['-x', '-o', '-t', 'tiff', '-l4242']);
  const file = args[5];
  assert.equal(path.dirname(file), path.join('/tmp-test'), file);
  assert.ok(file.endsWith('.tiff'), file);
  assert.deepEqual(calls.loaded, [file]);
  assert.deepEqual(calls.removed, [file]);
});

test('each capture uses its own temp file', async () => {
  const { deps, calls } = bitmapDeps();
  await captureWowBitmap(deps);
  await captureWowBitmap(deps);
  assert.notEqual(calls.run[0][6], calls.run[1][6]);
});

test('the temp file is removed even when reading or capturing fails', async () => {
  const bad = bitmapDeps({ readTop: async () => { throw new Error('not a TIFF'); } });
  assert.deepEqual(await captureWowBitmap(bad.deps), { ok: false, reason: 'error', error: 'not a TIFF' });
  assert.equal(bad.calls.removed.length, 1);
  const failed = bitmapDeps({ run: async () => { throw new Error('screencapture failed'); } });
  assert.deepEqual(await captureWowBitmap(failed.deps), { ok: false, reason: 'error', error: 'screencapture failed' });
  assert.equal(failed.calls.removed.length, 1);
});

test('a shared cache keeps the window id for a minute, so the window list is not fetched every read', async () => {
  let now = 1_000;
  const cache = {};
  const { deps, calls } = bitmapDeps({ cache, now: () => now });
  assert.equal((await captureWowBitmap(deps)).ok, true);
  now += 59_000;
  assert.equal((await captureWowBitmap(deps)).ok, true);
  assert.equal(calls.sources.length, 1);
  assert.deepEqual(calls.run.map((c) => c[5]), ['-l4242', '-l4242']);
  now += 2_000;
  await captureWowBitmap(deps);
  assert.equal(calls.sources.length, 2);
});

test('a cached window id that fails is looked up again once', async () => {
  const cache = { id: '777', at: 0 };
  let runs = 0;
  const { deps, calls } = bitmapDeps({
    cache,
    now: () => 10,
    run: async (cmd, args) => { calls.run.push([cmd, ...args]); if (runs++ === 0) throw new Error('could not create image from window'); },
  });
  assert.deepEqual(await captureWowBitmap(deps), { ok: true, ...top });
  assert.deepEqual(calls.run.map((c) => c[5]), ['-l777', '-l4242']);
  assert.equal(calls.sources.length, 1);
  assert.equal(calls.removed.length, 2);
  assert.equal(cache.id, '4242');
  // A fresh id that fails is not retried.
  const fresh = bitmapDeps({ cache: {}, run: async (cmd, args) => { fresh.calls.run.push(args); throw new Error('nope'); } });
  assert.deepEqual(await captureWowBitmap(fresh.deps), { ok: false, reason: 'error', error: 'nope' });
  assert.equal(fresh.calls.run.length, 1);
  assert.equal(fresh.deps.cache.id, undefined);
});

test('the bitmap capture never captures without Screen Recording permission', async () => {
  const { deps, calls } = bitmapDeps({ systemPreferences: { getMediaAccessStatus: () => 'not-determined' } });
  assert.deepEqual(await captureWowBitmap(deps), { ok: false, reason: 'no-permission' });
  const cached = bitmapDeps({ cache: { id: '4242', at: 0 }, now: () => 1, systemPreferences: { getMediaAccessStatus: () => 'denied' } });
  assert.deepEqual(await captureWowBitmap(cached.deps), { ok: false, reason: 'no-permission' });
  assert.equal(calls.sources.length + cached.calls.sources.length, 0);
  assert.equal(calls.run.length + cached.calls.run.length, 0);
});

test('the bitmap capture reports a missing window or window id without running screencapture', async () => {
  const none = bitmapDeps({ desktopCapturer: { getSources: async () => [] } });
  assert.deepEqual(await captureWowBitmap(none.deps), { ok: false, reason: 'not-running' });
  const odd = bitmapDeps({ desktopCapturer: { getSources: async () => [{ id: 'screen:1:0', name: 'World of Warcraft' }] } });
  assert.equal((await captureWowBitmap(odd.deps)).ok, false);
  assert.equal(none.calls.run.length + odd.calls.run.length, 0);
  const boom = bitmapDeps({ desktopCapturer: { getSources: async () => { throw new Error('boom'); } } });
  assert.deepEqual(await captureWowBitmap(boom.deps), { ok: false, reason: 'error', error: 'boom' });
});

test('elsewhere the bitmap comes from a thumbnail at the display\'s native size (fallback)', async () => {
  const { deps, calls } = bitmapDeps({ platform: 'win32' });
  const r = await captureWowBitmap(deps);
  assert.deepEqual(calls.sources, [{ types: ['window'], thumbnailSize: { width: 3024, height: 1964 } }]);
  assert.deepEqual(r, { ok: true, bitmap: raw, width: 16, height: 9 });
  assert.equal(calls.run.length, 0);
});
