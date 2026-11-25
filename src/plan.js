// Plans Claude writes for the in-game panel: validation, waypoint resolution, Lua output.
export const LIMITS = { steps: 12, text: 120, title: 60, nudges: 8 };

const DONE_FIELDS = {
  quest_turnin: ['id'],
  quest_accept: ['id'],
  level: ['level'],
  equip: ['itemId'],
  skill: ['name', 'rank'],
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Control characters (except newline) are removed: NUL cuts a WoW FontString short.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

function clip(text, max, what, warnings) {
  const chars = [...String(text).replace(CONTROL, '').replace(/\s+$/, '')]; // code points, not UTF-16 units
  if (chars.length <= max) return chars.join('');
  warnings.push(`${what} cut to ${max} characters`);
  return chars.slice(0, max).join('');
}

function normalizeDone(done, i, warnings) {
  if (done == null) return undefined;
  const fields = Object.hasOwn(DONE_FIELDS, done?.type ?? '') ? DONE_FIELDS[done.type] : null;
  if (!fields) { warnings.push(`step ${i + 1}: unknown done type "${done?.type}" dropped`); return undefined; }
  const out = { type: done.type };
  for (const f of fields) {
    const v = done[f];
    if (f === 'name' ? typeof v !== 'string' || !v : !isNum(v)) {
      warnings.push(`step ${i + 1}: done.${f} missing or invalid, condition dropped`);
      return undefined;
    }
    out[f] = f === 'name' ? clip(v, 60, `step ${i + 1} skill name`, warnings) : v;
  }
  return out;
}

function normalizeWaypoint(wp, i, warnings) {
  if (wp == null) return undefined;
  const hasPlace = wp.zone != null || wp.mapId != null;
  if (!hasPlace || !isNum(wp.x) || !isNum(wp.y) || wp.x < 0 || wp.x > 100 || wp.y < 0 || wp.y > 100) {
    warnings.push(`step ${i + 1}: waypoint needs zone or mapId and x,y between 0 and 100; dropped`);
    return undefined;
  }
  const out = { x: wp.x, y: wp.y };
  if (wp.mapId != null) {
    if (!Number.isInteger(wp.mapId) || wp.mapId <= 0) {
      warnings.push(`step ${i + 1}: waypoint mapId must be a positive whole number; dropped`);
      return undefined;
    }
    out.mapId = wp.mapId;
  } else if ((Number.isInteger(wp.zone) && wp.zone > 0) || (typeof wp.zone === 'string' && wp.zone.trim() && wp.zone.length <= 60)) {
    out.zone = wp.zone;
  } else {
    warnings.push(`step ${i + 1}: waypoint zone must be a zone name or area id; dropped`);
    return undefined;
  }
  return out;
}

export function validatePlan(input) {
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { plan: null, errors: ['plan must be a JSON object'], warnings };
  if (!Array.isArray(input.steps) || input.steps.length === 0) return { plan: null, errors: ['plan needs a non-empty "steps" array'], warnings };

  let steps = input.steps;
  if (steps.length > LIMITS.steps) {
    warnings.push(`plan has ${steps.length} steps; kept the first ${LIMITS.steps}`);
    steps = steps.slice(0, LIMITS.steps);
  }
  const out = [];
  steps.forEach((st, i) => {
    if (!st || typeof st.text !== 'string' || !st.text.trim()) { errors.push(`step ${i + 1} needs text`); return; }
    const step = { text: clip(st.text, LIMITS.text, `step ${i + 1} text`, warnings) };
    const done = normalizeDone(st.done, i, warnings);
    if (done) step.done = done;
    const wp = normalizeWaypoint(st.waypoint, i, warnings);
    if (wp) step.waypoint = wp;
    out.push(step);
  });

  const plan = { title: clip(typeof input.title === 'string' && input.title.trim() ? input.title : 'Next steps', LIMITS.title, 'title', warnings), steps: out };
  if (typeof input.character === 'string') plan.character = input.character;
  return { plan: errors.length ? null : plan, errors, warnings };
}

const round3 = (n) => Math.round(n * 10) / 1000;

export function resolveWaypoints(plan, db) {
  const warnings = [];
  const steps = plan.steps.map((st, i) => {
    if (!st.waypoint) return st;
    const { waypoint, ...rest } = st;
    if (!db && waypoint.mapId == null) return rest;
    let mapId = waypoint.mapId;
    let zoneLabel;
    if (mapId == null) {
      const areaId = typeof waypoint.zone === 'number' ? waypoint.zone : db.zoneIdByName(waypoint.zone);
      mapId = areaId != null ? db.uiMapId(areaId) : null;
      zoneLabel = areaId != null ? db.zoneName(areaId) ?? String(waypoint.zone) : null;
      if (!mapId) { warnings.push(`step ${i + 1}: unknown zone "${waypoint.zone}", waypoint dropped`); return rest; }
    }
    const label = `${zoneLabel ?? `map ${mapId}`} ${waypoint.x.toFixed(1)}, ${waypoint.y.toFixed(1)}`;
    return { ...rest, waypoint: { mapId, x: round3(waypoint.x), y: round3(waypoint.y), label } };
  });
  if (!db && plan.steps.some((s) => s.waypoint && s.waypoint.mapId == null)) warnings.push('QuestieDB not found; zone waypoints dropped');
  return { plan: { ...plan, steps }, warnings };
}

export function luaString(s) {
  let out = '"';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '|') out += '||';
    else if (c < 32 || c === 127) out += `\\${String(c).padStart(3, '0')}`;
    else out += ch;
  }
  return out + '"';
}

function toLua(v) {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'string') return luaString(v);
  if (Array.isArray(v)) return `{\n${v.map((x) => `${toLua(x)},\n`).join('')}}`;
  return `{\n${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `[${luaString(k)}] = ${toLua(x)},\n`).join('')}}`;
}

export function planToLua(plan, { generatedAt, characterName, nudges = [] }) {
  const data = {
    version: 1,
    generatedAt,
    characterName,
    title: plan.title,
    steps: plan.steps.map(({ text, done, waypoint }) => ({ text, done, waypoint })),
    nudges: nudges.slice(0, LIMITS.nudges).map((n) => String(n).slice(0, LIMITS.text)),
  };
  return `-- Generated by wowf plan write. Do not edit; it is replaced with each new plan.\nForeverLogPlan = ${toLua(data)}\n`;
}
