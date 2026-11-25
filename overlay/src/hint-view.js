// Decides which hints the chat page draws: rows on the empty chat, chips above the input
// once a conversation is under way. Pure: no I/O, no DOM.
import { MAX_ROWS, MAX_CHIPS } from './hints.js';

// Notices (hints without a prompt, like the update notice) are always shown, first, and take
// none of the slots the chat hints are capped at.
export function visibleHints({ live = [], starters = [], dismissed = new Set(), empty = true } = {}) {
  const open = live.filter((h) => !dismissed.has(h.key));
  const notices = open.filter((h) => h.prompt == null);
  const chat = open.filter((h) => h.prompt != null);
  if (empty) return { rows: [...notices, ...chat.slice(0, MAX_ROWS)], chips: [], starters };
  return { rows: [], chips: [...notices, ...chat.slice(0, MAX_CHIPS)], starters: [] };
}
