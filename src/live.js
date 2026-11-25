// Live state from the overlay's pixel bridge (<dataDir>/characters/<slug>.live.json, written by
// overlay/src/bridge-reader.js createLiveWriter), laid over the last synced snapshot when read.
// Nothing here writes: live values never reach <slug>.json, the journal, or plans.
import fs from 'node:fs';
import path from 'node:path';

export const LIVE_MAX_AGE_SEC = 120;

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Returns the character's live file when it is fresh, else null: missing, unparseable,
 * seenAt older than LIVE_MAX_AGE_SEC, or not newer than the SavedVariables the snapshot came
 * from (a /fc sync after the live data wins).
 */
export function readLive(cfg, slug, { nowSec = Math.floor(Date.now() / 1000), savedMtimeMs = 0 } = {}) {
  if (!slug) return null;
  let live;
  try { live = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, 'characters', `${slug}.live.json`), 'utf8')); } catch { return null; }
  if (!live || typeof live !== 'object' || !num(live.seenAt) || !num(live.level)) return null;
  if (nowSec - live.seenAt > LIVE_MAX_AGE_SEC) return null;
  if (live.seenAt * 1000 <= (savedMtimeMs ?? 0)) return null;
  return live;
}

// The strip carries only the uiMapId. Questie's zone wins; on the snapshot's own map its zone
// text is right too; otherwise the bare id.
export function liveZone(snapshot, uiMapId, zoneName) {
  return zoneName?.(uiMapId) ?? (uiMapId === snapshot.mapId && snapshot.zone ? snapshot.zone : `map ${uiMapId}`);
}

// "Canvas Scraps: 4/8" -> "Canvas Scraps: 8/8" when the count matches the objective's need.
function retext(text, have, need) {
  if (typeof text !== 'string') return text;
  return text.replace(/(\d+)\s*\/\s*(\d+)(?!.*\d+\s*\/\s*\d+)/, (m, _h, n) => (Number(n) === need ? `${have}/${n}` : m));
}

function mergeObjective(o, have, questComplete) {
  if (!num(o?.need) || !num(have)) return { ...o, done: Boolean(o?.done || questComplete) };
  // The strip clamps counts to 255; a larger need keeps the snapshot's count when it is higher.
  const h = o.need > 255 && have === 255 ? Math.max(255, o.have ?? 0) : have;
  return { ...o, text: retext(o.text, h, o.need), have: h, done: h >= o.need || Boolean(questComplete) };
}

/**
 * Returns a copy of the snapshot with live level, XP, rested, money, position (as liveMap, in
 * percent; the snapshot's own x/y stay fractions) and a live marker. The quest log is merged
 * only when the live log is complete: progress by id, quests gone from the log get
 * leftLog: true (turned in or abandoned, settled at the next sync; never counted completed),
 * quests new since the snapshot are appended.
 * opts.questInfo(id) -> { name, questLevel } | null titles new quests; opts.zoneName(uiMapId)
 * -> string | null names the live map.
 */
export function mergeLive(snapshot, live, { questInfo, zoneName } = {}) {
  const s = { ...snapshot };
  for (const k of ['level', 'xp', 'xpMax', 'rested', 'money']) if (num(live[k])) s[k] = live[k];
  const questsLive = Boolean(live.questsComplete && Array.isArray(live.quests));
  s.live = { seenAt: live.seenAt, changedAt: live.changedAt ?? live.seenAt, questsComplete: questsLive, snapshotLevel: snapshot.level };
  const m = live.map;
  if (m && num(m.uiMapId) && m.uiMapId > 0) {
    s.liveMap = { uiMapId: m.uiMapId, x: num(m.x) ? m.x : null, y: num(m.y) ? m.y : null, zone: liveZone(snapshot, m.uiMapId, zoneName) };
  }
  if (questsLive) {
    const byId = new Map(live.quests.filter((q) => q && num(q.id)).map((q) => [q.id, q]));
    const quests = (snapshot.quests ?? []).map((q) => {
      const lq = byId.get(q.id);
      if (!lq) return { ...q, leftLog: true };
      byId.delete(q.id);
      const out = {
        ...q,
        complete: Boolean(lq.complete),
        objectives: (q.objectives ?? []).map((o, i) => mergeObjective(o, lq.objectives?.[i], lq.complete)),
      };
      if (lq.failed) out.failed = true;
      return out;
    });
    for (const lq of byId.values()) {
      const info = questInfo?.(lq.id) ?? null;
      const q = {
        id: lq.id,
        title: info?.name ?? `Quest #${lq.id}`,
        complete: Boolean(lq.complete),
        objectives: (lq.objectives ?? []).map((have) => ({ text: `progress ${have}`, done: Boolean(lq.complete), have })),
        liveOnly: true,
      };
      if (info?.questLevel) q.level = info.questLevel;
      if (lq.failed) q.failed = true;
      quests.push(q);
    }
    s.quests = quests;
  }
  return s;
}

const xpPct = (s) => (s.xpMax > 0 ? Math.floor((s.xp / s.xpMax) * 100) : 0);
const QUIET_NUDGES = new Set(['rested', 'quests_ready']);

/** "Durotar 44.9/13.2" from the live position, or null when the snapshot has none. */
export function livePlace(snapshot, { zoneName } = {}) {
  const m = snapshot?.liveMap;
  if (!m) return null;
  const zone = zoneName?.(m.uiMapId) ?? m.zone ?? liveZone(snapshot, m.uiMapId);
  return m.x != null && m.y != null ? `${zone} ${m.x.toFixed(1)}/${m.y.toFixed(1)}` : zone;
}

const ago = (sec) => (sec < 90 ? `${sec}s ago` : `${Math.round(sec / 60)} min ago`);

/**
 * One line for the agent's context, or null when the snapshot carries no live state. It ends
 * with the age of the live values and says when quest progress is still from the last sync.
 */
export function liveLine(snapshot, { zoneName, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  if (!snapshot?.live) return null;
  const parts = [`Live: L${snapshot.level} ${xpPct(snapshot)}% XP`];
  const place = livePlace(snapshot, { zoneName });
  if (place) parts.push(place);
  const ready = (snapshot.quests ?? []).filter((q) => q.complete && !q.leftLog).length;
  if (ready) parts.push(`${ready} quest${ready === 1 ? '' : 's'} ready to turn in`);
  const left = (snapshot.quests ?? []).filter((q) => q.leftLog).length;
  if (left) parts.push(`${left} quest${left === 1 ? '' : 's'} left the log (turned in or abandoned; next sync confirms)`);
  const nudges = (snapshot.nudges ?? []).filter((n) => !QUIET_NUDGES.has(n.kind));
  if (nudges.length) parts.push(`nudges: ${[...new Set(nudges.map((n) => n.short ?? n.kind))].join(', ')}`);
  if (!snapshot.live.questsComplete) parts.push('quest progress from last sync');
  // Levelling since the sync means new talent points and trainer ranks the snapshot cannot show.
  const was = snapshot.live.snapshotLevel;
  if (num(was) && was !== snapshot.level) parts.push(`L${was} at last sync`);
  parts.push(ago(Math.max(0, Math.floor(nowSec - snapshot.live.seenAt))));
  return parts.join(' · ');
}
