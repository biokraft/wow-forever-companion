// How to start a command-line tool (pi, claude) without a shell, on every system.
//
// On Windows, npm installs a global CLI as a `.cmd` shim, and Node refuses to start a `.cmd`
// without a shell. A shell would read the tools' free-text arguments (the overlay's system
// prompt) as syntax, so instead the shim is read and the Node script it runs is started
// with node directly: every argument stays an element of an array.
import fs from 'node:fs';
import path from 'node:path';

const SCRIPT = /\.(?:c|m)?js$/i;

/**
 * The Node script an npm `.cmd` shim runs, relative to the shim's folder, or null when the
 * text is not such a shim. Matches the way npm's own read-cmd-shim reads it: the quoted
 * path after %dp0% (current npm) or %~dp0 (npm 6), followed by %*.
 */
export function shimTarget(text) {
  const m = /"%(?:~dp0|dp0%)\\([^"]+?)"\s+%\*/.exec(String(text ?? ''));
  return m && SCRIPT.test(m[1]) ? m[1] : null;
}

function envValue(env, name) {
  const key = Object.keys(env ?? {}).find((k) => k.toUpperCase() === name);
  return key ? env[key] : undefined;
}

// A shim found at `file`: node (the one next to the shim if there is one, as the shim itself
// prefers) and the script. null when it cannot be read or is not a Node shim.
function fromShim(file, { exists, readFile }) {
  let text;
  try { text = readFile(file); } catch { return null; }
  const target = shimTarget(text);
  if (!target) return null;
  const dir = path.win32.dirname(file);
  const localNode = path.win32.join(dir, 'node.exe');
  return { command: exists(localNode) ? localNode : 'node', args: [path.win32.join(dir, target)] };
}

/**
 * The command and leading arguments that start `name`: `spawn(command, [...args, ...yours])`.
 * Off Windows, and whenever nothing usable is found, it is `{ command: name, args: [] }`, so
 * the caller's own "not installed" message still appears when the start fails.
 * On Windows, PATH is searched in order, and in each folder the PATHEXT extensions in order;
 * an `.exe` is started directly, an npm `.cmd` shim through node and its script.
 * @param {string} name a program name (searched on PATH) or a path to one
 * @param {{ platform?: string, env?: object, exists?(p: string): boolean, readFile?(p: string): string }} [o]
 * @returns {{ command: string, args: string[] }}
 */
export function resolveTool(name, {
  platform = process.platform,
  env = process.env,
  exists = (p) => fs.existsSync(p),
  readFile = (p) => fs.readFileSync(p, 'utf8'),
} = {}) {
  const plain = { command: name, args: [] };
  if (platform !== 'win32') return plain;
  const io = { exists, readFile };
  if (/[\\/]/.test(name)) {
    return /\.cmd$/i.test(name) && exists(name) ? fromShim(name, io) ?? plain : plain;
  }
  const dirs = String(envValue(env, 'PATH') ?? '').split(';')
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
  const exts = String(envValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e === '.exe' || e === '.cmd');
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.win32.join(dir, name + ext);
      if (!exists(file)) continue;
      if (ext === '.exe') return { command: file, args: [] };
      const shim = fromShim(file, io);
      if (shim) return shim;
    }
  }
  return plain;
}
