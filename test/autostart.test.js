import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentPath, buildPlist, enableAutostart, disableAutostart, autostartStatus } from '../src/autostart.js';

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-autostart-'));
const overlayDir = path.join('opt', 'fc', 'overlay');

test('the login item lives in the user LaunchAgents folder', () => {
  assert.equal(agentPath('/home/x'), path.join('/home/x', 'Library', 'LaunchAgents', 'com.forever-companion.overlay.plist'));
});

test('the plist starts Electron on the overlay folder at login, with the caller PATH', () => {
  const plist = buildPlist({ overlayDir, envPath: '/a/bin:/b/bin' });
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.ok(plist.includes(`<string>${path.join(overlayDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')}</string>`));
  assert.ok(plist.includes(`<string>${overlayDir}</string>`));
  assert.ok(plist.includes('<string>/a/bin:/b/bin</string>'));
  assert.doesNotMatch(plist, /KeepAlive/);
});

test('special characters in paths are escaped for XML', () => {
  assert.ok(buildPlist({ overlayDir: 'a&b<c', envPath: '' }).includes('<string>a&amp;b&lt;c</string>'));
});

test('on writes the plist, status sees it, off removes it', () => {
  const home = tmpHome();
  try {
    assert.equal(autostartStatus({ home }), false);
    const file = enableAutostart({ home, overlayDir, envPath: '/bin' });
    assert.equal(file, agentPath(home));
    assert.equal(autostartStatus({ home }), true);
    assert.equal(disableAutostart({ home }), true);
    assert.equal(autostartStatus({ home }), false);
    assert.equal(disableAutostart({ home }), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
