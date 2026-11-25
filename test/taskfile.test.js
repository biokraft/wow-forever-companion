import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const taskfile = fs.existsSync(`${ROOT}Taskfile.yml`) ? fs.readFileSync(`${ROOT}Taskfile.yml`, 'utf8') : '';

// No YAML parser in this repo: find the `tasks:` block and its two-space-indented keys by line.
function taskNames(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l === 'tasks:');
  if (start < 0) return [];
  const names = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l) && l.trim() !== '' && !l.startsWith('#')) break;
    const m = l.match(/^  ("?)([A-Za-z][\w:-]*)\1:\s*$/);
    if (m) names.push(m[2]);
  }
  return names;
}

test('the Taskfile declares the six developer tasks', () => {
  assert.ok(taskfile, 'Taskfile.yml exists');
  assert.match(taskfile, /^version: '?3'?\s*$/m);
  const names = taskNames(taskfile);
  for (const n of ['test', 'test:overlay', 'test:addon', 'check', 'overlay', 'release:build']) {
    assert.ok(names.includes(n), `task ${n} is declared`);
  }
});

test('the CI workflow scans for personal data on ubuntu only', () => {
  const ci = fs.readFileSync(`${ROOT}.github/workflows/ci.yml`, 'utf8');
  assert.match(ci, /node scripts\/privacy-scan\.js/);
  assert.match(ci, /if: runner\.os == 'Linux'/);
});

test('private design docs are ignored', () => {
  const ignore = fs.readFileSync(`${ROOT}.gitignore`, 'utf8').split(/\r?\n/);
  assert.ok(ignore.includes('/docs/superpowers/'));
});
