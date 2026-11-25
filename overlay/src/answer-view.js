// How the page shows the end of a question. Pure: no DOM.

/** The line shown for a failed question, live or in a reopened chat. */
export const errorLine = (message) => `Could not get an answer: ${message}`;

/**
 * What to do with the pending answer bubble (it shows the thinking indicator until text
 * arrives) once the send is over. `raw` is the text streamed into it so far; `ok` and `answer`
 * come from the send result (leave them out when the call itself failed).
 * Returns { action: 'keep' } | { action: 'fill', text } | { action: 'remove' }.
 */
export function settlePending({ raw, ok, answer } = {}) {
  if (raw) return { action: 'keep' };
  if (ok && answer) return { action: 'fill', text: String(answer) };
  return { action: 'remove' };
}

// What the companion is doing while an answer is open, in the player's words. Tool names come
// from both backends (Claude Code tools and the Pi package's wow_* tools).
const ACTIVITY = {
  compact: 'Summarising earlier messages',
  wow_state: 'Reading your character',
  wow_quests: 'Looking up quests',
  wow_npc: 'Finding NPCs',
  wow_knowledge: 'Checking notes',
  wow_web_fetch: 'Researching',
  wow_plan_write: 'Writing your plan',
  Read: 'Reading your data',
  Glob: 'Reading your data',
  Grep: 'Reading your data',
  Bash: 'Running the toolkit',
  WebSearch: 'Researching',
  WebFetch: 'Researching',
  Write: 'Saving notes',
  Edit: 'Saving notes',
};

/** A plain label for a tool the companion started; unknown tools read as "Working". */
export const activityLabel = (name) => ACTIVITY[name] ?? 'Working';

/** "14s", "1m 5s": how long the current question has been running. */
export function elapsedText(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * The line under a pending answer while the companion still works: what it is doing,
 * animated dots and the time so far. Uses the existing thinking styles (no new CSS).
 */
export function workingHtml(label, sec) {
  return `<p class="working"><span class="muted thinking">${escapeHtml(label)}<span class="dots" aria-hidden="true"></span> <span class="elapsed">${elapsedText(sec)}</span></span></p>`;
}
