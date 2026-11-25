import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { readTiffTopFile } from './tiff-top.js';

// Captures the WoW window for the "look" toggle. Electron modules are passed in, so this is
// testable without Electron.
export async function captureWow({ desktopCapturer, systemPreferences, platform = process.platform }) {
  try {
    if (platform === 'darwin' && systemPreferences?.getMediaAccessStatus?.('screen') !== 'granted') {
      return { ok: false, reason: 'no-permission', text: 'Look needs Screen Recording permission: System Settings > Privacy & Security > Screen Recording > enable Forever Companion (Electron), then restart the overlay. Sent without a screenshot.' };
    }
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1000 } });
    // Exact title only: a browser tab like "World of Warcraft Classic - Wowhead" must not match.
    const wow = sources.find((s) => s.name.trim() === 'World of Warcraft');
    if (!wow || wow.thumbnail.isEmpty()) {
      return { ok: false, reason: 'not-running', text: "WoW isn't open (or its window is hidden), so no screenshot was sent." };
    }
    return { ok: true, png: wow.thumbnail.toPNG() };
  } catch (e) {
    return { ok: false, reason: 'error', text: `Screenshot failed: ${e.message}. Sent without it.` };
  }
}

// Captures the top rows of the WoW window as raw BGRA pixels for the pixel bridge reader, at
// native pixels so the strip's 3 x 2 px blocks are not resampled.
// macOS: `screencapture -l<id>` grabs only WoW's window at its native size (Retina included) into
// an uncompressed temp TIFF, which is always removed. TIFF, not PNG: the PNG encode cost about
// 0.13 s of CPU per read, the TIFF write about 0.04 s, and only the top rows are read back from
// it (see tiff-top.js). The window id comes from desktopCapturer's window list without thumbnails;
// that list costs about 30 ms of CPU, so with a shared `cache` the id is reused for a minute and
// looked up again at once when screencapture fails on it.
// Never captures without Screen Recording permission: on macOS that would open the system prompt
// over the game. Elsewhere (unused this phase) a full-window thumbnail is the fallback.
const execFileAsync = promisify(execFile);
const runFile = (cmd, args) => execFileAsync(cmd, args, { timeout: 5000 });
const rmFile = (file) => fs.promises.rm(file, { force: true });
const WINDOW_ID_TTL_MS = 60_000;

export async function captureWowBitmap({
  desktopCapturer, screen, systemPreferences, platform = process.platform,
  run = runFile, removeFile = rmFile, tmpDir = os.tmpdir(), readTop = readTiffTopFile,
  cache = {}, now = Date.now,
}) {
  try {
    if (platform === 'darwin' && systemPreferences?.getMediaAccessStatus?.('screen') !== 'granted') return { ok: false, reason: 'no-permission' };
    if (platform !== 'darwin') return await thumbnailBitmap({ desktopCapturer, screen });
    const cached = cache.id && now() - cache.at < WINDOW_ID_TTL_MS;
    if (!cached) {
      const found = await wowWindowId(desktopCapturer);
      if (!found.ok) return found;
      Object.assign(cache, { id: found.id, at: now() });
    }
    try {
      return await screencaptureTop({ id: cache.id, run, removeFile, tmpDir, readTop });
    } catch (e) {
      cache.id = undefined;
      if (!cached) throw e;
      // The cached window may be gone (WoW restarted its window): look it up once more.
      const found = await wowWindowId(desktopCapturer);
      if (!found.ok) return found;
      const r = await screencaptureTop({ id: found.id, run, removeFile, tmpDir, readTop });
      Object.assign(cache, { id: found.id, at: now() });
      return r;
    }
  } catch (e) {
    return { ok: false, reason: 'error', error: e.message };
  }
}

async function wowWindowId(desktopCapturer) {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
  const wow = sources.find((s) => s.name.trim() === 'World of Warcraft');
  if (!wow) return { ok: false, reason: 'not-running' };
  const id = /^window:(\d+):/.exec(wow.id ?? '')?.[1];
  if (!id) return { ok: false, reason: 'error', error: `no window id in ${wow.id}` };
  return { ok: true, id };
}

async function screencaptureTop({ id, run, removeFile, tmpDir, readTop }) {
  const file = path.join(tmpDir, `forever-companion-strip-${process.pid}-${randomUUID()}.tiff`);
  try {
    await run('screencapture', ['-x', '-o', '-t', 'tiff', `-l${id}`, file]);
    const { bitmap, width, height, windowHeight } = await readTop(file);
    return { ok: true, bitmap, width, height, windowHeight };
  } finally {
    await removeFile(file).catch(() => {});
  }
}

// Fallback: the window thumbnail asked for at the display's native pixel size. Electron
// aspect-fits thumbnails, so this is 1:1 only for a fullscreen window on the primary display.
async function thumbnailBitmap({ desktopCapturer, screen }) {
  const { size, scaleFactor = 1 } = screen.getPrimaryDisplay();
  const thumbnailSize = { width: Math.round(size.width * scaleFactor), height: Math.round(size.height * scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize });
  const wow = sources.find((s) => s.name.trim() === 'World of Warcraft');
  if (!wow || wow.thumbnail.isEmpty()) return { ok: false, reason: 'not-running' };
  const { width, height } = wow.thumbnail.getSize();
  return { ok: true, bitmap: wow.thumbnail.toBitmap(), width, height };
}
