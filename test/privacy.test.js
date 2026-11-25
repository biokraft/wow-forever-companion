import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanFiles, publicFiles, FORBIDDEN } from '../scripts/privacy-scan.js';
import { fileURLToPath } from 'node:url';

test('a planted personal line is flagged with file and line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-priv-'));
  fs.writeFileSync(path.join(dir, 'a.md'), `fine\nsaved in ${'/Us' + 'ers/alice'}/wow/data\n`);
  const hits = scanFiles([path.join(dir, 'a.md')]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
});

test('the public tree excludes private docs and local folders', () => {
  const files = publicFiles();
  assert.ok(files.some((f) => f === 'README.md' || f === 'package.json'));
  assert.ok(!files.some((f) => f.startsWith('docs/superpowers/')));
  assert.ok(!files.some((f) => f.startsWith('overlay/node_modules/') || f.startsWith('scratch/')));
});

test('the current public tree is clean', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const hits = scanFiles(publicFiles().map((f) => path.join(root, f)));
  assert.deepEqual(hits.map((h) => `${path.relative(root, h.file)}:${h.line}: ${h.match}`), []);
  assert.ok(FORBIDDEN.length >= 3);
});

test('review: unreadable files are reported, not silently skipped', () => {
  const hits = scanFiles([path.join(os.tmpdir(), 'does-not-exist-forever-companion.txt')]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, 'unreadable');
});

test('review: personal home paths on Windows and capitalized macOS names are caught', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-priv-'));
  fs.writeFileSync(path.join(dir, 'b.md'), `a ${'C:' + '\\Users\\Alice'}\\x\nb ${'/Us' + 'ers/Alice'}/y\n`);
  assert.equal(scanFiles([path.join(dir, 'b.md')]).length, 2);
});
