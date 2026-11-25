import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createChatStore } from '../src/chat-store.js';
import {
  createChatSession,
  STALE_AFTER_SEC,
  REPLAY_MESSAGES,
  REPLAY_NOTE,
} from '../src/chat-session.js';

const PREFACE_START = '[Earlier messages of this chat, for context:]';
const PREFACE_END = '[End of earlier messages.]';
const resumedLine = (d) =>
  `[Chat resumed after ${d}. The game state has likely changed: check the current state before answering.]`;

// Backend session ids are UUIDs (see src/session-id.js): sid(n) makes a distinct one.
const sid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SESS_OLD = sid(101);
const SESS_ABC = sid(102);
const SESS_KEEP = sid(103);
const SESS_OLDER = sid(104);
const SESS_NEWEST = sid(105);
const SESS_JAINA = sid(106);
const PI_SESS = sid(107);
// What the fake client calls its n-th fresh conversation.
const madeId = (n) => sid(n);

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fc-session-'));
}

function gone() {
  return Object.assign(new Error('Claude Code no longer has this conversation'), { code: 'session_gone' });
}

// A stand-in for ClaudeClient/PiClient: records openSession calls and every send, answers from
// a script (a string answers, an Error rejects), and gets a fresh session id when it starts
// without one, as the real clients do.
function fakeClient({ canResume = true, script = [] } = {}) {
  let n = 0;
  const c = {
    canResume,
    sessionId: null,
    opened: [],
    sent: [],
    script: [...script],
    openSession(id) {
      c.opened.push(id);
      c.sessionId = id ?? null;
    },
    async send(text, opts) {
      c.sent.push({ text, opts });
      if (!c.sessionId) c.sessionId = madeId(++n);
      const step = c.script.length ? c.script.shift() : `answer ${c.sent.length}`;
      if (step instanceof Error) {
        if (step.code === 'session_gone') c.sessionId = null;
        throw step;
      }
      return step;
    },
  };
  return c;
}

function setup({ backend = 'claude', character = 'Thrall', canResume = true, script = [], start = 1_800_000_000 } = {}) {
  const dir = tmp();
  const clock = { t: start };
  const now = () => clock.t;
  const store = createChatStore({ dir, now });
  const client = fakeClient({ canResume, script });
  let gets = 0;
  const getClient = () => { gets++; return client; };
  const make = (opts = {}) => createChatSession({ store, getClient, backend, character, now, ...opts });
  return { dir, clock, store, client, make, gets: () => gets };
}

// Writes a chat straight through the store, as an earlier overlay run would have left it.
function seed(store, { character = 'Thrall', backend = 'claude', backendSessionId = SESS_OLD, messages, title = 'Old chat' } = {}) {
  const chat = store.newChat({ character, backend });
  chat.title = title;
  chat.backendSessionId = backendSessionId;
  chat.messages = messages ?? [
    { role: 'user', text: 'q1', at: 1 },
    { role: 'bot', text: 'a1', at: 2 },
  ];
  store.save(chat);
  return chat;
}

test('constants have the agreed values', () => {
  assert.equal(STALE_AFTER_SEC, 1800);
  assert.equal(REPLAY_MESSAGES, 30);
  assert.equal(REPLAY_NOTE, 'The companion re-read this chat from the saved messages; details it looked up earlier are gone.');
});

test('the first message creates and titles the chat and saves the answer', async () => {
  const h = setup({ script: ['Go to Orgrimmar.'] });
  const s = h.make();
  const fresh = s.current();
  assert.deepEqual(fresh.messages, []);
  assert.equal(fresh.title, '');
  const images = [{ mime: 'image/png', data: 'AAAA' }];
  const res = await s.send('Where do I\ntrain my skills?', { images });
  assert.deepEqual(res, { answer: 'Go to Orgrimmar.', notes: [] });
  assert.equal(h.client.sent.length, 1);
  assert.equal(h.client.sent[0].text, 'Where do I\ntrain my skills?');
  assert.equal(h.client.sent[0].opts.images, images, 'images go to the client untouched');
  const saved = h.store.load(fresh.id);
  assert.equal(saved.title, 'Where do I train my skills?');
  assert.deepEqual(saved.messages.map((m) => [m.role, m.text]), [
    ['user', 'Where do I\ntrain my skills?'],
    ['bot', 'Go to Orgrimmar.'],
  ]);
  assert.ok(saved.messages.every((m) => typeof m.at === 'number'));
  assert.equal(saved.backend, 'claude');
  assert.equal(saved.backendSessionId, madeId(1));
  assert.ok(!fs.readFileSync(path.join(h.dir, `${fresh.id}.json`), 'utf8').includes('AAAA'), 'images are never stored');
  assert.equal(s.current().id, fresh.id);
  // A later message keeps the title.
  await s.send('And then?');
  assert.equal(h.store.load(fresh.id).title, 'Where do I train my skills?');
  assert.equal(h.client.sent[1].text, 'And then?');
});

test('a saved answer keeps its text but not its reply chips block', async () => {
  const h = setup({ script: ['Which do you want?\n<choices>\nFast questing\nDungeons\n</choices>\n'] });
  const s = h.make();
  const res = await s.send('What next?');
  assert.match(res.answer, /<choices>/, 'the page gets the whole answer to draw the chips');
  const saved = h.store.load(s.current().id);
  const bot = saved.messages.find((m) => m.role === 'bot');
  assert.equal(bot.text, 'Which do you want?');
  assert.ok(!JSON.stringify(saved).includes('<choices'), 'no block on disk');
});

test('an empty chat is never written to disk', () => {
  const h = setup();
  const s = h.make();
  s.current();
  s.startNew();
  s.openLatest();
  s.startNew();
  assert.deepEqual(fs.existsSync(h.dir) ? fs.readdirSync(h.dir) : [], []);
  assert.equal(s.open(s.current().id), s.current(), 'reopening the unsaved open chat keeps it');
  assert.deepEqual(fs.readdirSync(h.dir), []);
});

test('open resumes the backend conversation and sends the text unchanged when fresh', async () => {
  const h = setup();
  const old = seed(h.store, { backendSessionId: SESS_ABC });
  h.clock.t += 60;
  const s = h.make();
  const before = s.current();
  assert.equal(s.open('20990101-000000-none'), null, 'unknown id');
  assert.equal(s.current(), before, 'unknown id leaves the open chat as it is');
  assert.deepEqual(h.client.opened, []);
  const chat = s.open(old.id);
  assert.equal(chat.id, old.id);
  assert.equal(s.current().id, old.id);
  assert.deepEqual(h.client.opened, [SESS_ABC]);
  const res = await s.send('q2');
  assert.deepEqual(res.notes, []);
  assert.equal(h.client.sent[0].text, 'q2');
  const saved = h.store.load(old.id);
  assert.equal(saved.title, 'Old chat', 'not the first message: title stays');
  assert.deepEqual(saved.messages.map((m) => m.text), ['q1', 'a1', 'q2', 'answer 1']);
  assert.equal(saved.backendSessionId, SESS_ABC);
});

test('a chat older than 30 minutes gets the resumed line, once', async () => {
  const h = setup();
  const old = seed(h.store);
  h.clock.t += 3 * 86400 + 5 * 3600;
  const s = h.make();
  s.open(old.id);
  await s.send('what now?');
  assert.equal(h.client.sent[0].text, `${resumedLine('3 days')}\n\nwhat now?`);
  await s.send('and after that?');
  assert.equal(h.client.sent[1].text, 'and after that?', 'second send has no line');
  const saved = h.store.load(old.id);
  assert.deepEqual(saved.messages.filter((m) => m.role === 'user').map((m) => m.text), ['q1', 'what now?', 'and after that?']);
  assert.ok(!JSON.stringify(saved).includes('Chat resumed'), 'saved user text has no line');

  // Units: floor, singular when 1; 30 minutes or less gets no line.
  const cases = [
    [STALE_AFTER_SEC, null],
    [STALE_AFTER_SEC + 1, '30 minutes'],
    [59 * 60 + 59, '59 minutes'],
    [3600, '1 hour'],
    [2 * 3600 + 59 * 60, '2 hours'],
    [86400, '1 day'],
    [86400 * 2 - 1, '1 day'],
  ];
  for (const [age, words] of cases) {
    const c = seed(h.store);
    h.clock.t += age;
    s.open(c.id);
    const sentBefore = h.client.sent.length;
    await s.send('x');
    const text = h.client.sent[sentBefore].text;
    assert.equal(text, words ? `${resumedLine(words)}\n\nx` : 'x', `age ${age}`);
  }
});

test('a chat from another backend is replayed from saved messages with a note', async () => {
  const h = setup({ backend: 'claude', script: ['a2', 'a3'] });
  const old = seed(h.store, { backend: 'pi', backendSessionId: PI_SESS });
  const s = h.make();
  s.open(old.id);
  assert.deepEqual(h.client.opened, [null]);
  const res = await s.send('q2');
  assert.equal(h.client.sent[0].text, `${PREFACE_START}\nPlayer: q1\nCompanion: a1\n${PREFACE_END}\n\nq2`);
  assert.deepEqual(res, { answer: 'a2', notes: [REPLAY_NOTE] });
  let saved = h.store.load(old.id);
  assert.deepEqual(saved.messages.map((m) => [m.role, m.text]), [
    ['user', 'q1'], ['bot', 'a1'], ['user', 'q2'], ['bot', 'a2'], ['note', REPLAY_NOTE],
  ]);
  assert.equal(saved.backend, 'claude');
  assert.equal(saved.backendSessionId, madeId(1));
  // The replay is done: the next message goes as it is, with no note.
  const res2 = await s.send('q3');
  assert.equal(h.client.sent[1].text, 'q3');
  assert.deepEqual(res2.notes, []);
  saved = h.store.load(old.id);
  assert.equal(saved.messages.filter((m) => m.role === 'note').length, 1);
});

test('replay sends at most the newest 30 user and bot messages, no notes or errors', async () => {
  const h = setup();
  const messages = [];
  for (let i = 1; i <= 25; i++) {
    messages.push({ role: 'user', text: `q${i}`, at: i });
    messages.push({ role: 'bot', text: `a${i}`, at: i });
    if (i % 5 === 0) messages.push({ role: 'note', text: `note ${i}`, at: i });
    if (i % 7 === 0) messages.push({ role: 'error', text: `error ${i}`, at: i });
  }
  const old = seed(h.store, { backend: 'pi', messages });
  const s = h.make();
  s.open(old.id);
  await s.send('now');
  const lines = h.client.sent[0].text.split('\n');
  assert.equal(lines[0], PREFACE_START);
  const end = lines.indexOf(PREFACE_END);
  const body = lines.slice(1, end);
  assert.equal(body.length, REPLAY_MESSAGES);
  const expected = [];
  for (let i = 11; i <= 25; i++) expected.push(`Player: q${i}`, `Companion: a${i}`);
  assert.deepEqual(body, expected);
  assert.deepEqual(lines.slice(end + 1), ['', 'now'], 'the new message is not part of the preface');
  assert.ok(!/note |error /.test(h.client.sent[0].text));
});

test('session_gone falls back to replay once and stores the new session id', async () => {
  const h = setup({ script: [gone(), 'recovered'] });
  const old = seed(h.store, { backendSessionId: SESS_OLD });
  const s = h.make();
  s.open(old.id);
  const res = await s.send('q2');
  assert.deepEqual(h.client.opened, [SESS_OLD, null], 'reopened fresh before the retry');
  assert.equal(h.client.sent.length, 2);
  assert.equal(h.client.sent[0].text, 'q2');
  assert.equal(h.client.sent[1].text, `${PREFACE_START}\nPlayer: q1\nCompanion: a1\n${PREFACE_END}\n\nq2`);
  assert.deepEqual(res, { answer: 'recovered', notes: [REPLAY_NOTE] });
  const saved = h.store.load(old.id);
  assert.equal(saved.backendSessionId, madeId(1));
  assert.deepEqual(saved.messages.map((m) => [m.role, m.text]), [
    ['user', 'q1'], ['bot', 'a1'], ['user', 'q2'], ['bot', 'recovered'], ['note', REPLAY_NOTE],
  ]);

  // A second session_gone in the same send is a normal failure.
  const h2 = setup({ script: [gone(), gone()] });
  const old2 = seed(h2.store, { backendSessionId: SESS_OLD });
  const s2 = h2.make();
  s2.open(old2.id);
  await assert.rejects(s2.send('q2'), (e) => e.code === 'session_gone');
  assert.equal(h2.client.sent.length, 2, 'only one retry');
  const saved2 = h2.store.load(old2.id);
  assert.equal(saved2.backendSessionId, SESS_OLD);
  assert.deepEqual(saved2.messages.slice(-2).map((m) => m.role), ['user', 'error']);
});

test('any other error is saved as an error message and keeps the session id', async () => {
  const h = setup({ script: [new Error('Claude Code exited (code 1)')] });
  const old = seed(h.store, { backendSessionId: SESS_KEEP });
  const s = h.make();
  s.open(old.id);
  await assert.rejects(s.send('q2'), /exited/);
  assert.equal(h.client.sent.length, 1, 'no retry');
  assert.deepEqual(h.client.opened, [SESS_KEEP]);
  const saved = h.store.load(old.id);
  assert.deepEqual(saved.messages.map((m) => [m.role, m.text]), [
    ['user', 'q1'], ['bot', 'a1'], ['user', 'q2'], ['error', 'Claude Code exited (code 1)'],
  ]);
  assert.equal(saved.backendSessionId, SESS_KEEP);

  // A failed first message of a new chat is still saved, titled, with no session id.
  const h2 = setup({ script: [new Error('boom')] });
  const s2 = h2.make();
  await assert.rejects(s2.send('hello'), /boom/);
  const saved2 = h2.store.load(s2.current().id);
  assert.equal(saved2.title, 'hello');
  assert.equal(saved2.backendSessionId, null);
  assert.deepEqual(saved2.messages.map((m) => m.role), ['user', 'error']);
});

test('openLatest reopens a chat under 12 hours old, else starts new', async () => {
  const h = setup();
  const older = seed(h.store, { backendSessionId: SESS_OLDER });
  h.clock.t += 100;
  const newest = seed(h.store, { backendSessionId: SESS_NEWEST });
  h.clock.t += 100;
  seed(h.store, { character: 'Jaina', backendSessionId: SESS_JAINA });
  assert.notEqual(older.id, newest.id);

  h.clock.t += 12 * 3600 - 100; // newest Thrall chat is exactly 12 hours old
  const s = h.make();
  const chat = s.openLatest();
  assert.equal(chat.id, newest.id);
  assert.equal(s.current().id, newest.id);
  assert.deepEqual(h.client.opened, [SESS_NEWEST]);

  h.clock.t += 1; // now 12 hours and 1 second
  const s2 = h.make();
  const fresh = s2.openLatest();
  assert.ok(![older.id, newest.id].includes(fresh.id));
  assert.deepEqual(fresh.messages, []);
  assert.equal(s2.current(), fresh);
  assert.deepEqual(h.client.opened, [SESS_NEWEST, null]);

  const s3 = h.make();
  assert.equal(s3.openLatest({ maxAgeSec: 13 * 3600 }).id, newest.id);
});

test('removing the open chat starts a new one', async () => {
  const h = setup();
  const other = seed(h.store);
  const s = h.make();
  await s.send('first');
  const open = s.current();
  assert.ok(fs.existsSync(path.join(h.dir, `${open.id}.json`)));

  assert.deepEqual(s.remove(other.id), { openChanged: false });
  assert.equal(s.current(), open);
  assert.equal(h.store.load(other.id), null);

  const openedBefore = h.client.opened.length;
  assert.deepEqual(s.remove(open.id), { openChanged: true });
  assert.equal(h.store.load(open.id), null);
  assert.notEqual(s.current().id, open.id);
  assert.deepEqual(s.current().messages, []);
  assert.deepEqual(h.client.opened.slice(openedBefore), [null]);
  await s.send('second');
  assert.equal(h.client.sent[1].text, 'second', 'the new chat does not replay the removed one');
});

test('a client without canResume always replays', async () => {
  const h = setup({ canResume: false, backend: 'pi' });
  const old = seed(h.store, { backend: 'pi', backendSessionId: PI_SESS });
  const s = h.make();
  s.open(old.id);
  assert.deepEqual(h.client.opened, [null]);
  const res = await s.send('q2');
  assert.equal(h.client.sent[0].text, `${PREFACE_START}\nPlayer: q1\nCompanion: a1\n${PREFACE_END}\n\nq2`);
  assert.deepEqual(res.notes, [REPLAY_NOTE]);

  // The same chat opened again replays again.
  s.startNew();
  s.open(old.id);
  await s.send('q3');
  assert.ok(h.client.sent[1].text.startsWith(`${PREFACE_START}\nPlayer: q1\nCompanion: a1\nPlayer: q2\nCompanion: answer 1\n${PREFACE_END}`));
  assert.ok(h.client.sent[1].text.endsWith('\n\nq3'));
});

test('after a failed send the next send still carries the resumed line and the replay', async () => {
  const h = setup({ script: [new Error('boom'), 'ok'] });
  const old = seed(h.store, { backend: 'pi' });
  h.clock.t += 2 * 3600;
  const s = h.make();
  s.open(old.id);
  await assert.rejects(s.send('q2'), /boom/);
  const res = await s.send('q3');
  assert.equal(h.client.sent[1].text,
    `${PREFACE_START}\nPlayer: q1\nCompanion: a1\nPlayer: q2\n${PREFACE_END}\n\n${resumedLine('2 hours')}\n\nq3`);
  assert.deepEqual(res.notes, [REPLAY_NOTE]);
});

test('a saved session id that is not a UUID is never handed to the client: the chat is replayed', async () => {
  for (const bad of ['--dangerously-skip-permissions', 'sess-123', '', 42, [SESS_OLD]]) {
    const h = setup({ script: ['a2'] });
    const old = seed(h.store, { backendSessionId: bad });
    const s = h.make();
    s.open(old.id);
    assert.deepEqual(h.client.opened, [null], `opened fresh for ${JSON.stringify(bad)}`);
    const res = await s.send('q2');
    assert.equal(h.client.sent[0].text, `${PREFACE_START}\nPlayer: q1\nCompanion: a1\n${PREFACE_END}\n\nq2`);
    assert.deepEqual(res.notes, [REPLAY_NOTE]);
    assert.equal(h.store.load(old.id).backendSessionId, madeId(1), 'the bad id is replaced by the new one');
  }
});

test('removing the open chat deletes nothing when the backend cannot switch', async () => {
  const h = setup();
  const s = h.make();
  await s.send('first');
  const open = s.current();
  const file = path.join(h.dir, `${open.id}.json`);
  h.client.openSession = () => { throw new Error('Claude is still answering the previous message'); };
  assert.throws(() => s.remove(open.id), /still answering/);
  assert.ok(fs.existsSync(file), 'the chat file is still there');
  assert.equal(s.current(), open, 'and it is still the open chat');
});

// ---- Compacting: the backend summarises older messages; the chat keeps a note of it ----

test('isCompactCommand: only the bare command counts', async () => {
  const { isCompactCommand } = await import('../src/chat-session.js');
  assert.equal(isCompactCommand('/compact'), true);
  assert.equal(isCompactCommand('  /COMPACT  '), true);
  assert.equal(isCompactCommand('/compact now please'), false);
  assert.equal(isCompactCommand('how do I /compact?'), false);
  assert.equal(isCompactCommand(''), false);
});

test('compact asks the backend, saves one note and sends no message to the model', async () => {
  const { COMPACT_NOTE } = await import('../src/chat-session.js');
  const s = setup();
  let compacted = 0;
  s.client.compact = async () => { compacted++; };
  const session = s.make();
  await session.send('first question');
  const res = await session.compact();
  assert.equal(compacted, 1);
  assert.equal(s.client.sent.length, 1, 'the command itself is not a chat message');
  assert.deepEqual(res.notes, [COMPACT_NOTE]);
  const saved = s.store.load(session.current().id);
  assert.deepEqual(saved.messages.map((m) => m.role), ['user', 'bot', 'note']);
  assert.equal(saved.messages.at(-1).text, COMPACT_NOTE);
});

test('compact on an empty chat or a backend without it says so and saves nothing', async () => {
  const s = setup();
  const session = s.make();
  s.client.compact = async () => {};
  await assert.rejects(() => session.compact(), /nothing to summarise/i);
  delete s.client.compact;
  await session.send('q');
  await assert.rejects(() => session.compact(), /summarises long chats by itself/);
  assert.deepEqual(s.store.load(session.current().id).messages.map((m) => m.role), ['user', 'bot']);
});

test('a backend that fails to compact leaves no note', async () => {
  const s = setup();
  s.client.compact = async () => { throw new Error('Nothing to compact'); };
  const session = s.make();
  await session.send('q');
  await assert.rejects(() => session.compact(), /Nothing to compact/);
  assert.deepEqual(s.store.load(session.current().id).messages.map((m) => m.role), ['user', 'bot']);
});

test('a compaction the backend reports by itself is noted once, with the answer it happened in', async () => {
  const { COMPACT_NOTE } = await import('../src/chat-session.js');
  const s = setup();
  const session = s.make();
  await session.send('q1');
  // The backend compacts while answering q2: main forwards its event to noteCompacted().
  const realSend = s.client.send;
  s.client.send = async (...a) => { session.noteCompacted(); return realSend(...a); };
  const res = await session.send('q2');
  assert.deepEqual(res.notes, [COMPACT_NOTE]);
  const roles = s.store.load(session.current().id).messages.map((m) => m.role);
  assert.deepEqual(roles, ['user', 'bot', 'user', 'note', 'bot']);
  // A manual compact whose backend also reports it does not note it twice.
  s.client.send = realSend;
  s.client.compact = async () => { session.noteCompacted(); };
  const manual = await session.compact();
  assert.deepEqual(manual.notes, [COMPACT_NOTE]);
  assert.equal(s.store.load(session.current().id).messages.filter((m) => m.text === COMPACT_NOTE).length, 2);
});

test('the compact note is not replayed to the backend as something that was said', async () => {
  const { COMPACT_NOTE } = await import('../src/chat-session.js');
  const s = setup({ canResume: false });
  seed(s.store, { messages: [
    { role: 'user', text: 'q1', at: 1 }, { role: 'bot', text: 'a1', at: 2 }, { role: 'note', text: COMPACT_NOTE, at: 3 },
  ] });
  const session = s.make();
  session.open(s.store.list({ character: 'Thrall' })[0].id);
  await session.send('q2');
  assert.ok(!s.client.sent[0].text.includes(COMPACT_NOTE));
});
