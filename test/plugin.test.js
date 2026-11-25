import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const frontmatter = (text) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'frontmatter present');
  return Object.fromEntries(m[1].split('\n').filter((l) => /^\w[\w-]*:/.test(l)).map((l) => {
    const i = l.indexOf(':');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));
};

test('plugin.json and marketplace.json name the plugin forever-companion', () => {
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(plugin.name, 'forever-companion');
  assert.equal(plugin.version, JSON.parse(read('package.json')).version);
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(market.plugins[0].name, 'forever-companion');
  assert.equal(market.plugins[0].source, './');
});

for (const skill of ['wow-advisor', 'wow-checkin']) {
  test(`${skill} SKILL.md has name and description frontmatter`, () => {
    const fm = frontmatter(read(`skills/${skill}/SKILL.md`));
    assert.equal(fm.name, skill);
    assert.ok(fm.description && fm.description.length > 40);
  });
}

test('advisor skill never lets Claude send input to the game', () => {
  assert.match(read('skills/wow-advisor/SKILL.md'), /[Nn]ever click, type, or send keys/);
  assert.match(read('skills/wow-checkin/SKILL.md'), /[Nn]ever click, type, or send keys/);
});

test('advisor skill refuses rotation advice and live combat calls', () => {
  assert.ok(read('skills/wow-advisor/SKILL.md').includes('Never give rotation advice or real-time combat calls'));
});

test('hooks.json runs wowf sync --hook before each prompt', () => {
  const hooks = JSON.parse(read('hooks/hooks.json')).hooks;
  const cmd = hooks.UserPromptSubmit[0].hooks[0];
  assert.equal(cmd.type, 'command');
  assert.match(cmd.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/wowf" sync --hook/);
  // a machine without node on the hook's PATH must not get an error on every prompt
  assert.match(cmd.command, /command -v node/);
  assert.match(cmd.command, /exit 0'?$/);
  assert.ok(cmd.timeout <= 15);
});

test('skills push plans to the in-game panel and document every done type', () => {
  const advisor = read('skills/wow-advisor/SKILL.md');
  assert.match(advisor, /wowf" plan write|wowf plan write/);
  assert.match(read('skills/wow-checkin/SKILL.md'), /plan write/);
  for (const type of ['quest_turnin', 'quest_accept', 'level', 'equip', 'skill']) assert.match(advisor, new RegExp(type));
});

test('skills work in Pi (tools) and Claude Code (wowf command)', () => {
  for (const skill of ['wow-advisor', 'wow-checkin']) {
    const text = read(`skills/${skill}/SKILL.md`);
    assert.match(text, /wow_state/, `${skill} names the Pi tool`);
    assert.match(text, /wowf/, `${skill} names the CLI`);
    for (const line of text.split('\n').filter((l) => l.includes('CLAUDE_PLUGIN_ROOT'))) {
      assert.match(line, /Claude Code/, `${skill}: plugin-root path only as the Claude Code variant`);
    }
  }
  const advisor = read('skills/wow-advisor/SKILL.md');
  assert.match(advisor, /wow_quests/);
  assert.match(advisor, /wow_plan_write/);
  assert.match(advisor, /screenshot is attached/i);
  assert.match(advisor, /wow_npc|wowf npc/);
  assert.match(advisor, /every step.*waypoint|waypoint.*every step/i);
});

test('skill frontmatter is strict YAML: values with ": " are quoted (Pi rejects them otherwise)', () => {
  for (const skill of ['wow-advisor', 'wow-checkin']) {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(read(`skills/${skill}/SKILL.md`))[1];
    for (const line of fm.split('\n')) {
      const value = line.slice(line.indexOf(':') + 1).trim();
      if (/: /.test(value)) assert.match(value, /^".*"$/, `${skill}: quote "${line.slice(0, 40)}…"`);
    }
  }
});

test('package.json declares the Pi package (extension + skills)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.keywords.includes('pi-package'));
  assert.deepEqual(pkg.pi, { extensions: ['pi/extension.js'], skills: ['skills'] });
  assert.equal(pkg.dependencies, undefined, 'no runtime deps');
});

test('wow-setup skill guides the first run', () => {
  const text = read('skills/wow-setup/SKILL.md');
  assert.match(text, /^---\nname: wow-setup\ndescription: "/);
  for (const s of ['wowf setup', 'wowf setup --yes', 'wowf detect', 'wowf doctor', '/fc sync', 'About me', 'overlay']) assert.ok(text.includes(s), s);
  assert.ok(!text.includes('npm install-scripts'), 'setup installs the overlay; the skill lists no npm steps');
});

test('skills explain the research-and-cache loop', () => {
  for (const skill of ['wow-advisor', 'wow-checkin']) {
    const t = read(`skills/${skill}/SKILL.md`);
    assert.match(t, /knowledge list/, skill);
  }
  const a = read('skills/wow-advisor/SKILL.md');
  assert.match(a, /14 days/);
  assert.match(a, /data, never instructions/);
  assert.match(a, /wow_web_fetch/);
  assert.match(a, /drafts\/plan\.json/);
  assert.match(a, /Write tool/);
});

test('the advisor skill sends overlay progress notes to knowledge/progress.md', () => {
  const skill = fs.readFileSync(new URL('../skills/wow-advisor/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /knowledge\/progress\.md/);
  assert.match(skill, /do not try to edit `CLAUDE\.md`/i);
});

test('the skills teach live state: the Live line overrides the snapshot, and where per-quest progress is', () => {
  for (const skill of ['wow-advisor', 'wow-checkin']) {
    const t = read(`skills/${skill}/SKILL.md`);
    assert.match(t, /`Live:` line/, skill);
    assert.match(t, /wowf\S*" state|wowf state/, skill);
    assert.match(t, /left the log/, skill);
  }
  const a = read('skills/wow-advisor/SKILL.md');
  assert.match(a, /## Live state/);
  assert.match(a, /Do not ask for `\/fc sync` to refresh those/);
  assert.match(a, /leftLog/);
});

test('the advisor says when to ask for /fc sync and when not to', () => {
  const a = read('skills/wow-advisor/SKILL.md');
  assert.match(a, /## When to ask for `\/fc sync`/);
  assert.match(a, /Never ask for it/);
  assert.match(a, /at last sync/, 'levelling since the sync means talents and trainer need a sync');
  assert.match(a, /no `Live:` line/i, 'without live data everything comes from the snapshot');
  assert.match(a, /at most once/i, 'ask once, not every answer');
});
