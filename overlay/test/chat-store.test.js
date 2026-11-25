import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createChatStore, titleFrom, planChatId } from '../src/chat-store.js';

const ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/;

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fc-chats-'));
}

function clock(start = 1000) {
  let t = start;
  return () => t++;
}

test('a saved chat loads back and appears in the list', () => {
  const dir = tmp();
  const store = createChatStore({ dir, now: () => 5000 });
  const chat = store.newChat({ character: 'Thrall', backend: 'claude' });
  assert.match(chat.id, ID_RE);
  assert.equal(chat.title, '');
  assert.equal(chat.backendSessionId, null);
  assert.deepEqual(chat.messages, []);
  chat.title = 'Hello';
  chat.messages.push({ role: 'user', text: 'hi', at: 1 });
  store.save(chat);
  assert.equal(chat.updatedAt, 5000);
  assert.deepEqual(store.load(chat.id), chat);
  assert.deepEqual(store.list({ character: 'Thrall' }), [
    { id: chat.id, title: 'Hello', updatedAt: 5000 },
  ]);
});

test('the list is newest first and only for the given character', () => {
  const dir = tmp();
  const now = clock(100);
  const store = createChatStore({ dir, now });
  const a = store.newChat({ character: 'Thrall', backend: 'claude' });
  const b = store.newChat({ character: 'Thrall', backend: 'claude' });
  const c = store.newChat({ character: 'Jaina', backend: 'claude' });
  a.id = '20260101-000000-aaaa';
  b.id = '20260101-000000-bbbb';
  c.id = '20260101-000000-cccc';
  store.save(a);
  store.save(c);
  store.save(b);
  const ids = store.list({ character: 'Thrall' }).map((x) => x.id);
  assert.deepEqual(ids, [b.id, a.id]);
  assert.deepEqual(store.list({ character: 'Jaina' }).map((x) => x.id), [c.id]);
  assert.deepEqual(store.list({ character: 'Nobody' }), []);
});

test('a corrupt file and a non-chat json are skipped, not fatal', () => {
  const dir = tmp();
  const store = createChatStore({ dir });
  const chat = store.newChat({ character: 'Thrall', backend: 'claude' });
  store.save(chat);
  fs.writeFileSync(path.join(dir, '20260101-000000-bad1.json'), '{');
  fs.writeFileSync(path.join(dir, '20260101-000000-bad2.json'), '[]');
  fs.writeFileSync(path.join(dir, '20260101-000000-bad3.json'), '{"id":"x"}');
  fs.writeFileSync(path.join(dir, 'notes.json'), '{}');
  const list = store.list({ character: 'Thrall' });
  assert.deepEqual(list.map((x) => x.id), [chat.id]);
});

test('save leaves no temp file behind', () => {
  const dir = tmp();
  const store = createChatStore({ dir });
  const chat = store.newChat({ character: 'Thrall', backend: 'claude' });
  store.save(chat);
  store.save(chat);
  assert.deepEqual(fs.readdirSync(dir), [`${chat.id}.json`]);
});

test('remove deletes the file and tolerates a missing one', () => {
  const dir = tmp();
  const store = createChatStore({ dir });
  const chat = store.newChat({ character: 'Thrall', backend: 'claude' });
  store.save(chat);
  store.remove(chat.id);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(store.load(chat.id), null);
  assert.doesNotThrow(() => store.remove(chat.id));
});

test('ids that are not chat ids are refused', () => {
  const dir = tmp();
  const outer = path.join(dir, 'outer');
  fs.mkdirSync(outer);
  const store = createChatStore({ dir: outer });
  // A complete chat one folder up, whose own id is the path that reaches it: only the id
  // check can keep load() from returning it.
  const outside = { ...store.newChat({ character: 'Thrall', backend: 'claude' }), id: '../x' };
  fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify(outside));
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outer, '../x.json'), 'utf8')), outside, 'the path would resolve');
  assert.equal(store.load('../x'), null);
  assert.equal(store.load(''), null);
  assert.equal(store.load(undefined), null);
  assert.doesNotThrow(() => store.remove('../keep.txt'));
  assert.doesNotThrow(() => store.remove('../../etc'));
  assert.ok(fs.existsSync(path.join(dir, 'keep.txt')));
  assert.ok(fs.existsSync(path.join(dir, 'x.json')));
  assert.throws(() => store.save({ id: '../x', messages: [] }));
  assert.ok(!fs.existsSync(path.join(dir, 'x.json.tmp')));
});

test('titleFrom makes one line of at most 40 characters', () => {
  assert.equal(titleFrom('  hello\n\n  there\tworld '), 'hello there world');
  const long = titleFrom('x'.repeat(200));
  assert.equal(long.length, 40);
  assert.equal(long, 'x'.repeat(39) + '…');
  assert.equal(titleFrom('y'.repeat(40)), 'y'.repeat(40));
  assert.equal(titleFrom(''), 'New chat');
  assert.equal(titleFrom('  \n '), 'New chat');
  const store = createChatStore({ dir: tmp() });
  assert.equal(store.titleFrom('a\nb'), 'a b');
});

test('list on a missing directory is empty', () => {
  const dir = path.join(tmp(), 'does-not-exist');
  const store = createChatStore({ dir });
  assert.deepEqual(store.list({ character: 'Thrall' }), []);
  assert.equal(store.load('20260101-000000-aaaa'), null);
});

test('new ids use local time from now() and 4 random characters', () => {
  const store = createChatStore({ dir: tmp(), now: () => 1767225600 });
  const d = new Date(1767225600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const chat = store.newChat({ character: 'Thrall', backend: 'claude' });
  assert.ok(chat.id.startsWith(stamp + '-'), chat.id);
  assert.match(chat.id, ID_RE);
  assert.equal(chat.createdAt, 1767225600);
});

test('each save writes through its own temp file, named <id>.json.tmp-<pid>-<random>', () => {
  const dir = tmp();
  const store = createChatStore({ dir });
  const chat = store.newChat({ character: 'Thrall', backend: 'claude' });
  const renamed = [];
  const realRename = fs.renameSync;
  fs.renameSync = (from, to) => { renamed.push([from, to]); return realRename(from, to); };
  try {
    store.save(chat);
    store.save(chat);
  } finally {
    fs.renameSync = realRename;
  }
  const target = path.join(dir, `${chat.id}.json`);
  assert.equal(renamed.length, 2);
  for (const [from, to] of renamed) {
    assert.equal(to, target);
    assert.ok(from.startsWith(`${target}.tmp-${process.pid}-`), from);
    assert.match(from.slice(`${target}.tmp-${process.pid}-`.length), /^[0-9a-f]{8,}$/);
  }
  assert.notEqual(renamed[0][0], renamed[1][0], 'two saves never share a temp file');
  assert.deepEqual(fs.readdirSync(dir), [`${chat.id}.json`]);
});

test('a failed save removes its temp file and still throws', () => {
  const dir = tmp();
  const store = createChatStore({ dir });
  const chat = store.newChat({ character: 'Thrall', backend: 'claude' });
  // A folder where the chat file should go: the temp file is written, the rename fails.
  fs.mkdirSync(path.join(dir, `${chat.id}.json`));
  assert.throws(() => store.save(chat));
  assert.deepEqual(fs.readdirSync(dir), [`${chat.id}.json`], 'no temp file left behind');
});

test('a chat file whose inner id is not its file name is skipped', () => {
  const dir = tmp();
  const store = createChatStore({ dir, now: () => 5000 });
  const real = store.newChat({ character: 'Thrall', backend: 'claude' });
  real.id = '20260101-000000-real';
  store.save(real);
  // A copy under another name still says it is the real chat.
  const copy = '20260101-000000-copy';
  fs.copyFileSync(path.join(dir, `${real.id}.json`), path.join(dir, `${copy}.json`));
  assert.deepEqual(store.list({ character: 'Thrall' }).map((x) => x.id), [real.id]);
  assert.equal(store.load(copy), null);
  assert.equal(store.load(real.id).id, real.id);
});

test('a chat without a character name is never listed', () => {
  const dir = tmp();
  const store = createChatStore({ dir });
  const chat = store.newChat({ character: undefined, backend: 'claude' });
  store.save(chat);
  const numbered = store.newChat({ character: 7, backend: 'claude' });
  numbered.id = '20260101-000000-numb';
  store.save(numbered);
  assert.deepEqual(store.list(), []);
  assert.deepEqual(store.list({}), []);
  assert.deepEqual(store.list({ character: undefined }), []);
  assert.deepEqual(store.list({ character: 7 }), []);
});

// ---- The game plan page's chat ----

test('the plan chat id is gameplan-<slug>, only for a real slug', () => {
  assert.equal(planChatId('realm-thrall'), 'gameplan-realm-thrall');
  assert.equal(planChatId(''), null);
  assert.equal(planChatId('../x'), null);
  assert.equal(planChatId(undefined), null);
});

test('the plan chat saves and loads like any chat but never appears in the chat list', () => {
  const dir = tmp();
  const store = createChatStore({ dir, now: clock(100) });
  const normal = store.newChat({ character: 'Thrall', backend: 'claude' });
  normal.messages.push({ role: 'user', text: 'hi', at: 1 });
  store.save(normal);
  const plan = { ...store.newChat({ character: 'Thrall', backend: 'claude' }), id: planChatId('realm-thrall') };
  plan.messages.push({ role: 'user', text: 'Help me set up my game plan.', at: 2 });
  store.save(plan);
  assert.ok(fs.existsSync(path.join(dir, 'gameplan-realm-thrall.json')));
  assert.deepEqual(store.load(plan.id), plan);
  assert.deepEqual(store.list({ character: 'Thrall' }).map((c) => c.id), [normal.id]);
  store.remove(plan.id);
  assert.equal(store.load(plan.id), null);
  assert.throws(() => store.save({ ...plan, id: 'gameplan-../x' }));
});
