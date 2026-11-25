import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NAME = 'forever-companion';
const LEGACY_NAME = 'claude-forever'; // legacy name before the 2026-11-25 rename

function configDir(name) {
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, name);
  return path.join(process.env.HOME || os.homedir(), '.config', name);
}

export function configPath() {
  if (process.env.WOWF_CONFIG) return process.env.WOWF_CONFIG;
  return path.join(configDir(NAME), 'config.json');
}

/** @returns {{gameDir: string, dataDir: string, main: string|null} | null} */
export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (process.env.WOWF_CONFIG) return null;
  // Migrate the config written under the legacy name once.
  const legacy = path.join(configDir(LEGACY_NAME), 'config.json');
  if (!fs.existsSync(legacy)) return null;
  const cfg = JSON.parse(fs.readFileSync(legacy, 'utf8'));
  saveConfig(cfg);
  return cfg;
}

export function saveConfig(cfg) {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
  fs.renameSync(tmp, file); // atomic: a crash never leaves a half-written config
}
