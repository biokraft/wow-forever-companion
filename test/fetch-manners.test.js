import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { USER_AGENT, parseRobots, isAllowed, looksBlocked, createGate } from '../pi/fetch-manners.js';

const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test('the user agent names the product, its version and the public repo', () => {
  assert.equal(USER_AGENT, `ForeverCompanion/${version} (+https://github.com/biokraft/wow-forever-companion)`);
});

test('parseRobots picks the ForeverCompanion group over *', () => {
  const txt = 'User-agent: *\nDisallow: /all\n\nUser-agent: ForeverCompanion\nDisallow: /mine\n';
  assert.deepEqual(parseRobots(txt), { disallow: ['/mine'] });
});

test('parseRobots falls back to the * group, case-insensitively', () => {
  const txt = 'user-agent: Googlebot\ndisallow: /g\n\nuser-agent: *\ndisallow: /wp-admin/\n';
  assert.deepEqual(parseRobots(txt), { disallow: ['/wp-admin/'] });
});

test('parseRobots ignores comments, Allow, Content-Signal and other unknown lines', () => {
  const txt = [
    '# Content-Signal = no means no',
    'User-agent: *   # everyone',
    'Content-Signal: search=yes,ai-train=no',
    'Crawl-delay: 5',
    'Allow: /',
    'Disallow: /api.php # the API',
    'Sitemap: https://example.org/sitemap.xml',
    'nonsense line',
  ].join('\r\n');
  assert.deepEqual(parseRobots(txt), { disallow: ['/api.php'] });
});

test('parseRobots merges consecutive user-agent lines into one group', () => {
  const txt = 'User-agent: Foo\nUser-agent: ForeverCompanion\nDisallow: /x\nUser-agent: *\nDisallow: /y\n';
  assert.deepEqual(parseRobots(txt), { disallow: ['/x'] });
});

test('parseRobots returns no rules for empty or garbage input', () => {
  assert.deepEqual(parseRobots(''), { disallow: [] });
  assert.deepEqual(parseRobots('<html><body>Not Found</body></html>'), { disallow: [] });
  assert.deepEqual(parseRobots(undefined), { disallow: [] });
  assert.deepEqual(parseRobots('Disallow: /orphan\n'), { disallow: [] });
});

test('parseRobots cuts input longer than 500 kB', () => {
  const txt = `User-agent: *\n${'#'.repeat(500 * 1024)}\nDisallow: /late\n`;
  assert.deepEqual(parseRobots(txt), { disallow: [] });
});

test('isAllowed checks Disallow prefixes', () => {
  const robots = { disallow: ['/api.php', '/index.php'] };
  assert.equal(isAllowed(robots, '/wiki/Orgrimmar'), true);
  assert.equal(isAllowed(robots, '/api.php'), false);
  assert.equal(isAllowed(robots, '/index.php?title=Orgrimmar&action=edit'), false);
});

test('an empty Disallow line allows everything', () => {
  const robots = parseRobots('User-agent: *\nDisallow:\n');
  assert.equal(isAllowed(robots, '/anything'), true);
});

test('isAllowed honours * and $ in rules', () => {
  const robots = { disallow: ['/armory/*/character/*', '*/tools/arena/', '/*.pdf$'] };
  assert.equal(isAllowed(robots, '/armory/eu/character/bob'), false);
  assert.equal(isAllowed(robots, '/x/tools/arena/team/1'), false);
  assert.equal(isAllowed(robots, '/guide.pdf'), false);
  assert.equal(isAllowed(robots, '/guide.pdf?x=1'), true);
  assert.equal(isAllowed(robots, '/armory/eu/guild/x'), true);
});

test('looksBlocked spots block and bot-check answers', () => {
  assert.equal(looksBlocked(403, ''), true);
  assert.equal(looksBlocked(429, ''), true);
  assert.equal(looksBlocked(503, '<title>Just a moment...</title>'), true);
  assert.equal(looksBlocked(200, '<title>Just a moment...</title>'), true);
  assert.equal(looksBlocked(200, '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>'), true);
  assert.equal(looksBlocked(200, 'Orgrimmar is the capital of the Horde.'), false);
  assert.equal(looksBlocked(503, 'Service unavailable'), false);
  assert.equal(looksBlocked(404, 'Not found'), false);
});

// A clock that only moves when the gate sleeps (or the test advances it).
function fakeClock() {
  const clock = { t: 0, slept: [] };
  clock.now = () => clock.t;
  clock.sleep = async (ms) => { clock.slept.push(ms); clock.t += ms; };
  return clock;
}

const res = (status, body = '') => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => body });

function robotsServer(answer) {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return answer(url, opts); };
  return { calls, fetchImpl };
}

test('gate.allow: a missing robots.txt allows the page', async () => {
  const clock = fakeClock();
  const srv = robotsServer(() => res(404, 'nope'));
  const gate = createGate({ fetchImpl: srv.fetchImpl, now: clock.now, sleep: clock.sleep });
  assert.deepEqual(await gate.allow(new URL('https://warcraft.wiki.gg/wiki/Orgrimmar')), { ok: true });
  assert.equal(srv.calls[0].url, 'https://warcraft.wiki.gg/robots.txt');
  assert.equal(srv.calls[0].opts.headers['user-agent'], USER_AGENT);
  assert.equal(srv.calls[0].opts.redirect, 'manual');
});

test('gate.allow: a robots fetch that throws allows the page and is not cached', async () => {
  const clock = fakeClock();
  const srv = robotsServer(() => { throw new Error('ECONNRESET'); });
  const gate = createGate({ fetchImpl: srv.fetchImpl, now: clock.now, sleep: clock.sleep });
  assert.deepEqual(await gate.allow(new URL('https://warcraft.wiki.gg/wiki/A')), { ok: true });
  assert.deepEqual(await gate.allow(new URL('https://warcraft.wiki.gg/wiki/B')), { ok: true });
  assert.equal(srv.calls.length, 2);
});

test('gate.allow: a robots fetch that times out allows the page and is not cached', async () => {
  const clock = fakeClock();
  const hang = (_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
  });
  const srv = robotsServer(hang);
  const gate = createGate({ fetchImpl: srv.fetchImpl, now: clock.now, sleep: clock.sleep, timeoutMs: 20 });
  assert.deepEqual(await gate.allow(new URL('https://warcraft.wiki.gg/wiki/A')), { ok: true });
  assert.deepEqual(await gate.allow(new URL('https://warcraft.wiki.gg/wiki/B')), { ok: true });
  assert.equal(srv.calls.length, 2);
});

test('gate.allow: a disallowed path is refused with a reason naming robots.txt', async () => {
  const clock = fakeClock();
  const srv = robotsServer(() => res(200, 'User-agent: *\nDisallow: /api.php\n'));
  const gate = createGate({ fetchImpl: srv.fetchImpl, now: clock.now, sleep: clock.sleep });
  const v = await gate.allow(new URL('https://warcraft.wiki.gg/api.php?action=query'));
  assert.equal(v.ok, false);
  assert.match(v.reason, /robots\.txt/);
  assert.deepEqual(await gate.allow(new URL('https://warcraft.wiki.gg/wiki/Orgrimmar')), { ok: true });
});

test('gate.allow: robots.txt is fetched once per host within ttlMs, again after', async () => {
  const clock = fakeClock();
  const srv = robotsServer(() => res(200, 'User-agent: *\nDisallow: /private\n'));
  const gate = createGate({ fetchImpl: srv.fetchImpl, now: clock.now, sleep: clock.sleep, ttlMs: 60000 });
  await gate.allow(new URL('https://warcraft.wiki.gg/wiki/A'));
  clock.t += 30000;
  await gate.allow(new URL('https://warcraft.wiki.gg/wiki/B'));
  assert.equal(srv.calls.length, 1);
  await gate.allow(new URL('https://www.method.gg/guides'));
  assert.equal(srv.calls.length, 2, 'another host has its own robots.txt');
  clock.t += 60000;
  await gate.allow(new URL('https://warcraft.wiki.gg/wiki/C'));
  assert.equal(srv.calls.length, 3);
});

test('gate.allow: robots.txt redirects are followed on the same host only', async () => {
  const clock = fakeClock();
  const moved = (location) => ({ ok: false, status: 301, headers: { get: (k) => (k.toLowerCase() === 'location' ? location : null) }, text: async () => '' });
  const srv = robotsServer((url) => (url.endsWith('/robots.txt') ? moved('/robots-real.txt') : res(200, 'User-agent: *\nDisallow: /x\n')));
  const gate = createGate({ fetchImpl: srv.fetchImpl, now: clock.now, sleep: clock.sleep });
  assert.equal((await gate.allow(new URL('https://www.icy-veins.com/x'))).ok, false);
  assert.deepEqual(srv.calls.map((c) => c.url), ['https://www.icy-veins.com/robots.txt', 'https://www.icy-veins.com/robots-real.txt']);

  const away = robotsServer(() => moved('https://elsewhere.example/robots.txt'));
  const gate2 = createGate({ fetchImpl: away.fetchImpl, now: clock.now, sleep: clock.sleep });
  assert.deepEqual(await gate2.allow(new URL('https://warcrafttavern.com/x')), { ok: true });
  assert.equal(away.calls.length, 1, 'never fetches robots.txt from another host');
});

test('gate.pace: two calls for one host 100 ms apart sleep about 900 ms', async () => {
  const clock = fakeClock();
  const gate = createGate({ fetchImpl: async () => res(404), now: clock.now, sleep: clock.sleep });
  await gate.pace('warcraft.wiki.gg');
  clock.t += 100;
  await gate.pace('warcraft.wiki.gg');
  assert.deepEqual(clock.slept, [900]);
});

test('gate.pace: different hosts do not wait on each other', async () => {
  const clock = fakeClock();
  const gate = createGate({ fetchImpl: async () => res(404), now: clock.now, sleep: clock.sleep });
  await gate.pace('warcraft.wiki.gg');
  await gate.pace('www.method.gg');
  await gate.pace('www.icy-veins.com');
  assert.deepEqual(clock.slept, []);
});

test('gate.pace: concurrent calls for one host queue one gap apart', async () => {
  const clock = { t: 0, slept: [] };
  const gate = createGate({ fetchImpl: async () => res(404), now: () => clock.t, sleep: async (ms) => { clock.slept.push(ms); } });
  await Promise.all([gate.pace('h'), gate.pace('h'), gate.pace('h')]);
  assert.deepEqual(clock.slept, [1000, 2000]);
});

test('gate.allow paces its robots.txt request like any other', async () => {
  const clock = fakeClock();
  const srv = robotsServer(() => res(404));
  const gate = createGate({ fetchImpl: srv.fetchImpl, now: clock.now, sleep: clock.sleep });
  await gate.allow(new URL('https://warcraft.wiki.gg/wiki/A'));
  await gate.pace('warcraft.wiki.gg');
  assert.deepEqual(clock.slept, [1000]);
});

test('isAllowed: many-star rules from robots.txt match in linear time', () => {
  const robots = parseRobots(`User-agent: *\nDisallow: /${'*a'.repeat(40)}*b\nDisallow: /*a*a*a*a*a*a*a*a$\n`);
  const path = `/${'a'.repeat(20000)}`;
  const t0 = performance.now();
  assert.equal(isAllowed({ disallow: [robots.disallow[0]] }, path), true);
  assert.equal(isAllowed(robots, `${path}c`), true);
  assert.equal(isAllowed(robots, path), false, 'the anchored rule matches');
  assert.ok(performance.now() - t0 < 200, `took ${performance.now() - t0} ms`);
});

test('isAllowed: wildcard edge cases', () => {
  assert.equal(isAllowed({ disallow: ['/a*b*c'] }, '/a-c-b-c'), false);
  assert.equal(isAllowed({ disallow: ['/a*b*c'] }, '/a-c-b'), true);
  assert.equal(isAllowed({ disallow: ['/a*bc$'] }, '/abc'), false);
  assert.equal(isAllowed({ disallow: ['/a*bc$'] }, '/abcx'), true);
  assert.equal(isAllowed({ disallow: ['/ab*b$'] }, '/ab'), true, 'the end piece may not overlap the start');
  assert.equal(isAllowed({ disallow: ['/x$'] }, '/x'), false);
  assert.equal(isAllowed({ disallow: ['/x$'] }, '/xy'), true);
  assert.equal(isAllowed({ disallow: ['/a$b'] }, '/a$b/c'), false, 'a $ inside a rule is literal');
  assert.deepEqual(parseRobots('User-agent: *\nDisallow: /a***b\n'), { disallow: ['/a*b'] });
});

test('parseRobots caps rule length (a cut rule matches more, never less) and rule count', () => {
  const long = `/${'x'.repeat(5000)}$`;
  const { disallow } = parseRobots(`User-agent: *\nDisallow: ${long}\n`);
  assert.equal(disallow[0].length, 2048);
  assert.equal(isAllowed({ disallow }, `/${'x'.repeat(6000)}`), false);
  const many = `User-agent: *\n${Array.from({ length: 1500 }, (_, i) => `Disallow: /p${i}`).join('\n')}\n`;
  assert.equal(parseRobots(many).disallow.length, 1000);
});

test('looksBlocked: ordinary pages with Turnstile or bot-detection scripts are not blocked', () => {
  const turnstile = '<html><head><title>Orgrimmar</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script></head><body><div class="cf-turnstile" data-sitekey="x"></div><input name="cf-chl-widget-1_response">Orgrimmar is...</body></html>';
  assert.equal(looksBlocked(200, turnstile), false);
  const jsd = '<p>Guide</p><script>(function(){var a=document.createElement("script");a.src="/cdn-cgi/challenge-platform/scripts/jsd/main.js";})();</script>';
  assert.equal(looksBlocked(200, jsd), false);
  assert.equal(looksBlocked(200, '<script>window._cf_chl_opt={cvId:"3"};</script>'), true);
  assert.equal(looksBlocked(200, '<title>Attention Required! | Cloudflare</title>'), true);
});

test('gate.allow: a blocked robots.txt answer is not cached', async () => {
  for (const answer of [() => res(403, 'Forbidden'), () => res(429), () => res(200, '<title>Just a moment...</title>')]) {
    const clock = fakeClock();
    const srv = robotsServer(answer);
    const gate = createGate({ fetchImpl: srv.fetchImpl, now: clock.now, sleep: clock.sleep });
    assert.deepEqual(await gate.allow(new URL('https://www.method.gg/a')), { ok: true });
    assert.deepEqual(await gate.allow(new URL('https://www.method.gg/b')), { ok: true });
    assert.equal(srv.calls.length, 2);
  }
});

test('gate.allow: a robots.txt answering 5xx refuses this request and is not cached', async () => {
  const clock = fakeClock();
  let status = 503;
  const srv = robotsServer(() => (status === 503 ? res(503, 'down') : res(200, 'User-agent: *\nDisallow: /x\n')));
  const gate = createGate({ fetchImpl: srv.fetchImpl, now: clock.now, sleep: clock.sleep });
  const v = await gate.allow(new URL('https://warcraft.wiki.gg/wiki/A'));
  assert.equal(v.ok, false);
  assert.match(v.reason, /robots\.txt is unavailable right now/);
  status = 200;
  assert.deepEqual(await gate.allow(new URL('https://warcraft.wiki.gg/wiki/A')), { ok: true });
  assert.equal(srv.calls.length, 2);
});

test('gate.allow: a 410 robots.txt allows the page and is cached', async () => {
  const clock = fakeClock();
  const srv = robotsServer(() => res(410));
  const gate = createGate({ fetchImpl: srv.fetchImpl, now: clock.now, sleep: clock.sleep });
  assert.deepEqual(await gate.allow(new URL('https://www.icy-veins.com/a')), { ok: true });
  assert.deepEqual(await gate.allow(new URL('https://www.icy-veins.com/b')), { ok: true });
  assert.equal(srv.calls.length, 1);
});
