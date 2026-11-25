// Knowledge notes: what the player's agent researched, cached per player in
// <dataDir>/knowledge/. Nothing ships with the toolkit: game facts change with every hotfix,
// so each player's agent looks them up and keeps them fresh. Format: YAML-ish frontmatter
// with topic, sources, checked (YYYY-MM-DD), scope; markdown body.
import fs from 'node:fs';
import path from 'node:path';

export const STALE_DAYS = 14;
export const MAX_BYTES = 40 * 1024;
const CACHE_SLUG = /^[a-z0-9-]{1,60}$/;
// Names a harness could load as instructions (CLAUDE.md on case-insensitive disks, etc.).
const RESERVED = new Set(['claude', 'agents', 'agents-override', 'readme', 'system', 'append-system']);
// knowledge/progress.md holds the player's dated progress notes (the overlay's agent keeps them):
// listed as "notes", never stale, never re-researched, and written without frontmatter.
export const NOTES_SLUG = 'progress';

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let listKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) { meta[listKey].push(item[1].trim()); continue; }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (kv[2] === '') { meta[kv[1]] = []; listKey = kv[1]; } else { meta[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1').trim(); listKey = null; }
  }
  return { meta, body: text.slice(m[0].length) };
}

const cacheDir = (cfg) => path.join(cfg.dataDir, 'knowledge');

function walk(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.isDirectory()) return walk(path.join(dir, d.name), `${prefix}${d.name}/`);
    if (d.name.endsWith('.md') && d.name !== 'README.md') return [{ slug: `${prefix}${d.name.slice(0, -3)}`, file: path.join(dir, d.name) }];
    return [];
  });
}

function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d.getTime() : null;
}

function describe({ slug, file }, source, now) {
  const { meta } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  if (source === 'cache' && slug === NOTES_SLUG) {
    return { slug, topic: meta.topic ?? 'Progress notes', checked: meta.checked ?? null, ageDays: null, stale: false, valid: true, source: 'notes', path: file };
  }
  const checkedMs = validDate(meta.checked);
  const ageDays = checkedMs != null ? Math.max(0, Math.floor((now * 1000 - checkedMs) / 86400000)) : null;
  const valid = Array.isArray(meta.sources) && meta.sources.length > 0 && meta.sources.every((u) => /^https?:\/\/\S+$/.test(u)) && checkedMs != null;
  const stale = !valid || ageDays > STALE_DAYS;
  return { slug, topic: meta.topic ?? slug, checked: meta.checked ?? null, ageDays, stale, valid, source, path: file };
}

export function listKnowledge(cfg, { now = Math.floor(Date.now() / 1000) } = {}) {
  if (!cfg?.dataDir) return [];
  return walk(cacheDir(cfg)).filter((e) => !e.slug.includes('/')).map((e) => describe(e, 'cache', now));
}

export function readKnowledge(cfg, slug) {
  if (!CACHE_SLUG.test(String(slug))) throw new Error(`invalid knowledge slug "${slug}"`);
  const f = cfg?.dataDir ? path.join(cacheDir(cfg), `${slug}.md`) : null;
  if (!f || !fs.existsSync(f)) throw new Error(`knowledge "${slug}" not found`);
  return fs.readFileSync(f, 'utf8');
}

export function writeKnowledge(cfg, slug, markdown) {
  if (!CACHE_SLUG.test(slug)) throw new Error('slug must be 1-60 characters of a-z, 0-9 and -');
  if (RESERVED.has(slug)) throw new Error(`"${slug}" is a reserved name`);
  const text = String(markdown);
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`knowledge entry too large (max ${MAX_BYTES / 1024} kB)`);
  if (slug !== NOTES_SLUG) checkResearchNote(text);
  const dir = cacheDir(cfg);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.md`);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text.endsWith('\n') ? text : `${text}\n`);
  fs.renameSync(tmp, file);
  return file;
}

function checkResearchNote(text) {
  const { meta } = parseFrontmatter(text);
  if (!Array.isArray(meta.sources) || meta.sources.length === 0) throw new Error('frontmatter needs a sources list with at least one URL');
  if (!meta.sources.every((u) => /^https?:\/\/\S+$/.test(u))) throw new Error('every source must be an http(s) URL');
  const checkedMs = validDate(meta.checked);
  if (checkedMs == null) throw new Error('frontmatter needs checked: YYYY-MM-DD (a real date)');
  if (checkedMs > Date.now() + 86400000) throw new Error('checked date is in the future');
}
