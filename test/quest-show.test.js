import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFakeQuestie } from './helpers/questie-fixture.js';
import { questShow } from '../src/core.js';

function withGame(fn) {
  const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-show-'));
  try {
    writeFakeQuestie(path.join(gameDir, 'Interface', 'AddOns'));
    return fn({ gameDir });
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
  }
}

test('quest show names the profession a quest requires', () => {
  const { lines } = withGame((cfg) => questShow(cfg, 102));
  assert.ok(lines.includes('  needs profession: Blacksmithing 1'), lines.join('\n'));
});

test('quest show names the parent quest that must be in the log', () => {
  const { lines } = withGame((cfg) => questShow(cfg, 102));
  assert.ok(lines.includes('  only while in your log: Follow Up #101'), lines.join('\n'));
});
