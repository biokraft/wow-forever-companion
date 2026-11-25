// Class data: what a class can wear and wield and how much each stat is worth to it. The
// bag-upgrade reminder (nudges.js) scores items with it. Nothing of it ships with the
// toolkit: the player's agent researches it for the character's class and saves it through
// `wowf classdata write`, which validates it and stores <dataDir>/classdata/<class>.json.
// Invalid input is refused with every reason at once and nothing is written.
import fs from 'node:fs';
import path from 'node:path';

export const CLASSDATA_STALE_DAYS = 14;
export const CLASSDATA_LIMITS = { sources: 12, list: 24, name: 40, weights: 40, maxWeight: 1000, note: 1500, maxLevel: 60 };
const L = CLASSDATA_LIMITS;
const FIELDS = ['classFile', 'checked', 'sources', 'note', 'armor', 'armorFrom40', 'weapons', 'statWeights', 'dualWieldLevel'];
const CLASS = /^[A-Z]{3,20}$/;
// Stat names as the game's item data gives them (ITEM_MOD_STRENGTH_SHORT), plus plain armor.
const WEIGHT_KEY = /^(ITEM_MOD_[A-Z0-9_]{1,60}|armor)$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d.getTime() : null;
}

// A list of short one-line names (armor or weapon types as items name them).
function names(value, field, errors, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) errors.push(`${field}: required (a list of item types, e.g. "Mail")`);
    return undefined;
  }
  if (!Array.isArray(value)) { errors.push(`${field}: must be a list of item types`); return undefined; }
  if (value.length > L.list) errors.push(`${field}: ${value.length} items, at most ${L.list}`);
  const out = [];
  value.forEach((v, i) => {
    if (typeof v !== 'string' || !v.trim()) errors.push(`${field}[${i}]: must be non-empty text`);
    else if (v.trim().length > L.name || CONTROL.test(v)) errors.push(`${field}[${i}]: one plain line of at most ${L.name} characters`);
    else out.push(v.trim());
  });
  return out;
}

/**
 * Checks class data. Returns { ok: true, data } or { ok: false, errors } naming each field.
 * `expectedClass` (the character's classFile, e.g. "HUNTER") must match when given.
 */
export function validateClassData(input, { expectedClass, nowMs = Date.now() } = {}) {
  if (!isObject(input)) return { ok: false, errors: ['class data must be a JSON object'] };
  const errors = [];
  for (const k of Object.keys(input)) if (!FIELDS.includes(k)) errors.push(`${k}: unknown field; allowed: ${FIELDS.join(', ')}`);

  const classFile = typeof input.classFile === 'string' ? input.classFile.trim().toUpperCase() : '';
  if (!CLASS.test(classFile)) errors.push('classFile: required, the class as the game names it in capitals (e.g. "HUNTER")');
  else if (expectedClass && classFile !== String(expectedClass).toUpperCase()) errors.push(`classFile: this character is a ${String(expectedClass).toUpperCase()}, not a ${classFile}`);

  const checkedMs = validDate(input.checked);
  if (checkedMs == null) errors.push('checked: required, the date the facts were verified as YYYY-MM-DD');
  else if (checkedMs > nowMs + 86400000) errors.push('checked: is in the future');

  let sources;
  if (!Array.isArray(input.sources) || input.sources.length === 0) errors.push('sources: required, a list with at least one URL the data came from');
  else if (input.sources.length > L.sources) errors.push(`sources: ${input.sources.length} items, at most ${L.sources}`);
  else if (!input.sources.every((u) => typeof u === 'string' && /^https?:\/\/\S+$/.test(u) && u.length <= 300)) errors.push('sources: every source must be an http(s) URL');
  else sources = input.sources;

  const armor = names(input.armor, 'armor', errors, { required: true });
  const armorFrom40 = names(input.armorFrom40, 'armorFrom40', errors);
  const weapons = names(input.weapons, 'weapons', errors, { required: true });

  let statWeights;
  if (!isObject(input.statWeights)) errors.push('statWeights: required, an object of stat name to weight (e.g. "ITEM_MOD_AGILITY_SHORT": 1)');
  else {
    const entries = Object.entries(input.statWeights);
    if (entries.length > L.weights) errors.push(`statWeights: ${entries.length} entries, at most ${L.weights}`);
    for (const [k, v] of entries) {
      if (!WEIGHT_KEY.test(k)) errors.push(`statWeights.${k.slice(0, 60)}: unknown stat name; use the game's names (ITEM_MOD_..._SHORT) or "armor"`);
      else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > L.maxWeight) errors.push(`statWeights.${k}: must be a number from 0 to ${L.maxWeight}`);
    }
    if (!entries.some(([, v]) => typeof v === 'number' && v > 0)) errors.push('statWeights: at least one stat needs a weight above 0');
    statWeights = input.statWeights;
  }

  let dualWieldLevel = null;
  if (input.dualWieldLevel !== undefined && input.dualWieldLevel !== null) {
    if (Number.isInteger(input.dualWieldLevel) && input.dualWieldLevel >= 1 && input.dualWieldLevel <= L.maxLevel) dualWieldLevel = input.dualWieldLevel;
    else errors.push(`dualWieldLevel: a whole number from 1 to ${L.maxLevel}, or null when the class never dual wields`);
  }

  let note;
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== 'string' || input.note.length > L.note) errors.push(`note: text of at most ${L.note} characters`);
    else note = input.note.trim() || undefined;
  }

  if (errors.length) return { ok: false, errors };
  const data = { classFile, checked: input.checked, sources, armor, weapons, statWeights: { ...statWeights }, dualWieldLevel };
  if (armorFrom40?.length) data.armorFrom40 = armorFrom40;
  if (note) data.note = note;
  return { ok: true, data };
}

/** Where a class's data lives, or null for a class name that is not one. */
export function classDataFile(cfg, classFile) {
  const name = String(classFile ?? '').toUpperCase();
  if (!cfg?.dataDir || !CLASS.test(name)) return null;
  return path.join(cfg.dataDir, 'classdata', `${name.toLowerCase()}.json`);
}

/** The stored data for the class, or null when it is missing, unreadable or not valid. */
export function readClassData(cfg, classFile) {
  const file = classDataFile(cfg, classFile);
  if (!file) return null;
  try {
    // A stored date is never "in the future" for the reader: only the write checks that.
    const r = validateClassData(JSON.parse(fs.readFileSync(file, 'utf8')), { expectedClass: classFile, nowMs: Infinity });
    return r.ok ? r.data : null;
  } catch {
    return null;
  }
}

/** Validates and stores the data (write then rename). Throws an Error listing every reason. */
export function writeClassData(cfg, classFile, input, { nowMs = Date.now() } = {}) {
  const r = validateClassData(input, { expectedClass: classFile, nowMs });
  if (!r.ok) throw new Error(`class data rejected, nothing saved: ${r.errors.join('; ')}`);
  const file = classDataFile(cfg, classFile);
  if (!file) throw new Error('class data rejected, nothing saved: the character has no class yet; sync first');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(r.data, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return { data: r.data, file };
}

/** { state: 'none' | 'fresh' | 'stale', checked, ageDays } for the class's stored data. */
export function classDataStatus(cfg, classFile, { nowMs = Date.now() } = {}) {
  const data = readClassData(cfg, classFile);
  if (!data) return { state: 'none', checked: null, ageDays: null };
  const ageDays = Math.max(0, Math.floor((nowMs - validDate(data.checked)) / 86400000));
  return { state: ageDays > CLASSDATA_STALE_DAYS ? 'stale' : 'fresh', checked: data.checked, ageDays };
}

/** One line for the agent: what to do about the class data, or that it is in place. */
export function classDataLine(classFile, status) {
  const cls = String(classFile ?? '').toUpperCase() || 'this class';
  if (!status || status.state === 'none') return `Class data: none for ${cls} yet, so no bag-upgrade reminders. Research it and save it (wowf classdata write).`;
  if (status.state === 'stale') return `Class data: ${cls}, checked ${status.checked} (${status.ageDays} days ago, stale). Check it again and save it (wowf classdata write).`;
  return `Class data: ${cls}, checked ${status.checked}.`;
}

/** The stored data as readable text. */
export function classDataText(data) {
  const weights = Object.entries(data.statWeights).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  const lines = [
    `Class data for ${data.classFile} (checked ${data.checked})`,
    `Armor: ${data.armor.join(', ') || 'none'}${data.armorFrom40?.length ? `; from level 40: ${data.armorFrom40.join(', ')}` : ''}`,
    `Weapons: ${data.weapons.join(', ') || 'none'}`,
    `Dual wield: ${data.dualWieldLevel == null ? 'never' : `from level ${data.dualWieldLevel}`}`,
    `Stat weights: ${weights}`,
  ];
  if (data.note) lines.push(`Note: ${data.note}`);
  lines.push('Sources:', ...data.sources.map((u) => `  - ${u}`));
  return lines.join('\n');
}
