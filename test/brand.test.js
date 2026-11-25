import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SCAN = ['src', 'bin', 'addon/ForeverLog', 'skills', '.claude-plugin', 'hooks', 'package.json'];

function files(p) {
  const full = path.join(root, p);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full).flatMap((f) => files(path.join(p, f)));
}

test('no leftover ClaudeForever / claude-forever names outside docs', () => {
  // Lines that mention "legacy" may keep the old name on purpose (config migration).
  const hits = SCAN.flatMap(files).filter((f) => fs.readFileSync(f, 'utf8').split('\n')
    .some((line) => /ClaudeForever|claude-forever/.test(line) && !/legacy/i.test(line)));
  assert.deepEqual(hits.map((f) => path.relative(root, f)), []);
});
