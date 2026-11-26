// Updating a folder that is not a git clone (the installer made it from a download, or the
// player unpacked a ZIP): fetch the newest code as an archive and copy it over the old files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ARCHIVE_URL = 'https://github.com/biokraft/wow-forever-companion/archive/refs/heads/main.tar.gz';
const ARCHIVE = 'newest.tar.gz';
const PACKAGE_NAME = 'forever-companion';
// Installed packages are not part of the archive; `wowf update` refreshes them separately.
const KEPT = 'node_modules';

async function download(url, file, { fetchImpl = globalThis.fetch, timeoutMs = 120000 } = {}) {
  const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/**
 * Downloads and unpacks the newest code into a temporary folder and checks that it is this
 * project. Nothing of the installed folder is touched.
 * @returns {Promise<{ tree: string, cleanup(): void }>}
 */
export async function fetchNewest({ run, tmpDir = os.tmpdir(), downloadImpl = download }) {
  const work = fs.mkdtempSync(path.join(tmpDir, 'forever-companion-update-'));
  const cleanup = () => fs.rmSync(work, { recursive: true, force: true });
  try {
    await downloadImpl(ARCHIVE_URL, path.join(work, ARCHIVE));
    // A relative archive name with the folder as cwd: GNU tar reads "C:\..." as a remote host.
    const r = await run('tar', ['-xzf', ARCHIVE], { cwd: work });
    if (r.code !== 0) throw new Error(`the download could not be unpacked (tar exit ${r.code})`);
    const dirs = fs.readdirSync(work, { withFileTypes: true }).filter((d) => d.isDirectory());
    if (dirs.length !== 1) throw new Error('the download does not look like Forever Companion');
    const tree = path.join(work, dirs[0].name);
    let name = null;
    try { name = JSON.parse(fs.readFileSync(path.join(tree, 'package.json'), 'utf8')).name; } catch { /* checked below */ }
    if (name !== PACKAGE_NAME || !fs.existsSync(path.join(tree, 'bin', 'wowf'))) {
      throw new Error('the download does not look like Forever Companion');
    }
    return { tree, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

function replaceDir(src, dest, keepPackages) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(dest)) {
    if (keepPackages && name === KEPT) continue;
    fs.rmSync(path.join(dest, name), { recursive: true, force: true });
  }
  for (const name of fs.readdirSync(src)) {
    fs.cpSync(path.join(src, name), path.join(dest, name), { recursive: true });
  }
}

/**
 * Replaces every top-level file and folder of `repoDir` that the new tree has. Files the
 * new version no longer has inside those folders go away with them; `overlay/node_modules`
 * stays. Anything else the player keeps in the folder is left alone.
 */
export function replaceTree(tree, repoDir) {
  for (const d of fs.readdirSync(tree, { withFileTypes: true })) {
    const src = path.join(tree, d.name);
    const dest = path.join(repoDir, d.name);
    if (d.isDirectory()) replaceDir(src, dest, d.name === 'overlay');
    else fs.copyFileSync(src, dest);
  }
}
