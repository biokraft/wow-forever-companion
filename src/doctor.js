// wowf doctor: a paste-able health report. Nothing personal goes in: no paths, no names, no model or account details.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveTool } from './tool-command.js';

export function redactHome(text, home) {
  if (typeof home !== 'string' || home.length <= 1) return text;
  const windowsStyle = /^[A-Za-z]:|\\/.test(home);
  const variants = new Set([home, home.replaceAll('\\', '/'), home.replaceAll('/', '\\')]);
  let result = text;
  for (const v of [...variants].sort((x, y) => y.length - x.length)) {
    const body = v.replace(/[\\/]+$/, '');
    if (body.length <= 1) continue;
    const re = new RegExp(`${body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\\\/])`, windowsStyle ? 'gi' : 'g');
    result = result.replace(re, '~');
  }
  return result;
}

// `resolve` finds how to start the program without a shell (an npm .cmd shim on Windows).
export function execCommand(cmd, args, { timeoutMs = 15000, resolve: resolveCmd = resolveTool } = {}) {
  return new Promise((resolve, reject) => {
    const tool = resolveCmd(cmd);
    const p = spawn(tool.command, [...tool.args, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stdout += d; });
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, stdout }); });
  });
}

const parts = (v) => String(v ?? '0').split('.').map((n) => parseInt(n, 10) || 0);
const olderThan = (a, b) => {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  }
  return false;
};

const SETUP = 'run: node bin/wowf setup';

async function aiCheck(backend, exec) {
  const runs = async (cmd, args) => exec(cmd, args).catch(() => null);
  if (backend === 'claude') {
    const v = await runs('claude', ['--version']);
    return v?.code === 0
      ? { ok: true, text: 'AI: Claude Code works' }
      : { ok: false, text: `AI: Claude Code is missing; ${SETUP}` };
  }
  const v = await runs('pi', ['--version']);
  if (v?.code !== 0) return { ok: false, text: `AI: Pi is missing; ${SETUP}` };
  const m = await runs('pi', ['--list-models']);
  const hasModel = m?.code === 0 && m.stdout.trim() && !/No models available/i.test(m.stdout);
  return hasModel
    ? { ok: true, text: 'AI: Pi works and has a model' }
    : { ok: false, text: `AI: Pi has no model yet; ${SETUP}` };
}

export async function doctorReport({ version, platform, nodeVersion, home, cfg, exists, exec = execCommand, installedAddonVersion, overlayDir, update, syncState }) {
  const checks = [];
  const add = (id, ok, text) => checks.push({ id, ok, text });

  const major = parseInt(String(nodeVersion).replace(/^v/, ''), 10);
  add('node', major >= 22, major >= 22
    ? `Node ${nodeVersion}: ok`
    : `Node ${nodeVersion}: too old, Node 22 or newer is needed; install it from https://nodejs.org`);

  add('config', !!cfg, cfg ? 'Config: found' : `Config: missing; ${SETUP}`);

  add('game', !!cfg?.gameDir && !!exists(cfg.gameDir), cfg?.gameDir && exists(cfg.gameDir)
    ? 'Game folder: found'
    : `Game folder: not found; ${SETUP}`);

  if (installedAddonVersion == null) {
    add('addon', false, 'Addon: not installed; run: node bin/wowf update');
  } else if (olderThan(installedAddonVersion, version)) {
    add('addon', false, `Addon: v${installedAddonVersion} is older than the toolkit v${version}; run: node bin/wowf update`);
  } else {
    add('addon', true, `Addon: v${installedAddonVersion} is current`);
  }

  const dataOk = !!cfg?.dataDir && !!exists(cfg.dataDir);
  add('data', dataOk, dataOk ? 'Data folder: found' : `Data folder: not found; ${SETUP}`);

  // Snapshots live under a slug that `wowf sync` records in <dataDir>/.wowf/sync-state.json.
  const slug = cfg?.main ? syncState?.[cfg.main]?.slug : null;
  const snapOk = !!(cfg?.dataDir && typeof slug === 'string' && slug) && !!exists(path.join(cfg.dataDir, 'characters', `${slug}.json`));
  add('snapshot', snapOk, snapOk ? 'Snapshot: found' : 'Snapshot: none yet; log in to the game and type /fc sync');

  const overlayOk = !!exists(path.join(overlayDir, 'node_modules', 'electron', 'path.txt'));
  add('overlay', overlayOk, overlayOk ? 'Overlay: installed' : `Overlay: not installed; ${SETUP}`);

  const backend = cfg?.overlay?.backend ?? 'pi';
  const backendOk = backend === 'pi' || backend === 'claude';
  add('backend', backendOk, backendOk ? `Backend: ${backend}` : `Backend: unknown; ${SETUP}`);

  const ai = backendOk ? await aiCheck(backend, exec) : { ok: false, text: `AI: not checked; ${SETUP}` };
  add('ai', ai.ok, ai.text);

  const lines = [
    `Forever Companion ${version} on ${platform}`,
    ...checks.map((c) => `${c.ok ? 'ok    ' : 'FIX   '}${c.text}`),
  ];
  if (update) {
    lines.push(update.newer
      ? `Update: ${update.latest} is available; run: node bin/wowf update`
      : 'Update: you have the latest version');
  }
  return {
    ok: checks.every((c) => c.ok),
    checks,
    lines: lines.map((l) => redactHome(l, home)),
  };
}
