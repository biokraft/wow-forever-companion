import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bumpVersion, changelogSection, VERSION_FILES } from '../scripts/bump-version.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const JSON_FILES = {
  'package.json': [['version']],
  'overlay/package.json': [['version']],
  'overlay/package-lock.json': [['version'], ['packages', '', 'version']],
  '.claude-plugin/plugin.json': [['version']],
  '.claude-plugin/marketplace.json': [['plugins', 0, 'version']],
};
const TOC = 'addon/ForeverLog/ForeverLog.toc';
const CORE = 'addon/ForeverLog/Core.lua';
const TEXT_FILES = [TOC, CORE];
const ALL_FILES = [...Object.keys(JSON_FILES), ...TEXT_FILES];

// A temp folder holding copies of the seven real version files at their repo paths.
function copyVersionFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wowf bump '));
  for (const f of ALL_FILES) {
    fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  return dir;
}

const setPath = (obj, keys, value) => {
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = value;
};
const changedLines = (a, b) => {
  const x = a.split('\n');
  const y = b.split('\n');
  assert.equal(x.length, y.length, 'line count unchanged');
  return x.filter((l, i) => l !== y[i]).length;
};

test('bumpVersion lists the seven version files', () => {
  assert.deepEqual([...VERSION_FILES].sort(), [...ALL_FILES].sort());
});

test('package.json, the addon .toc and Core.lua carry the same version', () => {
  const pkg = JSON.parse(read('package.json')).version;
  assert.equal(/^## Version:[ \t]*(\S+)/m.exec(read(TOC))?.[1], pkg, 'ForeverLog.toc');
  assert.equal(/^ns\.VERSION = "([^"]*)"/m.exec(read(CORE))?.[1], pkg, 'Core.lua ns.VERSION');
});

// A version no release will carry: the real files may already be at any real version (this
// test once pinned the next release's number and failed on the day of that release).
const NEXT = '98.7.6';

test('bumpVersion sets every version and touches nothing else', () => {
  const dir = copyVersionFiles();
  const before = Object.fromEntries(ALL_FILES.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
  const changed = bumpVersion(dir, NEXT);
  assert.deepEqual([...changed].sort(), Object.keys(before).sort());
  for (const [f, keys] of Object.entries(JSON_FILES)) {
    const after = fs.readFileSync(path.join(dir, f), 'utf8');
    const expected = JSON.parse(before[f]);
    for (const k of keys) setPath(expected, k, NEXT);
    assert.deepEqual(JSON.parse(after), expected, `${f}: only the version fields change`);
    assert.equal(changedLines(before[f], after), keys.length, `${f}: formatting kept`);
    assert.ok(after.endsWith('\n'), `${f}: trailing newline kept`);
  }
  const toc = fs.readFileSync(path.join(dir, TOC), 'utf8');
  assert.match(toc, new RegExp(`^## Version: ${NEXT.replaceAll('.', '\\.')}$`, 'm'));
  assert.equal(changedLines(before[TOC], toc), 1);
  const core = fs.readFileSync(path.join(dir, CORE), 'utf8');
  assert.match(core, new RegExp(`^ns\\.VERSION = "${NEXT.replaceAll('.', '\\.')}"$`, 'm'));
  assert.equal(changedLines(before[CORE], core), 1);
});

test('bumpVersion keeps CRLF line endings', () => {
  const dir = copyVersionFiles();
  for (const f of ALL_FILES) {
    const p = path.join(dir, f);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\n/g, '\r\n'));
  }
  bumpVersion(dir, '1.2.3');
  for (const f of ALL_FILES) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.equal(/(?<!\r)\n/.test(text), false, `${f}: no bare LF`);
  }
  assert.match(fs.readFileSync(path.join(dir, TOC), 'utf8'), /^## Version: 1\.2\.3\r$/m);
  assert.match(fs.readFileSync(path.join(dir, CORE), 'utf8'), /^ns\.VERSION = "1\.2\.3"\r$/m);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '1.2.3');
});

test('bumpVersion rejects anything that is not MAJOR.MINOR.PATCH and writes nothing', () => {
  const dir = copyVersionFiles();
  const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  for (const bad of ['0.4', 'v0.4.0', '0.4.0; rm', '0.4.0-beta', '01.4.0', '', ' 0.4.0']) {
    assert.throws(() => bumpVersion(dir, bad), /MAJOR\.MINOR\.PATCH/, JSON.stringify(bad));
  }
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), before);
});

test('bumpVersion writes nothing when Core.lua has no version line', () => {
  const dir = copyVersionFiles();
  const p = path.join(dir, CORE);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/^ns\.VERSION = .*$/m, '-- no version here'));
  const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  assert.throws(() => bumpVersion(dir, '0.4.0'), /Core\.lua/);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), before);
});

test('the release skill names every version file the bump sets', () => {
  const skill = read('.claude/skills/forever-companion-release/SKILL.md').replace(/\s+/g, ' ');
  for (const f of VERSION_FILES) assert.ok(skill.includes(`\`${f}\``), f);
});

test('bumpVersion writes nothing when a version file is missing', () => {
  const dir = copyVersionFiles();
  fs.rmSync(path.join(dir, TOC));
  const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  assert.throws(() => bumpVersion(dir, '0.4.0'), /ForeverLog\.toc/);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), before);
});

const CHANGELOG = `# Changelog

## 0.5.0 (2026-12-01)

- Newer thing.

## 0.4.0

First public release.

### Highlights
- Old thing.

## 0.3.10

- Not this one.
`;

test('changelogSection returns the block under a version heading, with or without a date', () => {
  assert.equal(changelogSection(CHANGELOG, '0.5.0'), '- Newer thing.');
  assert.equal(changelogSection(CHANGELOG, '0.4.0'), 'First public release.\n\n### Highlights\n- Old thing.');
  assert.equal(changelogSection(CHANGELOG.replace(/\n/g, '\r\n'), '0.3.10'), '- Not this one.');
});

test('changelogSection throws for an unknown, partial or invalid version', () => {
  assert.throws(() => changelogSection(CHANGELOG, '0.6.0'), /0\.6\.0/);
  assert.throws(() => changelogSection(CHANGELOG, '0.3.1'), /0\.3\.1/, 'no prefix match on 0.3.10');
  assert.throws(() => changelogSection(CHANGELOG, 'v0.4.0'), /MAJOR\.MINOR\.PATCH/);
  assert.throws(() => changelogSection('# Changelog\n\n## 1.0.0\n\n## 0.9.0\n- x\n', '1.0.0'), /empty/);
});

test('the real changelog has a 0.4.0 section for players that shows /fc', () => {
  const notes = changelogSection(read('CHANGELOG.md'), '0.4.0');
  assert.match(notes, /first public release/i);
  assert.match(notes, /\/fc/);
  assert.doesNotMatch(notes, new RegExp(`${'/' + 'cf'}\\b`));
  assert.doesNotMatch(notes, /never published/, 'the note on unpublished versions stays out of the release notes');
});

test('the release skill can only be started by the owner typing it', () => {
  const skill = read('.claude/skills/forever-companion-release/SKILL.md');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(skill);
  assert.ok(fm, 'frontmatter present');
  const lines = fm[1].split(/\r?\n/);
  assert.ok(lines.includes('name: forever-companion-release'));
  assert.ok(lines.includes('disable-model-invocation: true'));
  assert.ok(lines.some((l) => /^description: "?Cut a Forever Companion release/.test(l)));
});

test('the release workflow reads by default and only the release job may write', () => {
  const wf = read('.github/workflows/release.yml');
  assert.match(wf, /^permissions:\r?\n  contents: read\r?$/m, 'top level is read-only');
  assert.equal(wf.match(/contents: write/g)?.length, 1, 'contents: write appears exactly once');
  assert.match(wf, /^  release:[\s\S]*^    permissions:\r?\n      contents: write\r?$/m, 'on the release job');
});

test('the release workflow passes event text to the shell only through env', () => {
  const wf = read('.github/workflows/release.yml');
  assert.match(wf, /tags: \['v\*'\]/);
  for (const line of wf.split(/\r?\n/).filter((l) => l.includes('${{'))) {
    assert.match(line, /^\s+[A-Z][A-Z0-9_]*: \$\{\{ [\w.]+ \}\}\s*$/, `only env assignments use \${{ }}: ${line.trim()}`);
  }
});
