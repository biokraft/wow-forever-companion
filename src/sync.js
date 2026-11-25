// Turns each character's ForeverLog SavedVariables into JSON files in the data folder.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseSavedVariables } from './lua/parse.js';
import { listCharacters } from './detect.js';
import { charSlug, firstName } from './slug.js';
import { computeNudges, loadClassKnowledge } from './nudges.js';

const xpPct = (s) => (s.xpMax > 0 ? Math.floor((s.xp / s.xpMax) * 100) : 0);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function describeChanges(prev, snap) {
  const changes = [];
  if (prev && prev.level !== snap.level) changes.push(`level ${prev.level} → ${snap.level}`);
  if (prev && prev.zone !== snap.zone) changes.push(`zone ${prev.zone} → ${snap.zone}`);
  return changes;
}

const defaultEnrich = (snapshot, journal) => ({
  nudges: computeNudges(snapshot, { classKnowledge: loadClassKnowledge(snapshot.classFile), journal }),
});

// WoW serialises a table with keys 1..n as a list, so slot-keyed tables can arrive as arrays.
function bySlot(value) {
  if (!Array.isArray(value)) return value ?? {};
  const out = {};
  value.forEach((v, i) => { if (v != null) out[String(i + 1)] = v; });
  return out;
}

// Live state from the overlay is read, never committed.
const IGNORE_LINES = ['.wowf/', '*.tmp-*', 'characters/*.live.json', 'chats/'];

function ensureGitignore(dataDir) {
  const file = path.join(dataDir, '.gitignore');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const have = new Set(current.split(/\r?\n/));
  const missing = IGNORE_LINES.filter((l) => !have.has(l));
  if (missing.length) fs.appendFileSync(file, (current && !current.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
}

function syncCharacter(ch, prevState, charDir, now, enrich) {
  const base = { folder: ch.folder, newJournal: 0, changes: [] };
  const mtimeMs = fs.statSync(ch.svPath).mtimeMs;
  if (mtimeMs === prevState.mtimeMs) return { result: { ...base, status: 'unchanged', slug: prevState.slug }, state: prevState };

  let db;
  try {
    db = parseSavedVariables(fs.readFileSync(ch.svPath, 'utf8')).ForeverLogDB;
    if (!db || !db.snapshot || !db.snapshot.name) throw new Error('ForeverLogDB has no snapshot yet');
  } catch (e) {
    // Remember this file version so the error is reported once, not on every prompt.
    return { result: { ...base, status: 'error', error: e.message }, state: { ...prevState, mtimeMs } };
  }

  const snap = { ...db.snapshot, equipped: bySlot(db.snapshot.equipped) };
  if (!snap.realm) {
    // Some clients return "" for the realm; the folder is named <Character>-<Realm>.
    const dash = ch.folder.indexOf('-');
    if (dash > 0) snap.realm = ch.folder.slice(dash + 1);
  }
  const slug = charSlug(snap);
  const jsonFile = path.join(charDir, `${slug}.json`);
  const prev = readJson(jsonFile, null);
  const journal = Array.isArray(db.journal) ? db.journal : [];
  const journalSeq = db.journalSeq ?? 0;
  const epoch = db.epoch ?? null;

  const changes = describeChanges(prev, snap);
  const epochChanged = epoch != null && prevState.epoch != null && epoch !== prevState.epoch;
  let fresh;
  if (epochChanged || journalSeq < prevState.lastSeq) {
    changes.push('journal reset');
    fresh = journal;
  } else {
    fresh = journal.filter((e) => e.seq > prevState.lastSeq);
  }
  fresh = [...fresh].sort((a, b) => a.seq - b.seq);

  const extra = enrich ? enrich(snap, journal) : {};
  writeJsonAtomic(jsonFile, { ...snap, ...extra, addonVersion: db.addonVersion, diagnostics: db.diagnostics ?? {}, syncedAt: now });
  if (fresh.length) {
    fs.appendFileSync(path.join(charDir, `${slug}.journal.jsonl`), fresh.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  return {
    state: { mtimeMs, lastSeq: journalSeq, epoch, slug },
    result: {
      ...base,
      status: 'updated',
      slug,
      name: firstName(snap),
      level: snap.level,
      xpPct: xpPct(snap),
      zone: snap.zone,
      place: snap.subzone || snap.zone,
      ageSec: Math.max(0, now - (snap.time ?? now)),
      newJournal: fresh.length,
      changes,
      ...extra,
    },
  };
}

/**
 * @param {{gameDir: string, dataDir: string}} cfg
 * @param {{now?: number, enrich?: (snapshot: object, journal: object[]) => object}} opts
 *   enrich returns extra fields merged into the character JSON (used for nudges).
 */
export function syncAll(cfg, { now = Math.floor(Date.now() / 1000), enrich = defaultEnrich } = {}) {
  const charDir = path.join(cfg.dataDir, 'characters');
  const stateFile = path.join(cfg.dataDir, '.wowf', 'sync-state.json');
  fs.mkdirSync(charDir, { recursive: true });
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  ensureGitignore(cfg.dataDir);
  const state = readJson(stateFile, {});
  const results = [];

  for (const ch of listCharacters(cfg.gameDir)) {
    if (!ch.hasData) { results.push({ folder: ch.folder, newJournal: 0, changes: [], status: 'no-data' }); continue; }
    const prevState = state[ch.folder] ?? { mtimeMs: 0, lastSeq: 0, epoch: null };
    try {
      const { result, state: next } = syncCharacter(ch, prevState, charDir, now, enrich);
      results.push(result);
      if (next !== prevState) {
        state[ch.folder] = next;
        writeJsonAtomic(stateFile, state); // per character, so a later failure cannot replay this one
      }
    } catch (e) {
      results.push({ folder: ch.folder, newJournal: 0, changes: [], status: 'error', error: e.message });
    }
  }

  writeJsonAtomic(stateFile, state);
  // The data is written; a commit that fails (no git, no identity, a broken repo) never fails
  // the sync. It stays local: nothing here talks to a remote.
  try { commitIfRepo(cfg.dataDir, results.filter((r) => r.status === 'updated')); } catch { /* history only */ }
  return results;
}

// Used only for a setting git has no value for: Git for Windows usually cannot guess an email.
const FALLBACK_IDENTITY = { 'user.name': 'Forever Companion', 'user.email': 'forever-companion@localhost' };

function commitIfRepo(dataDir, updated) {
  if (!updated.length || !fs.existsSync(path.join(dataDir, '.git'))) return;
  const git = (...args) => execFileSync('git', ['-C', dataDir, ...args], { stdio: 'pipe' });
  git('add', '--', 'characters');
  try {
    git('diff', '--cached', '--quiet', '--', 'characters');
    return; // nothing staged under characters/
  } catch { /* staged changes exist */ }
  const identity = [];
  for (const [key, value] of Object.entries(FALLBACK_IDENTITY)) {
    try { git('config', '--get', key); } catch { identity.push('-c', `${key}=${value}`); }
  }
  const msg = 'sync: ' + updated.map((r) => `${r.name} L${r.level} ${r.xpPct}% XP, ${r.zone}`).join('; ');
  // Pathspec commit: only characters/, never whatever else the user has staged.
  git(...identity, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg, '--', 'characters');
}

const age = (sec) => (sec < 90 ? `${sec}s` : sec < 5400 ? `${Math.round(sec / 60)}m` : `${Math.round(sec / 3600)}h`);

export function formatSummary(results) {
  return results
    .filter((r) => r.status === 'updated' || r.status === 'error')
    .map((r) => {
      if (r.status === 'error') return `${r.folder}: could not read ForeverLog data (${r.error})`;
      let line = `${r.name} L${r.level} ${r.xpPct}% XP · ${r.place} · snapshot ${age(r.ageSec)} old · +${r.newJournal} events`;
      if (r.changes.length) line += ` · ${r.changes.join(', ')}`;
      const actionable = (r.nudges ?? []).filter((n) => n.kind !== 'rested');
      if (actionable.length) line += ` · nudges: ${actionable.map((n) => n.short ?? n.kind).join(', ')}`;
      return line;
    })
    .join('\n');
}
