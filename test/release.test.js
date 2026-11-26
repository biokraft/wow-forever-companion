import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildAddonZip, workingTreeDirty } from '../scripts/release.js';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const noZip = process.platform === 'win32' && 'zip CLI';
const entries = (zip) => execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean);

test('the addon zip contains ForeverLog with an empty plan file', { skip: noZip }, () => {
  const zip = buildAddonZip(tmp('wowf-zip-'), '9.9.9');
  assert.equal(path.basename(zip), 'ForeverLog-9.9.9.zip');
  const list = entries(zip);
  assert.ok(list.includes('ForeverLog/ForeverLog.toc'));
  assert.ok(list.includes('ForeverLog/Core.lua'));
  assert.ok(list.includes('ForeverLog/ForeverLog_Plan.lua'));
  assert.ok(list.every((f) => f.startsWith('ForeverLog/')), 'nothing but the addon folder');
  const plan = execFileSync('unzip', ['-p', zip, 'ForeverLog/ForeverLog_Plan.lua'], { encoding: 'utf8' });
  assert.match(plan, /ForeverLogPlan = nil/);
});

test('review: the addon zip comes from the last commit, not the working folder', { skip: noZip }, () => {
  const stray = path.join(ROOT, 'addon', 'ForeverLog', 'stray-untracked-test-file.lua');
  fs.writeFileSync(stray, '-- untracked\n');
  try {
    const list = entries(buildAddonZip(tmp('wowf-zip-'), '9.9.7'));
    assert.equal(list.includes('ForeverLog/stray-untracked-test-file.lua'), false);
    assert.equal(workingTreeDirty(), true, 'an untracked file makes the tree dirty');
  } finally {
    fs.rmSync(stray, { force: true });
  }
});

test('buildAddonZip accepts a folder given relative to the current directory, as the release workflow does', { skip: noZip }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-relzip-'));
  const before = process.cwd();
  try {
    process.chdir(root);
    const zip = buildAddonZip('out', '9.9.8');
    assert.ok(path.isAbsolute(zip), 'the returned path does not depend on the current directory');
    assert.ok(fs.statSync(zip).size > 1000);
    assert.equal(fs.realpathSync(path.dirname(zip)), fs.realpathSync(path.join(root, 'out')));
  } finally {
    process.chdir(before);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
