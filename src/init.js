// The data folder and the config that points at it, shared by `wowf init` and `wowf setup`.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig } from './config.js';

const TEMPLATE_DIR = fileURLToPath(new URL('../templates/data-folder/', import.meta.url));

// Creates the data folder layout; existing files are never overwritten, so running it again
// only adds what is missing. Returns whether it created anything, and whether git history was
// asked for but `git init` failed.
// On a Mac without Apple's command line tools, /usr/bin/git is a stub that opens an install
// dialog, which can land over the game. Git is run only when the tools are installed or
// another git (Homebrew, for example) comes first on PATH.
export function gitSafeToRun({
  platform = process.platform,
  pathEnv = process.env.PATH ?? '',
  toolsInstalled = () => spawnSync('xcode-select', ['-p'], { stdio: 'ignore' }).status === 0,
  exists = fs.existsSync,
} = {}) {
  if (platform !== 'darwin') return true;
  if (toolsInstalled()) return true;
  const first = pathEnv.split(':').filter(Boolean).find((dir) => exists(path.join(dir, 'git')));
  return Boolean(first) && first !== '/usr/bin';
}

function scaffoldDataFolder(dir, { git, gitSafe = gitSafeToRun }) {
  let created = false;
  for (const sub of ['characters', 'plans', 'knowledge', 'drafts']) {
    if (fs.mkdirSync(path.join(dir, sub), { recursive: true }) !== undefined) created = true;
  }
  // AGENTS.md holds the player's notes (Pi reads it first); CLAUDE.md imports it. If the
  // folder already has its own CLAUDE.md, leave it alone and add no AGENTS.md (Pi falls back
  // to CLAUDE.md), so both harnesses keep reading the real notes.
  const hadClaude = fs.existsSync(path.join(dir, 'CLAUDE.md'));
  for (const f of fs.readdirSync(TEMPLATE_DIR)) {
    const dest = path.join(dir, f);
    if (f === 'AGENTS.md' && hadClaude) continue;
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(TEMPLATE_DIR, f), dest);
      created = true;
    }
  }
  if (git && !fs.existsSync(path.join(dir, '.git'))) {
    if (!gitSafe()) return { created, gitFailed: true };
    const r = spawnSync('git', ['init', '-q', dir], { stdio: 'ignore' });
    if (r.status !== 0) return { created, gitFailed: true };
    created = true;
  }
  return { created, gitFailed: false };
}

/**
 * Saves the config (keeping every other setting of an earlier one, such as the overlay
 * settings and `updateCheck`) and creates or completes the data folder.
 * @returns {{ cfg: {gameDir: string, dataDir: string, main: string|null}, gitFailed: boolean, created: boolean }}
 */
export function initData({ gameDir, dataDir, main = null, git = false }) {
  let previous = null;
  try { previous = loadConfig(); } catch { /* unreadable: start fresh */ }
  const cfg = { ...(previous ?? {}), gameDir: path.resolve(gameDir), dataDir: path.resolve(dataDir), main };
  saveConfig(cfg);
  const { created, gitFailed } = scaffoldDataFolder(cfg.dataDir, { git });
  return { cfg, gitFailed, created };
}
