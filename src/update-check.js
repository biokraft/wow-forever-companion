// The new-version notice: asks GitHub at most once a day for the newest release. The request
// is the same for every player (fixed URL, generic user agent); the answer is cached in the
// config folder. Used by the overlay and `wowf doctor`, never by `wowf sync`.
import fs from 'node:fs';
import path from 'node:path';
import { configPath } from './config.js';

export const RELEASES_URL = 'https://api.github.com/repos/biokraft/wow-forever-companion/releases/latest';
const HEADERS = { accept: 'application/vnd.github+json', 'user-agent': 'ForeverCompanion' };
const DAY_MS = 24 * 3600 * 1000;
const VERSION = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Where the answer is cached: next to the config file. */
export function updateCacheFile() {
  return path.join(path.dirname(configPath()), 'update-check.json');
}

function parseVersion(v) {
  const m = VERSION.exec(String(v ?? '').trim());
  if (!m) return null;
  return { core: m[1].split('.').map(Number), pre: m[2] ? m[2].split('.') : [] };
}

const sign = (n) => (n < 0 ? -1 : n > 0 ? 1 : 0);

// Prerelease identifiers as in semver: numbers numerically and before words, words by text,
// and a shorter list first when it is the start of the longer one.
function comparePre(x, y) {
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const [a, b] = [x[i], y[i]];
    const [na, nb] = [/^\d+$/.test(a), /^\d+$/.test(b)];
    if (na && nb) { if (Number(a) !== Number(b)) return sign(Number(a) - Number(b)); continue; }
    if (na !== nb) return na ? -1 : 1;
    if (a !== b) return a < b ? -1 : 1;
  }
  return sign(x.length - y.length);
}

/**
 * Compares two versions such as `0.4.0` and `v0.4.1`. A prerelease sorts before its release.
 * Text that is no version sorts before every version.
 * @returns {-1 | 0 | 1}
 */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d) return sign(d);
  }
  if (!x.pre.length || !y.pre.length) return sign(y.pre.length - x.pre.length);
  return comparePre(x.pre, y.pre);
}

function readCache(file) {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isFinite(c?.checkedAt) || !(c.latest === null || typeof c.latest === 'string')) return null;
    return c;
  } catch {
    return null;
  }
}

function writeCache(file, entry) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(entry) + '\n');
    fs.renameSync(tmp, file);
  } catch { /* no cache: the next start asks again */ }
}

// The newest release's version without its `v`, or null for any failure.
async function fetchLatest(fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(RELEASES_URL, { headers: { ...HEADERS }, signal: controller.signal });
    if (!res?.ok) return null;
    const tag = (await res.json())?.tag_name;
    return typeof tag === 'string' && parseVersion(tag) ? tag.trim().replace(/^v/, '') : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is a newer release out? Asks GitHub when the cached answer is missing or a day old, and
 * caches failures too, so an offline machine does not ask on every start. Never throws.
 * @param {{ current: string, enabled?: boolean, now?: number, cacheFile?: string,
 *   fetchImpl?: typeof fetch, timeoutMs?: number }} o
 * @returns {Promise<{ latest: string | null, newer: boolean }>}
 */
export async function checkForUpdate({ current, enabled = true, now = Date.now(), cacheFile = updateCacheFile(), fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  if (!enabled) return { latest: null, newer: false };
  try {
    const cached = readCache(cacheFile);
    let latest;
    if (cached && now >= cached.checkedAt && now - cached.checkedAt < DAY_MS) {
      latest = cached.latest;
    } else {
      latest = await fetchLatest(fetchImpl, timeoutMs);
      writeCache(cacheFile, { checkedAt: now, latest });
    }
    return { latest, newer: latest !== null && compareVersions(latest, current) > 0 };
  } catch {
    return { latest: null, newer: false };
  }
}
