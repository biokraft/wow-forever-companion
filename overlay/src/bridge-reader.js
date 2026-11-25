// Pixel bridge reader: finds the ForeverLog strip in a capture of the WoW window, decodes its
// frames, assembles the pages into one live state per character, and writes
// <dataDir>/characters/<slug>.live.json. Everything here is plain Node; Electron capture and the
// timers are passed in, so it is testable without Electron.
import fs from 'node:fs';
import path from 'node:path';
import {
  GREYS, MARKER, BLOCK_W, decodeFrame, frameSymbolCount, unpackCore, unpackQuests, questDigest, characterTag,
} from '../../src/bridge/codec.js';

// The strip is the top 2 px of the game's drawing area; a windowed capture adds the title bar
// above it, so the marker is looked for in the top tenth of the window, at most 120 rows.
const MAX_STRIP_ROW = 120;
const MARKER_TOLERANCE = 12; // marker samples must be close to their grey, not just nearest
export const HEARTBEAT_MS = 30_000;
export const BASE_MS = 10_000; // each read is a screencapture; 10 s keeps the average near 1 % of a core
export const FOLLOW_MS = 1100;
export const LIVE_MAX_AGE_MS = 120_000;

const nearestGrey = (v) => GREYS.reduce((best, g, i) => (Math.abs(g - v) < Math.abs(GREYS[best] - v) ? i : best), 0);

// How many rows from the top of a window of this height can hold the strip: the rows readStrip
// searches. A capture can stop there.
export const stripRowCount = (windowHeight) => Math.min(windowHeight, Math.min(MAX_STRIP_ROW, Math.floor(windowHeight / 10)) + 1);

// Returns the symbols from the marker to the end of the strip row, or null when no row near the
// top starts with the marker at the left edge. The capture must be at native pixels: blocks are
// exactly BLOCK_W wide, and each block's centre pixel (BGRA, mean of B, G, R) is sampled.
// `height` is the rows in the bitmap; `windowHeight` (when only the top rows were captured) is
// the full window's, which sets how deep the strip may be.
export function readStrip({ bitmap, width, height, windowHeight = height } = {}) {
  if (!bitmap || !(width > 0) || !(height > 0) || bitmap.length < width * height * 4) return null;
  const count = Math.floor(width / BLOCK_W);
  if (count < MARKER.length) return null;
  const centre = Math.floor(BLOCK_W / 2);
  const lastRow = Math.min(stripRowCount(windowHeight), height) - 1;
  for (let y = 0; y <= lastRow; y++) {
    const grey = (i) => {
      const o = (y * width + i * BLOCK_W + centre) * 4;
      return (bitmap[o] + bitmap[o + 1] + bitmap[o + 2]) / 3;
    };
    if (!MARKER.every((m, i) => Math.abs(grey(i) - GREYS[m]) <= MARKER_TOLERANCE)) continue;
    return Array.from({ length: count }, (_, i) => nearestGrey(grey(i)));
  }
  return null;
}

// A checksum-valid frame can still be game pixels that happen to pass; values no character can
// have mark it as not live state.
export function plausibleFrame(frame) {
  if (!frame?.ok || !(frame.page < frame.pages)) return false;
  if (frame.page !== 0) return true;
  let c;
  try { c = unpackCore(frame.bits); } catch { return false; }
  return c.level >= 1 && c.level <= 60 && c.xp <= c.xpMax && c.x <= 1000 && c.y <= 1000 && c.questCount <= 31;
}

// Cuts the frame out of a strip row (the pixels after its checksum are game pixels) and decodes it.
export function decodeStrip(symbols) {
  if (!symbols) return { ok: false, reason: 'no strip' };
  const n = frameSymbolCount(symbols);
  if (n == null) return { ok: false, reason: 'length' };
  return decodeFrame(symbols.slice(0, n));
}

// Keeps the newest page 0 per character tag and the newest copy of each quest page. The quest
// list is complete only when pages 1..pages-1 are all there, for the same page count, and their
// quests hash to the core's quest digest; a stale page simply mismatches until it is redrawn.
export function createAssembler() {
  const byTag = new Map();
  const push = (frame) => {
    if (!frame?.ok) return null;
    let t = byTag.get(frame.tag);
    if (!t) byTag.set(frame.tag, (t = { core: null, pages: 0, seq: 0, questPages: new Map(), key: null, state: null }));
    try {
      if (frame.page === 0) {
        t.core = unpackCore(frame.bits);
        t.pages = frame.pages;
      } else {
        t.questPages.set(frame.page, { pages: frame.pages, quests: unpackQuests(frame.bits) });
      }
    } catch {
      return null; // a payload that does not unpack changes nothing
    }
    t.seq = frame.seq;
    if (!t.core) return null;
    let quests = [];
    for (let p = 1; p < t.pages && quests; p++) {
      const e = t.questPages.get(p);
      quests = e && e.pages === t.pages ? quests.concat(e.quests) : null;
    }
    if (quests && (quests.length !== t.core.questCount || questDigest(quests) !== t.core.questDigest)) quests = null;
    t.state = { tag: frame.tag, seq: t.seq, pages: t.pages, core: t.core, quests, questsComplete: quests !== null };
    const key = JSON.stringify([t.core, t.pages, quests]);
    if (key === t.key) return null;
    t.key = key;
    return t.state;
  };
  return { push, state: (tag) => byTag.get(tag)?.state ?? null };
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// Writes a character's live file when its content changes, and at least every 30 s while
// updates keep coming (heartbeat), so seenAt tells readers the strip is still being decoded.
// seq is recorded but is not content: an idle player's strip still redraws quest pages.
export function createLiveWriter({ dataDir, slugForTag, now = Date.now, writeFile = writeAtomic }) {
  const last = new Map();
  const sec = (ms) => Math.floor(ms / 1000);
  return {
    update(state) {
      if (!state?.core) return false;
      const c = state.core;
      const file = path.join(dataDir, 'characters', `${slugForTag(state.tag) ?? `live-${state.tag}`}.live.json`);
      const content = {
        tag: state.tag, level: c.level, xp: c.xp, xpMax: c.xpMax, rested: c.rested, money: c.money,
        map: { uiMapId: c.uiMapId, x: c.x / 10, y: c.y / 10 },
        quests: state.quests ?? null, questsComplete: Boolean(state.questsComplete),
      };
      const key = JSON.stringify(content);
      const t = now();
      const prev = last.get(file);
      const changed = !prev || prev.key !== key;
      if (!changed && t - prev.writtenAt < HEARTBEAT_MS) return false;
      const changedAt = changed ? t : prev.changedAt;
      writeFile(file, JSON.stringify({ seenAt: sec(t), changedAt: sec(changedAt), seq: state.seq, ...content }, null, 2) + '\n');
      last.set(file, { key, writtenAt: t, changedAt });
      return true;
    },
  };
}

// Maps a character tag to the slug of its synced snapshot (<dataDir>/characters/<slug>.json).
// Known tags are cached; an unknown tag rescans the folder at most once per rescanMs.
export function createSlugResolver({
  dataDir, now = Date.now, rescanMs = 60_000,
  readdir = fs.readdirSync, readFile = (f) => fs.readFileSync(f, 'utf8'),
}) {
  const dir = path.join(dataDir, 'characters');
  let slugs = new Map();
  let scannedAt = -Infinity;
  const scan = () => {
    scannedAt = now();
    let names = [];
    try { names = readdir(dir); } catch { /* no characters synced yet */ }
    const next = new Map();
    for (const name of names) {
      if (!name.endsWith('.json') || name.endsWith('.live.json')) continue;
      try {
        const s = JSON.parse(readFile(path.join(dir, name)));
        if (s?.name && s?.classFile) {
          const tag = characterTag(s.name, s.classFile);
          if (!next.has(tag)) next.set(tag, name.slice(0, -'.json'.length));
        }
      } catch { /* a broken snapshot names nobody */ }
    }
    slugs = next;
  };
  return (tag) => {
    if (slugs.has(tag)) return slugs.get(tag);
    if (now() - scannedAt >= rescanMs) scan();
    return slugs.get(tag) ?? null;
  };
}

// One read: capture -> strip -> frame -> assembler -> writer. Never throws. A failed read writes
// nothing; missesBeforeLog failures in a row are logged once, not per miss. Reads asked for
// while one runs share it. Returns what the scheduler needs to decide on follow-up reads.
export function createLiveReader({ capture, assembler = createAssembler(), writer, log = console.error, now = Date.now, missesBeforeLog = 3 }) {
  let misses = 0;
  let writeFailed = false;
  let inflight = null;
  const latest = new Map();
  const miss = (reason) => {
    misses++;
    if (misses === missesBeforeLog) log(`Pixel bridge: ${misses} reads in a row found no live state (last: ${reason}).`);
    return { ok: false, reason };
  };
  const once = async () => {
    let shot;
    try { shot = await capture(); } catch (e) { return miss(`capture failed: ${e.message}`); }
    if (!shot?.ok) return miss(shot?.reason ?? 'capture failed');
    const symbols = readStrip(shot);
    if (!symbols) return miss('no marker');
    const frame = decodeStrip(symbols);
    if (!frame.ok) return miss(frame.reason);
    if (!plausibleFrame(frame)) return miss('implausible');
    misses = 0;
    const state = assembler.push(frame) ?? assembler.state(frame.tag);
    if (state) {
      latest.set(frame.tag, { state, at: now() });
      try {
        writer.update(state);
        writeFailed = false;
      } catch (e) {
        if (!writeFailed) log(`Pixel bridge: could not write live state: ${e.message}`);
        writeFailed = true;
      }
    }
    return {
      ok: true, tag: frame.tag, pages: state?.pages ?? frame.pages, questsComplete: Boolean(state?.questsComplete),
      key: `${frame.tag}:${state ? state.core.questDigest : '?'}`,
    };
  };
  return {
    read: () => (inflight ??= once().finally(() => { inflight = null; })),
    latest: (tag) => latest.get(tag) ?? null,
  };
}

// Reads now, then every baseMs. The addon shows page 0 every other second, so a fixed cadence
// can phase-lock and never see some quest pages: while the quest list is incomplete, take up to
// 2 x (pages - 1) + 2 follow-up reads followMs apart, then go back to baseMs. A list that used up
// its follow-ups gets no new burst until its key (tag and quest digest) changes.
export function scheduleReads({ read, baseMs = BASE_MS, followMs = FOLLOW_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let stopped = false;
  let left = 0;
  let spentKey = null;
  const next = (ms) => { if (!stopped) timer = setTimer(run, ms); };
  async function run() {
    timer = null;
    if (stopped) return;
    let r = null;
    try { r = await read(); } catch { /* a failed read is a miss */ }
    if (stopped) return;
    if (!(r?.ok && !r.questsComplete && r.pages > 1)) {
      left = 0;
      next(baseMs);
    } else if (left > 0) {
      left--;
      if (left === 0) spentKey = r.key;
      next(left > 0 ? followMs : baseMs);
    } else if (r.key === spentKey) {
      next(baseMs);
    } else {
      left = 2 * (r.pages - 1) + 2;
      next(followMs);
    }
  }
  run();
  return () => {
    stopped = true;
    if (timer) clearTimer(timer);
    timer = null;
  };
}

// Title bar status from fresh live values for the snapshot's character, or null when there are
// none (missing, another character, or older than maxAgeMs).
export function liveStatusLine({ snapshot, live, nowMs, maxAgeMs = LIVE_MAX_AGE_MS }) {
  const c = live?.state?.core;
  if (!c || !snapshot || nowMs - live.at > maxAgeMs) return null;
  if (characterTag(snapshot.name, snapshot.classFile) !== live.state.tag) return null;
  const pct = c.xpMax > 0 ? Math.floor((c.xp / c.xpMax) * 100) : 0;
  // The strip carries only the map id; the snapshot's zone name is used while it is the same map.
  const place = c.uiMapId === snapshot.mapId ? (snapshot.subzone || snapshot.zone) : null;
  return `${String(snapshot.name ?? '').split(/\s+/)[0]} L${c.level} ${pct}% XP${place ? ` · ${place}` : ''} (live)`;
}
