import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Plans, specs and other working notes of people and their AI agents stay on their machines.
const PRIVATE_DIRS = ['docs/superpowers/', 'docs/plans/', 'docs/specs/', '.superpowers/', 'scratch/'];

test('no plan, spec or working-note folder is tracked by git', () => {
  const tracked = execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const leaked = tracked.filter((f) => PRIVATE_DIRS.some((d) => f.startsWith(d)));
  assert.deepEqual(leaked, [], 'these belong in an ignored folder (see AGENTS.md), never in a commit');
});

test('.gitignore covers every working-note folder, and AGENTS.md tells agents not to commit them', () => {
  const ignore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8').split(/\r?\n/);
  for (const d of PRIVATE_DIRS) assert.ok(ignore.includes(`/${d}`), `.gitignore is missing /${d}`);
  const agents = fs.readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
  assert.match(agents, /never commit plans, specs or design notes/i);
  assert.match(agents, /docs\/superpowers\//);
  assert.match(agents, /git add -f/);
});
