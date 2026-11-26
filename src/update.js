// wowf update: gets the newest version (with git in a clone, as a download otherwise), then
// refreshes what depends on it (the overlay's packages when their lockfile changed, the addon
// in the game folder).
// Commands get argument arrays and the clone as `cwd`; no path is ever put into a command.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { installOverlayPackages, electronMissingText, installRetryHint } from './setup.js';
import { fetchNewest, replaceTree } from './update-archive.js';

const REPO_PAGE = 'https://github.com/biokraft/wow-forever-companion';
const SETUP = 'node bin/wowf setup';
const LOCKFILE = 'overlay/package-lock.json';

const lines = (s) => String(s ?? '').split('\n').map((l) => l.trimEnd()).filter(Boolean);
const tail = (s, n = 8) => lines(s).slice(-n).join('\n');
// runCommand mixes git's stderr into its output, so only lines of the expected shape count:
// a porcelain status line ("XY path") and a commit id.
const PORCELAIN = /^[ MADRCUT?!]{2} /;
const COMMIT = /^[0-9a-f]{40,64}$/;
const commitOf = (r) => (r.code === 0 ? lines(r.stdout).find((l) => COMMIT.test(l)) ?? null : null);

// A release bump rewrites the lockfile's own two version fields; that alone needs no reinstall.
function withoutOwnVersion(text) {
  const lock = JSON.parse(text);
  delete lock.version;
  if (lock.packages?.['']) delete lock.packages[''].version;
  return lock;
}

// Whether the overlay's dependencies changed between `before` and the pulled lockfile. Anything
// that cannot be read or compared counts as changed, so a real change is never skipped.
async function overlayDepsChanged({ git, before, readFile, repoDir }) {
  try {
    const old = await git('show', `${before}:${LOCKFILE}`);
    if (old.code !== 0) return true;
    const now = readFile(path.join(repoDir, ...LOCKFILE.split('/')));
    return !isDeepStrictEqual(withoutOwnVersion(old.stdout), withoutOwnVersion(now));
  } catch {
    return true;
  }
}

function readVersion(readFile, repoDir) {
  try { return JSON.parse(readFile(path.join(repoDir, 'package.json'))).version ?? null; } catch { return null; }
}

// The `## <version>` section of CHANGELOG.md without its heading, or null.
function changelogSection(readFile, repoDir, version) {
  let text;
  try { text = String(readFile(path.join(repoDir, 'CHANGELOG.md'))); } catch { return null; }
  const out = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (/^## /.test(line)) {
      if (inside) break;
      inside = line.slice(3).trim().split(/\s/)[0].replace(/^v/, '') === version;
      continue;
    }
    if (inside) out.push(line);
  }
  const body = out.join('\n').trim();
  return body || null;
}

/**
 * @param {{ repoDir: string,
 *   run(cmd: string, args: string[], o: { cwd: string }): Promise<{ code: number, stdout?: string }>,
 *   exists(p: string): boolean, cfg: { gameDir?: string } | null,
 *   installAddon(gameDir: string): string, say(text: string): void,
 *   readFile?(p: string): string, nodeVersion?: string, platform?: string,
 *   archive?: { fetchNewest(o: { run: Function }): Promise<{ tree: string, cleanup(): void }>, replaceTree(tree: string, repoDir: string): void } }} deps
 * @returns {Promise<{ ok: boolean, code: 'download-failed' | 'copy-failed' | 'dirty' | 'detached' | 'pull-failed' | 'current' | 'updated' }>}
 */
export async function runUpdate({ repoDir, run, exists, cfg, installAddon, say, readFile = (p) => fs.readFileSync(p, 'utf8'), nodeVersion = process.version, platform = process.platform, archive = { fetchNewest, replaceTree } }) {
  const git = async (...args) => {
    try { return await run('git', args, { cwd: repoDir }); } catch (e) { return { code: 1, stdout: String(e?.message ?? '') }; }
  };
  const overlayDir = path.join(repoDir, 'overlay');
  const lockPath = path.join(repoDir, ...LOCKFILE.split('/'));

  // What follows the new files, however they arrived. `depsChanged` is asked only when the
  // overlay is installed.
  const finish = async ({ updated, fromVersion, depsChanged }) => {
    const toVersion = readVersion(readFile, repoDir);
    let ok = true;
    if (updated) {
      say(fromVersion && toVersion && fromVersion !== toVersion
        ? `Updated Forever Companion from ${fromVersion} to ${toVersion}.`
        : `Updated Forever Companion${toVersion ? ` (${toVersion})` : ''}.`);
      // The overlay's packages, when their lockfile changed (more than the release version
      // fields) and the overlay is installed.
      if (exists(path.join(overlayDir, 'node_modules')) && await depsChanged()) {
        say("Updating the overlay's packages (npm ci)...");
        const r = await installOverlayPackages({ run, exists, overlayDir, readFile });
        if (!r.ok) {
          ok = false;
          if (r.output) say(r.output);
          say(r.failed === 'electron'
            ? electronMissingText(nodeVersion, platform)
            : `Updating the overlay's packages failed, so the overlay may not start. ${installRetryHint(platform)} Then run: ${SETUP}`);
        }
      }
    } else {
      say(`Already up to date${toVersion ? ` (${toVersion})` : ''}.`);
    }

    // The addon in the game folder (also when already up to date, so an old copy is replaced).
    if (cfg?.gameDir) {
      try {
        installAddon(cfg.gameDir);
        say('Refreshed the ForeverLog addon in the game folder.');
      } catch (e) {
        ok = false;
        say(`Could not refresh the addon (${e?.message ?? e}). Close WoW, then run: ${SETUP}`);
      }
    } else {
      say(`No game folder is set up, so the addon was not refreshed. Run: ${SETUP}`);
    }

    // What the player does next, and what is new.
    if (updated) say('If the overlay is running, run node bin/wowf overlay again to restart it with the new version.');
    say('If WoW is running, type /reload in game to load the addon.');
    const notes = updated && toVersion && toVersion !== fromVersion ? changelogSection(readFile, repoDir, toVersion) : null;
    if (notes) say(`\nWhat's new in ${toVersion}:\n${notes}`);
    return { ok, code: updated ? 'updated' : 'current' };
  };

  // 1. Not a git clone (the installer downloaded it, or a ZIP was unpacked): there is no
  // history to pull, so the newest code is downloaded and copied over this folder.
  if (!exists(path.join(repoDir, '.git'))) {
    const fromVersion = readVersion(readFile, repoDir);
    let lockBefore = null;
    try { lockBefore = withoutOwnVersion(readFile(lockPath)); } catch { /* compared as changed */ }
    say('Downloading the newest version from GitHub...');
    let newest;
    try {
      newest = await archive.fetchNewest({ run });
    } catch (e) {
      say(`The download failed, so nothing was changed (${e?.message ?? e}). Try again later.`);
      return { ok: false, code: 'download-failed' };
    }
    try {
      archive.replaceTree(newest.tree, repoDir);
    } catch (e) {
      say(`Copying the new files stopped part-way (${e?.message ?? e}). Close the chat overlay, then run: node bin/wowf update again.
If that keeps failing, install again with the line from ${REPO_PAGE}; your settings and progress data live elsewhere and are kept.`);
      return { ok: false, code: 'copy-failed' };
    } finally {
      newest.cleanup();
    }
    return finish({
      updated: true,
      fromVersion,
      depsChanged: () => {
        try { return lockBefore === null || !isDeepStrictEqual(lockBefore, withoutOwnVersion(readFile(lockPath))); } catch { return true; }
      },
    });
  }

  // 2. Local changes to tracked files: stop, so nothing of the player's is overwritten.
  const status = await git('status', '--porcelain');
  if (status.code !== 0) {
    say(`git could not read this folder (is git installed?):\n${tail(status.stdout)}`);
    return { ok: false, code: 'pull-failed' };
  }
  const changed = lines(status.stdout)
    .filter((l) => PORCELAIN.test(l) && !l.startsWith('??') && !l.startsWith('!!'))
    .map((l) => l.slice(3));
  if (changed.length) {
    say(`These files in the wow-forever-companion folder have local changes, so nothing was updated:
${changed.map((f) => `  ${f}`).join('\n')}
Undo or save them (for example: git stash), then run: node bin/wowf update`);
    return { ok: false, code: 'dirty' };
  }

  // A checkout of a tag or commit has no branch to pull into.
  const branch = await git('symbolic-ref', '--quiet', '--short', 'HEAD');
  if (branch.code !== 0) {
    say('This clone is not on a branch (detached HEAD), so there is nothing to pull into.\nRun: git switch main, then: node bin/wowf update');
    return { ok: false, code: 'detached' };
  }

  // 3. Pull.
  const fromVersion = readVersion(readFile, repoDir);
  const before = commitOf(await git('rev-parse', 'HEAD'));
  if (!before) {
    say('git could not read the current version of this folder, so nothing was updated.');
    return { ok: false, code: 'pull-failed' };
  }
  say('Getting the newest version with git...');
  const pull = await git('pull', '--ff-only');
  if (pull.code !== 0) {
    say(`git pull failed, nothing was changed:\n${tail(pull.stdout)}`);
    return { ok: false, code: 'pull-failed' };
  }
  const after = commitOf(await git('rev-parse', 'HEAD'));
  if (!after) {
    say(`git pulled, but could not read the new version. Run: node bin/wowf update again, or: ${SETUP}`);
    return { ok: false, code: 'pull-failed' };
  }
  const updated = before !== after;
  return finish({
    updated,
    fromVersion,
    depsChanged: async () => {
      const diff = await git('diff', '--name-only', before, after);
      return lines(diff.stdout).includes(LOCKFILE) && overlayDepsChanged({ git, before, readFile, repoDir });
    },
  });
}
