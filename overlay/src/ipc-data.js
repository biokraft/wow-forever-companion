// What the main process answers the page with for hints and saved chats. Pure: everything it
// reads comes in as a parameter, so the cases without a config are tested without Electron.

/**
 * Hint chips: the merged (live) snapshot's nudges, with level-ups seen against the synced one,
 * and the new-version notice when `update` says a newer release is out. With no config only
 * the starters come back; when the character cannot be read, the notice and the starters.
 */
export function hintsData({ safeConfig, readCharacter, buildHints, starters, update }) {
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
    return { live: buildHints({ merged, synced, update }), starters };
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
