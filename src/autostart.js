// Start the overlay at login (macOS): a per-user LaunchAgent that runs the overlay's own
// Electron on the overlay folder. The overlay hides itself until WoW is running.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const AGENT_LABEL = 'com.forever-companion.overlay';

export const agentPath = (home = os.homedir()) => path.join(home, 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`);

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// launchd starts agents with a bare PATH, so the caller's PATH is written in: the overlay
// needs it to find node, pi and claude.
export function buildPlist({ overlayDir, envPath }) {
  const electron = path.join(overlayDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(electron)}</string>
    <string>${xml(overlayDir)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(envPath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`;
}

export function enableAutostart({ home = os.homedir(), overlayDir, envPath = process.env.PATH ?? '' }) {
  const file = agentPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buildPlist({ overlayDir, envPath }));
  return file;
}

export function disableAutostart({ home = os.homedir() } = {}) {
  const file = agentPath(home);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

export const autostartStatus = ({ home = os.homedir() } = {}) => fs.existsSync(agentPath(home));
