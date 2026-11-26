import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fetchNewest, replaceTree, ARCHIVE_URL } from '../src/update-archive.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fc-archive-')));
const write = (root, rel, text) => {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const run = async (cmd, args, { cwd }) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

// A tar.gz like GitHub's: one top-level folder holding the files.
function archiveOf(files, top = 'wow-forever-companion-main') {
  const dir = tmp();
  for (const [rel, text] of Object.entries(files)) write(path.join(dir, top), rel, text);
  const r = spawnSync('tar', ['-czf', 'a.tar.gz', top], { cwd: dir });
  assert.equal(r.status, 0, String(r.stderr));
  return path.join(dir, 'a.tar.gz');
}
const serving = (archive, seen = []) => async (url, file) => { seen.push(url); fs.copyFileSync(archive, file); };

const NEWEST = {
  'package.json': JSON.stringify({ name: 'forever-companion', version: '0.5.0' }),
  'bin/wowf': '#!/usr/bin/env node\n',
  'src/cli.js': '// new\n',
  'overlay/main.js': '// new overlay\n',
  'overlay/package-lock.json': '{}\n',
};

test('fetchNewest downloads the main branch, unpacks it and hands back the tree', async () => {
  const seen = [];
  const work = tmp();
  const { tree, cleanup } = await fetchNewest({ run, tmpDir: work, downloadImpl: serving(archiveOf(NEWEST), seen) });
  assert.deepEqual(seen, [ARCHIVE_URL]);
  assert.match(ARCHIVE_URL, /^https:\/\/github\.com\/biokraft\/wow-forever-companion\/archive\/refs\/heads\/main\.tar\.gz$/);
  assert.equal(fs.readFileSync(path.join(tree, 'src', 'cli.js'), 'utf8'), '// new\n');
  cleanup();
  assert.deepEqual(fs.readdirSync(work), [], 'cleanup removes the download');
});

test('fetchNewest refuses an archive that is not this project and leaves nothing behind', async () => {
  const work = tmp();
  const other = archiveOf({ 'package.json': JSON.stringify({ name: 'something-else' }), 'bin/wowf': '' });
  await assert.rejects(fetchNewest({ run, tmpDir: work, downloadImpl: serving(other) }), /does not look like Forever Companion/);
  const broken = async (url, file) => fs.writeFileSync(file, 'not an archive');
  await assert.rejects(fetchNewest({ run, tmpDir: work, downloadImpl: broken }), /could not be unpacked/);
  await assert.rejects(fetchNewest({ run, tmpDir: work, downloadImpl: async () => { throw new Error('GitHub answered 503'); } }), /503/);
  assert.deepEqual(fs.readdirSync(work), []);
});

test('replaceTree swaps in the new files, drops files the new version no longer has and keeps installed packages', async () => {
  const repo = tmp();
  write(repo, 'package.json', JSON.stringify({ name: 'forever-companion', version: '0.4.0' }));
  write(repo, 'src/cli.js', '// old\n');
  write(repo, 'src/gone.js', '// removed upstream\n');
  write(repo, 'overlay/main.js', '// old overlay\n');
  write(repo, 'overlay/old-file.js', '// removed upstream\n');
  write(repo, 'overlay/node_modules/electron/path.txt', 'Electron');
  write(repo, 'my-notes.txt', 'the player keeps this\n');
  const { tree, cleanup } = await fetchNewest({ run, tmpDir: tmp(), downloadImpl: serving(archiveOf(NEWEST)) });
  replaceTree(tree, repo);
  cleanup();
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version, '0.5.0');
  assert.equal(fs.readFileSync(path.join(repo, 'src', 'cli.js'), 'utf8'), '// new\n');
  assert.equal(fs.existsSync(path.join(repo, 'src', 'gone.js')), false);
  assert.equal(fs.readFileSync(path.join(repo, 'overlay', 'main.js'), 'utf8'), '// new overlay\n');
  assert.equal(fs.existsSync(path.join(repo, 'overlay', 'old-file.js')), false);
  assert.equal(fs.readFileSync(path.join(repo, 'overlay', 'node_modules', 'electron', 'path.txt'), 'utf8'), 'Electron');
  assert.equal(fs.readFileSync(path.join(repo, 'my-notes.txt'), 'utf8'), 'the player keeps this\n');
  assert.ok(fs.existsSync(path.join(repo, 'bin', 'wowf')));
});
