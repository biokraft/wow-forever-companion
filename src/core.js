// Shared operations used by the wowf CLI and the Pi tools. Each returns text lines (or data)
// and throws FcError with a player-facing message when something is missing.
import fs from 'node:fs';
import path from 'node:path';
import { addonsDir } from './detect.js';
import { openQuestieDb, questieTocPath } from './questie/db.js';
import { availableQuests, SKILL_NAMES } from './questie/available.js';
import { npcPlace } from './questie/place.js';
import { validatePlan, resolveWaypoints, planToLua } from './plan.js';
import { readLive, mergeLive } from './live.js';
import { computeNudges, loadClassKnowledge } from './nudges.js';
import { characterTag } from './bridge/codec.js';
import { readGamePlan } from './gameplan.js';

export class FcError extends Error {}

export const PLAN_FILE = 'ForeverLog_Plan.lua';
const PACKAGE_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// Returns the last synced snapshot with fresh live state from the overlay laid over it (see
// live.js); { live: false } returns the snapshot exactly as synced. Nothing live is written.
// { questTitles: false } names quests picked up since the snapshot "Quest #id" instead of
// looking them up: the first quest lookup reads the baked QuestieDB (~19 MB, about a second),
// too slow for the per-prompt hook and the overlay status line, which print no titles.
// The game plan (gameplan.js) rides along as snapshot.gamePlan: the plan, or null when there is
// none or it is invalid.
export function readCharacter(cfg, folder, { live = true, nowSec, questTitles = true } = {}) {
  const { who, slug, state } = syncedCharacter(cfg, folder);
  const file = path.join(cfg.dataDir, 'characters', `${slug}.json`);
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  snapshot.gamePlan = readGamePlan(cfg, slug);
  if (!live) return { snapshot, file };
  const fresh = readLive(cfg, slug, { nowSec, savedMtimeMs: state[who].mtimeMs });
  if (!fresh || fresh.tag !== characterTag(String(snapshot.name ?? ''), String(snapshot.classFile ?? ''))) return { snapshot, file };
  let db = null;
  try { db = cachedQuestieDb(cfg); } catch { /* names fall back */ }
  // An unreadable .toc names quests "Quest #id" and maps "map <id>"; a read never throws for it.
  const quiet = (fn) => (fn ? (v) => { try { return fn(v); } catch { return null; } } : undefined);
  const merged = mergeLive(snapshot, fresh, { questInfo: questTitles && db ? quiet((id) => db.quest(id)) : undefined, zoneName: quiet(db?.uiMapZoneName) });
  // Turn-ins and level-gated trainer visits follow the live values.
  merged.nudges = computeNudges(merged, { classKnowledge: loadClassKnowledge(merged.classFile), journal: readJournal(cfg, slug) });
  return { snapshot: merged, file };
}

function syncedCharacter(cfg, folder) {
  const who = folder ?? cfg.main;
  let state = {};
  try { state = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, '.wowf', 'sync-state.json'), 'utf8')); } catch { /* none yet */ }
  const slug = state[who]?.slug;
  if (!slug) throw new FcError(`No synced data for ${who}. Log in, type /fc sync, then sync again.`);
  return { who, slug, state };
}

/** The data-file slug of the main (or given) character; throws FcError before its first sync. */
export const characterSlug = (cfg, folder) => syncedCharacter(cfg, folder).slug;

// The overlay reads the character every few seconds in one long-lived process, and the first
// quest lookup parses the ~19 MB baked .toc (one to three seconds). Keep the opened db while the
// .toc's path, size and mtime are unchanged; a Questie update reopens it.
let dbCache = null;
function cachedQuestieDb(cfg) {
  const dir = addonsDir(cfg.gameDir);
  const toc = questieTocPath(dir);
  if (!toc) return null;
  const st = fs.statSync(toc);
  const key = `${toc}\0${st.size}\0${st.mtimeMs}`;
  if (dbCache?.key !== key) dbCache = { key, db: openQuestieDb(dir) };
  return dbCache.db;
}

function readJournal(cfg, slug) {
  try {
    return fs.readFileSync(path.join(cfg.dataDir, 'characters', `${slug}.journal.jsonl`), 'utf8')
      .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function openDb(cfg) {
  const db = cachedQuestieDb(cfg);
  if (!db) throw new FcError('QuestieDB not found in the AddOns folder; quest lookups need Questie installed.');
  return db;
}

const fmtCoord = (db, zoneId, x, y) =>
  `${db.zoneName(zoneId) ?? `zone ${zoneId}`}${x != null ? ` ${Number(x).toFixed(1)}, ${Number(y).toFixed(1)}` : ''}`;

export function questsAvailable(cfg, { character, zone, band } = {}) {
  const db = openDb(cfg);
  const s = readCharacter(cfg, character).snapshot;
  // A quest that left the log (live) may be turned in or abandoned: offer neither it nor the
  // quests that hang on it until a real sync settles it.
  const leftLog = new Set((s.quests ?? []).filter((q) => q.leftLog).map((q) => q.id));
  let list = availableQuests(db, {
    level: s.level, raceId: s.raceId, classId: s.classId,
    completed: new Set(s.completedQuests ?? []),
    inLog: new Set((s.quests ?? []).filter((q) => !q.leftLog).map((q) => q.id)),
    unsettled: leftLog,
    skills: s.skills?.length ? s.skills : undefined,
    band,
  }).map((q) => ({ ...q, zoneName: db.zoneName(q.zoneId) }));
  if (zone) {
    const wanted = [].concat(zone).map((z) => String(z).toLowerCase());
    list = list.filter((q) => wanted.some((w) => String(q.zoneId) === w || (q.zoneName ?? '').toLowerCase().includes(w)));
  }
  const lines = list.length ? list.map((q) => {
    const where = q.start ? `${q.start.name ?? q.start.kind} (${fmtCoord(db, q.start.zoneId, q.start.x, q.start.y)})` : 'unknown start';
    return `[${q.questLevel}] ${q.name}  #${q.id}  ← ${where}`;
  }) : ['No quests available with these filters.'];
  return { list, lines };
}

export function questShow(cfg, id) {
  const db = openDb(cfg);
  const q = db.quest(Number(id));
  if (!q) throw new FcError(`Quest ${id} not found in QuestieDB.`);
  const npcLine = (npcId) => { const n = db.npc(npcId); return n ? npcPlace(db, n) : `npc #${npcId}`; };
  const names = (ids) => ids.map((p) => `${db.quest(p)?.name ?? '?'} #${p}`).join(', ');
  const info = { ...q, zoneName: db.zoneName(q.zoneOrSort), givers: q.startedBy.npcs.map(npcLine), turnIn: q.finishedBy.npcs.map(npcLine) };
  const lines = [`${q.name}  #${q.id}  (level ${q.questLevel}, requires ${q.requiredLevel})`];
  if (info.zoneName) lines.push(`  zone: ${info.zoneName}`);
  if (info.givers.length) lines.push(`  from: ${info.givers.join('; ')}`);
  if (q.startedBy.objects.length) lines.push(`  from object: ${q.startedBy.objects.map((o) => db.object(o)?.name ?? `#${o}`).join(', ')}`);
  if (q.startedBy.items.length) lines.push(`  from item: #${q.startedBy.items.join(', #')}`);
  if (info.turnIn.length) lines.push(`  turn in: ${info.turnIn.join('; ')}`);
  if (q.preQuestGroup.length) lines.push(`  needs all of: ${names(q.preQuestGroup)}`);
  if (q.preQuestSingle.length) lines.push(`  needs one of: ${names(q.preQuestSingle)}`);
  if (q.requiredSkill) {
    const [skillId, rank = 1] = q.requiredSkill;
    lines.push(`  needs profession: ${SKILL_NAMES[skillId] ?? `skill #${skillId}`} ${rank}`);
  }
  if (q.parentQuest) lines.push(`  only while in your log: ${names([q.parentQuest])}`);
  if (q.nextQuestInChain) lines.push(`  next: ${names([q.nextQuestInChain])}`);
  return { info, lines };
}

export function npcSearch(cfg, name) {
  if (!String(name ?? '').trim()) throw new FcError('npc needs a name, e.g. wowf npc Hanashi');
  const db = openDb(cfg);
  const found = db.findNpcs(name);
  return { found, lines: found.length ? found.map((n) => `${npcPlace(db, n)}  #${n.id}`) : [`No NPC matching "${name}".`] };
}

const versionParts = (v) => String(v).split('.').map((n) => Number(n) || 0);
const olderThan = (a, b) => {
  const [x, y] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};

// Returns a reason when the installed addon cannot show plans from this version.
export function installedAddonOutdated(addonDir) {
  let toc;
  try { toc = fs.readFileSync(path.join(addonDir, 'ForeverLog.toc'), 'utf8'); } catch { return 'The installed ForeverLog addon has no .toc file.'; }
  const version = /^## Version:\s*(\S+)/m.exec(toc)?.[1] ?? '0';
  if (!/^ForeverLog_Plan\.lua\s*$/m.test(toc) || olderThan(version, PACKAGE_VERSION)) {
    return `The installed ForeverLog addon (v${version}) is older than this plugin (v${PACKAGE_VERSION}) and may not show plans.`;
  }
  return null;
}

export function writePlan(cfg, input, { now = Math.floor(Date.now() / 1000) } = {}) {
  const { plan, errors, warnings } = validatePlan(input);
  if (errors.length) throw new FcError(`plan rejected: ${errors.join('; ')}`);
  const addonDir = path.join(addonsDir(cfg.gameDir), 'ForeverLog');
  if (!fs.existsSync(addonDir)) throw new FcError('ForeverLog is not installed; run wowf install-addon first');
  // Plans never carry live values: nudges and names come from the synced snapshot.
  const s = readCharacter(cfg, plan.character, { live: false }).snapshot;
  const { plan: resolved, warnings: wpWarnings } = resolveWaypoints(plan, openQuestieDb(addonsDir(cfg.gameDir)));
  const characterName = String(s.name ?? '').split(/\s+/)[0] || String(plan.character ?? cfg.main ?? '').split('-')[0];
  // The addon computes turn-in and talent nudges live; baking them in would go stale.
  const LIVE = new Set(['rested', 'quests_ready', 'talent_points']);
  const nudges = (s.nudges ?? []).filter((n) => !LIVE.has(n.kind)).map((n) => n.text);
  // Write then rename, so a /reload during the write never loads half a file.
  const planPath = path.join(addonDir, PLAN_FILE);
  fs.writeFileSync(`${planPath}.tmp`, planToLua(resolved, { generatedAt: now, characterName, nudges }));
  fs.renameSync(`${planPath}.tmp`, planPath);
  const plansDir = path.join(cfg.dataDir, 'plans');
  fs.mkdirSync(plansDir, { recursive: true });
  const stamp = new Date(now * 1000).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  let copy = path.join(plansDir, `${stamp}.json`);
  for (let i = 2; fs.existsSync(copy); i++) copy = path.join(plansDir, `${stamp}-${i}.json`);
  fs.writeFileSync(copy, JSON.stringify({ ...resolved, generatedAt: now, characterName, nudges }, null, 2) + '\n');
  const n = resolved.steps.length;
  const lines = [`Plan pushed: ${n} step${n === 1 ? '' : 's'} for ${characterName}. In game: /fc sync to load it.`];
  for (const w of [...warnings, ...wpWarnings]) lines.push(`  warning: ${w}`);
  const outdated = installedAddonOutdated(addonDir);
  if (outdated) lines.push(`  warning: ${outdated} Run wowf install-addon, then restart WoW.`);
  return { plan: resolved, lines };
}
