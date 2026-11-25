// Decides which saved chat is open, saves messages as they happen, resumes the backend's own
// conversation when a chat is reopened, and falls back to replaying the saved messages when
// it cannot be resumed. Pure logic: files go through the chat store, the backend through the
// client that getClient() returns. No Electron here.
import { isSessionId } from './session-id.js';
import { parseChoices } from './choices.js';
import { isPlanChatId } from './chat-store.js';

export const STALE_AFTER_SEC = 1800;
export const REPLAY_MESSAGES = 30;
export const COMPACT_NOTE = 'Earlier messages summarised: the companion now works from a summary of what came before.';

/** True for the bare `/compact` command typed into the chat. */
export const isCompactCommand = (text) => String(text ?? '').trim().toLowerCase() === '/compact';

// Sent ahead of every turn in the game plan page's chat, to the backend only: never saved,
// never shown. The player's own message stays the plain words they clicked or typed.
export const PLAN_PREFACE = '[This is the game plan page: use the wow-gameplan skill. Ask one question at a time, with reply chips where a few clear answers fit, and save the plan as the wow-gameplan skill says.]';
export const REPLAY_NOTE = 'The companion re-read this chat from the saved messages; details it looked up earlier are gone.';

const PREFACE_START = '[Earlier messages of this chat, for context:]';
const PREFACE_END = '[End of earlier messages.]';
const SPEAKER = { user: 'Player', bot: 'Companion' };

function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function duration(sec) {
  const minutes = Math.floor(sec / 60);
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.floor(sec / 3600);
  if (hours < 24) return plural(hours, 'hour');
  return plural(Math.floor(sec / 86400), 'day');
}

function staleLine(sec) {
  return `[Chat resumed after ${duration(sec)}. The game state has likely changed: check the current state before answering.]`;
}

/** The earlier user/bot messages as a block the backend can read, or '' when there are none. */
function replayPreface(messages) {
  const said = messages.filter((m) => m.role in SPEAKER).slice(-REPLAY_MESSAGES);
  if (!said.length) return '';
  return [PREFACE_START, ...said.map((m) => `${SPEAKER[m.role]}: ${m.text}`), PREFACE_END].join('\n');
}

export function createChatSession({ store, getClient, backend, character, now = () => Math.floor(Date.now() / 1000) }) {
  let chat = store.newChat({ character, backend });
  // Send the saved messages along with the next message (the backend lost or never had them).
  let replay = false;
  // updatedAt of the chat when open() loaded it; null once a send went through.
  let openedAt = null;
  // Notes recorded while a send or compact is running, handed back with its result.
  let fresh = [];

  /** The backend summarised older messages (it says so by itself): keep a note in the chat. */
  function noteCompacted() {
    chat.messages.push({ role: 'note', text: COMPACT_NOTE, at: now() });
    store.save(chat);
    fresh.push(COMPACT_NOTE);
  }

  /** Asks the backend to summarise the older messages now. Sends nothing to the model as a message. */
  async function compact() {
    const client = getClient();
    if (chat.messages.length === 0) throw new Error('Nothing to summarise yet: this chat is empty.');
    if (typeof client.compact !== 'function') {
      throw new Error('This AI backend summarises long chats by itself; /compact is not available with it.');
    }
    fresh = [];
    await client.compact();
    if (fresh.length === 0) noteCompacted(); // a backend that did not report it itself
    const notes = fresh;
    fresh = [];
    return { notes };
  }

  function current() {
    return chat;
  }

  function startNew() {
    getClient().openSession(null);
    chat = store.newChat({ character, backend });
    replay = false;
    openedAt = null;
    return chat;
  }

  function open(id) {
    // The open chat has not been saved yet (no messages), so it is not on disk: keep it.
    if (id === chat.id && chat.messages.length === 0) return chat;
    const loaded = store.load(id);
    if (!loaded) return null;
    const client = getClient();
    // The id comes from a file on disk: one that is not a real session id cannot be resumed.
    const resume = loaded.backend === backend && client.canResume && isSessionId(loaded.backendSessionId);
    client.openSession(resume ? loaded.backendSessionId : null);
    chat = loaded;
    replay = !resume;
    openedAt = loaded.updatedAt;
    return chat;
  }

  // The game plan page's chat (id from planChatId): reopened like any saved chat (resume or
  // replay), or started under that id when it has no file yet. Already open: nothing switches.
  function openPlan(id) {
    if (!isPlanChatId(id)) return null;
    if (chat.id === id) return chat;
    if (store.load(id)) return open(id);
    getClient().openSession(null);
    chat = { ...store.newChat({ character, backend }), id, title: 'Game plan' };
    replay = false;
    openedAt = null;
    return chat;
  }

  function openLatest({ maxAgeSec = 43200 } = {}) {
    const [newest] = store.list({ character });
    if (newest && now() - newest.updatedAt <= maxAgeSec) {
      const opened = open(newest.id);
      if (opened) return opened;
    }
    return startNew();
  }

  async function send(text, { images } = {}) {
    const target = chat;
    const client = getClient();
    const earlier = target.messages.slice();
    fresh = [];
    if (earlier.length === 0 && !isPlanChatId(target.id)) target.title = store.titleFrom(text);
    target.messages.push({ role: 'user', text, at: now() });
    store.save(target);

    const age = openedAt === null ? 0 : now() - openedAt;
    const stale = age > STALE_AFTER_SEC ? staleLine(age) : '';
    let preface = '';
    const build = () => {
      preface = replay ? replayPreface(earlier) : '';
      return [preface, stale, isPlanChatId(target.id) ? PLAN_PREFACE : '', text].filter(Boolean).join('\n\n');
    };

    let answer;
    try {
      try {
        answer = await client.send(build(), { images });
      } catch (err) {
        if (err?.code !== 'session_gone') throw err;
        replay = true;
        client.openSession(null);
        answer = await client.send(build(), { images });
      }
    } catch (err) {
      target.messages.push({ role: 'error', text: String(err?.message ?? err), at: now() });
      store.save(target);
      throw err;
    }

    const notes = fresh;
    fresh = [];
    // Reply chips belong to the moment they were offered: the saved text has no block, so a
    // reopened chat shows none. The page still gets the whole answer to draw them.
    target.messages.push({ role: 'bot', text: parseChoices(answer).text, at: now() });
    if (preface) {
      target.messages.push({ role: 'note', text: REPLAY_NOTE, at: now() });
      notes.push(REPLAY_NOTE);
    }
    target.backend = backend;
    target.backendSessionId = client.sessionId ?? null;
    if (target === chat) {
      replay = false;
      openedAt = null;
    }
    store.save(target);
    return { answer, notes };
  }

  function remove(id) {
    if (id !== chat.id) {
      store.remove(id);
      return { openChanged: false };
    }
    // Switch the backend first: if it refuses (it throws), nothing has been deleted yet.
    startNew();
    store.remove(id);
    return { openChanged: true };
  }

  return { current, startNew, open, openPlan, openLatest, send, remove, compact, noteCompacted };
}
