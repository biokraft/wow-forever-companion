// Fetch manners for the advisor's web tool: an honest user agent, robots.txt obeyed per host,
// at least a second between requests to one host, and block pages recognised so they are
// never retried. Only Disallow rules are obeyed; Allow, Crawl-delay, Content-Signal and other
// lines are ignored (ignoring Allow can only make us stricter than the site asks).
import fs from 'node:fs';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export const USER_AGENT = `ForeverCompanion/${VERSION} (+https://github.com/biokraft/wow-forever-companion)`;

const MAX_ROBOTS = 500 * 1024;
const MAX_ROBOTS_HOPS = 5;
const MAX_SNIFF = 64 * 1024;
// Robots content is remote: rules are capped in length and number. A cut rule matches more
// paths than the original, never fewer.
const MAX_RULE = 2048;
const MAX_RULES = 1000;

const tidyRule = (value) => {
  const rule = value.replace(/\*+/g, '*');
  return rule.length > MAX_RULE ? rule.slice(0, MAX_RULE).replace(/\$+$/, '') : rule;
};

export function parseRobots(text, agent = 'ForeverCompanion') {
  const want = agent.toLowerCase();
  const groups = [];
  let group = null;
  let inRules = false;
  for (const raw of String(text ?? '').slice(0, MAX_ROBOTS).split(/\r\n|\r|\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.*)$/.exec(raw.replace(/#.*/, ''));
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      // Consecutive user-agent lines share one group; one after a rule starts a new group.
      if (!group || inRules) { group = { agents: [], disallow: [] }; groups.push(group); inRules = false; }
      group.agents.push(value.split('/')[0].trim().toLowerCase());
    } else if (key === 'disallow' || key === 'allow') {
      if (!group) continue;
      inRules = true;
      if (key === 'disallow' && value) group.disallow.push(tidyRule(value));
    }
  }
  const named = groups.filter((g) => g.agents.includes(want));
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes('*'));
  return { disallow: chosen.flatMap((g) => g.disallow).slice(0, MAX_RULES) };
}

// Rules match as prefixes of the path (with query); `*` matches anything and a trailing `$`
// anchors the end, as RFC 9309 describes. With `*` as the only wildcard, matching each literal
// piece at its leftmost place is exact, so this runs in one pass with indexOf: no regex, no
// backtracking, whatever the rule holds.
function ruleMatches(rule, path) {
  const anchored = rule.endsWith('$');
  const pieces = (anchored ? rule.slice(0, -1) : rule).split('*');
  const head = pieces[0];
  if (!path.startsWith(head)) return false;
  if (pieces.length === 1) return !anchored || path.length === head.length;
  let pos = head.length;
  const last = pieces.length - 1;
  for (let i = 1; i < last; i++) {
    const at = path.indexOf(pieces[i], pos);
    if (at < 0) return false;
    pos = at + pieces[i].length;
  }
  const tail = pieces[last];
  if (!anchored) return path.indexOf(tail, pos) >= 0;
  return path.length - tail.length >= pos && path.endsWith(tail);
}

export function isAllowed(robots, pathname) {
  const path = String(pathname || '/');
  return !(robots?.disallow ?? []).some((rule) => ruleMatches(rule, path));
}

// Signatures of a challenge page itself. Not challenges.cloudflare.com, cf-chl- or the
// challenge-platform/scripts/jsd script: ordinary pages load those for Turnstile widgets and
// bot detection.
const CHALLENGE = /<title>\s*Just a moment|\/cdn-cgi\/challenge-platform\/[^"'\s]*\/orchestrate\/|Attention Required! \| Cloudflare|cf_chl_opt/i;

export function looksBlocked(status, body) {
  if (status === 403 || status === 429) return true;
  const head = String(body ?? '').slice(0, MAX_SNIFF);
  return (status === 503 && /Just a moment/i.test(head)) || CHALLENGE.test(head);
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createGate({ fetchImpl, now = Date.now, sleep = realSleep, ttlMs = 86400000, minGapMs = 1000, timeoutMs = 10000 } = {}) {
  const robotsByHost = new Map();
  const nextSlot = new Map();

  // Reserves the host's next free slot before sleeping, so concurrent callers queue up.
  async function pace(host) {
    const t = now();
    const at = Math.max(t, nextSlot.get(host) ?? -Infinity);
    nextSlot.set(host, at + minGapMs);
    if (at > t) await sleep(at - t);
  }

  // What the host's robots.txt says: { rules } to cache, { unavailable } for a 5xx (RFC 9309:
  // disallow for now, nothing cached), or null when it could not be read or a block page
  // answered (allowed, nothing cached). Redirects are followed on the same host
  // only; a redirect elsewhere or a 4xx means "no rules".
  async function fetchRobots(origin, host) {
    let u = new URL('/robots.txt', origin);
    for (let hop = 0; hop < MAX_ROBOTS_HOPS; hop++) {
      await pace(host);
      let res;
      // An own timer, not AbortSignal.timeout: that one does not keep the process alive on
      // every Node version, and it must also cover reading the body.
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(new Error('robots.txt request timed out')), timeoutMs);
      try {
        res = await fetchImpl(u.href, { redirect: 'manual', signal: abort.signal, headers: { 'user-agent': USER_AGENT } });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers?.get?.('location');
          const next = loc ? new URL(loc, u) : null;
          if (!next || next.origin !== u.origin) return { rules: { disallow: [] } };
          u = next;
          continue;
        }
        if (res.status >= 500) return { unavailable: res.status };
        const body = res.ok ? String(await res.text()).slice(0, MAX_ROBOTS) : '';
        if (looksBlocked(res.status, body)) return null;
        return { rules: res.ok ? parseRobots(body) : { disallow: [] } };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return { rules: { disallow: [] } };
  }

  async function allow(url) {
    const host = url.host;
    let entry = robotsByHost.get(host);
    if (!entry || now() - entry.at >= ttlMs) {
      const answer = await fetchRobots(url.origin, host);
      if (!answer) return { ok: true };
      if (answer.unavailable) return { ok: false, reason: `the site's robots.txt is unavailable right now (HTTP ${answer.unavailable})` };
      entry = { robots: answer.rules, at: now() };
      robotsByHost.set(host, entry);
    }
    if (isAllowed(entry.robots, url.pathname + url.search)) return { ok: true };
    return { ok: false, reason: `${host}/robots.txt asks automated clients not to fetch ${url.pathname}` };
  }

  return { allow, pace };
}
