import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// The in-game command shown to players is /fc. The old /cf stays registered as a silent
// alias in Core.lua and is kept in the historical changelog and design docs only.
const OLD = '/' + 'cf';
const shown = new RegExp(`(?<![\\w/.-])${OLD}(?=[ \`'"\\r\\n]|$)`, 'm');
const exempt = (f) => f === 'addon/ForeverLog/Core.lua' || f === 'CHANGELOG.md' || f === 'addon/test/core_test.lua' || f === 'addon/test/core_test.lua'
  || f === 'test/slash.test.js' || f.startsWith('docs/superpowers/') || f.startsWith('.superpowers/');

test('no tracked file shows the old /cf command', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  const hits = [];
  for (const f of files) {
    if (exempt(f) || !fs.existsSync(path.join(root, f))) continue;
    const buf = fs.readFileSync(path.join(root, f));
    if (buf.includes(0)) continue;
    if (shown.test(buf.toString('utf8'))) hits.push(f);
  }
  assert.deepEqual(hits, []);
});
