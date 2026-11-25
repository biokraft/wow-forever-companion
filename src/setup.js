// wowf setup: one command from a fresh clone to a working install. Every step checks first,
// so running it again only does what is still missing. Prompts, files and commands are
// injected (io, deps), so the steps are tested without a terminal.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { agentPath } from './autostart.js';
import { resolveTool } from './tool-command.js';

// The only AI logins setup offers. `args` follow `pi`. The ChatGPT entry is the `openai`
// provider's own "Sign in with ChatGPT"; the API-key entries pass --api-key so Pi never
// starts a subscription login for those providers.
export const AI_LOGINS = [
  { id: 'openai-key', label: 'OpenAI API key', args: ['auth', 'login', 'openai', '--api-key'] },
  { id: 'anthropic-key', label: 'Anthropic API key', args: ['auth', 'login', 'anthropic', '--api-key'] },
  { id: 'google-key', label: 'Google Gemini API key (paid tier)', args: ['auth', 'login', 'google', '--api-key'] },
  { id: 'openrouter', label: 'OpenRouter', args: ['auth', 'login', 'openrouter'] },
  { id: 'chatgpt', label: 'Sign in with ChatGPT (official flow)', args: ['auth', 'login', 'openai'] },
  { id: 'skip', label: 'Skip (I will set up Pi myself)', args: [] },
];

const SETUP = 'node bin/wowf setup';
const PI_PACKAGE = '@earendil-works/pi-coding-agent';
const PI_INSTALL = ['install', '-g', PI_PACKAGE];
const ADULT = 'AI providers require their users to be 18 or older.';
const LABEL = { done: 'done     ', already: 'already  ', skipped: 'skipped  ', failed: 'FAILED   ' };

// Windows runs npm through a .cmd shim, which only starts through cmd.exe. The command line
// is built from constant arguments only, and anything a shell could read as syntax is
// refused. Pi is found the way doctor and the overlay find it (resolveTool), so a Pi
// installed as an .exe works as well as the npm shim.
const SHIMS = new Set(['npm']);
const RESOLVED = new Set(['pi']);
export function windowsCommandLine(cmd, args) {
  for (const a of args) {
    if (!/^[\w@./:=-]+$/.test(a)) throw new Error(`refusing to pass "${a}" through the Windows shell`);
  }
  return [`${cmd}.cmd`, ...args].join(' ');
}

/**
 * The full path of Electron's program, or null while it is missing: its install script
 * writes `path.txt` naming the program under `dist/`, and an interrupted extraction can leave
 * one without the other.
 */
export function overlayElectronProgram({ exists, overlayDir, readFile = (p) => fs.readFileSync(p, 'utf8') }) {
  const dir = path.join(overlayDir, 'node_modules', 'electron');
  const pathTxt = path.join(dir, 'path.txt');
  if (!exists(pathTxt)) return null;
  try {
    const program = String(readFile(pathTxt)).trim();
    const full = program ? path.join(dir, 'dist', program) : null;
    return full && exists(full) ? full : null;
  } catch {
    return null;
  }
}

/** Electron's app is usable (see overlayElectronProgram). */
export function overlayElectronReady(deps) {
  return overlayElectronProgram(deps) !== null;
}

/**
 * What to check before trying an overlay install again. On Windows a running overlay keeps
 * its files open, so npm can neither remove nor replace them.
 */
export function installRetryHint(platform) {
  return platform === 'win32'
    ? 'Close the chat overlay if it is running (Windows cannot replace files a running program uses), and check your internet connection.'
    : 'Check your internet connection.';
}

/** The one sentence for an overlay whose Electron app is still missing after the install. */
export function electronMissingText(nodeVersion, platform = process.platform) {
  return `The chat overlay's Electron app did not install on Node ${nodeVersion}. ${installRetryHint(platform)} Then run ${SETUP} again; if it fails again, report it with the output of node bin/wowf doctor.`;
}

/**
 * Installs the overlay's packages exactly as the lockfile pins them (`npm ci` never rewrites
 * the lockfile, so a later `wowf update` does not find a change the player never made), then
 * makes sure Electron's app arrived. Used by setup and update.
 * Electron 39 unzips its app with extract-zip, whose yauzl 2 stalled on Node 26 and left
 * nothing behind; overlay/package.json overrides yauzl to 3.x for that.
 * @param {{ run(cmd: string, args: string[], o: { cwd: string }): Promise<{ code: number, stdout?: string }>,
 *   exists(p: string): boolean, overlayDir: string, readFile?(p: string): string }} deps
 * @returns {Promise<{ ok: true } | { ok: false, failed: 'install' | 'electron', output: string }>}
 */
export async function installOverlayPackages({ run, exists, overlayDir, readFile }) {
  const cwd = overlayDir;
  const npm = async (...args) => {
    try { return await run('npm', args, { cwd }); } catch (e) { return { code: 1, stdout: String(e?.message ?? '') }; }
  };
  const electronReady = () => overlayElectronReady({ exists, overlayDir, readFile });
  const r = await npm('ci');
  if (r.code !== 0) return { ok: false, failed: 'install', output: String(r.stdout ?? '').trim().split('\n').slice(-8).join('\n') };
  if (!electronReady()) {
    // npm 11 holds back Electron's download script until it is approved. npm 10 has no
    // approval command (that call fails, which is fine), and its rebuild retries the download.
    await npm('install-scripts', 'approve', 'electron');
    await npm('rebuild', 'electron');
  }
  return electronReady() ? { ok: true } : { ok: false, failed: 'electron', output: '' };
}

/**
 * Runs a program with an argument array. `inherit` hands the terminal to it (logins);
 * otherwise its output is collected. A program that cannot start returns a non-zero code.
 * @returns {Promise<{ code: number, stdout: string }>}
 */
export function runCommand(cmd, args, { cwd, inherit = false, timeoutMs, platform = process.platform, resolve: resolveCmd = resolveTool } = {}) {
  return new Promise((resolve) => {
    const stdio = inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'];
    let p;
    try {
      if (platform === 'win32' && SHIMS.has(cmd)) {
        p = spawn(windowsCommandLine(cmd, args), { cwd, stdio, shell: true });
      } else if (platform === 'win32' && RESOLVED.has(cmd)) {
        const tool = resolveCmd(cmd, { platform });
        p = spawn(tool.command, [...tool.args, ...args], { cwd, stdio });
      } else {
        p = spawn(cmd, args, { cwd, stdio });
      }
    } catch (e) {
      resolve({ code: 1, stdout: String(e.message) });
      return;
    }
    let stdout = '';
    const timer = timeoutMs ? setTimeout(() => p.kill(), timeoutMs) : null;
    p.stdout?.on('data', (d) => { stdout += d; });
    p.stderr?.on('data', (d) => { stdout += d; });
    p.on('error', () => { clearTimeout(timer); resolve({ code: 127, stdout }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout }); });
  });
}

// A typed or pasted path: trims it, drops surrounding quotes (Windows "Copy as path"),
// undoes the escaped spaces of a folder dragged into a macOS terminal, and expands ~.
function cleanPath(input, home) {
  let s = String(input ?? '').trim();
  if (/^(["']).*\1$/.test(s) && s.length >= 2) s = s.slice(1, -1);
  if (s.startsWith('/')) s = s.replace(/\\ /g, ' ');
  if (s === '~') s = home;
  else if (/^~[\\/]/.test(s)) s = path.join(home, s.slice(2));
  return s ? path.resolve(s) : '';
}

/**
 * @param {{ opts: { yes?: boolean, gameDir?: string, dataDir?: string, main?: string, overlay?: boolean },
 *   io: { ask(question: string, o?: { fallback?: string, choices?: string[] }): Promise<string>, say(text: string): void },
 *   deps: { nodeVersion: string, platform: string, home: string, exists(p: string): boolean,
 *     findGameDir(): string|null, isGameDir(dir: string): boolean, listCharacters(gameDir: string): object[],
 *     loadConfig(): object|null, initData(o: object): { gitFailed?: boolean, created?: boolean }, addonCurrent(gameDir: string): boolean,
 *     installAddon(gameDir: string): string, enableAutostart(o: { overlayDir: string }): string, overlayDir: string,
 *     run(cmd: string, args: string[], o?: { cwd?: string, inherit?: boolean, timeoutMs?: number }): Promise<{ code: number, stdout?: string }>,
 *     readFile?(p: string): string } }} args
 * @returns {Promise<{ ok: boolean, steps: { id: string, status: 'done'|'already'|'skipped'|'failed', text: string }[] }>}
 */
export async function runSetup({ opts = {}, io, deps }) {
  const yes = Boolean(opts.yes);
  const steps = [];
  const record = (id, status, text) => {
    steps.push({ id, status, text });
    io.say(`${LABEL[status]}${text}`);
    return status;
  };
  const result = () => ({ ok: steps.every((s) => s.status !== 'failed'), steps });
  const askYesNo = async (question, byDefault) =>
    /^y/i.test(String((await io.ask(`${question} (${byDefault ? 'Y/n' : 'y/N'})`, { fallback: byDefault ? 'y' : 'n' })) ?? '').trim());
  const run = async (cmd, args, o) => {
    try { return await deps.run(cmd, args, o); } catch { return { code: 1, stdout: '' }; }
  };

  // node
  const major = parseInt(String(deps.nodeVersion).replace(/^v/, ''), 10);
  if (!(major >= 22)) {
    record('node', 'failed', `Node ${deps.nodeVersion} is too old: Forever Companion needs Node 22 or newer. Download it from https://nodejs.org, then run ${SETUP} again.`);
    return result();
  }
  record('node', 'done', `Node ${deps.nodeVersion}: ok`);

  let cfg = null;
  let configError = null;
  try { cfg = deps.loadConfig(); } catch (e) { configError = e; }

  // game
  let gameDir = null;
  if (typeof opts.gameDir === 'string') {
    gameDir = cleanPath(opts.gameDir, deps.home);
    if (!deps.isGameDir(gameDir)) {
      record('game', 'failed', `${gameDir} is not the WoW: Forever game folder. Pass the _forever_ folder (it holds Interface or WTF).`);
      return result();
    }
    record('game', cfg?.gameDir === gameDir ? 'already' : 'done', `Game folder: ${gameDir}`);
  } else if (cfg?.gameDir && deps.isGameDir(cfg.gameDir)) {
    gameDir = cfg.gameDir;
    record('game', 'already', `Game folder: ${gameDir}`);
  } else {
    gameDir = deps.findGameDir();
    if (gameDir) gameDir = path.resolve(gameDir);
    if (!gameDir && !yes) {
      for (let tries = 0; tries < 3 && !gameDir; tries++) {
        const typed = cleanPath(await io.ask('Where is WoW: Forever installed? Paste the path of its _forever_ folder:'), deps.home);
        if (typed && deps.isGameDir(typed)) gameDir = typed;
        else io.say(`${typed || 'That'} is not the _forever_ folder (it holds Interface or WTF). Try again.`);
      }
    }
    if (!gameDir) {
      record('game', 'failed', `WoW: Forever was not found. Run setup again with --game-dir <path to the _forever_ folder>.`);
      return result();
    }
    record('game', 'done', `Game folder: ${gameDir}`);
  }

  // character
  const chars = deps.listCharacters(gameDir);
  const folders = chars.map((c) => c.folder);
  let main = null;
  if (!folders.length) {
    record('character', 'skipped', `No characters yet. Log in to the game once with your main, then run ${SETUP} again to pick it.`);
  } else if (typeof opts.main === 'string') {
    if (!folders.includes(opts.main)) {
      record('character', 'failed', `No character folder named ${opts.main}. Found: ${folders.join(', ')}.`);
      return result();
    }
    main = opts.main;
    record('character', cfg?.main === main ? 'already' : 'done', `Main character: ${main}`);
  } else if (cfg?.main && folders.includes(cfg.main)) {
    main = cfg.main;
    record('character', 'already', `Main character: ${main}`);
  } else {
    const preferred = chars.find((c) => c.hasData)?.folder ?? folders[0];
    main = yes || folders.length === 1
      ? preferred
      : await io.ask('Which character is your main?', { choices: folders, fallback: preferred });
    if (!folders.includes(main)) {
      record('character', 'failed', `No character folder named ${main}. Found: ${folders.join(', ')}.`);
      return result();
    }
    record('character', 'done', `Main character: ${main}`);
  }

  // data
  const defaultData = path.join(deps.home, 'wow-companion');
  let dataDir;
  if (typeof opts.dataDir === 'string') dataDir = cleanPath(opts.dataDir, deps.home);
  else if (cfg?.dataDir) dataDir = cfg.dataDir;
  else if (yes) dataDir = defaultData;
  else dataDir = cleanPath(await io.ask('Where should Forever Companion keep your progress data?', { fallback: defaultData }), deps.home) || defaultData;
  if (configError) {
    // Overwriting it would lose the overlay settings kept in it.
    record('data', 'failed', `Your Forever Companion config file can't be read (${configError.message}). Fix or delete it, then run ${SETUP} again.`);
    return result();
  }
  if (path.resolve(dataDir) === path.resolve(deps.home)) {
    record('data', 'failed', `Pick a dedicated folder for your progress data, not your home folder (for example ${defaultData}).`);
    return result();
  }
  // The scaffold always runs: it never overwrites, so a folder that an earlier run left
  // incomplete (or whose git init failed) is finished now.
  const inPlace = cfg && cfg.gameDir === gameDir && cfg.dataDir === dataDir && (cfg.main ?? null) === main && deps.exists(dataDir);
  try {
    const r = deps.initData({ gameDir, dataDir, main, git: true });
    const noHistory = r?.gitFailed ? ' (git is not installed, so it keeps no history)' : '';
    if (inPlace && !r?.created) record('data', 'already', `Data folder: ${dataDir}${noHistory}`);
    else record('data', 'done', `Data folder: ${dataDir}${noHistory}; settings saved`);
  } catch (e) {
    record('data', 'failed', `Could not create the data folder ${dataDir} (${e.message}).`);
    return result();
  }

  // addon
  if (deps.addonCurrent(gameDir)) {
    record('addon', 'already', 'Addon: Forever Companion is installed and current');
  } else {
    try {
      deps.installAddon(gameDir);
      record('addon', 'done', 'Addon: Forever Companion installed into the game');
    } catch (e) {
      record('addon', 'failed', `Could not install the addon (${e.message}). Close WoW and run ${SETUP} again.`);
    }
  }

  // overlay
  const cwd = deps.overlayDir;
  const electronReady = () => overlayElectronReady({ exists: deps.exists, overlayDir: cwd, readFile: deps.readFile });
  let overlayReady = false;
  if (opts.overlay === false) {
    record('overlay', 'skipped', 'Chat overlay: skipped (--no-overlay)');
  } else if (electronReady()) {
    overlayReady = true;
    record('overlay', 'already', 'Chat overlay: installed');
  } else if (!yes && !(await askYesNo('Install the chat overlay? It downloads about 250 MB.', true))) {
    record('overlay', 'skipped', `Chat overlay: not installed. Install it later with ${SETUP}.`);
  } else {
    io.say('Installing the chat overlay (about 250 MB). This can take a few minutes...');
    const r = await installOverlayPackages({ run, exists: deps.exists, overlayDir: cwd, readFile: deps.readFile });
    overlayReady = r.ok;
    if (r.ok) {
      record('overlay', 'done', 'Chat overlay: installed');
    } else if (r.failed === 'install') {
      if (r.output) io.say(r.output);
      record('overlay', 'failed', `Installing the chat overlay failed. ${installRetryHint(deps.platform)} Then run ${SETUP} again.`);
    } else {
      record('overlay', 'failed', electronMissingText(deps.nodeVersion, deps.platform));
    }
  }

  // ai
  const noOverlay = opts.overlay === false ? 'not needed without the overlay' : 'needs the chat overlay';
  if (!overlayReady) {
    record('ai', 'skipped', `AI login: ${noOverlay}`);
  } else {
    const piWorks = async () => (await run('pi', ['--version'], { timeoutMs: 30000 })).code === 0;
    const piHasLogin = async () => {
      const m = await run('pi', ['--list-models'], { timeoutMs: 30000 });
      return m.code === 0 && Boolean(m.stdout?.trim()) && !/No models available/i.test(m.stdout);
    };
    const leftToPlayer = `Run this yourself in the wow-forever-companion folder to set it up: ${SETUP}`;
    let pi = await piWorks();
    let done = false;
    if (!pi) {
      if (yes) {
        record('ai', 'skipped', `AI login: Pi, the AI app the overlay talks to, is not installed. ${leftToPlayer}`);
        done = true;
      } else if (!(await askYesNo(`Pi, the AI app the overlay talks to, is not installed. Install it now with npm ${PI_INSTALL.join(' ')}?`, true))) {
        record('ai', 'skipped', `AI login: Pi is not installed. Install it with npm ${PI_INSTALL.join(' ')}, then run ${SETUP} again.`);
        done = true;
      } else {
        await run('npm', PI_INSTALL, { inherit: true });
        pi = await piWorks();
        if (!pi) {
          record('ai', 'failed', `Pi did not install. If npm reported a permission error, your Node install does not let npm add global tools: use Pi's own installer from https://pi.dev instead, or run npm ${PI_INSTALL.join(' ')} with the rights your Node install needs. Then run ${SETUP} again.`);
          done = true;
        }
      }
    }
    if (!done) {
      if (await piHasLogin()) {
        record('ai', 'already', 'AI login: Pi works and has an AI login');
      } else if (yes) {
        record('ai', 'skipped', `AI login: Pi has no AI login yet, and setup leaves logins to you. ${leftToPlayer}`);
      } else {
        io.say(ADULT);
        const labels = AI_LOGINS.map((l) => l.label);
        const skip = AI_LOGINS.at(-1);
        const label = await io.ask('Which AI login do you want to use with Pi?', { choices: labels, fallback: skip.label });
        const entry = AI_LOGINS.find((l) => l.label === label) ?? skip;
        if (entry === skip) {
          record('ai', 'skipped', `AI login: skipped. Set it up later with ${SETUP}.`);
        } else {
          io.say(`Starting: pi ${entry.args.join(' ')}\nPi asks for your key or opens the sign-in page; what you type goes to Pi only.`);
          await run('pi', entry.args, { inherit: true });
          if (await piHasLogin()) record('ai', 'done', `AI login: ${entry.label} is ready`);
          else record('ai', 'failed', `The AI login did not finish. Run ${SETUP} again to retry.`);
        }
      }
    }
  }

  // autostart
  if (!overlayReady) {
    record('autostart', 'skipped', 'Start at login: needs the chat overlay');
  } else if (deps.platform !== 'darwin') {
    record('autostart', 'skipped', 'Start at login: only available on macOS');
  } else if (deps.exists(agentPath(deps.home))) {
    record('autostart', 'already', 'Start at login: on');
  } else if (yes || !(await askYesNo('Start the overlay when you log in to your Mac? It stays hidden until WoW runs.', false))) {
    record('autostart', 'skipped', 'Start at login: off. Turn it on with node bin/wowf overlay autostart on');
  } else {
    try {
      deps.enableAutostart({ overlayDir: cwd });
      record('autostart', 'done', 'Start at login: on from your next login');
    } catch (e) {
      record('autostart', 'failed', `Could not turn on start at login (${e.message}).`);
    }
  }

  // finish
  const overlayLine = overlayReady ? '\n  Start the chat overlay with: node bin/wowf overlay' : '';
  record('finish', 'done', 'Next, in the game:\n'
    + '  1. restart WoW (quit it fully, then start it again)\n'
    + '  2. on the character screen, click AddOns and tick Forever Companion\n'
    + '  3. log in and type /fc sync' + overlayLine);
  return result();
}
