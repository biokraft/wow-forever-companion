import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFakeQuestie } from './helpers/questie-fixture.js';
import { parseSavedVariables } from '../src/lua/parse.js';

const BIN = fileURLToPath(new URL('../bin/wowf', import.meta.url));
const FIXTURE = fs.readFileSync(new URL('./fixtures/sv/ForeverLog.lua', import.meta.url), 'utf8');

let root, game, dataDir, cfgFile;
const run = (args, { cwd = root, env = {} } = {}) =>
  spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, WOWF_CONFIG: cfgFile, ...env } });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-cli-')));
  game = path.join(root, '_forever_');
  const sv = path.join(game, 'WTF', 'Account', 'ACC#1', '7', 'Testa-Grimtusk', 'SavedVariables');
  fs.mkdirSync(sv, { recursive: true });
  // quest 100 is available to the fixture Troll Warrior: no prereqs, level 2
  fs.writeFileSync(path.join(sv, 'ForeverLog.lua'), FIXTURE.replace('["level"] = 12,', '["level"] = 3,'));
  writeFakeQuestie(path.join(game, 'Interface', 'AddOns'));
  dataDir = path.join(root, 'data');
  cfgFile = path.join(root, 'config.json');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const init = () => run(['init', '--data-dir', dataDir, '--game-dir', game]);

test('init writes config and picks the character with data as main', () => {
  const r = init();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(cfgFile, 'utf8')), { gameDir: game, dataDir, main: 'Testa-Grimtusk' });
});

test('detect lists characters and whether they have data', () => {
  init();
  const r = run(['detect']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Testa-Grimtusk\s+data/);
});

test('detect without config suggests setup, the command players have', () => {
  const r = run(['detect', '--game-dir', game]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /node bin\/wowf setup/);
  assert.doesNotMatch(r.stdout, /wowf init/);
});

test('a command that needs the config points to setup when there is none', () => {
  const r = run(['state']);
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /node bin\/wowf setup/);
  assert.doesNotMatch(r.stderr + r.stdout, /wowf init/);
});

test('sync --json emits sync results', () => {
  init();
  const r = run(['sync', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const results = JSON.parse(r.stdout);
  assert.equal(results[0].status, 'updated');
  assert.equal(results[0].level, 3);
});

test('sync --hook from another folder prints nothing and exits 0', () => {
  init();
  const r = run(['sync', '--hook'], { cwd: root });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('sync --hook inside the data folder prints one context line once', () => {
  init();
  fs.mkdirSync(dataDir, { recursive: true });
  const first = run(['sync', '--hook'], { cwd: dataDir });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /^Forever Companion: Testa L3/);
  const second = run(['sync', '--hook'], { cwd: dataDir });
  assert.equal(second.stdout, '');
});

test('sync --hook with no config prints nothing and exits 0', () => {
  const r = run(['sync', '--hook'], { env: { WOWF_CONFIG: path.join(root, 'missing.json') } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('quests available --json returns quests for the main character with zone names', () => {
  init();
  run(['sync']);
  const r = run(['quests', 'available', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const list = JSON.parse(r.stdout);
  assert.deepEqual(list.map((q) => q.id), [100]);
  assert.equal(list[0].zoneName, 'Durotar');
});

test('quests available --zone filters by zone name', () => {
  init();
  run(['sync']);
  assert.deepEqual(JSON.parse(run(['quests', 'available', '--zone', 'barrens', '--json']).stdout), []);
  assert.equal(JSON.parse(run(['quests', 'available', '--zone', 'Durotar', '--json']).stdout).length, 1);
});

test('quests show prints giver, turn-in and prerequisites', () => {
  init();
  const r = run(['quests', 'show', '101']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Follow Up/);
  assert.match(r.stdout, /Test Giver/);
  assert.match(r.stdout, /Durotar 50\.1, 60\.2/);
  assert.match(r.stdout, /Test Quest/);
});

test('unknown command exits 1 with usage', () => {
  const r = run(['frobnicate']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Usage: wowf/);
});

const addonDir = () => path.join(game, 'Interface', 'AddOns', 'ForeverLog');
const goodPlan = { title: 'Razor Hill loop', steps: [{ text: 'Turn in Test Quest', done: { type: 'quest_turnin', id: 100 }, waypoint: { zone: 'Durotar', x: 50.1, y: 60.2 } }] };

test('plan write emits the addon plan file and a JSON copy in the data folder', () => {
  init();
  run(['sync']);
  fs.mkdirSync(addonDir(), { recursive: true });
  const file = path.join(root, 'plan.json');
  fs.writeFileSync(file, JSON.stringify(goodPlan));
  const r = run(['plan', 'write', file]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Plan pushed: 1 step for Testa.*\/fc sync/);
  const lua = fs.readFileSync(path.join(addonDir(), 'ForeverLog_Plan.lua'), 'utf8');
  const { ForeverLogPlan } = parseSavedVariables(lua);
  assert.equal(ForeverLogPlan.characterName, 'Testa');
  assert.equal(ForeverLogPlan.steps[0].waypoint.mapId, 1411);
  assert.ok(Array.isArray(ForeverLogPlan.nudges));
  const copies = fs.readdirSync(path.join(dataDir, 'plans')).filter((f) => f.endsWith('.json'));
  assert.equal(copies.length, 1);
});

test('plan write - reads the plan from stdin', () => {
  init();
  run(['sync']);
  fs.mkdirSync(addonDir(), { recursive: true });
  const r = spawnSync(process.execPath, [BIN, 'plan', 'write', '-'], { cwd: root, encoding: 'utf8', input: JSON.stringify(goodPlan), env: { ...process.env, WOWF_CONFIG: cfgFile } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(addonDir(), 'ForeverLog_Plan.lua')));
});

test('plan write with invalid input exits 1 and writes nothing', () => {
  init();
  run(['sync']);
  fs.mkdirSync(addonDir(), { recursive: true });
  const file = path.join(root, 'bad.json');
  fs.writeFileSync(file, '{"title": "no steps"}');
  const r = run(['plan', 'write', file]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /steps/);
  assert.equal(fs.existsSync(path.join(addonDir(), 'ForeverLog_Plan.lua')), false);
  fs.writeFileSync(file, 'not json');
  assert.equal(run(['plan', 'write', file]).status, 1);
});

test('plan show prints the newest plan', () => {
  init();
  run(['sync']);
  fs.mkdirSync(addonDir(), { recursive: true });
  const file = path.join(root, 'plan.json');
  fs.writeFileSync(file, JSON.stringify(goodPlan));
  run(['plan', 'write', file]);
  const r = run(['plan', 'show']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Razor Hill loop/);
  assert.match(r.stdout, /Turn in Test Quest/);
});

test('review: plan show picks the newest plan even when two share a second', () => {
  init();
  run(['sync']);
  fs.mkdirSync(addonDir(), { recursive: true });
  const plans = path.join(dataDir, 'plans');
  fs.mkdirSync(plans, { recursive: true });
  fs.writeFileSync(path.join(plans, '20261125-101010.json'), JSON.stringify({ title: 'older', generatedAt: 100, characterName: 'T', steps: [] }));
  fs.writeFileSync(path.join(plans, '20261125-101010-2.json'), JSON.stringify({ title: 'newer', generatedAt: 100, seq: 2, characterName: 'T', steps: [] }));
  fs.writeFileSync(path.join(plans, '20261125-101010-10.json'), JSON.stringify({ title: 'newest', generatedAt: 100, seq: 10, characterName: 'T', steps: [] }));
  assert.match(run(['plan', 'show']).stdout, /newest/);
});

test('review: plan write warns when the installed addon cannot load plans', () => {
  init();
  run(['sync']);
  fs.mkdirSync(addonDir(), { recursive: true });
  fs.writeFileSync(path.join(addonDir(), 'ForeverLog.toc'), '## Interface: 16001\n## Version: 0.1.0\n\nCore.lua\n');
  const file = path.join(root, 'plan.json');
  fs.writeFileSync(file, JSON.stringify(goodPlan));
  const r = run(['plan', 'write', file]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /wowf install-addon/);
});

test('review: plan write leaves turn-in and talent nudges to the addon (it computes them live)', () => {
  init();
  run(['sync']);
  fs.mkdirSync(addonDir(), { recursive: true });
  const file = path.join(root, 'plan.json');
  fs.writeFileSync(file, JSON.stringify(goodPlan));
  run(['plan', 'write', file]);
  const { ForeverLogPlan } = parseSavedVariables(fs.readFileSync(path.join(addonDir(), 'ForeverLog_Plan.lua'), 'utf8'));
  assert.ok(!ForeverLogPlan.nudges.some((n) => /talent point|Ready to turn in/.test(n)), JSON.stringify(ForeverLogPlan.nudges));
});

test('npc prints matching NPCs with zone and coordinates', () => {
  init();
  const r = run(['npc', 'Test Giver']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Test Giver <Weapon Master> \(Durotar 50\.1, 60\.2\)  #500/);
  assert.match(run(['npc', 'nobody']).stdout, /No NPC/);
});

test('overlay without its node_modules prints the install hint', () => {
  init();
  const r = run(['overlay'], { env: { WOWF_OVERLAY_DIR: path.join(root, 'no-overlay') } });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /node bin\/wowf setup/);
});

test('plan write --json takes the plan inline (no temp file needed)', () => {
  init();
  run(['sync']);
  fs.mkdirSync(addonDir(), { recursive: true });
  const r = run(['plan', 'write', '--json', JSON.stringify(goodPlan)]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Plan pushed: 1 step/);
});

test('review: overlay with electron installed but no binary says so', () => {
  init();
  const dir = path.join(root, 'ov');
  fs.mkdirSync(path.join(dir, 'node_modules', 'electron'), { recursive: true });
  const r = run(['overlay'], { env: { WOWF_OVERLAY_DIR: dir } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Electron's app was not downloaded/);
  assert.match(r.stdout, /node bin\/wowf setup/);
});

// Electron's program is started directly (no npm, no shell): a stand-in records how.
test('wowf overlay starts Electron\'s program on the overlay folder, and says on macOS that nothing appears until WoW runs',
  { skip: process.platform === 'win32' && 'the stand-in program is a shell script' }, async () => {
    const dir = path.join(root, 'my overlay');
    const electron = path.join(dir, 'node_modules', 'electron');
    const marker = path.join(root, 'started.txt');
    fs.mkdirSync(path.join(electron, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(electron, 'path.txt'), 'fake-electron');
    fs.writeFileSync(path.join(electron, 'dist', 'fake-electron'), `#!/bin/sh\npwd > "${marker}.tmp"; printf '%s|' "$@" >> "${marker}.tmp"; mv "${marker}.tmp" "${marker}"\n`, { mode: 0o755 });
    const r = run(['overlay'], { env: { WOWF_OVERLAY_DIR: dir } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /overlay started/);
    if (process.platform === 'darwin') assert.match(r.stdout, /Nothing appears until WoW is running/);
    else assert.doesNotMatch(r.stdout, /until WoW is running/);
    for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await new Promise((res) => setTimeout(res, 50));
    const [cwd, args] = fs.readFileSync(marker, 'utf8').split('\n');
    assert.equal(fs.realpathSync(cwd), fs.realpathSync(dir));
    assert.equal(args, '.|');
  });

test('wowf overlay with path.txt but no program says Electron is missing', () => {
  const dir = path.join(root, 'ov');
  const electron = path.join(dir, 'node_modules', 'electron');
  fs.mkdirSync(electron, { recursive: true });
  fs.writeFileSync(path.join(electron, 'path.txt'), 'fake-electron');
  const r = run(['overlay'], { env: { WOWF_OVERLAY_DIR: dir } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Electron's app was not downloaded/);
});

test('init scaffolds an empty data folder and never overwrites an edited CLAUDE.md', () => {
  const r = init();
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['CLAUDE.md', 'AGENTS.md', '.gitignore']) assert.ok(fs.existsSync(path.join(dataDir, f)), f);
  for (const d of ['characters', 'plans', 'knowledge', 'drafts']) assert.ok(fs.statSync(path.join(dataDir, d)).isDirectory(), d);
  fs.writeFileSync(path.join(dataDir, 'CLAUDE.md'), '# my notes\n');
  init();
  assert.equal(fs.readFileSync(path.join(dataDir, 'CLAUDE.md'), 'utf8'), '# my notes\n');
  assert.match(r.stdout, /install-addon/);
  assert.match(r.stdout, /\/fc sync/);
});

test('init keeps overlay settings from an existing config', () => {
  fs.writeFileSync(cfgFile, JSON.stringify({ gameDir: game, dataDir, main: null, overlay: { backend: 'claude', hotkey: 'F9' } }));
  init();
  assert.deepEqual(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).overlay, { backend: 'claude', hotkey: 'F9' });
});

test('init --git creates a git repo in the data folder', () => {
  run(['init', '--data-dir', dataDir, '--game-dir', game, '--git']);
  assert.ok(fs.existsSync(path.join(dataDir, '.git')));
});

test('knowledge write, list and show through the CLI', () => {
  init();
  const md = '---\ntopic: Hunter leveling\nsources:\n  - https://www.wowhead.com/x\nchecked: 2026-11-25\nscope: forever\n---\n\nPets.\n';
  const w = run(['knowledge', 'write', 'hunter-leveling', '--md', md]);
  assert.equal(w.status, 0, w.stderr);
  const list = run(['knowledge', 'list']).stdout;
  assert.match(list, /hunter-leveling .*cache/);
  assert.ok(list.startsWith(`Save new notes to: ${path.join(dataDir, 'knowledge')}/<slug>.md`), list.slice(0, 120));
  assert.match(run(['knowledge', 'show', 'hunter-leveling']).stdout, /Pets\./);
  const bad = run(['knowledge', 'write', 'x', '--md', 'no frontmatter']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /sources/);
});

test('review: AGENTS.md holds the notes and CLAUDE.md imports it (Pi reads AGENTS.md first)', () => {
  init();
  assert.match(fs.readFileSync(path.join(dataDir, 'AGENTS.md'), 'utf8'), /About me/);
  assert.equal(fs.readFileSync(path.join(dataDir, 'CLAUDE.md'), 'utf8').trim(), '@AGENTS.md');
});

test('review: init never adds AGENTS.md next to an existing real CLAUDE.md', () => {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'CLAUDE.md'), '# My real notes\n');
  init();
  assert.equal(fs.existsSync(path.join(dataDir, 'AGENTS.md')), false);
  assert.equal(fs.readFileSync(path.join(dataDir, 'CLAUDE.md'), 'utf8'), '# My real notes\n');
});

test('review: plan write refuses paths that climb out and never echoes file contents', () => {
  init();
  run(['sync']);
  fs.mkdirSync(addonDir(), { recursive: true });
  const secret = path.join(root, 'secret.txt');
  fs.writeFileSync(secret, 'SECRET_TOKEN_123');
  const climb = run(['plan', 'write', 'drafts/../../secret.txt'], { cwd: dataDir });
  assert.equal(climb.status, 1);
  assert.match(climb.stderr, /\.\./);
  const direct = run(['plan', 'write', secret]);
  assert.equal(direct.status, 1);
  assert.doesNotMatch(direct.stderr, /SECRET/);
});

test('review: knowledge list works without a config (shipped notes)', () => {
  const r = run(['knowledge', 'list'], { env: { WOWF_CONFIG: path.join(root, 'none.json') } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /forever-rules .*shipped/);
});

test('review: init refuses the home folder as the data folder', () => {
  const r = run(['init', '--data-dir', os.homedir(), '--game-dir', game]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /home folder/);
});

test('overlay autostart on, status and off manage the login item', { skip: process.platform !== 'darwin' && 'login items are macOS only' }, () => {
  const home = path.join(root, 'home');
  const env = { HOME: home, WOWF_OVERLAY_DIR: path.join(root, 'ov') };
  const agent = path.join(home, 'Library', 'LaunchAgents', 'com.forever-companion.overlay.plist');
  assert.match(run(['overlay', 'autostart', 'status'], { env }).stdout, /off/);
  const on = run(['overlay', 'autostart', 'on'], { env });
  assert.equal(on.status, 0, on.stderr);
  assert.ok(fs.readFileSync(agent, 'utf8').includes(path.join(root, 'ov')));
  assert.match(run(['overlay', 'autostart', 'status'], { env }).stdout, /on/);
  assert.equal(run(['overlay', 'autostart', 'off'], { env }).status, 0);
  assert.equal(fs.existsSync(agent), false);
});

test('overlay autostart on says it is macOS only elsewhere', { skip: process.platform === 'darwin' && 'macOS supports it' }, () => {
  const env = { HOME: path.join(root, 'home'), WOWF_OVERLAY_DIR: path.join(root, 'ov') };
  const on = run(['overlay', 'autostart', 'on'], { env });
  assert.equal(on.status, 1);
  assert.match(on.stdout, /only available on macOS/);
});

test('overlay autostart rejects an unknown word', () => {
  const r = run(['overlay', 'autostart', 'maybe']);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /on\|off\|status/);
});

// --- Live state from the overlay's pixel bridge ---

const SLUG = 'testrealm-testa-grimtusk';
const svFile = () => path.join(game, 'WTF', 'Account', 'ACC#1', '7', 'Testa-Grimtusk', 'SavedVariables', 'ForeverLog.lua');
async function tagOf(name, classFile) {
  const { characterTag } = await import('../src/bridge/codec.js');
  return characterTag(name, classFile);
}
async function writeLive(over = {}) {
  const now = Math.floor(Date.now() / 1000);
  const value = {
    seenAt: now - 1, changedAt: now - 10, seq: 3, tag: await tagOf('Testa Grimtusk', 'WARRIOR'),
    level: 4, xp: 450, xpMax: 1000, rested: 0, money: 99,
    map: { uiMapId: 1411, x: 44.9, y: 13.2 },
    quests: [{ id: 791, complete: true, failed: false, objectives: [8] }], questsComplete: true,
    ...over,
  };
  fs.writeFileSync(path.join(dataDir, 'characters', `${SLUG}.live.json`), JSON.stringify(value));
}
// SavedVariables written ten minutes ago, so live data seen now is newer.
const ageSv = () => { const t = Date.now() / 1000 - 600; fs.utimesSync(svFile(), t, t); };

test('sync --hook prints the live line on every prompt while live data is fresh', async () => {
  init();
  ageSv();
  run(['sync', '--hook'], { cwd: dataDir });
  await writeLive();
  for (let i = 0; i < 2; i++) {
    const r = run(['sync', '--hook'], { cwd: dataDir });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /^Forever Companion: Live: L4 45% XP · Durotar 44\.9\/13\.2 · 1 quest ready to turn in/);
    assert.equal(r.stdout.trim().split('\n').length, 1);
  }
});

test('state prints the snapshot with live values and per-quest live progress merged in', async () => {
  init();
  ageSv();
  run(['sync']);
  await writeLive({ quests: [{ id: 791, complete: true, failed: false, objectives: [8] }, { id: 102, complete: false, failed: false, objectives: [1] }] });
  const r = run(['state']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Testa L4 45% XP .*Durotar 44\.9\/13\.2 \(live\)/);
  assert.match(r.stdout, /Carry Your Weight #791 \(ready to turn in\): Canvas Scraps: 8\/8/);
  assert.match(r.stdout, /Smithing Task #102/);
  const j = run(['state', '--json']);
  assert.equal(j.status, 0, j.stderr);
  const s = JSON.parse(j.stdout);
  assert.equal(s.level, 4);
  assert.equal(s.live.questsComplete, true);
  assert.equal(s.quests.find((q) => q.id === 791).objectives[0].have, 8);
  assert.equal(s.quests.find((q) => q.id === 102).liveOnly, true);
});

test('state without live data prints the synced snapshot', () => {
  init();
  const r = run(['state']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Testa L3 .*Razor Hill \(Durotar\)/);
  assert.doesNotMatch(r.stdout, /\(live\)/);
});

test('sync --hook prints nothing extra when live data is stale or older than the SavedVariables', async () => {
  init();
  ageSv();
  run(['sync', '--hook'], { cwd: dataDir });
  await writeLive({ seenAt: Math.floor(Date.now() / 1000) - 200 });
  assert.equal(run(['sync', '--hook'], { cwd: dataDir }).stdout, '');
  // A /fc sync after the live data: SavedVariables are newer, the snapshot wins.
  await writeLive({ seenAt: Math.floor(Date.now() / 1000) - 300 });
  assert.equal(run(['sync', '--hook'], { cwd: dataDir }).stdout, '');
});

test('sync --hook stays silent and exits 0 when the live file is broken', () => {
  init();
  ageSv();
  run(['sync', '--hook'], { cwd: dataDir });
  fs.writeFileSync(path.join(dataDir, 'characters', `${SLUG}.live.json`), '{ broken');
  const r = run(['sync', '--hook'], { cwd: dataDir });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('quests available excludes a quest that left the log and one picked up since the snapshot', async () => {
  init();
  ageSv();
  run(['sync']);
  // Live log: 791 is gone (left the log), 100 was picked up after the snapshot.
  await writeLive({ level: 3, quests: [{ id: 100, complete: false, failed: false, objectives: [] }] });
  const r = run(['quests', 'available', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).map((q) => q.id), []);
});

test('init and sync keep live files out of the data folder history', () => {
  init();
  assert.ok(fs.readFileSync(path.join(dataDir, '.gitignore'), 'utf8').split('\n').includes('characters/*.live.json'));
  fs.writeFileSync(path.join(dataDir, '.gitignore'), '.wowf/\n');
  run(['sync']);
  assert.ok(fs.readFileSync(path.join(dataDir, '.gitignore'), 'utf8').split('\n').includes('characters/*.live.json'));
});

test('init and sync keep overlay chat transcripts out of the data folder history', () => {
  init();
  assert.ok(fs.readFileSync(path.join(dataDir, '.gitignore'), 'utf8').split('\n').includes('chats/'));
  fs.writeFileSync(path.join(dataDir, '.gitignore'), '.wowf/\n');
  run(['sync']);
  assert.ok(fs.readFileSync(path.join(dataDir, '.gitignore'), 'utf8').split('\n').includes('chats/'));
});

test('sync --hook never looks up quest titles (the baked QuestieDB is slow to read and the line prints none)', { skip: process.getuid?.() === 0 && 'root reads unreadable files' }, async () => {
  init();
  ageSv();
  run(['sync', '--hook'], { cwd: dataDir });
  // 100 was picked up since the snapshot: a live-only quest, whose title would come from Questie.
  await writeLive({ quests: [{ id: 791, complete: true, failed: false, objectives: [8] }, { id: 100, complete: false, failed: false, objectives: [] }] });
  // Any quest row lookup reads the .toc; make that fail so a lookup would silence the hook.
  fs.chmodSync(path.join(game, 'Interface', 'AddOns', 'QuestieDB', 'QuestieDB_Forever.toc'), 0o000);
  const r = run(['sync', '--hook'], { cwd: dataDir });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^Forever Companion: Live: L4 45% XP · Durotar 44\.9\/13\.2 · 1 quest ready to turn in/);
});

test('plain sync prints the live line after the summary and in place of the no-changes hint', async () => {
  init();
  ageSv();
  const first = run(['sync']);
  assert.doesNotMatch(first.stdout, /Live:/); // no live file yet
  await writeLive();
  const again = run(['sync']);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /^Live: L4 45% XP · Durotar 44\.9\/13\.2 · 1 quest ready to turn in/m);
  assert.doesNotMatch(again.stdout, /No changes since the last sync/);
  // With real changes the live line follows the summary.
  const sv = fs.readFileSync(svFile(), 'utf8');
  fs.writeFileSync(svFile(), sv + '\n');
  ageSv();
  fs.utimesSync(svFile(), Date.now() / 1000 - 590, Date.now() / 1000 - 590);
  await writeLive();
  const third = run(['sync']);
  assert.match(third.stdout, /Live: L4/);
});

test('plain sync keeps the no-changes hint when live data is stale or broken', async () => {
  init();
  ageSv();
  run(['sync']);
  await writeLive({ seenAt: Math.floor(Date.now() / 1000) - 200 });
  let r = run(['sync']);
  assert.match(r.stdout, /No changes since the last sync/);
  assert.doesNotMatch(r.stdout, /Live:/);
  fs.writeFileSync(path.join(dataDir, 'characters', `${SLUG}.live.json`), '{not json');
  r = run(['sync']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /No changes since the last sync/);
});

// --- Game plan ---

const gamePlan = {
  summary: 'Fury warrior, solo questing, Mining and Engineering',
  goal: 'Reach 60 with steady questing',
  milestones: [{ level: 10, text: 'Learn Defensive Stance' }, { text: 'Save gold for the mount' }],
};
const gamePlanPath = () => path.join(dataDir, 'gameplans', `${SLUG}.json`);

test('gameplan write stores the plan for the main character and gameplan show prints it', () => {
  init();
  run(['sync']);
  const file = path.join(root, 'gameplan.json');
  fs.writeFileSync(file, JSON.stringify(gamePlan));
  const w = run(['gameplan', 'write', file]);
  assert.equal(w.status, 0, w.stderr);
  assert.match(w.stdout, /Fury warrior, solo questing/);
  const saved = JSON.parse(fs.readFileSync(gamePlanPath(), 'utf8'));
  assert.equal(saved.version, 1);
  assert.equal(typeof saved.updatedAt, 'number');
  const s = run(['gameplan', 'show']);
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /Goal: Reach 60 with steady questing/);
  assert.match(s.stdout, /L10: Learn Defensive Stance/);
  const j = run(['gameplan', 'show', '--json']);
  assert.equal(JSON.parse(j.stdout).summary, gamePlan.summary);
});

test('gameplan write takes --json inline and - from stdin', () => {
  init();
  run(['sync']);
  assert.equal(run(['gameplan', 'write', '--json', JSON.stringify(gamePlan)]).status, 0);
  const r = spawnSync(process.execPath, [BIN, 'gameplan', 'write', '-'], { cwd: root, encoding: 'utf8', input: JSON.stringify({ ...gamePlan, summary: 'From stdin' }), env: { ...process.env, WOWF_CONFIG: cfgFile } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(gamePlanPath(), 'utf8')).summary, 'From stdin');
});

test('gameplan write with an invalid plan exits 1 with every reason and leaves the old plan byte-identical', () => {
  init();
  run(['sync']);
  run(['gameplan', 'write', '--json', JSON.stringify(gamePlan)]);
  const before = fs.readFileSync(gamePlanPath());
  const r = run(['gameplan', 'write', '--json', JSON.stringify({ summary: 'x'.repeat(121), playstyle: Array(9).fill('solo') })]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /summary: 121 characters, at most 120/);
  assert.match(r.stderr, /goal: required/);
  assert.match(r.stderr, /playstyle: 9 items, at most 8/);
  assert.deepEqual(fs.readFileSync(gamePlanPath()), before);
  assert.equal(run(['gameplan', 'write', '--json', 'not json']).status, 1);
  assert.deepEqual(fs.readFileSync(gamePlanPath()), before);
});

test('gameplan write refuses paths that climb out', () => {
  init();
  run(['sync']);
  const r = run(['gameplan', 'write', 'drafts/../../secret.json']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /paths with \.\. are not allowed/);
});

test('gameplan show without a plan says so', () => {
  init();
  run(['sync']);
  const r = run(['gameplan', 'show']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^No game plan yet/);
  assert.equal(run(['gameplan', 'show', '--json']).stdout.trim(), 'null');
});

test('plan show ignores game plans (separate folders)', () => {
  init();
  run(['sync']);
  run(['gameplan', 'write', '--json', JSON.stringify(gamePlan)]);
  const r = run(['plan', 'show']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^No plan yet/);
});

test('sync --hook prints the game plan line on every prompt when a plan exists, and nothing without one', () => {
  init();
  run(['sync', '--hook'], { cwd: dataDir });
  assert.equal(run(['sync', '--hook'], { cwd: dataDir }).stdout, '');
  run(['gameplan', 'write', '--json', JSON.stringify(gamePlan)]);
  for (let i = 0; i < 2; i++) {
    const r = run(['sync', '--hook'], { cwd: dataDir });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `Forever Companion: Game plan: ${gamePlan.summary} · next: Learn Defensive Stance\n`);
  }
});

test('sync --hook puts the game plan line after the live line, next milestone above the live level', async () => {
  init();
  ageSv();
  run(['sync', '--hook'], { cwd: dataDir });
  run(['gameplan', 'write', '--json', JSON.stringify(gamePlan)]);
  await writeLive({ level: 12 });
  const lines = run(['sync', '--hook'], { cwd: dataDir }).stdout.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Forever Companion: Live: L12/);
  assert.equal(lines[1], `Forever Companion: Game plan: ${gamePlan.summary} · next: Save gold for the mount`);
});

test('plain sync and state show the game plan', () => {
  init();
  run(['sync']);
  run(['gameplan', 'write', '--json', JSON.stringify(gamePlan)]);
  assert.match(run(['sync']).stdout, /^Game plan: Fury warrior/m);
  const s = run(['state']);
  assert.match(s.stdout, /Game plan: Fury warrior/);
  assert.match(s.stdout, /Goal: Reach 60 with steady questing/);
  assert.equal(JSON.parse(run(['state', '--json']).stdout).gamePlan.summary, gamePlan.summary);
});

test('state --json has gamePlan null without a plan', () => {
  init();
  assert.equal(JSON.parse(run(['state', '--json']).stdout).gamePlan, null);
});
