import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TITLE_MAX = 40;

export function titleFrom(text) {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!one) return 'New chat';
  return one.length > TITLE_MAX ? one.slice(0, TITLE_MAX - 1) + '…' : one;
}

function isChat(v) {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof v.id === 'string' &&
    Array.isArray(v.messages) &&
    typeof v.updatedAt === 'number'
  );
}

function makeId(seconds) {
  const d = new Date(seconds * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  let suffix = '';
  for (const b of crypto.randomBytes(4)) suffix += ALPHABET[b % ALPHABET.length];
  return `${stamp}-${suffix}`;
}

export function createChatStore({ dir, now = () => Math.floor(Date.now() / 1000) }) {
  const fileOf = (id) => path.join(dir, `${id}.json`);

  // The file name is the id: a file that says it is another chat is not read as one.
  function readChat(id) {
    try {
      const parsed = JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));
      return isChat(parsed) && parsed.id === id ? parsed : null;
    } catch {
      return null;
    }
  }

  function list({ character } = {}) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      if (!ID_RE.test(id)) continue;
      const chat = readChat(id);
      if (!chat || typeof chat.character !== 'string' || chat.character !== character) continue;
      out.push({ id, title: chat.title, updatedAt: chat.updatedAt });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function load(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    return readChat(id);
  }

  function save(chat) {
    if (!chat || typeof chat.id !== 'string' || !ID_RE.test(chat.id)) {
      throw new Error(`invalid chat id: ${chat && chat.id}`);
    }
    chat.updatedAt = now();
    fs.mkdirSync(dir, { recursive: true });
    const target = fileOf(chat.id);
    // Its own temp file per save (the data folder's git ignores *.tmp-*): two writers never
    // share one, and a crash never leaves a half-written chat.
    const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(chat, null, 2));
      fs.renameSync(tmp, target);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
  }

  function remove(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return;
    fs.rmSync(fileOf(id), { force: true });
  }

  function newChat({ character, backend }) {
    const t = now();
    return {
      id: makeId(t),
      title: '',
      createdAt: t,
      updatedAt: t,
      backend,
      backendSessionId: null,
      character,
      messages: [],
    };
  }

  return { list, load, save, remove, newChat, titleFrom };
}
