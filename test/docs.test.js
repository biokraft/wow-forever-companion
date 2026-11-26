import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const readme = () => read('README.md');
const reference = () => read('docs/REFERENCE.md');
const PLAYER_DOCS = ['README.md', 'docs/SETUP.md', 'docs/REFERENCE.md', 'docs/AGENT-INSTALL.md'];
const RAW = 'https://raw.githubusercontent.com/biokraft/wow-forever-companion/main';

test('the reference documents every wowf command', () => {
  const usage = read('src/cli.js').match(/const USAGE = `([\s\S]*?)`;/)[1];
  const cmds = [...usage.matchAll(/^  ([a-z-]+)\b/gm)].map((m) => m[1]);
  assert.ok(cmds.length >= 9);
  for (const c of cmds) assert.match(reference(), new RegExp(`wowf ${c}\\b`), c);
});

test('the reference documents every config key', () => {
  for (const k of ['gameDir', 'dataDir', 'main', 'updateCheck', 'overlay.backend', 'overlay.model', 'overlay.claudeModel', 'overlay.hotkey', 'overlay.button', 'overlay.chat', 'overlay.opacity']) {
    assert.ok(reference().includes(k), k);
  }
});

test('the reference carries the Claude subscription terms note, and the README links to the reference', () => {
  assert.match(reference(), /Free, Pro, Max/);
  assert.ok(readme().includes('(docs/REFERENCE.md)'));
});

test('README has the one-line installs, the install by hand, the agent install line and the update command', () => {
  const text = readme();
  for (const s of [
    `curl -fsSL ${RAW}/install.sh | sh`,
    `irm ${RAW}/install.ps1 | iex`,
    'git clone https://github.com/biokraft/wow-forever-companion.git',
    'node bin/wowf setup',
    'Let your agent install it',
    'Clone https://github.com/biokraft/wow-forever-companion and follow docs/AGENT-INSTALL.md to set it up for me.',
    'node bin/wowf update',
  ]) assert.ok(text.includes(s), s);
});

test('README states the trademarks, what the tool never does, and that Windows is beta', () => {
  const text = readme();
  for (const s of [
    'World of Warcraft and Warcraft are trademarks or registered trademarks of Blizzard Entertainment, Inc.',
    'It sends no input to the game, reads no game memory and automates nothing.',
    'Windows (beta)',
  ]) assert.ok(text.includes(s), s);
});

test('player docs name no unfetched site, old command, disallowed login or old Electron fix', () => {
  for (const doc of PLAYER_DOCS) {
    const text = read(doc);
    assert.doesNotMatch(text, /wowhead/i, doc);
    assert.ok(!text.includes(`/${'cf'} `), `${doc}: old slash command`);
    assert.doesNotMatch(text, /copilot/i, doc);
    assert.ok(!text.includes('npm install-scripts'), `${doc}: npm install-scripts`);
  }
});

test('AGENT-INSTALL keeps the agent out of the game and away from AI logins', () => {
  const text = read('docs/AGENT-INSTALL.md');
  for (const s of ['never click or type into the game window', 'never handle AI keys or logins', 'wowf setup --yes', 'wowf doctor',
    "Never re-run setup with flags that differ from the player's answers."]) {
    assert.ok(text.includes(s), s);
  }
});

test('relative links in the player docs and ARCHITECTURE resolve', () => {
  for (const doc of [...PLAYER_DOCS, 'docs/ARCHITECTURE.md']) {
    const text = read(doc);
    const hrefs = [
      ...[...text.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)/g)].map((m) => m[1]),
      ...[...text.matchAll(/\b(?:src|href)="(?!https?:|#|mailto:)([^"#]+)"/g)].map((m) => m[1]),
    ];
    for (const href of hrefs) {
      assert.ok(fs.existsSync(path.join(root, path.dirname(doc), href)), `${doc} -> ${href}`);
    }
  }
});

test('LICENSE is MIT and CHANGELOG lists the current version', () => {
  assert.match(read('LICENSE'), /MIT License/);
  assert.ok(read('CHANGELOG.md').includes(JSON.parse(read('package.json')).version));
});

test('the player docs say how to restart the overlay: start it again', () => {
  for (const doc of ['README.md', 'docs/SETUP.md']) {
    assert.ok(read(doc).replace(/\s+/g, ' ').includes('run `node bin/wowf overlay` again to restart it'), doc);
  }
});

test('README tells players about the Plan page and reply chips', () => {
  const text = readme();
  for (const s of ['**Plan**', 'Start my game plan', 'set up my game plan', 'chips']) assert.ok(text.includes(s), s);
});

test('ARCHITECTURE covers the game plan folder, the wowf gameplan command and the chips block', () => {
  const text = read('docs/ARCHITECTURE.md');
  for (const s of ['gameplans/', 'wowf gameplan', '<choices>', 'wow-gameplan', 'wow_gameplan']) assert.ok(text.includes(s), s);
});

test('CHANGELOG keeps unreleased work in its own section above the released versions', () => {
  // What the section holds changes with every release (it is empty right after one), so
  // only its place is checked.
  const headings = [...read('CHANGELOG.md').matchAll(/^## .*$/gm)];
  assert.equal(headings[0]?.[0], '## Unreleased', 'Unreleased is the first section');
  assert.match(headings[1]?.[0] ?? '', /^## \d+\.\d+\.\d+(?: \(\d{4}-\d{2}-\d{2}\))?$/, 'a released version follows it');
});

test('the setup guide shows the same one-line installs and links both scripts', () => {
  const text = read('docs/SETUP.md');
  for (const s of [`curl -fsSL ${RAW}/install.sh | sh`, `irm ${RAW}/install.ps1 | iex`, '(../install.sh)', '(../install.ps1)']) {
    assert.ok(text.includes(s), s);
  }
});

test('player docs say About me holds the rest and the game plan holds goals and build', () => {
  for (const doc of ['README.md', 'docs/SETUP.md', 'docs/AGENT-INSTALL.md']) {
    const text = read(doc).replace(/\s+/g, ' ');
    assert.match(text, /game plan/i, doc);
    assert.doesNotMatch(text, /talent plan/i, doc);
  }
});
