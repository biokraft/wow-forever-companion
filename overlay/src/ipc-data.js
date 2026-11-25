import { cleanFolds } from './plan-page.js';
import { planChatId } from './chat-store.js';

// What the main process answers the page with for hints, saved chats and the game plan page. Pure: everything it
// reads comes in as a parameter, so the cases without a config are tested without Electron.

/**
 * Hint chips: the merged (live) snapshot's nudges, with level-ups seen against the synced one,
 * the new-version notice when `update` says a newer release is out, and the hotkey notice
 * when `hotkey` says the key could not be taken. With no config only
 * the starters come back; when the character cannot be read, the notice and the starters.
 */
export function hintsData({ safeConfig, readCharacter, buildHints, starters, update, hotkey }) {
  const cfg = safeConfig();
  if (!cfg) return { live: [], starters };
  let merged = null;
  let synced = null;
  try {
    merged = readCharacter(cfg).snapshot;
    synced = readCharacter(cfg, undefined, { live: false }).snapshot;
  } catch {
    merged = null;
  }
  try {
    return { live: buildHints({ merged, synced, update, hotkey }), starters };
  } catch {
    return { live: [], starters };
  }
}

/**
 * A getter for the chat parts ({ session, store, character }): null while there is no config
 * with a data folder, then `make(cfg)` once, and that same result from then on.
 */
export function lazyChats({ safeConfig, make }) {
  let parts = null;
  return () => {
    if (parts) return parts;
    const cfg = safeConfig();
    if (!cfg?.dataDir) return null;
    parts = make(cfg);
    return parts;
  };
}

/** Saved chats of the current character, newest first, and which one is open. */
export function chatsData({ getChats }) {
  const parts = getChats();
  if (!parts) return { items: [], openId: null };
  return { items: parts.store.list({ character: parts.character }), openId: parts.session.current().id };
}

/**
 * Runs one question at a time. `state.answering` is true from a question's arrival until its
 * answer or error is in; a second question in that time is refused, and neither `run` nor the
 * flag is touched for it.
 */
export async function exclusiveSend(state, run) {
  if (state.answering) return { ok: false, error: 'Still answering the previous message' };
  state.answering = true;
  try {
    return await run();
  } finally {
    state.answering = false;
  }
}

/**
 * The game plan page's data: { hasSnapshot, planChat, plan, level, introSeen, folds }.
 * `planChat` is false when the character's name gives no plan chat id (slug "realm-"). `plan` is the
 * validated plan or null, `level` the live level, `introSeen` the first-use flag of this
 * character, `folds` the saved fold state. Without a config or a readable character:
 * hasSnapshot false and no plan.
 */
export function gamePlanData({ safeConfig, readCharacter, characterSlug }) {
  const cfg = safeConfig();
  const folds = cleanFolds(cfg?.overlay?.planFolds);
  const none = { hasSnapshot: false, planChat: false, plan: null, level: null, introSeen: false, folds };
  if (!cfg) return none;
  let slug;
  let snapshot;
  try {
    slug = characterSlug(cfg);
    snapshot = readCharacter(cfg, undefined, { questTitles: false }).snapshot;
  } catch {
    return none;
  }
  const planChat = planChatId(slug) !== null;
  return {
    hasSnapshot: true,
    planChat,
    plan: snapshot?.gamePlan ?? null,
    level: Number.isFinite(snapshot?.level) ? snapshot.level : null,
    introSeen: planChat && cfg.overlay?.planIntroSeen?.[slug] === true,
    folds,
  };
}

export const MAX_COPY = 20000;

/** The text a copy request from the page may put on the clipboard: a string, not empty, capped; else null. */
export function copyText(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.slice(0, MAX_COPY);
}

/**
 * The address a link click from the page may open in the browser: https only, no user name
 * or password in it, of a sane length; else null.
 */
export function linkToOpen(value) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
  return url.href;
}
