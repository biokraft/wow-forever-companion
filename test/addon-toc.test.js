import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const toc = fs.readFileSync(new URL('../addon/ForeverLog/ForeverLog.toc', import.meta.url), 'utf8');
const files = toc.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

test('the addon .toc lists each file once, in load order', () => {
  assert.deepEqual(files, ['Core.lua', 'Snapshot.lua', 'Events.lua', 'ForeverLog_Plan.lua', 'Plan.lua', 'Panel.lua', 'Bridge.lua', 'Help.lua']);
});

test('every listed file except the generated plan exists in the repo', () => {
  for (const f of files.filter((x) => x !== 'ForeverLog_Plan.lua')) {
    assert.ok(fs.existsSync(new URL(`../addon/ForeverLog/${f}`, import.meta.url)), f);
  }
});

test('the AddOns list shows the Forever Companion brand, notes and an icon', () => {
  assert.match(toc, /^## Title: \|cffc8a24aForever Companion\|r/m);
  assert.match(toc, /^## Notes: .+/m);
  assert.match(toc, /^## IconTexture: Interface\\Icons\\.+/m);
  assert.match(toc, /^## SavedVariablesPerCharacter: ForeverLogDB$/m, 'saved data name unchanged');
  assert.match(toc, /^## SavedVariables: ForeverCompanionAccountDB$/m, 'account-wide flags (guide seen)');
});
