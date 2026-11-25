import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Battle.net records the WoW install folder in the registry; Forever sits next to the
// flavour folder it names (e.g. D:\\Games\\World of Warcraft\\_retail_ -> ..\\_forever_).
export function windowsRegistryGameDir(query = () => execFileSync('reg', ['query',
  'HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft', '/v', 'InstallPath'],
{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })) {
  try {
    const m = /InstallPath\s+REG_\w+\s+(.+?)\s*$/m.exec(String(query()));
    if (!m) return null;
    let dir = m[1].replace(/[\\/]+$/, '');
    if (/[\\/]_[a-z_]+_$/i.test(dir)) dir = dir.replace(/[\\/]_[a-z_]+_$/i, '');
    return `${dir}\\_forever_`;
  } catch {
    return null;
  }
}

export function defaultGameDirs(platform = process.platform, { registryDir } = {}) {
  if (platform === 'darwin') return ['/Applications/World of Warcraft/_forever_'];
  if (platform === 'win32') {
    const reg = registryDir === undefined ? windowsRegistryGameDir() : registryDir;
    return [
      ...(reg ? [reg] : []),
      'C:\\Program Files (x86)\\World of Warcraft\\_forever_',
      'C:\\Program Files\\World of Warcraft\\_forever_',
    ];
  }
  return [];
}

// A _forever_ folder: has WTF (after the first login), Interface, or the game itself.
const GAME_MARKERS = ['WTF', 'Interface', 'World of Warcraft.app', 'Wow.exe', 'WowClassic.exe'];

export function isGameDir(dir) {
  return GAME_MARKERS.some((m) => fs.existsSync(path.join(dir, m)));
}

export function findGameDir(candidates = defaultGameDirs()) {
  return candidates.find(isGameDir) ?? null;
}

export function addonsDir(gameDir) {
  return path.join(gameDir, 'Interface', 'AddOns');
}

const subdirs = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
};

/**
 * Character folders live at WTF/Account/<account>/<realmDir>/<Character>/.
 * @returns {{account: string, realmDir: string, folder: string, svPath: string, hasData: boolean}[]}
 */
export function listCharacters(gameDir) {
  const accountsDir = path.join(gameDir, 'WTF', 'Account');
  const out = [];
  for (const account of subdirs(accountsDir)) {
    for (const realmDir of subdirs(path.join(accountsDir, account))) {
      if (realmDir === 'SavedVariables') continue;
      for (const folder of subdirs(path.join(accountsDir, account, realmDir))) {
        const svDir = path.join(accountsDir, account, realmDir, folder, 'SavedVariables');
        if (!fs.existsSync(svDir)) continue;
        const svPath = path.join(svDir, 'ForeverLog.lua');
        out.push({ account, realmDir, folder, svPath, hasData: fs.existsSync(svPath) });
      }
    }
  }
  return out;
}
