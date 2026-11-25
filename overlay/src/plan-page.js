// The game plan page's decisions: what it shows, when the Plan button may switch, what the
// first-use chip sends, and how fold state and the first-use flag are kept in the overlay
// config. Pure: no I/O, no DOM.
import { PLAN_SECTIONS } from './plan-card.js';

export const START_LABEL = 'Start my game plan';
// Sent only when the player clicks the Start chip, and shown as their message: plain words.
// The agent's guidance (skill, chips, how to save) rides along with every plan chat turn as a
// backend-only preface (chat-session.js PLAN_PREFACE).
export const KICKOFF = 'Help me set up my game plan.';
export const INTRO_TEXT = 'No game plan yet: answer a few questions and the companion keeps your goal, build and milestones here.';
export const NO_PLAN_TEXT = 'No game plan yet. It shows here once the companion saves it.';
export const NO_SNAPSHOT_TEXT = 'No character data yet. Log in to WoW and type /fc sync, then open the Plan page again.';
// A character name without any a-z or 0-9 letter gives no plan chat id (see chat-store.js).
export const NO_PLAN_CHAT_TEXT = "The Plan page can't keep a chat for this character's name yet. The normal chat still works.";

// 'card' folds the whole card to its summary line; the rest are the sections.
export const FOLD_IDS = ['card', ...PLAN_SECTIONS.map((s) => s.id)];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Which plan page a first look gets: 'empty' without character data, 'intro' (the plan page
 * opens by itself once, with the Start chip) for a character without a plan who never saw it
 * and has a plan chat, else 'card'. Without a plan chat (hasPlanChat false) the intro never
 * opens: it could not keep its seen flag and would come back on every run.
 */
export function planPageState({ hasSnapshot, hasPlan, introSeen, hasPlanChat = true }) {
  if (!hasSnapshot) return 'empty';
  if (!hasPlan && !introSeen && hasPlanChat) return 'intro';
  return 'card';
}

/** The Plan button switches chats, so it waits like the chat list: never mid-answer. */
export const canSwitch = ({ busy, switching = false }) => !busy && !switching;

/**
 * What the card area shows: 'empty' (no character data), 'unsupported' (no plan chat for this
 * character's name), 'start' (no plan and an empty plan chat: one sentence and the Start
 * chip), 'none' (no plan yet, the interview under way) or 'card'.
 */
export function cardMode({ hasSnapshot, hasPlan, chatEmpty, hasPlanChat = true }) {
  if (!hasSnapshot) return 'empty';
  if (!hasPlanChat) return 'unsupported';
  if (hasPlan) return 'card';
  return chatEmpty ? 'start' : 'none';
}

/**
 * The saved folds with one id folded (false) or unfolded (removed); junk in the saved value is
 * dropped. null for an unknown id or a non-boolean `open`: nothing is saved then.
 */
export function foldsWith(folds, id, open) {
  if (!FOLD_IDS.includes(id) || typeof open !== 'boolean') return null;
  const out = cleanFolds(folds);
  if (open) delete out[id];
  else out[id] = false;
  return out;
}

/** Only known ids folded with false survive from a saved config. */
export function cleanFolds(folds) {
  const out = {};
  if (folds && typeof folds === 'object') for (const k of FOLD_IDS) if (folds[k] === false) out[k] = false;
  return out;
}

/** The per-character first-use flags with this character's set; null for a bad slug. */
export function introSeenWith(seen, slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
  const out = {};
  if (seen && typeof seen === 'object') for (const [k, v] of Object.entries(seen)) if (SLUG_RE.test(k) && v === true) out[k] = true;
  out[slug] = true;
  return out;
}
