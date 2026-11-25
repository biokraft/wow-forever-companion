import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildPublicTree, buildAddonZip, workingTreeDirty } from '../scripts/release.js';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('the public tree has the toolkit but no private docs or local state', () => {
  const out = tmp('wowf-rel-');
  const files = buildPublicTree(out);
  assert.ok(fs.existsSync(path.join(out, 'README.md')));
  assert.ok(fs.existsSync(path.join(out, 'bin', 'wowf')));
  assert.ok(!fs.existsSync(path.join(out, 'docs', 'superpowers')));
  assert.ok(!files.some((f) => f.includes('node_modules') || f.endsWith('ForeverLog_Plan.lua')));
});

test('the addon zip contains ForeverLog with an empty plan file', { skip: process.platform === 'win32' && 'zip CLI' }, () => {
  const tree = tmp('wowf-tree-');
  buildPublicTree(tree);
  const out = tmp('wowf-zip-');
  const zip = buildAddonZip(tree, out, '9.9.9');
  assert.equal(path.basename(zip), 'ForeverLog-9.9.9.zip');
  const list = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
  assert.ok(list.includes('ForeverLog/ForeverLog.toc'));
  assert.ok(list.includes('ForeverLog/Core.lua'));
  assert.ok(list.includes('ForeverLog/ForeverLog_Plan.lua'));
  const plan = execFileSync('unzip', ['-p', zip, 'ForeverLog/ForeverLog_Plan.lua'], { encoding: 'utf8' });
  assert.match(plan, /ForeverLogPlan = nil/);
});

test('review: the public tree comes from the last commit, not the working folder', () => {
  const stray = path.join(ROOT, 'addon', 'ForeverLog', 'stray-untracked-test-file.lua');
  fs.writeFileSync(stray, '-- untracked\n');
  try {
    const out = tmp('wowf-rel-');
    buildPublicTree(out);
    assert.equal(fs.existsSync(path.join(out, 'addon', 'ForeverLog', 'stray-untracked-test-file.lua')), false);
    assert.equal(workingTreeDirty(), true, 'an untracked file makes the tree dirty');
  } finally {
    fs.rmSync(stray, { force: true });
  }
});

test('review: files in the public tree have normal permissions', { skip: process.platform === 'win32' && 'Windows has no Unix file modes' }, () => {
  const out = tmp('wowf-rel-');
  buildPublicTree(out);
  assert.equal(fs.statSync(path.join(out, 'README.md')).mode & 0o777, 0o644);
  assert.equal(fs.statSync(path.join(out, 'bin', 'wowf')).mode & 0o777, 0o755);
});
