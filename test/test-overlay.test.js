import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = path.join(ROOT, 'scripts', 'test-overlay.js');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// Without the runner's own marker, so the child `node --test` runs really run their files.
const { NODE_TEST_CONTEXT, ...ENV } = process.env;

// An overlay folder with three test files; the middle one fails. Each records that it ran.
function fakeOverlay() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wowf overlay tests '));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }\n');
  const body = (name, ok) => `import { test } from 'node:test';
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(path.join(dir, 'ran.txt'))}, ${JSON.stringify(name + '\n')});
test('${name}', () => { if (!${ok}) throw new Error('${name} fails'); });
`;
  fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), body('a', true));
  fs.writeFileSync(path.join(dir, 'test', 'b.test.js'), body('b', false));
  fs.writeFileSync(path.join(dir, 'test', 'c.test.js'), body('c', true));
  fs.writeFileSync(path.join(dir, 'test', 'fake-helper.js'), 'throw new Error("not a test file");\n');
  return dir;
}

test('every overlay test file runs in its own process; a failure is reported at the end, not first', () => {
  const dir = fakeOverlay();
  try {
    const r = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'ran.txt'), 'utf8').trim().split('\n').sort(), ['a', 'b', 'c']);
    assert.match(r.stdout + r.stderr, /failed: test\/b\.test\.js/);
    assert.doesNotMatch(r.stdout + r.stderr, /failed:.*a\.test\.js/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('all passing files exit 0', () => {
  const dir = fakeOverlay();
  try {
    fs.rmSync(path.join(dir, 'test', 'b.test.js'));
    const r = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the Taskfile and the release build run the overlay tests one file per process, never combined', () => {
  assert.match(read('scripts/release.js'), /scripts\/test-overlay\.js|test-overlay\.js/);
  assert.doesNotMatch(read('scripts/release.js'), /overlay\/test\/\*\.test\.js/);
  const task = /^  test:overlay:\n([\s\S]*?)(?=^  \S)/m.exec(read('Taskfile.yml'))?.[1] ?? '';
  assert.match(task, /node scripts\/test-overlay\.js/);
});
