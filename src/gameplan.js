// The character's game plan: a small validated JSON file (<dataDir>/gameplans/<slug>.json)
// that every reader (hook, Pi, wowf state, the overlay) sees. Its own folder: `wowf plan show`
// reads every file in plans/ as a step plan. Invalid input is refused with every reason at
// once, phrased so the model can fix it; nothing is written then.
import fs from 'node:fs';
import path from 'node:path';
// core.js imports readGamePlan from here; neither module uses the other's bindings while loading.
import { FcError } from './core.js';

export const GAMEPLAN_LIMITS = {
  summary: 120, goal: 300, role: 80,
  playstyle: { items: 8, chars: 80 },
  professions: { items: 4, name: 40, why: 120 },
  milestones: { items: 10, text: 100, minLevel: 1, maxLevel: 60 },
  avoid: { items: 8, chars: 80 },
  notes: 1000,
};
const L = GAMEPLAN_LIMITS;
const FIELDS = ['version', 'summary', 'goal', 'role', 'playstyle', 'professions', 'milestones', 'avoid', 'notes', 'updatedAt'];
const ROLE_FIELDS = ['spec', 'weapons', 'notes'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const length = (s) => [...s].length; // code points, as the player sees them

// Control characters other than line breaks, tabs included: they garble the card and the
// prompt lines.
const CONTROL = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/;

// One text field: returns the trimmed text, or undefined (with errors when it is wrong). Only
// goal and notes may span lines: every other field can reach the one line put into every
// prompt, or a one-line row on the card. All problems of a field are reported together.
function text(value, name, max, errors, { required = false, multiline = false } = {}) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    if (required) errors.push(`${name}: required (non-empty text, at most ${max} characters)`);
    return undefined;
  }
  if (typeof value !== 'string') { errors.push(`${name}: must be text (at most ${max} characters)`); return undefined; }
  const t = multiline ? value.trim().replace(/\r\n/g, '\n') : value.trim();
  const before = errors.length;
  if (length(t) > max) errors.push(`${name}: ${length(t)} characters, at most ${max}`);
  if (!multiline && /[\r\n]/.test(t)) errors.push(`${name}: must be one line (no line breaks)`);
  if (CONTROL.test(t) || (multiline && /\r/.test(t))) errors.push(`${name}: contains control characters (tabs or similar); use plain text`);
  return errors.length > before ? undefined : t;
}

function unknownKeys(obj, allowed, prefix, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) errors.push(`${prefix}${k}: unknown field; allowed: ${allowed.join(', ')}`);
  }
}

// A list field: checks the type and count, then each item with itemFn.
function list(value, name, max, errors, itemFn) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) { errors.push(`${name}: must be a list (at most ${max} items)`); return undefined; }
  // Too many items is reported with the items' own problems, so one round fixes everything.
  if (value.length > max) errors.push(`${name}: ${value.length} items, at most ${max}`);
  const out = value.map((v, i) => itemFn(v, `${name}[${i}]`)).filter((v) => v !== undefined);
  return out.length ? out : undefined;
}

/**
 * Checks a game plan against schema version 1. Returns { ok: true, plan } with trimmed text
 * and empty sections left out, or { ok: false, errors } naming each field and its limit.
 * An updatedAt on input is kept only when it is a number (writeGamePlan replaces it).
 */
export function validateGamePlan(input) {
  if (!isObject(input)) return { ok: false, errors: ['game plan must be a JSON object with at least summary and goal'] };
  const errors = [];
  unknownKeys(input, FIELDS, '', errors);
  if (input.version !== undefined && input.version !== 1) errors.push('version: must be 1 (or left out)');

  const plan = { version: 1 };
  plan.summary = text(input.summary, 'summary', L.summary, errors, { required: true });
  plan.goal = text(input.goal, 'goal', L.goal, errors, { required: true, multiline: true });

  if (input.role !== undefined && input.role !== null) {
    if (!isObject(input.role)) errors.push(`role: must be an object with ${ROLE_FIELDS.join(', ')}`);
    else {
      unknownKeys(input.role, ROLE_FIELDS, 'role.', errors);
      const role = {};
      for (const k of ROLE_FIELDS) {
        const v = text(input.role[k], `role.${k}`, L.role, errors);
        if (v !== undefined) role[k] = v;
      }
      if (Object.keys(role).length) plan.role = role;
    }
  }

  plan.playstyle = list(input.playstyle, 'playstyle', L.playstyle.items, errors, (v, n) => text(v, n, L.playstyle.chars, errors, { required: true }));
  plan.professions = list(input.professions, 'professions', L.professions.items, errors, (v, n) => {
    if (!isObject(v)) { errors.push(`${n}: must be an object with name and why`); return undefined; }
    unknownKeys(v, ['name', 'why'], `${n}.`, errors);
    const name = text(v.name, `${n}.name`, L.professions.name, errors, { required: true });
    const why = text(v.why, `${n}.why`, L.professions.why, errors);
    return name === undefined ? undefined : why === undefined ? { name } : { name, why };
  });
  plan.milestones = list(input.milestones, 'milestones', L.milestones.items, errors, (v, n) => {
    if (!isObject(v)) { errors.push(`${n}: must be an object with text and an optional level`); return undefined; }
    unknownKeys(v, ['level', 'text'], `${n}.`, errors);
    const { minLevel, maxLevel } = L.milestones;
    let ok = true;
    if (v.level !== undefined && v.level !== null && !(Number.isInteger(v.level) && v.level >= minLevel && v.level <= maxLevel)) {
      errors.push(`${n}.level: ${JSON.stringify(v.level)} is not a whole number from ${minLevel} to ${maxLevel} (or leave it out)`);
      ok = false;
    }
    const t = text(v.text, `${n}.text`, L.milestones.text, errors, { required: true });
    if (!ok || t === undefined) return undefined;
    return v.level == null ? { text: t } : { level: v.level, text: t };
  });
  plan.avoid = list(input.avoid, 'avoid', L.avoid.items, errors, (v, n) => text(v, n, L.avoid.chars, errors, { required: true }));
  plan.notes = text(input.notes, 'notes', L.notes, errors, { multiline: true });
  if (typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt)) plan.updatedAt = input.updatedAt;

  if (errors.length) return { ok: false, errors };
  for (const k of Object.keys(plan)) if (plan[k] === undefined) delete plan[k];
  return { ok: true, plan };
}

export const gamePlanFile = (cfg, slug) => path.join(cfg.dataDir, 'gameplans', `${slug}.json`);

/** The stored plan, or null when it is missing, unreadable or no longer valid. */
export function readGamePlan(cfg, slug) {
  if (!slug) return null;
  try {
    const r = validateGamePlan(JSON.parse(fs.readFileSync(gamePlanFile(cfg, slug), 'utf8')));
    return r.ok ? r.plan : null;
  } catch {
    return null;
  }
}

/** Validates and stores the plan (write then rename), with updatedAt in seconds. */
export function writeGamePlan(cfg, slug, input, { now = Math.floor(Date.now() / 1000) } = {}) {
  const r = validateGamePlan(input);
  if (!r.ok) throw new FcError(`game plan rejected, nothing saved: ${r.errors.join('; ')}`);
  const plan = { ...r.plan, updatedAt: now };
  const file = gamePlanFile(cfg, slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(plan, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
  return { plan, file };
}

/** The first milestone above the level, else the first without a level, else null. */
export function nextMilestone(plan, level) {
  const ms = plan?.milestones ?? [];
  return ms.find((m) => m.level != null && typeof level === 'number' && m.level > level) ?? ms.find((m) => m.level == null) ?? null;
}

/** One line for the agent's context: "Game plan: <summary> · next: <milestone>", or null. */
export function gamePlanLine(plan, level) {
  if (!plan?.summary) return null;
  const next = nextMilestone(plan, level);
  return `Game plan: ${plan.summary}${next ? ` · next: ${next.text}` : ''}`;
}

/** The whole plan as readable text. */
export function gamePlanText(plan) {
  const lines = [`Game plan${plan.updatedAt ? ` (updated ${new Date(plan.updatedAt * 1000).toLocaleString()})` : ''}`, `Summary: ${plan.summary}`, `Goal: ${plan.goal}`];
  const section = (title, items) => { if (items?.length) lines.push(`${title}:`, ...items.map((i) => `  - ${i}`)); };
  if (plan.role) lines.push(`Role: ${ROLE_FIELDS.filter((k) => plan.role[k]).map((k) => `${k[0].toUpperCase()}${k.slice(1)}: ${plan.role[k]}`).join('; ')}`);
  section('Playstyle', plan.playstyle);
  section('Professions', plan.professions?.map((p) => (p.why ? `${p.name}: ${p.why}` : p.name)));
  section('Milestones', plan.milestones?.map((m) => (m.level != null ? `L${m.level}: ${m.text}` : m.text)));
  section('Avoid', plan.avoid);
  if (plan.notes) lines.push('Notes:', ...plan.notes.split('\n').map((l) => `  ${l}`));
  return lines.join('\n');
}
